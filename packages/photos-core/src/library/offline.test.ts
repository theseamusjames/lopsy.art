import { describe, expect, it } from 'vitest';
import { StorageError } from '../storage/errors';
import { MemoryLocalStore } from './local-store';
import { openLibrary } from './session';
import type { SyncTimers } from './sync';
import { TestAdapter } from './test-support/test-adapter';

class FakeTimers implements SyncTimers {
  now = 1_000_000;
  private next = 1;
  private readonly pending = new Map<number, { at: number; fn: () => void }>();
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.pending.set(id, { at: this.now + ms, fn });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number);
  }
  advance(ms: number): void {
    const until = this.now + ms;
    for (;;) {
      const due = [...this.pending].filter(([, t]) => t.at <= until).sort((x, y) => x[1].at - y[1].at)[0];
      if (!due) break;
      this.pending.delete(due[0]);
      this.now = due[1].at;
      due[1].fn();
    }
    this.now = until;
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1));
}

async function seeded() {
  const adapter = new TestAdapter();
  const store = new MemoryLocalStore();
  const first = await openLibrary({ adapter, store, autoSync: false });
  first.setSetting('theme', 'dark');
  await first.syncNow();
  await first.close();
  return { adapter, store, libraryId: first.libraryId };
}

describe('opening without storage', () => {
  it('opens from the device when storage is offline, then catches up', async () => {
    const { adapter, store, libraryId } = await seeded();
    adapter.failNext('network', { count: 1000 });
    const s = await openLibrary({ adapter, store, autoSync: false });
    expect(s.libraryId).toBe(libraryId);
    expect(s.getSyncStatus().state).toBe('offline');
    expect(s.getView().settings.get('theme')).toBe('dark');
    s.setSetting('grid', 'large');
    await s.syncNow();
    expect(s.getSyncStatus()).toMatchObject({ state: 'offline', pendingOps: 1 });

    adapter.clearFailures();
    await s.syncNow();
    expect(s.getSyncStatus()).toMatchObject({ state: 'idle', pendingOps: 0, error: null });
    const other = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false });
    await other.syncNow();
    expect(other.getView().settings.get('grid')).toBe('large');
  });

  it('opens paused when sign-in has expired', async () => {
    const { adapter, store } = await seeded();
    adapter.failNext('auth', { count: 1000 });
    const s = await openLibrary({ adapter, store, autoSync: false });
    expect(s.getSyncStatus().state).toBe('paused');
    adapter.clearFailures();
    await s.syncNow();
    expect(s.getSyncStatus().state).toBe('idle');
  });

  it('retries in the background until storage is back', async () => {
    const { adapter, store } = await seeded();
    const timers = new FakeTimers();
    adapter.failNext('rate-limited', { count: 1000 });
    const s = await openLibrary({ adapter, store, timers, now: () => timers.now });
    timers.advance(0);
    await settle();
    expect(s.getSyncStatus().state).toBe('offline');
    adapter.clearFailures();
    timers.advance(60_000);
    await settle();
    expect(s.getSyncStatus().state).toBe('idle');
    await s.close();
  });

  it('fails when this device has never opened a library', async () => {
    const adapter = new TestAdapter();
    adapter.failNext('network', { count: 1000 });
    await expect(openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false })).rejects.toBeInstanceOf(StorageError);
  });

  it('does not open offline on other errors', async () => {
    const { adapter, store } = await seeded();
    adapter.failNext('invalid', { count: 1000 });
    await expect(openLibrary({ adapter, store, autoSync: false })).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('devices file', () => {
  it('is rewritten at most every 5 minutes on flush', async () => {
    const adapter = new TestAdapter();
    let t = Date.UTC(2026, 10, 18, 9, 0);
    const s = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false, now: () => t });
    const read = async () => {
      const file = (await adapter.listChildren(s.layout.devicesId)).find((f) => f.name === `${s.deviceId}.json`)!;
      return JSON.parse(await (await adapter.readContent(file.id)).text()) as { lastSeenAt: string };
    };
    s.setSetting('a', 1);
    await s.syncNow();
    expect((await read()).lastSeenAt).toBe('2026-11-18T09:00:00.000Z');
    t += 60_000;
    s.setSetting('a', 2);
    await s.syncNow();
    expect((await read()).lastSeenAt).toBe('2026-11-18T09:00:00.000Z');
    t += 5 * 60_000;
    s.setSetting('a', 3);
    await s.syncNow();
    expect((await read()).lastSeenAt).toBe('2026-11-18T09:06:00.000Z');
  });
});
