import { describe, expect, it } from 'vitest';
import { runAdapterContract } from './adapter-contract';
import { StorageError } from './errors';
import { MemoryAdapter } from './memory-adapter';

runAdapterContract('MemoryAdapter', async () => new MemoryAdapter());

describe('MemoryAdapter', () => {
  it('has kind memory', () => {
    expect(new MemoryAdapter().kind).toBe('memory');
  });

  it('throws quota-exceeded past the configured limit', async () => {
    const adapter = new MemoryAdapter({ quotaBytes: 10 });
    const root = await adapter.getRoot();
    const file = await adapter.createFile({ parentId: root.id, name: 'a', mimeType: 'text/plain' }, new Blob(['12345678']));
    await expect(
      adapter.createFile({ parentId: root.id, name: 'b', mimeType: 'text/plain' }, new Blob(['123'])),
    ).rejects.toMatchObject({ code: 'quota-exceeded', retryable: false });
    await expect(adapter.updateContent(file.id, new Blob(['1234567890a']))).rejects.toMatchObject({ code: 'quota-exceeded' });
    await adapter.updateContent(file.id, new Blob(['1234567890']));
    expect(await adapter.getQuota()).toEqual({ usedBytes: 10, limitBytes: 10 });
  });

  it('injects a failure into the next call of a method only', async () => {
    const adapter = new MemoryAdapter();
    const root = await adapter.getRoot();
    adapter.failNext('listChildren', new StorageError('network', 'offline'));
    await expect(adapter.listChildren(root.id)).rejects.toMatchObject({ code: 'network', retryable: true });
    expect(await adapter.listChildren(root.id)).toEqual([]);
    expect(adapter.callCount('listChildren')).toBe(2);
  });

  it('pages the change feed', async () => {
    const adapter = new MemoryAdapter({ changePageSize: 2 });
    const root = await adapter.getRoot();
    const cursor = await adapter.getChangeCursor();
    for (let i = 0; i < 5; i++) {
      await adapter.createFile({ parentId: root.id, name: `f${i}`, mimeType: 'text/plain' }, new Blob([String(i)]));
    }
    const first = await adapter.listChanges(cursor);
    expect(first.changes).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    const second = await adapter.listChanges(first.cursor);
    expect(second.changes).toHaveLength(2);
    const third = await adapter.listChanges(second.cursor);
    expect(third.changes).toHaveLength(1);
    expect(third.hasMore).toBe(false);
    expect((await adapter.listChanges(third.cursor)).changes).toEqual([]);
    const names = [...first.changes, ...second.changes, ...third.changes].map((change) => change.file?.name);
    expect(names).toEqual(['f0', 'f1', 'f2', 'f3', 'f4']);
  });

  it('applies artificial latency', async () => {
    const adapter = new MemoryAdapter({ latencyMs: 20 });
    const started = Date.now();
    await adapter.getRoot();
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });

  it('rejects a malformed cursor', async () => {
    await expect(new MemoryAdapter().listChanges('abc')).rejects.toMatchObject({ code: 'invalid' });
  });
});
