/**
 * The behaviour every StorageAdapter must share, as a Vitest suite. Each
 * adapter's test file runs it, so the memory, local-folder and Drive
 * adapters are held to one definition of the contract in types.ts.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { sha256Hex } from './content-hash';
import { isStorageError } from './errors';
import type { FileId, StorageAdapter, StorageChange, StoredFile } from './types';

function text(value: string, type = 'text/plain'): Blob {
  return new Blob([value], { type });
}

async function expectStorageError(promise: Promise<unknown>, code: string): Promise<void> {
  let caught: unknown = null;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(isStorageError(caught), `expected a StorageError '${code}', got ${String(caught)}`).toBe(true);
  if (isStorageError(caught)) expect(caught.code).toBe(code);
}

async function readAllChanges(adapter: StorageAdapter, cursor: string): Promise<{ changes: StorageChange[]; cursor: string }> {
  const changes: StorageChange[] = [];
  let current = cursor;
  for (let page = 0; page < 1000; page++) {
    const result = await adapter.listChanges(current);
    changes.push(...result.changes);
    current = result.cursor;
    if (!result.hasMore) return { changes, cursor: current };
  }
  throw new Error('The change feed never ended');
}

/** The last state the feed reported for each file. */
function latestById(changes: readonly StorageChange[]): Map<FileId, StoredFile | null> {
  const latest = new Map<FileId, StoredFile | null>();
  for (const change of changes) latest.set(change.fileId, change.file);
  return latest;
}

function ids(files: readonly StoredFile[]): FileId[] {
  return files.map((file) => file.id).sort();
}

export function runAdapterContract(name: string, makeAdapter: () => Promise<StorageAdapter>): void {
  describe(`StorageAdapter contract: ${name}`, () => {
    let adapter: StorageAdapter;
    let root: StoredFile;

    beforeEach(async () => {
      adapter = await makeAdapter();
      root = await adapter.getRoot();
    });

    it('has a root folder with no parent', () => {
      expect(root.isFolder).toBe(true);
      expect(root.parentId).toBeNull();
      expect(root.trashed).toBe(false);
      expect(typeof adapter.label).toBe('string');
    });

    it('creates folders with properties and lists them', async () => {
      const folder = await adapter.createFolder(root.id, 'Photonamous', { 'lp.role': 'library' });
      expect(folder.isFolder).toBe(true);
      expect(folder.name).toBe('Photonamous');
      expect(folder.parentId).toBe(root.id);
      expect(folder.size).toBe(0);
      expect(folder.properties).toEqual({ 'lp.role': 'library' });
      expect(ids(await adapter.listChildren(root.id))).toContain(folder.id);
      expect(await adapter.getFile(folder.id)).toMatchObject({ id: folder.id, name: 'Photonamous', isFolder: true });
    });

    it('creates a file and reads it back whole and by range', async () => {
      const folder = await adapter.createFolder(root.id, 'Originals');
      const content = text('0123456789abcdef');
      const file = await adapter.createFile(
        { parentId: folder.id, name: 'DSCF1234.RAF', mimeType: 'image/x-fuji-raf', properties: { 'lp.role': 'original' } },
        content,
      );
      expect(file).toMatchObject({
        name: 'DSCF1234.RAF',
        parentId: folder.id,
        isFolder: false,
        size: 16,
        mimeType: 'image/x-fuji-raf',
        trashed: false,
        properties: { 'lp.role': 'original' },
      });
      expect(file.sha256).toBe(await sha256Hex(content));
      expect(file.revision).not.toBe('');
      expect(Number.isNaN(Date.parse(file.modifiedTime))).toBe(false);
      expect(await (await adapter.readContent(file.id)).text()).toBe('0123456789abcdef');
      expect(await (await adapter.readContent(file.id, { range: { start: 2, end: 6 } })).text()).toBe('2345');
      expect(await (await adapter.readContent(file.id, { range: { start: 10, end: 16 } })).text()).toBe('abcdef');
      expect(ids(await adapter.listChildren(folder.id))).toEqual([file.id]);
    });

    it('reports read progress ending at the content size', async () => {
      const file = await adapter.createFile({ parentId: root.id, name: 'r.bin', mimeType: 'application/octet-stream' }, new Blob([new Uint8Array(3000)]));
      const whole: [number, number | null][] = [];
      expect((await adapter.readContent(file.id, { onProgress: (received, total) => whole.push([received, total]) })).size).toBe(3000);
      expect(whole[whole.length - 1]).toEqual([3000, 3000]);
      const ranged: [number, number | null][] = [];
      await adapter.readContent(file.id, { range: { start: 100, end: 600 }, onProgress: (received, total) => ranged.push([received, total]) });
      expect(ranged[ranged.length - 1]).toEqual([500, 500]);
      for (let i = 1; i < whole.length; i++) expect(whole[i]?.[0]).toBeGreaterThanOrEqual(whole[i - 1]?.[0] ?? 0);
    });

    it('creates empty files', async () => {
      const file = await adapter.createFile({ parentId: root.id, name: 'empty.txt', mimeType: 'text/plain' }, new Blob([]));
      expect(file.size).toBe(0);
      expect((await adapter.readContent(file.id)).size).toBe(0);
    });

    it('reports write progress ending at the total', async () => {
      const progress: [number, number][] = [];
      await adapter.createFile({ parentId: root.id, name: 'p.bin', mimeType: 'application/octet-stream' }, text('hello'), {
        onProgress: (sent, total) => progress.push([sent, total]),
      });
      expect(progress.length).toBeGreaterThan(0);
      expect(progress[progress.length - 1]).toEqual([5, 5]);
    });

    it('allows two files with the same name in one folder', async () => {
      const a = await adapter.createFile({ parentId: root.id, name: 'same.txt', mimeType: 'text/plain' }, text('first'));
      const b = await adapter.createFile({ parentId: root.id, name: 'same.txt', mimeType: 'text/plain' }, text('second'));
      expect(a.id).not.toBe(b.id);
      expect(b.name).toBe('same.txt');
      expect(await (await adapter.readContent(a.id)).text()).toBe('first');
      expect(await (await adapter.readContent(b.id)).text()).toBe('second');
      expect(ids(await adapter.listChildren(root.id))).toEqual(ids([a, b]));
    });

    it('replaces content, keeping the ID and changing the revision and checksum', async () => {
      const file = await adapter.createFile({ parentId: root.id, name: 'library.json', mimeType: 'application/json' }, text('{"v":1}'));
      const updated = await adapter.updateContent(file.id, text('{"v":2,"more":true}'));
      expect(updated.id).toBe(file.id);
      expect(updated.revision).not.toBe(file.revision);
      expect(updated.size).toBe(19);
      expect(updated.sha256).toBe(await sha256Hex(text('{"v":2,"more":true}')));
      expect(await (await adapter.readContent(file.id)).text()).toBe('{"v":2,"more":true}');
      expect((await adapter.getFile(file.id))?.revision).toBe(updated.revision);
    });

    it('merges properties and removes keys set to null', async () => {
      const file = await adapter.createFile(
        { parentId: root.id, name: 'a.txt', mimeType: 'text/plain', properties: { a: '1', b: '2' } },
        text('x'),
      );
      const updated = await adapter.updateProperties(file.id, { b: null, c: '3' });
      expect(updated.properties).toEqual({ a: '1', c: '3' });
      expect((await adapter.getFile(file.id))?.properties).toEqual({ a: '1', c: '3' });
    });

    it('rejects properties past the limits', async () => {
      const many: Record<string, string> = {};
      for (let i = 0; i < 31; i++) many[`k${i}`] = 'v';
      await expectStorageError(adapter.createFile({ parentId: root.id, name: 'x', mimeType: 'text/plain', properties: many }, text('x')), 'invalid');
      const file = await adapter.createFile({ parentId: root.id, name: 'y', mimeType: 'text/plain' }, text('y'));
      await expectStorageError(adapter.updateProperties(file.id, { long: 'v'.repeat(124) }), 'invalid');
    });

    it('moves a file between folders', async () => {
      const from = await adapter.createFolder(root.id, 'from');
      const to = await adapter.createFolder(root.id, 'to');
      const file = await adapter.createFile({ parentId: from.id, name: 'm.txt', mimeType: 'text/plain' }, text('moving'));
      const moved = await adapter.move(file.id, to.id);
      expect(moved.id).toBe(file.id);
      expect(moved.parentId).toBe(to.id);
      expect(await adapter.listChildren(from.id)).toEqual([]);
      expect(ids(await adapter.listChildren(to.id))).toEqual([file.id]);
      expect(await (await adapter.readContent(file.id)).text()).toBe('moving');
    });

    it('moves a folder with its contents', async () => {
      const a = await adapter.createFolder(root.id, 'a');
      const b = await adapter.createFolder(root.id, 'b');
      const file = await adapter.createFile({ parentId: a.id, name: 'inner.txt', mimeType: 'text/plain' }, text('inner'));
      await adapter.move(a.id, b.id);
      expect(ids(await adapter.listChildren(b.id))).toEqual([a.id]);
      expect(await (await adapter.readContent(file.id)).text()).toBe('inner');
    });

    it('returns null for an unknown file and not-found for its content', async () => {
      expect(await adapter.getFile('no-such-file')).toBeNull();
      await expectStorageError(adapter.readContent('no-such-file'), 'not-found');
    });

    it('finds files by property anywhere, excluding trashed ones', async () => {
      const deep = await adapter.createFolder(root.id, 'deep');
      const deeper = await adapter.createFolder(deep.id, 'deeper');
      const a = await adapter.createFile({ parentId: deeper.id, name: 'a', mimeType: 'text/plain', properties: { 'lp.lib': 'L1' } }, text('a'));
      const b = await adapter.createFile({ parentId: root.id, name: 'b', mimeType: 'text/plain', properties: { 'lp.lib': 'L1' } }, text('b'));
      await adapter.createFile({ parentId: root.id, name: 'c', mimeType: 'text/plain', properties: { 'lp.lib': 'L2' } }, text('c'));
      const folder = await adapter.createFolder(root.id, 'tagged', { 'lp.lib': 'L1' });
      expect(ids(await adapter.findByProperty('lp.lib', 'L1'))).toEqual(ids([a, b, folder]));
      await adapter.trash(b.id);
      expect(ids(await adapter.findByProperty('lp.lib', 'L1'))).toEqual(ids([a, folder]));
      expect(await adapter.findByProperty('lp.lib', 'nothing')).toEqual([]);
    });

    it('finds values containing quotes and backslashes', async () => {
      const value = "it's a \\ test";
      const file = await adapter.createFile({ parentId: root.id, name: "o'brien\\.txt", mimeType: 'text/plain', properties: { note: value } }, text('q'));
      expect(ids(await adapter.findByProperty('note', value))).toEqual([file.id]);
      const folder = await adapter.createFolder(root.id, "it's");
      await adapter.createFile({ parentId: folder.id, name: 'in.txt', mimeType: 'text/plain' }, text('i'));
      expect((await adapter.listChildren(folder.id)).map((child) => child.name)).toEqual(['in.txt']);
    });

    it('trashes and untrashes files, keeping their content and properties', async () => {
      const file = await adapter.createFile({ parentId: root.id, name: 't.txt', mimeType: 'text/plain', properties: { k: 'v' } }, text('keep me'));
      await adapter.trash(file.id);
      expect(ids(await adapter.listChildren(root.id))).not.toContain(file.id);
      const trashed = await adapter.getFile(file.id);
      expect(trashed?.trashed).toBe(true);
      expect(trashed?.properties).toEqual({ k: 'v' });
      expect(await (await adapter.readContent(file.id)).text()).toBe('keep me');
      await adapter.untrash(file.id);
      expect((await adapter.getFile(file.id))?.trashed).toBe(false);
      expect(ids(await adapter.listChildren(root.id))).toContain(file.id);
      expect(await (await adapter.readContent(file.id)).text()).toBe('keep me');
    });

    it('trashing a folder hides what is inside it', async () => {
      const folder = await adapter.createFolder(root.id, 'f');
      const file = await adapter.createFile({ parentId: folder.id, name: 'x', mimeType: 'text/plain', properties: { tag: 'T' } }, text('x'));
      await adapter.trash(folder.id);
      expect(await adapter.findByProperty('tag', 'T')).toEqual([]);
      expect((await adapter.getFile(file.id))?.trashed).toBe(true);
      await adapter.untrash(folder.id);
      expect(ids(await adapter.findByProperty('tag', 'T'))).toEqual([file.id]);
      expect(await (await adapter.readContent(file.id)).text()).toBe('x');
    });

    it('deletes permanently', async () => {
      const file = await adapter.createFile({ parentId: root.id, name: 'gone.txt', mimeType: 'text/plain' }, text('bye'));
      await adapter.deletePermanently(file.id);
      expect(await adapter.getFile(file.id)).toBeNull();
      await expectStorageError(adapter.readContent(file.id), 'not-found');
      expect(ids(await adapter.listChildren(root.id))).not.toContain(file.id);
    });

    it('deletes a trashed file permanently', async () => {
      const file = await adapter.createFile({ parentId: root.id, name: 'gone.txt', mimeType: 'text/plain' }, text('bye'));
      await adapter.trash(file.id);
      await adapter.deletePermanently(file.id);
      expect(await adapter.getFile(file.id)).toBeNull();
    });

    it('reports changes after a cursor', async () => {
      const before = await adapter.createFile({ parentId: root.id, name: 'before.txt', mimeType: 'text/plain' }, text('b'));
      const cursor = await adapter.getChangeCursor();
      const created = await adapter.createFile({ parentId: root.id, name: 'new.txt', mimeType: 'text/plain' }, text('n'));
      const toDelete = await adapter.createFile({ parentId: root.id, name: 'del.txt', mimeType: 'text/plain' }, text('d'));
      await adapter.updateContent(created.id, text('n2'));
      await adapter.deletePermanently(toDelete.id);

      const { changes, cursor: next } = await readAllChanges(adapter, cursor);
      const latest = latestById(changes);
      expect(latest.has(before.id)).toBe(false);
      expect(latest.get(created.id)).toMatchObject({ id: created.id, size: 2, trashed: false });
      expect(latest.has(toDelete.id)).toBe(true);
      expect(latest.get(toDelete.id)).toBeNull();

      const quiet = await readAllChanges(adapter, next);
      expect(quiet.changes.filter((change) => change.fileId === created.id)).toEqual([]);

      await adapter.trash(created.id);
      await adapter.updateProperties(before.id, { seen: 'yes' });
      const later = latestById((await readAllChanges(adapter, quiet.cursor)).changes);
      expect(later.get(created.id)?.trashed).toBe(true);
      expect(later.get(before.id)?.properties).toEqual({ seen: 'yes' });
    });

    it('reports quota usage', async () => {
      await adapter.createFile({ parentId: root.id, name: 'q.bin', mimeType: 'application/octet-stream' }, new Blob([new Uint8Array(1000)]));
      const quota = await adapter.getQuota();
      expect(quota.usedBytes).toBeGreaterThanOrEqual(1000);
      expect(quota.limitBytes === null || quota.limitBytes >= quota.usedBytes).toBe(true);
    });

    it('honours an aborted signal', async () => {
      const controller = new AbortController();
      controller.abort();
      await expectStorageError(
        adapter.createFile({ parentId: root.id, name: 'a', mimeType: 'text/plain' }, text('a'), { signal: controller.signal }),
        'aborted',
      );
      expect(await adapter.listChildren(root.id)).toEqual([]);
      const file = await adapter.createFile({ parentId: root.id, name: 'b', mimeType: 'text/plain' }, text('b'));
      await expectStorageError(adapter.readContent(file.id, { signal: controller.signal }), 'aborted');
    });

    it('rejects writes into a missing folder', async () => {
      await expectStorageError(adapter.createFile({ parentId: 'missing', name: 'a', mimeType: 'text/plain' }, text('a')), 'not-found');
    });
  });
}
