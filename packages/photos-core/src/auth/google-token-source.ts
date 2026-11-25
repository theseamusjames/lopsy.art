/**
 * TokenSource over Google Identity Services' token model (spec 6.4).
 * Browser only. The token lives in memory and nothing about the account is
 * kept by this class.
 *
 * The one scope asked for is `drive.file`: the files this app creates or
 * the user picks for it. No `openid`, `email` or `profile`, so the app is
 * never told who the user is. What it needs, an ID to keep one account's
 * data on this device apart from another's, is Drive's own opaque ID for
 * the account (`fetchDriveAccountId`). Without an email there is no login
 * hint, so Google's popup shows its account chooser.
 *
 * The token model has no refresh token, so a new token needs GIS's popup,
 * and a browser lets a page open a popup only from a click or key press.
 * So the token is renewed from the user's own clicks: once it is 45 minutes
 * old, `refreshOnGesture`, called from any click, asks Google for a new one
 * without showing anything (prompt 'none'). If Google has to ask something
 * first (several accounts are signed in and it cannot tell which), the next
 * click opens its window properly; if the user closes that, nothing more is
 * tried and the token runs its hour. `getToken` still tries a silent
 * refresh of its own when under five minutes remain, which works only where
 * the browser lets that popup through, and throws 'auth' once the token has
 * run out; the UI then shows Reconnect, whose click calls
 * `requestInteractive`.
 */

import { StorageError } from '../storage/errors';
import { loadScript, readGlobal } from './load-script';
import type { TokenSource } from './types';

export const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
/** Everything the sign-in asks for. */
export const GOOGLE_SCOPES = DRIVE_FILE_SCOPE;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const MIN_VALIDITY_MS = 60 * 1000;
/** How old a token is when a click renews it. Google's tokens last an hour. */
export const GESTURE_REFRESH_AGE_MS = 45 * 60 * 1000;
/**
 * How long to leave it after a click whose popup the browser refused: the
 * click was spent on something else that needed it (a file dialog, another
 * window). Short, so one of the next clicks does it.
 */
export const GESTURE_RETRY_MS = 15 * 1000;
/** Where builds that asked for the email kept it as a login hint. Never written now; removed when found. */
export const LEGACY_LOGIN_HINT_KEY = 'photonamous.google-email';

interface TokenResponse {
  readonly access_token?: string;
  readonly expires_in?: number | string;
  readonly scope?: string;
  readonly error?: string;
  readonly error_description?: string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}

interface Oauth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type?: string; message?: string }) => void;
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
   * The Google account this library belongs to (`fetchDriveAccountId`),
   * when reconnecting. Every grant is checked against it, so picking
   * another account in Google's chooser cannot attach that account's Drive
   * to this library.
   */
  readonly expectedAccountId?: string;
  /** For the account check; default globalThis.fetch. */
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
  readonly grantedAt: number;
}

/** Why Google's window gave no token: what a renewal does next depends on it. */
type SignInFailureReason = 'blocked' | 'closed' | 'refused';

class SignInFailure extends StorageError {
  constructor(
    message: string,
    readonly reason: SignInFailureReason,
  ) {
    super('auth', message);
    this.name = 'SignInFailure';
  }
}

/** GIS's `error_callback` types, as its documentation lists them. */
function failureReason(type: string | undefined): SignInFailureReason {
  if (type === 'popup_failed_to_open') return 'blocked';
  if (type === 'popup_closed') return 'closed';
  return 'refused';
}

/**
 * Where renewing from clicks stands for the current token: 'silent' asks
 * without showing anything, 'ask' lets Google show its window, 'off' leaves
 * the token to run out.
 */
type GestureRefresh = 'silent' | 'ask' | 'off';

export class GoogleTokenSource implements TokenSource {
  private token: Grant | null = null;
  private gestureRefresh: GestureRefresh = 'silent';
  private gestureNotBefore = 0;
  private client: TokenClient | null = null;
  private oauth2: Oauth2 | null = null;
  private pending: { resolve: (grant: Grant) => void; reject: (error: unknown) => void } | null = null;
  private inFlight: Promise<string> | null = null;
  private readonly now: () => number;

  constructor(private readonly options: GoogleTokenSourceOptions) {
    this.now = options.now ?? Date.now;
    forgetLegacyLoginHint();
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

  /**
   * Opens Google's popup. Call from a click or key press. A sign-in to an
   * account not yet known here always shows the consent screen; a library's
   * own account, reconnecting, is asked only what Google still needs.
   */
  requestInteractive(): Promise<string> {
    return this.request(this.token === null && this.options.expectedAccountId === undefined ? 'consent' : '');
  }

  /**
   * Renews a token that is 45 minutes old. Call it from every click: a
   * browser opens Google's popup only then, and it does nothing until the
   * token is old enough. The token in use stays good whatever happens here.
   * Resolves true when a new token was taken.
   */
  async refreshOnGesture(): Promise<boolean> {
    const token = this.token;
    if (!token || this.inFlight) return false;
    const now = this.now();
    // Run out: Reconnect, which says what is happening, is the way back.
    if (token.expiresAt - now <= MIN_VALIDITY_MS) return false;
    if (now - token.grantedAt < GESTURE_REFRESH_AGE_MS) return false;
    if (this.gestureRefresh === 'off' || now < this.gestureNotBefore) return false;
    const isSilent = this.gestureRefresh === 'silent';
    try {
      await this.request(isSilent ? 'none' : '', 'keep-current');
      return true;
    } catch (error) {
      if (error instanceof SignInFailure && error.reason === 'blocked') {
        this.gestureNotBefore = this.now() + GESTURE_RETRY_MS;
      } else if (isSilent && !(error instanceof AccountMismatchError)) {
        // Google needs to ask something: let the next click show its window.
        this.gestureRefresh = 'ask';
      } else {
        // The window was closed, or another account was picked: do not open it again unasked.
        this.gestureRefresh = 'off';
      }
      return false;
    }
  }

  invalidate(): void {
    this.token = null;
  }

  /** Revokes the token and forgets it. */
  async signOut(): Promise<void> {
    const token = this.token;
    this.token = null;
    if (token) await revokeToken(token.value);
  }

  /**
   * `onMismatch` says what a grant for another account does to the token
   * in use: a sign-in drops it, a renewal keeps it.
   */
  private request(prompt: string, onMismatch: 'drop-current' | 'keep-current' = 'drop-current'): Promise<string> {
    if (this.inFlight) return this.inFlight;
    const flight = this.ensureClient()
      .then(
        (client) =>
          new Promise<Grant>((resolve, reject) => {
            this.pending = { resolve, reject };
            client.requestAccessToken({ prompt });
          }),
      )
      .then((grant) => this.accept(grant, onMismatch));
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
    this.client = oauth2.initTokenClient({
      client_id: this.options.clientId,
      scope: GOOGLE_SCOPES,
      callback: (response) => this.onResponse(response),
      error_callback: (error) =>
        this.settle(new SignInFailure(error.message ?? `Google sign-in failed (${error.type ?? 'unknown'})`, failureReason(error.type))),
    });
    return this.client;
  }

  /** Keeps a grant once it is known to be for the expected account. */
  private async accept(grant: Grant, onMismatch: 'drop-current' | 'keep-current'): Promise<string> {
    const expected = this.options.expectedAccountId;
    if (expected !== undefined) {
      const actual = await fetchDriveAccountId(grant.value, this.options.fetch);
      if (actual !== expected) {
        if (onMismatch === 'drop-current') this.token = null;
        throw new AccountMismatchError(actual);
      }
    }
    this.token = grant;
    // A new token starts over: its own renewal asks silently first.
    this.gestureRefresh = 'silent';
    this.gestureNotBefore = 0;
    return grant.value;
  }

  private onResponse(response: TokenResponse): void {
    if (response.error || !response.access_token) {
      this.settle(new SignInFailure(response.error_description ?? response.error ?? 'Google returned no token', 'refused'));
      return;
    }
    if (!this.oauth2?.hasGrantedAllScopes(response, DRIVE_FILE_SCOPE)) {
      this.settle(
        new StorageError('auth', 'Google Drive access was not granted. Sign in again and leave "See, edit, create and delete only the specific Google Drive files you use with this app" ticked.'),
      );
      return;
    }
    const seconds = Number(response.expires_in ?? 3600);
    const now = this.now();
    this.settle(null, { value: response.access_token, expiresAt: now + (Number.isFinite(seconds) ? seconds : 3600) * 1000, grantedAt: now });
  }

  private settle(error: StorageError | null, grant?: Grant): void {
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;
    if (error || !grant) pending.reject(error ?? new StorageError('auth', 'Google returned no token'));
    else pending.resolve(grant);
  }
}

/** Removes the email an earlier build kept in localStorage. */
function forgetLegacyLoginHint(): void {
  try {
    localStorage.removeItem(LEGACY_LOGIN_HINT_KEY);
  } catch {
    // No storage (blocked, or not a browser): nothing was kept.
  }
}

/**
 * Drive's own ID for the signed-in account: `about.user.permissionId`, an
 * opaque number that stays the same for the account and says nothing
 * about its owner. Only that field is asked for, so the name, email
 * address and photo Drive could also return never reach the app. The
 * `drive.file` scope is enough for it.
 */
export async function fetchDriveAccountId(
  token: string,
  fetchFn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = (input, init) => globalThis.fetch(input, init),
): Promise<string> {
  let response: Response;
  try {
    response = await fetchFn('https://www.googleapis.com/drive/v3/about?fields=user(permissionId)', {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    throw new StorageError('network', 'Could not reach Google', { cause: error });
  }
  if (response.status === 401 || response.status === 403) throw new StorageError('auth', 'Google refused the token', { status: response.status });
  if (!response.ok) throw new StorageError('unknown', `Google Drive returned ${response.status}`, { status: response.status });
  const body: unknown = await response.json();
  const user: unknown = typeof body === 'object' && body !== null ? Reflect.get(body, 'user') : null;
  const id: unknown = typeof user === 'object' && user !== null ? Reflect.get(user, 'permissionId') : null;
  if (typeof id !== 'string' || id === '') throw new StorageError('unknown', 'Google Drive did not say which account this is');
  return id;
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
