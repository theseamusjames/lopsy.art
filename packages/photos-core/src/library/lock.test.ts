import { describe, expect, it } from 'vitest';
import { MemoryLocalStore } from './local-store';
import { LibraryBusyError, LibraryLockLostError, LOCK_LOST_MESSAGE, WebLocksLibraryLock } from './lock';
import { openLibrary } from './session';
import { FakeLibraryLock } from './test-support/fake-lock';
import { TestAdapter } from './test-support/test-adapter';

describe('one writer per device', () => {
  it('refuses a second session while the first holds the lock', async () => {
    const adapter = new TestAdapter();
    const store = new MemoryLocalStore();
    const lock = new FakeLibraryLock();
    const first = await openLibrary({ adapter, store, lock, autoSync: false });
    await expect(openLibrary({ adapter, store, lock, autoSync: false })).rejects.toBeInstanceOf(LibraryBusyError);
    await first.close();
    const second = await openLibrary({ adapter, store, lock, autoSync: false });
    expect(second.deviceId).toBe(first.deviceId);
  });

  it('lets a new tab take over; the old one stops writing and says why', async () => {
    const adapter = new TestAdapter();
    const store = new MemoryLocalStore();
    const lock = new FakeLibraryLock();
    const old = await openLibrary({ adapter, store, lock, autoSync: false });
    old.setSetting('a', 1);
    await old.syncNow();
    let viewCalls = 0;
    let syncCalls = 0;
    old.subscribe(() => (viewCalls += 1));
    old.subscribeSync(() => (syncCalls += 1));

    const fresh = await openLibrary({ adapter, store, lock, autoSync: false, takeOver: true });
    expect(viewCalls).toBe(1);
    expect(syncCalls).toBeGreaterThan(0);
    expect(old.getSyncStatus()).toMatchObject({ state: 'error', error: LOCK_LOST_MESSAGE });
    expect(() => old.setSetting('b', 2)).toThrow(LibraryLockLostError);
    const writes = adapter.calls.length;
    await old.syncNow();
    expect(adapter.calls.length).toBe(writes);
    await old.close();

    fresh.setSetting('c', 3);
    await fresh.syncNow();
    expect(fresh.getView().settings.get('a')).toBe(1);
    expect(fresh.getSyncStatus().state).toBe('idle');
    expect(lock.isHeld(`photonamous:${fresh.libraryId}`)).toBe(true);
  });
});

/** Just enough of navigator.locks: exclusive locks, ifAvailable and steal. */
class FakeLockManager {
  private held = new Map<string, { reject: (e: unknown) => void; release: () => void }>();

  request(
    name: string,
    options: { ifAvailable?: boolean; steal?: boolean },
    callback: (lock: { name: string } | null) => Promise<void>,
  ): Promise<void> {
    const current = this.held.get(name);
    if (current && options.ifAvailable) return callback(null);
    if (current && options.steal) {
      this.held.delete(name);
      current.reject(new DOMException('Lock stolen', 'AbortError'));
    }
    return new Promise<void>((resolve, reject) => {
      const entry = { reject, release: () => undefined };
      this.held.set(name, entry);
      callback({ name }).then(
        () => {
          if (this.held.get(name) === entry) this.held.delete(name);
          resolve();
        },
        reject,
      );
    });
  }
}

describe('WebLocksLibraryLock', () => {
  it('grants, refuses while held, steals and reports the loss', async () => {
    const lock = new WebLocksLibraryLock(new FakeLockManager());
    const a = await lock.acquire('lib', { steal: false });
    expect(a).not.toBeNull();
    expect(await lock.acquire('lib', { steal: false })).toBeNull();
    let lost = false;
    a!.onLost(() => (lost = true));
    const b = await lock.acquire('lib', { steal: true });
    await Promise.resolve();
    expect(b).not.toBeNull();
    expect(lost).toBe(true);
    b!.release();
    await new Promise((r) => setTimeout(r, 0));
    expect(await lock.acquire('lib', { steal: false })).not.toBeNull();
  });
});
