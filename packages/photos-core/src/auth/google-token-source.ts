/**
 * TokenSource over Google Identity Services' token model (spec 6.4).
 * Browser only. The token lives in memory; only the last email is kept in
 * localStorage, as the login hint that skips the account chooser.
 *
 * The token model has no refresh token, so a new token needs GIS's popup.
 * `getToken` tries a silent refresh (prompt 'none') when under five minutes
 * remain, and throws 'auth' once the token has run out; the UI then shows
 * Reconnect, whose click calls `requestInteractive`.
 */

import { StorageError } from '../storage/errors';
import { loadScript, readGlobal } from './load-script';
import type { GoogleAccount, TokenSource } from './types';

export const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_SCOPES = `openid email profile ${DRIVE_FILE_SCOPE}`;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const MIN_VALIDITY_MS = 60 * 1000;
const LOGIN_HINT_KEY = 'lopsy-photos.google-email';

interface TokenResponse {
  readonly access_token?: string;
  readonly expires_in?: number | string;
  readonly scope?: string;
  readonly error?: string;
  readonly error_description?: string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void;
}

interface Oauth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type?: string; message?: string }) => void;
    login_hint?: string;
  }): TokenClient;
  hasGrantedAllScopes(response: TokenResponse, firstScope: string, ...rest: string[]): boolean;
}

function isOauth2(value: unknown): value is Oauth2 {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'initTokenClient') === 'function' &&
    typeof Reflect.get(value, 'hasGrantedAllScopes') === 'function'
  );
}

export interface GoogleTokenSourceOptions {
  /** The OAuth client ID of the Cloud project. */
  readonly clientId: string;
  readonly now?: () => number;
  /**
   * The Google account (`sub`) this library belongs to, when reconnecting.
   * Every grant is checked against it, so picking another account in
   * Google's chooser cannot attach that account's Drive to this library.
   */
  readonly expectedAccountId?: string;
  /** For the userinfo check; default globalThis.fetch. */
  readonly fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

/** Thrown when Google granted a token for another account than `expectedAccountId`. */
export class AccountMismatchError extends StorageError {
  constructor(readonly actualAccountId: string) {
    super('auth', 'Signed in as a different Google account than the one this library belongs to. Sign in with that account.');
    this.name = 'AccountMismatchError';
  }
}

interface Grant {
  readonly value: string;
  readonly expiresAt: number;
}

export class GoogleTokenSource implements TokenSource {
  private token: { readonly value: string; readonly expiresAt: number } | null = null;
  private client: TokenClient | null = null;
  private oauth2: Oauth2 | null = null;
  private pending: { resolve: (grant: Grant) => void; reject: (error: unknown) => void } | null = null;
  private inFlight: Promise<string> | null = null;
  private readonly now: () => number;

  constructor(private readonly options: GoogleTokenSourceOptions) {
    this.now = options.now ?? Date.now;
  }

  async getToken(): Promise<string> {
    const token = this.token;
    const remaining = token ? token.expiresAt - this.now() : 0;
    if (token && remaining > REFRESH_MARGIN_MS) return token.value;
    if (token && remaining > MIN_VALIDITY_MS) {
      try {
        return await this.request('none');
      } catch (error) {
        if (error instanceof AccountMismatchError) throw error;
        return token.value;
      }
    }
    throw new StorageError('auth', 'Google Drive needs reconnecting');
  }

  /** Opens Google's consent popup. Call from a click or key press. */
  requestInteractive(): Promise<string> {
    return this.request(this.token === null && lastEmail() === null ? 'consent' : '');
  }

  invalidate(): void {
    this.token = null;
  }

  /** Remembers the signed-in email as the next login hint. */
  rememberAccount(account: GoogleAccount): void {
    try {
      localStorage.setItem(LOGIN_HINT_KEY, account.email);
    } catch {
      // Storage can be blocked; the hint only saves a click.
    }
  }

  /** Revokes the token and forgets it and the login hint. */
  async signOut(): Promise<void> {
    const token = this.token;
    this.token = null;
    try {
      localStorage.removeItem(LOGIN_HINT_KEY);
    } catch {
      // Nothing to forget when storage is blocked.
    }
    if (token) await revokeToken(token.value);
  }

  private request(prompt: string): Promise<string> {
    if (this.inFlight) return this.inFlight;
    const flight = this.ensureClient()
      .then(
        (client) =>
          new Promise<Grant>((resolve, reject) => {
            this.pending = { resolve, reject };
            const hint = lastEmail();
            client.requestAccessToken({ prompt, ...(hint === null ? {} : { login_hint: hint }) });
          }),
      )
      .then((grant) => this.accept(grant));
    this.inFlight = flight;
    const clear = (): void => {
      if (this.inFlight === flight) this.inFlight = null;
    };
    flight.then(clear, clear);
    return flight;
  }

  private async ensureClient(): Promise<TokenClient> {
    if (this.client) return this.client;
    // Already present when the page loaded GIS itself, or when an e2e test installed a stub.
    if (!isOauth2(readGlobal('google.accounts.oauth2'))) {
      try {
        await loadScript(GIS_SCRIPT_URL);
      } catch (error) {
        throw new StorageError('network', 'Could not load Google sign-in', { cause: error });
      }
    }
    const oauth2 = readGlobal('google.accounts.oauth2');
    if (!isOauth2(oauth2)) throw new StorageError('unknown', 'Google sign-in did not load');
    this.oauth2 = oauth2;
    const hint = lastEmail();
    this.client = oauth2.initTokenClient({
      client_id: this.options.clientId,
      scope: GOOGLE_SCOPES,
      callback: (response) => this.onResponse(response),
      error_callback: (error) => this.settle(new StorageError('auth', error.message ?? `Google sign-in failed (${error.type ?? 'unknown'})`)),
      ...(hint === null ? {} : { login_hint: hint }),
    });
    return this.client;
  }

  /** Keeps a grant once it is known to be for the expected account. */
  private async accept(grant: Grant): Promise<string> {
    const expected = this.options.expectedAccountId;
    if (expected !== undefined) {
      const account = await fetchGoogleAccount(grant.value, this.options.fetch);
      if (account.id !== expected) {
        this.token = null;
        throw new AccountMismatchError(account.id);
      }
    }
    this.token = grant;
    return grant.value;
  }

  private onResponse(response: TokenResponse): void {
    if (response.error || !response.access_token) {
      this.settle(new StorageError('auth', response.error_description ?? response.error ?? 'Google returned no token'));
      return;
    }
    if (!this.oauth2?.hasGrantedAllScopes(response, DRIVE_FILE_SCOPE)) {
      this.settle(
        new StorageError('auth', 'Google Drive access was not granted. Sign in again and leave "See, edit, create and delete only the specific Google Drive files you use with this app" ticked.'),
      );
      return;
    }
    const seconds = Number(response.expires_in ?? 3600);
    this.settle(null, { value: response.access_token, expiresAt: this.now() + (Number.isFinite(seconds) ? seconds : 3600) * 1000 });
  }

  private settle(error: StorageError | null, grant?: Grant): void {
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;
    if (error || !grant) pending.reject(error ?? new StorageError('auth', 'Google returned no token'));
    else pending.resolve(grant);
  }
}

function lastEmail(): string | null {
  try {
    return localStorage.getItem(LOGIN_HINT_KEY);
  } catch {
    return null;
  }
}

/** The signed-in user, from the OpenID userinfo endpoint. */
export async function fetchGoogleAccount(
  token: string,
  fetchFn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = (input, init) => globalThis.fetch(input, init),
): Promise<GoogleAccount> {
  let response: Response;
  try {
    response = await fetchFn('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` } });
  } catch (error) {
    throw new StorageError('network', 'Could not reach Google', { cause: error });
  }
  if (response.status === 401 || response.status === 403) throw new StorageError('auth', 'Google refused the token', { status: response.status });
  if (!response.ok) throw new StorageError('unknown', `Google userinfo returned ${response.status}`, { status: response.status });
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null) throw new StorageError('unknown', 'Unexpected userinfo response');
  const sub: unknown = Reflect.get(body, 'sub');
  const email: unknown = Reflect.get(body, 'email');
  const name: unknown = Reflect.get(body, 'name');
  const picture: unknown = Reflect.get(body, 'picture');
  if (typeof sub !== 'string' || typeof email !== 'string') throw new StorageError('unknown', 'Unexpected userinfo response');
  return {
    id: sub,
    email,
    name: typeof name === 'string' ? name : email,
    pictureUrl: typeof picture === 'string' ? picture : null,
  };
}

/** Revokes an access token at Google. Failures are ignored: the token expires within the hour anyway. */
export async function revokeToken(
  token: string,
  fetchFn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = (input, init) => globalThis.fetch(input, init),
): Promise<void> {
  try {
    await fetchFn('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    });
  } catch {
    // Offline sign-out still clears the token from memory.
  }
}
