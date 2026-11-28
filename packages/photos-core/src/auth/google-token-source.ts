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
 * without showing anything (prompt 'none'). If that gives no token (Google
 * has to ask something first, the window never answers, or the browser
 * keeps the answer from the page), it is not tried from clicks again, in
 * this browser for a month (`SILENT_RENEWAL_KEY`): a window flashing on
 * every click and giving nothing helps nobody. The sign-in state then says
 * 'renew' once the token is old, and the UI offers Reconnect, whose click
 * calls `requestInteractive`, which always opens Google's window.
 * `getToken` never opens a window itself (outside a click the browser
 * blocks it): it returns the token while a minute of it is left, and
 * otherwise says 'needed' and throws 'auth'.
 *
 * No request waits on Google for ever: one whose window never answers is
 * given up after a while (`SILENT_REQUEST_TIMEOUT_MS`), and a token that
 * arrives later is still taken. `subscribe` and `whenTokenAfter` tell work
 * waiting for sign-in that a new token is here, however it came;
 * `signInState` and `subscribeSignIn` tell the UI whether it needs one.
 */

import { StorageError } from '../storage/errors';
import { abortedError } from '../storage/signals';
import { loadScript, readGlobal } from './load-script';
import type { SignInGate, SignInState, TokenSource } from './types';

export const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
/** Everything the sign-in asks for. */
export const GOOGLE_SCOPES = DRIVE_FILE_SCOPE;
const MIN_VALIDITY_MS = 60 * 1000;
/** Where this browser remembers that a silent renewal gave no token ("fails:<when>"). Nothing about the account. */
export const SILENT_RENEWAL_KEY = 'photonamous.silent-renewal';
/** How long that is believed: a month, then a click tries again. */
export const SILENT_RENEWAL_MEMORY_MS = 30 * 24 * 60 * 60 * 1000;
/** How old a token is when a click renews it. Google's tokens last an hour. */
export const GESTURE_REFRESH_AGE_MS = 45 * 60 * 1000;
/**
 * How long to leave it after a click whose popup the browser refused: the
 * click was spent on something else that needed it (a file dialog, another
 * window). Short, so one of the next clicks does it.
 */
export const GESTURE_RETRY_MS = 15 * 1000;
/**
 * How long a request waits for Google's window to answer before it is given
 * up. GIS reports a window that failed to open or was closed, but a window
 * that never answers (lost to the browser, or to a blocker) would otherwise
 * hold every request behind it: a silent one for good, so in the token's last
 * five minutes every Drive call would wait on it. A late answer is still taken.
 */
export const SILENT_REQUEST_TIMEOUT_MS = 30 * 1000;
export const INTERACTIVE_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
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
  /** How long Google's window may take to answer; default the constants above. */
  readonly requestTimeoutMs?: { readonly silent: number; readonly interactive: number };
  /** Where `SILENT_RENEWAL_KEY` is kept; localStorage by default. */
  readonly memory?: { read(key: string): string | null; write(key: string, value: string | null): void };
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
 * without showing anything, 'off' leaves it to Reconnect.
 */
type GestureRefresh = 'silent' | 'off';

/** A request waiting for Google's answer. */
interface Waiter {
  readonly resolve: (token: string) => void;
  readonly reject: (error: unknown) => void;
  readonly onMismatch: 'drop-current' | 'keep-current';
}

function localMemory(): { read(key: string): string | null; write(key: string, value: string | null): void } {
  return {
    read: (key) => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    write: (key, value) => {
      try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch {
        // No storage: it is tried again next time.
      }
    },
  };
}

export class GoogleTokenSource implements TokenSource, SignInGate {
  private token: Grant | null = null;
  private state: SignInState = 'ok';
  private readonly stateListeners = new Set<() => void>();
  /** Tokens taken so far, for `whenTokenAfter`. */
  private taken = 0;
  private readonly memory: { read(key: string): string | null; write(key: string, value: string | null): void };
  private gestureRefresh: GestureRefresh = 'silent';
  private gestureNotBefore = 0;
  private client: TokenClient | null = null;
  private oauth2: Oauth2 | null = null;
  /** Requests waiting for Google, oldest first: an error answers the oldest, a token all of them. */
  private waiters: Waiter[] = [];
  private inFlight: { readonly promise: Promise<string>; readonly silent: boolean } | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;

  constructor(private readonly options: GoogleTokenSourceOptions) {
    this.now = options.now ?? Date.now;
    this.memory = options.memory ?? localMemory();
    forgetLegacyLoginHint();
  }

  /**
   * Called whenever a new token is taken, however it came (a click's
   * renewal, Reconnect, a late answer), so work waiting for sign-in carries on.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get tokenCount(): number {
    return this.taken;
  }

  whenTokenAfter(count: number, signal?: AbortSignal): Promise<void> {
    if (this.taken > count) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const off = this.subscribe(() => {
        if (this.taken <= count) return;
        off();
        signal?.removeEventListener('abort', aborted);
        resolve();
      });
      const aborted = (): void => {
        off();
        reject(abortedError());
      };
      if (signal?.aborted) aborted();
      else signal?.addEventListener('abort', aborted, { once: true });
    });
  }

  /** 'needed' once work found no usable token, 'renew' when the token is old and only Reconnect can renew it, else 'ok'. */
  signInState(): SignInState {
    return this.state;
  }

  subscribeSignIn(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Work refused for sign-in with a token that looked good (a 401 or 403): Reconnect is wanted. */
  markSignInNeeded(): void {
    this.setState('needed');
  }

  async getToken(): Promise<string> {
    const token = this.token;
    if (token && token.expiresAt - this.now() > MIN_VALIDITY_MS) {
      this.review();
      return token.value;
    }
    this.setState('needed');
    throw new StorageError('auth', 'Google Drive needs reconnecting');
  }

  /**
   * Opens Google's popup. Call from a click or key press. A sign-in to an
   * account not yet known here always shows the consent screen; a library's
   * own account, reconnecting, is asked only what Google still needs.
   */
  requestInteractive(): Promise<string> {
    return this.request(this.token === null && this.options.expectedAccountId === undefined ? 'consent' : '', 'drop-current', true);
  }

  /**
   * Renews a token that is 45 minutes old. Call it from every click: a
   * browser opens Google's popup only then, and it does nothing until the
   * token is old enough. The token in use stays good whatever happens here.
   * Resolves true when a new token was taken.
   */
  async refreshOnGesture(): Promise<boolean> {
    this.review();
    const token = this.token;
    if (!token || this.inFlight) return false;
    const now = this.now();
    // Run out: Reconnect, which says what is happening, is the way back.
    if (token.expiresAt - now <= MIN_VALIDITY_MS) return false;
    if (now - token.grantedAt < GESTURE_REFRESH_AGE_MS) return false;
    if (this.gestureRefresh === 'off' || this.silentKnownToFail() || now < this.gestureNotBefore) return false;
    try {
      await this.request('none', 'keep-current');
      this.memory.write(SILENT_RENEWAL_KEY, null);
      return true;
    } catch (error) {
      if (error instanceof SignInFailure && error.reason === 'blocked') {
        // The click was spent on something else that needed it: one of the next clicks tries.
        this.gestureNotBefore = this.now() + GESTURE_RETRY_MS;
      } else {
        // No token from a silent try (Google has to ask, the window never answered, or another account came
        // back): no more windows from clicks. The UI offers Reconnect once the token is old ('renew').
        if (!(error instanceof AccountMismatchError)) this.memory.write(SILENT_RENEWAL_KEY, `fails:${this.now()}`);
        this.gestureRefresh = 'off';
        this.review();
      }
      return false;
    }
  }

  invalidate(): void {
    this.token = null;
  }

  /** Whether a silent renewal has given no token in this browser in the last month. */
  private silentKnownToFail(): boolean {
    const remembered = this.memory.read(SILENT_RENEWAL_KEY);
    const at = remembered?.startsWith('fails:') ? Number(remembered.slice(6)) : Number.NaN;
    return Number.isFinite(at) && this.now() - at < SILENT_RENEWAL_MEMORY_MS;
  }

  /** 'renew' while the token is old and clicks will not renew it; 'needed' stays until a token comes. */
  private review(): void {
    if (this.state === 'needed') return;
    const token = this.token;
    if (!token) return;
    const old = this.now() - token.grantedAt >= GESTURE_REFRESH_AGE_MS;
    const clicksCannot = this.gestureRefresh === 'off' || this.silentKnownToFail();
    this.setState(old && clicksCannot ? 'renew' : 'ok');
  }

  private setState(next: SignInState): void {
    if (next === this.state) return;
    this.state = next;
    for (const listener of [...this.stateListeners]) {
      try {
        listener();
      } catch (error) {
        console.error('A listener of the sign-in state threw; carrying on:', error);
      }
    }
  }

  /** Revokes the token and forgets it. */
  async signOut(): Promise<void> {
    const token = this.token;
    this.token = null;
    if (token) await revokeToken(token.value);
  }

  /**
   * `onMismatch` says what a grant for another account does to the token
   * in use: a sign-in drops it, a renewal keeps it. A request of the same
   * kind as one in flight joins it; an interactive one opens Google's
   * window even while a silent one waits, and `fresh` (Reconnect's click)
   * opens it whatever is in flight, since an earlier window may never
   * answer. A token from any of them answers all.
   */
  private request(prompt: string, onMismatch: 'drop-current' | 'keep-current' = 'drop-current', fresh = false): Promise<string> {
    const silent = prompt === 'none';
    const current = this.inFlight;
    if (current && !fresh && (current.silent === silent || !current.silent)) return current.promise;
    let resolve: (token: string) => void = () => {};
    let reject: (error: unknown) => void = () => {};
    const promise = new Promise<string>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const waiter: Waiter = { resolve, reject, onMismatch };
    const flight = { promise, silent };
    this.inFlight = flight;
    this.waiters.push(waiter);
    const limits = this.options.requestTimeoutMs ?? { silent: SILENT_REQUEST_TIMEOUT_MS, interactive: INTERACTIVE_REQUEST_TIMEOUT_MS };
    const timer = setTimeout(
      () => this.drop(waiter, new SignInFailure('Google sign-in did not answer', 'closed')),
      silent ? limits.silent : limits.interactive,
    );
    const clear = (): void => {
      clearTimeout(timer);
      if (this.inFlight === flight) this.inFlight = null;
    };
    promise.then(clear, clear);
    this.ensureClient().then(
      (client) => client.requestAccessToken({ prompt }),
      (error: unknown) => this.drop(waiter, error),
    );
    return promise;
  }

  /** Gives up one request, leaving any others waiting. */
  private drop(waiter: Waiter, error: unknown): void {
    const index = this.waiters.indexOf(waiter);
    if (index < 0) return;
    this.waiters.splice(index, 1);
    waiter.reject(error);
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
    // A new token starts over: its own renewal asks silently first (unless that is known to give nothing here).
    this.gestureRefresh = 'silent';
    this.gestureNotBefore = 0;
    this.taken++;
    this.setState('ok');
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('A listener of the Google token threw; carrying on:', error);
      }
    }
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
    if (error || !grant) {
      this.waiters.shift()?.reject(error ?? new StorageError('auth', 'Google returned no token'));
      return;
    }
    // A token answers every request waiting; one that arrives after its request gave up is still taken.
    const waiters = this.waiters.splice(0);
    const onMismatch = waiters.some((w) => w.onMismatch === 'drop-current') ? 'drop-current' : 'keep-current';
    void this.accept(grant, onMismatch).then(
      (token) => {
        for (const w of waiters) w.resolve(token);
      },
      (failure: unknown) => {
        for (const w of waiters) w.reject(failure);
      },
    );
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
