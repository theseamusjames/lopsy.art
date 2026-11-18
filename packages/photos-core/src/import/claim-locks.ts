/**
 * Who runs an import job. A job's lock is held for as long as it runs, so
 * an overlapping resume (a double-click, the resume on connect, another
 * tab) skips it instead of uploading its files a second time.
 *
 * With the Web Locks API the lock spans tabs and dies with the tab. Where
 * it is missing (Node, tests) an in-process lock covers this tab, and the
 * queue's lease covers other tabs.
 */

import { WebLocksLibraryLock } from '../library/lock';

export interface ImportLocks {
  /** True when a lock held in one tab is held for every tab, so the queue's lease is not needed. */
  readonly acrossTabs: boolean;
  /** Takes the lock if nobody holds it, resolving its release; null when it is taken. */
  tryAcquire(name: string): Promise<(() => void) | null>;
}

export function importLockName(jobId: string): string {
  return `lopsy-photos-import:${jobId}`;
}

/** The Web Locks API, through the library lock's handling of it. */
export class WebImportLocks implements ImportLocks {
  readonly acrossTabs = true;
  private readonly lock: WebLocksLibraryLock;

  constructor(lock: WebLocksLibraryLock = new WebLocksLibraryLock()) {
    this.lock = lock;
  }

  async tryAcquire(name: string): Promise<(() => void) | null> {
    const handle = await this.lock.acquire(name, { steal: false });
    return handle ? () => handle.release() : null;
  }
}

/** Locks within one page; other tabs are guarded by the lease. */
export class InProcessImportLocks implements ImportLocks {
  readonly acrossTabs: boolean;
  private readonly held = new Set<string>();

  /** `acrossTabs` is for tests that stand in for Web Locks. */
  constructor(options: { readonly acrossTabs?: boolean } = {}) {
    this.acrossTabs = options.acrossTabs ?? false;
  }

  async tryAcquire(name: string): Promise<(() => void) | null> {
    if (this.held.has(name)) return null;
    this.held.add(name);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.held.delete(name);
    };
  }
}

let shared: ImportLocks | null = null;

/** This page's locks: Web Locks where the browser has them. */
export function defaultImportLocks(): ImportLocks {
  if (!shared) {
    const hasWebLocks = typeof navigator !== 'undefined' && 'locks' in navigator && navigator.locks != null;
    shared = hasWebLocks ? new WebImportLocks() : new InProcessImportLocks();
  }
  return shared;
}
