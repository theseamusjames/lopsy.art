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

export interface GoogleAccount {
  /** Google's stable user ID (`sub`); local data is partitioned by it. */
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly pictureUrl: string | null;
}
