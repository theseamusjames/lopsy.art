/**
 * One writer per device. Tabs on one device share the device ID and seq
 * counter in IndexedDB, so two sessions writing at once could make two
 * different ops with the same ID. A session holds this lock for its life.
 */

export interface LibraryLockHandle {
  /** Called once if another holder steals the lock. */
  onLost(listener: () => void): void;
  release(): void;
}

export interface LibraryLock {
  /**
   * Takes the lock. Resolves null when someone else holds it, unless
   * `steal` is set, which takes it from them.
   */
  acquire(name: string, options: { readonly steal: boolean }): Promise<LibraryLockHandle | null>;
}

export function libraryLockName(libraryId: string): string {
  return `lopsy-photos:${libraryId}`;
}

/** Thrown by `openLibrary` when another tab has the library open. */
export class LibraryBusyError extends Error {
  constructor(message = 'This library is open in another tab.') {
    super(message);
    this.name = 'LibraryBusyError';
  }
}

/** Thrown by commands after another tab took the library over. */
export class LibraryLockLostError extends Error {
  constructor() {
    super(LOCK_LOST_MESSAGE);
    this.name = 'LibraryLockLostError';
  }
}

export const LOCK_LOST_MESSAGE = 'Opened in another tab. Reload this tab to keep working here.';

/** Always granted: for Node, tests and single-tab hosts. */
export class NoopLibraryLock implements LibraryLock {
  async acquire(): Promise<LibraryLockHandle> {
    return { onLost: () => undefined, release: () => undefined };
  }
}

interface MinimalLock {
  readonly name: string;
}

interface MinimalLockManager {
  request(
    name: string,
    options: { ifAvailable?: boolean; steal?: boolean },
    callback: (lock: MinimalLock | null) => Promise<void>,
  ): Promise<void>;
}

/** The Web Locks API (`navigator.locks`), held until release or until stolen. */
export class WebLocksLibraryLock implements LibraryLock {
  private readonly locks: MinimalLockManager;

  constructor(locks: MinimalLockManager = navigator.locks as unknown as MinimalLockManager) {
    this.locks = locks;
  }

  acquire(name: string, options: { readonly steal: boolean }): Promise<LibraryLockHandle | null> {
    return new Promise((resolve, reject) => {
      let granted = false;
      let releaseHeld: () => void = () => undefined;
      const lostListeners: (() => void)[] = [];
      let released = false;
      const held = new Promise<void>((r) => (releaseHeld = r));
      const handle: LibraryLockHandle = {
        onLost: (listener) => lostListeners.push(listener),
        release: () => {
          released = true;
          releaseHeld();
        },
      };
      const request = this.locks.request(
        name,
        options.steal ? { steal: true } : { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            resolve(null);
            return;
          }
          granted = true;
          resolve(handle);
          await held;
        },
      );
      request.catch((error: unknown) => {
        // A stolen lock rejects the holder's request with an AbortError.
        if (granted && !released) {
          for (const listener of lostListeners) listener();
        } else if (!granted) {
          reject(error);
        }
      });
    });
  }
}
