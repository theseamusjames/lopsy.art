import type { LibraryLock, LibraryLockHandle } from '../lock';

/** An in-memory lock shared by the sessions of one test, with steal. */
export class FakeLibraryLock implements LibraryLock {
  private readonly holders = new Map<string, { lost: (() => void)[]; handle: LibraryLockHandle }>();

  isHeld(name: string): boolean {
    return this.holders.has(name);
  }

  async acquire(name: string, options: { readonly steal: boolean }): Promise<LibraryLockHandle | null> {
    const current = this.holders.get(name);
    if (current && !options.steal) return null;
    if (current) {
      this.holders.delete(name);
      for (const listener of current.lost) listener();
    }
    const lost: (() => void)[] = [];
    const handle: LibraryLockHandle = {
      onLost: (listener) => lost.push(listener),
      release: () => {
        if (this.holders.get(name)?.handle === handle) this.holders.delete(name);
      },
    };
    this.holders.set(name, { lost, handle });
    return handle;
  }
}
