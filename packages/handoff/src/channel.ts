/**
 * The window surface the handoff uses, small enough to fake in tests. A
 * browser `Window` satisfies it.
 */

export interface HandoffPeer {
  postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void;
  readonly closed: boolean;
  focus(): void;
}

export interface HandoffMessageEvent {
  readonly data: unknown;
  readonly origin: string;
  readonly source: unknown;
}

export type HandoffListener = (event: HandoffMessageEvent) => void;

export interface HandoffWindow {
  readonly location: { readonly href: string };
  readonly opener: HandoffPeer | null;
  open(url: string, target: string): HandoffPeer | null;
  addEventListener(type: 'message', listener: HandoffListener): void;
  removeEventListener(type: 'message', listener: HandoffListener): void;
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

export class HandoffError extends Error {
  readonly code: 'popup-blocked' | 'timeout' | 'closed' | 'no-opener' | 'refused';
  constructor(code: HandoffError['code'], message: string) {
    super(message);
    this.name = 'HandoffError';
    this.code = code;
  }
}

/** The page's own window, as the handoff surface. */
export function browserWindow(): HandoffWindow {
  return window as unknown as HandoffWindow;
}

/** Resolves a configured app URL (absolute, or a path on this origin) against the page. */
export function resolveAppUrl(url: string, win: HandoffWindow): URL {
  const resolved = new URL(url, win.location.href);
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
    throw new Error(`Handoff URL must be http(s): ${url}`);
  }
  return resolved;
}

/** `base` with one query parameter set, keeping its path and other parameters. */
export function withParam(base: URL, name: string, value: string): string {
  const url = new URL(base.href);
  url.searchParams.set(name, value);
  return url.href;
}

export function createHandoffId(): string {
  return crypto.randomUUID();
}

/**
 * Listens for messages from `origin` (and, when given, from `source`)
 * until `stop` is called. Everything else is ignored.
 */
export function listen(
  win: HandoffWindow,
  origin: string,
  source: () => unknown,
  onMessage: (data: unknown, event: HandoffMessageEvent) => void,
): () => void {
  const listener: HandoffListener = (event) => {
    if (event.origin !== origin) return;
    const expected = source();
    if (expected !== undefined && event.source !== expected) return;
    onMessage(event.data, event);
  };
  win.addEventListener('message', listener);
  return () => win.removeEventListener('message', listener);
}

/**
 * Waits for the first message that `parse` accepts. Rejects with a
 * `timeout` HandoffError after `timeoutMs`, or with `closed` when `isClosed`
 * turns true (checked once a second).
 */
export function waitForMessage<T>(
  win: HandoffWindow,
  options: {
    readonly origin: string;
    readonly source: () => unknown;
    readonly parse: (data: unknown) => T | null;
    readonly timeoutMs: number;
    readonly timeoutMessage: string;
    readonly isClosed?: () => boolean;
    /** Runs once now and again every `repeatMs` until a reply arrives. */
    readonly repeat?: { readonly ms: number; readonly run: () => void };
  },
): Promise<{ message: T; event: HandoffMessageEvent }> {
  return new Promise((resolve, reject) => {
    let deadline = 0;
    let pollTimer = 0;
    let isSettled = false;
    const finish = (): void => {
      isSettled = true;
      stop();
      win.clearTimeout(deadline);
      win.clearTimeout(pollTimer);
    };
    const stop = listen(win, options.origin, options.source, (data, event) => {
      const message = options.parse(data);
      if (message === null) return;
      finish();
      resolve({ message, event });
    });
    deadline = win.setTimeout(() => {
      finish();
      reject(new HandoffError('timeout', options.timeoutMessage));
    }, options.timeoutMs);
    const poll = (): void => {
      if (isSettled) return;
      if (options.isClosed?.()) {
        finish();
        reject(new HandoffError('closed', 'The other window was closed.'));
        return;
      }
      options.repeat?.run();
      if (isSettled) return;
      pollTimer = win.setTimeout(poll, options.repeat?.ms ?? 1000);
    };
    poll();
  });
}
