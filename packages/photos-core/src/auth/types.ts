/**
 * Where an adapter that talks to a web API gets its access token. The
 * Google Identity Services token client is one source; the optional
 * sign-in helper (spec 6.4) would be another; tests use a fixed token.
 */
export interface TokenSource {
  /**
   * A token valid for at least the next minute. May refresh first. Throws
   * `StorageError` with code 'auth' when no token can be had without the
   * user (the UI then shows Reconnect and calls `requestInteractive`).
   */
  getToken(): Promise<string>;

  /**
   * Asks the user again (a popup). Must be called from a user gesture,
   * or the browser blocks the popup.
   */
  requestInteractive(): Promise<string>;

  /** Forget the current token, e.g. after a 401, so the next getToken refreshes. */
  invalidate(): void;
}

/**
 * Whether the storage's sign-in needs the person: 'ok'; 'renew', the token
 * is old and only Reconnect can renew it (it still works); 'needed', work
 * found no usable token and waits for Reconnect.
 */
export type SignInState = 'ok' | 'renew' | 'needed';

/** What work waiting for sign-in needs of a token source (auth/sign-in-wait.ts). */
export interface SignInGate {
  /** How many tokens have been taken so far. */
  readonly tokenCount: number;
  /** Resolves once a token after the `count`th is taken; rejects with 'aborted' when `signal` aborts. */
  whenTokenAfter(count: number, signal?: AbortSignal): Promise<void>;
  /** Says that work is waiting for Reconnect, though the token looked usable (a 401 or 403 from the storage). */
  markSignInNeeded(): void;
}
