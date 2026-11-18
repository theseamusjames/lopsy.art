import { describe, expect, it } from 'vitest';
import { runAdapterContract } from './adapter-contract';
import { INDEX_FILE_NAME, LocalFolderAdapter, TRASH_FOLDER_NAME } from './local-folder-adapter';
import { FakeDirectoryHandle, listPaths, readPath } from './test-support/fake-fs-handle';

function open(handle: FakeDirectoryHandle, changePageSize?: number): Promise<LocalFolderAdapter> {
  return LocalFolderAdapter.open(handle, {
    kind: 'local-folder',
    label: handle.name,
    ...(changePageSize === undefined ? {} : { changePageSize }),
  });
}

runAdapterContract('LocalFolderAdapter (local folder)', () => open(new FakeDirectoryHandle('Pictures')));
runAdapterContract('LocalFolderAdapter (paged changes)', () => open(new FakeDirectoryHandle('Pictures'), 2));
runAdapterContract('LocalFolderAdapter (browser)', () =>
  LocalFolderAdapter.open(new FakeDirectoryHandle('lopsy-photos'), {
    kind: 'browser',
    label: 'This browser',
    estimate: async () => ({ usage: 0, quota: 1e9 }),
  }),
);

describe('LocalFolderAdapter', () => {
  it('lays files out on disk like the Drive library', async () => {
    const disk = new FakeDirectoryHandle('Pictures');
    const adapter = await open(disk);
    const root = await adapter.getRoot();
    expect(root.name).toBe('Pictures');
    expect(adapter.kind).toBe('local-folder');
    const library = await adapter.createFolder(root.id, 'Lopsy Photos', { 'lp.role': 'library' });
    const originals = await adapter.createFolder(library.id, 'Originals');
    const year = await adapter.createFolder(originals.id, '2026');
    const day = await adapter.createFolder(year.id, '2026-11-14');
    await adapter.createFile({ parentId: day.id, name: 'DSCF1234.RAF', mimeType: 'image/x-fuji-raf' }, new Blob(['raw']));

    expect(await readPath(disk, 'Lopsy Photos/Originals/2026/2026-11-14/DSCF1234.RAF')).toBe('raw');
    expect(await listPaths(disk)).toEqual([
      INDEX_FILE_NAME,
      'Lopsy Photos/',
      'Lopsy Photos/Originals/',
      'Lopsy Photos/Originals/2026/',
      'Lopsy Photos/Originals/2026/2026-11-14/',
      'Lopsy Photos/Originals/2026/2026-11-14/DSCF1234.RAF',
    ]);
  });

  it('gives a duplicate name a numbered name on disk but keeps its own name', async () => {
    const disk = new FakeDirectoryHandle('Pictures');
    const adapter = await open(disk);
    const root = await adapter.getRoot();
    await adapter.createFile({ parentId: root.id, name: 'a.jpg', mimeType: 'image/jpeg' }, new Blob(['1']));
    const second = await adapter.createFile({ parentId: root.id, name: 'A.jpg', mimeType: 'image/jpeg' }, new Blob(['2']));
    expect(second.name).toBe('A.jpg');
    expect(await readPath(disk, 'A (2).jpg')).toBe('2');
    const reserved = await adapter.createFile({ parentId: root.id, name: TRASH_FOLDER_NAME, mimeType: 'text/plain' }, new Blob(['r']));
    expect(reserved.name).toBe(TRASH_FOLDER_NAME);
    expect(await readPath(disk, `${TRASH_FOLDER_NAME} (2)`)).toBe('r');
  });

  it('moves trashed files into the hidden trash folder and back', async () => {
    const disk = new FakeDirectoryHandle('Pictures');
    const adapter = await open(disk);
    const root = await adapter.getRoot();
    const folder = await adapter.createFolder(root.id, 'Exports');
    const file = await adapter.createFile({ parentId: folder.id, name: 'x.jpg', mimeType: 'image/jpeg' }, new Blob(['x']));
    await adapter.trash(file.id);
    expect(await readPath(disk, 'Exports/x.jpg')).toBeNull();
    expect(await readPath(disk, `${TRASH_FOLDER_NAME}/${file.id}`)).toBe('x');
    await adapter.untrash(file.id);
    expect(await readPath(disk, 'Exports/x.jpg')).toBe('x');
    expect(await readPath(disk, `${TRASH_FOLDER_NAME}/${file.id}`)).toBeNull();

    await adapter.trash(folder.id);
    expect(await readPath(disk, `${TRASH_FOLDER_NAME}/${folder.id}/x.jpg`)).toBe('x');
    expect(await listPaths(disk)).not.toContain('Exports/');
  });

  it('never deletes files the index does not know', async () => {
    const disk = new FakeDirectoryHandle('Pictures');
    const adapter = await open(disk);
    const root = await adapter.getRoot();
    const folder = await adapter.createFolder(root.id, 'Mine');
    await adapter.createFile({ parentId: folder.id, name: 'known.txt', mimeType: 'text/plain' }, new Blob(['k']));
    const dir = await disk.getDirectoryHandle('Mine');
    const writable = await (await dir.getFileHandle('hand-made.txt', { create: true })).createWritable();
    await writable.write(new Blob(['mine']));
    await writable.close();
    await adapter.deletePermanently(folder.id);
    expect(await readPath(disk, 'Mine/hand-made.txt')).toBe('mine');
    expect(await readPath(disk, 'Mine/known.txt')).toBeNull();
  });

  it('keeps IDs, properties and the change feed across reopening', async () => {
    const disk = new FakeDirectoryHandle('Pictures');
    const first = await open(disk);
    const root = await first.getRoot();
    const cursor = await first.getChangeCursor();
    const file = await first.createFile(
      { parentId: root.id, name: 'f.txt', mimeType: 'text/plain', properties: { 'lp.role': 'original' } },
      new Blob(['hello']),
    );
    await first.trash(file.id);

    const second = await open(disk);
    expect((await second.getRoot()).id).toBe(root.id);
    expect(await second.getFile(file.id)).toEqual(await first.getFile(file.id));
    await second.untrash(file.id);
    expect(await (await second.readContent(file.id)).text()).toBe('hello');
    const changes = await second.listChanges(cursor);
    expect(changes.changes.map((change) => change.fileId)).toContain(file.id);
  });

  it('serializes concurrent writes so the index stays whole', async () => {
    const disk = new FakeDirectoryHandle('Pictures');
    const adapter = await open(disk);
    const root = await adapter.getRoot();
    const created = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        adapter.createFile({ parentId: root.id, name: `f${i}.txt`, mimeType: 'text/plain', properties: { n: String(i) } }, new Blob([String(i)])),
      ),
    );
    await Promise.all(created.map((file, i) => adapter.updateProperties(file.id, { m: String(i * 2) })));
    const reopened = await open(disk);
    const children = await reopened.listChildren(root.id);
    expect(children).toHaveLength(25);
    for (const file of created) {
      const stored = await reopened.getFile(file.id);
      expect(stored?.properties.m).toBe(String(Number(stored?.properties.n) * 2));
    }
  });

  it('reports the browser quota and refuses writes past it', async () => {
    const adapter = await LocalFolderAdapter.open(new FakeDirectoryHandle('lopsy-photos'), {
      kind: 'browser',
      label: 'This browser',
      estimate: async () => ({ usage: 95, quota: 100 }),
    });
    const root = await adapter.getRoot();
    expect((await adapter.getQuota()).limitBytes).toBe(100);
    await expect(
      adapter.createFile({ parentId: root.id, name: 'big', mimeType: 'application/octet-stream' }, new Blob([new Uint8Array(10)])),
    ).rejects.toMatchObject({ code: 'quota-exceeded' });
  });

  it('refuses a damaged index', async () => {
    const disk = new FakeDirectoryHandle('Pictures');
    const writable = await (await disk.getFileHandle(INDEX_FILE_NAME, { create: true })).createWritable();
    await writable.write(new Blob(['{"version": 7}']));
    await writable.close();
    await expect(open(disk)).rejects.toMatchObject({ code: 'unknown' });
  });
});
