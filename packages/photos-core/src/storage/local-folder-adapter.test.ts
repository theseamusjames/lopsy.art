import { describe, expect, it } from 'vitest';
import { runAdapterContract } from './adapter-contract';
import { INDEX_FILE_NAME, LocalFolderAdapter, TRASH_FOLDER_NAME } from './local-folder-adapter';
import { FakeDirectoryHandle, failNextWrites, listPaths, readPath } from './test-support/fake-fs-handle';

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
  LocalFolderAdapter.open(new FakeDirectoryHandle('photonamous'), {
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
    const library = await adapter.createFolder(root.id, 'Photonamous', { 'lp.role': 'library' });
    const originals = await adapter.createFolder(library.id, 'Originals');
    const year = await adapter.createFolder(originals.id, '2026');
    const day = await adapter.createFolder(year.id, '2026-11-14');
    await adapter.createFile({ parentId: day.id, name: 'DSCF1234.RAF', mimeType: 'image/x-fuji-raf' }, new Blob(['raw']));

    expect(await readPath(disk, 'Photonamous/Originals/2026/2026-11-14/DSCF1234.RAF')).toBe('raw');
    expect(await listPaths(disk)).toEqual([
      INDEX_FILE_NAME,
      'Photonamous/',
      'Photonamous/Originals/',
      'Photonamous/Originals/2026/',
      'Photonamous/Originals/2026/2026-11-14/',
      'Photonamous/Originals/2026/2026-11-14/DSCF1234.RAF',
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
    const adapter = await LocalFolderAdapter.open(new FakeDirectoryHandle('photonamous'), {
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

describe('LocalFolderAdapter on a folder with files it does not know', () => {
  async function writeText(dir: FakeDirectoryHandle, name: string, text: string): Promise<void> {
    const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await writable.write(new Blob([text]));
    await writable.close();
  }

  it('never overwrites files or folders already on disk', async () => {
    const disk = new FakeDirectoryHandle('Pictures');
    const existing = await disk.getDirectoryHandle('Photonamous', { create: true });
    await writeText(existing, 'library.json', 'the real one');
    await writeText(disk, 'DSCF1234.JPG', 'real photo');
    const adapter = await open(disk);
    const root = await adapter.getRoot();
    const library = await adapter.createFolder(root.id, 'Photonamous');
    const photo = await adapter.createFile({ parentId: root.id, name: 'DSCF1234.JPG', mimeType: 'image/jpeg' }, new Blob(['imported']));
    expect(photo.name).toBe('DSCF1234.JPG');
    expect(await readPath(disk, 'DSCF1234.JPG')).toBe('real photo');
    expect(await readPath(disk, 'DSCF1234 (2).JPG')).toBe('imported');
    await adapter.createFile({ parentId: library.id, name: 'library.json', mimeType: 'application/json' }, new Blob(['ours']));
    expect(await readPath(disk, 'Photonamous/library.json')).toBe('the real one');
    expect(await readPath(disk, 'Photonamous (2)/library.json')).toBe('ours');

    const other = await adapter.createFolder(root.id, 'Other');
    await writeText(await disk.getDirectoryHandle('Other'), 'DSCF1234 (2).JPG', 'someone else');
    await adapter.move(photo.id, other.id);
    expect(await readPath(disk, 'Other/DSCF1234 (2).JPG')).toBe('someone else');
    expect(await (await adapter.readContent(photo.id)).text()).toBe('imported');
  });

  it('keeps the index and the bytes in step when a trash or move runs out of space', async () => {
    const disk = new FakeDirectoryHandle('Pictures');
    const adapter = await open(disk);
    const root = await adapter.getRoot();
    const folder = await adapter.createFolder(root.id, 'Elsewhere');
    const file = await adapter.createFile({ parentId: root.id, name: 'keep.raf', mimeType: 'image/x-fuji-raf' }, new Blob(['raw']));

    failNextWrites(1);
    await expect(adapter.trash(file.id)).rejects.toMatchObject({ code: 'quota-exceeded' });
    expect((await adapter.getFile(file.id))?.trashed).toBe(false);
    expect(await (await adapter.readContent(file.id)).text()).toBe('raw');

    failNextWrites(1);
    await expect(adapter.move(file.id, folder.id)).rejects.toMatchObject({ code: 'quota-exceeded' });
    expect((await adapter.getFile(file.id))?.parentId).toBe(root.id);
    expect(await (await adapter.readContent(file.id)).text()).toBe('raw');
    expect(await listPaths(disk)).not.toContain('Elsewhere/keep.raf');

    const reopened = await open(disk);
    expect(await (await reopened.readContent(file.id)).text()).toBe('raw');
    await reopened.trash(file.id);
    expect((await reopened.getFile(file.id))?.trashed).toBe(true);
  });
});

describe('LocalFolderAdapter when the index cannot be saved', () => {
  /** Makes the next write of the index fail as if the disk were full. */
  function failIndexWritesOn(disk: FakeDirectoryHandle): { arm(): void } {
    let armed = false;
    const original = disk.getFileHandle.bind(disk);
    disk.getFileHandle = async (name: string, options?: { create?: boolean }) => {
      if (armed && name === INDEX_FILE_NAME && options?.create) {
        armed = false;
        throw new DOMException('full', 'QuotaExceededError');
      }
      return original(name, options);
    };
    return {
      arm: () => {
        armed = true;
      },
    };
  }

  async function setup(): Promise<{ disk: FakeDirectoryHandle; adapter: LocalFolderAdapter; rootId: string; fileId: string; folderId: string; fail: { arm(): void } }> {
    const disk = new FakeDirectoryHandle('Pictures');
    const adapter = await open(disk);
    const root = await adapter.getRoot();
    const folder = await adapter.createFolder(root.id, 'Elsewhere');
    const file = await adapter.createFile({ parentId: root.id, name: 'keep.raf', mimeType: 'image/x-fuji-raf' }, new Blob(['raw']));
    return { disk, adapter, rootId: root.id, fileId: file.id, folderId: folder.id, fail: failIndexWritesOn(disk) };
  }

  it('a trash keeps the original where the saved index says', async () => {
    const { disk, adapter, fileId, fail } = await setup();
    fail.arm();
    await expect(adapter.trash(fileId)).rejects.toMatchObject({ code: 'quota-exceeded' });
    expect((await adapter.getFile(fileId))?.trashed).toBe(false);
    expect(await (await adapter.readContent(fileId)).text()).toBe('raw');
    const reopened = await open(disk);
    expect((await reopened.getFile(fileId))?.trashed).toBe(false);
    expect(await (await reopened.readContent(fileId)).text()).toBe('raw');
    expect(await listPaths(disk)).not.toContain(`${TRASH_FOLDER_NAME}/${fileId}`);
  });

  it('a move keeps the original where the saved index says', async () => {
    const { disk, adapter, rootId, fileId, folderId, fail } = await setup();
    fail.arm();
    await expect(adapter.move(fileId, folderId)).rejects.toMatchObject({ code: 'quota-exceeded' });
    expect((await adapter.getFile(fileId))?.parentId).toBe(rootId);
    const reopened = await open(disk);
    expect((await reopened.getFile(fileId))?.parentId).toBe(rootId);
    expect(await (await reopened.readContent(fileId)).text()).toBe('raw');
    expect(await readPath(disk, 'Elsewhere/keep.raf')).toBeNull();
  });

  it('an untrash keeps the original where the saved index says', async () => {
    const { disk, adapter, fileId, fail } = await setup();
    await adapter.trash(fileId);
    fail.arm();
    await expect(adapter.untrash(fileId)).rejects.toMatchObject({ code: 'quota-exceeded' });
    const reopened = await open(disk);
    expect((await reopened.getFile(fileId))?.trashed).toBe(true);
    expect(await (await reopened.readContent(fileId)).text()).toBe('raw');
  });

  it('a create leaves no entry and no stray file', async () => {
    const { disk, adapter, rootId, fail } = await setup();
    fail.arm();
    await expect(
      adapter.createFile({ parentId: rootId, name: 'new.jpg', mimeType: 'image/jpeg' }, new Blob(['new'])),
    ).rejects.toMatchObject({ code: 'quota-exceeded' });
    expect((await adapter.listChildren(rootId)).map((child) => child.name).sort()).toEqual(['Elsewhere', 'keep.raf']);
    expect(await readPath(disk, 'new.jpg')).toBeNull();
  });

  it('a permanent delete that cannot be saved keeps the file', async () => {
    const { disk, adapter, fileId, fail } = await setup();
    fail.arm();
    await expect(adapter.deletePermanently(fileId)).rejects.toMatchObject({ code: 'quota-exceeded' });
    const reopened = await open(disk);
    expect(await (await reopened.readContent(fileId)).text()).toBe('raw');
    await reopened.deletePermanently(fileId);
    expect(await reopened.getFile(fileId)).toBeNull();
    expect(await readPath(disk, 'keep.raf')).toBeNull();
  });
});

describe('LocalFolderAdapter with a hand-edited index', () => {
  function entry(id: string, parentId: string | null, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id,
      name: id,
      parentId,
      isFolder: true,
      size: 0,
      mimeType: 'application/vnd.google-apps.folder',
      modifiedTime: '2026-11-18T00:00:00.000Z',
      sha256: null,
      revision: 1,
      properties: {},
      explicitlyTrashed: false,
      seq: 1,
      diskName: id,
      ...extra,
    };
  }

  async function diskWithIndex(entries: Record<string, unknown>[], rootId = 'root'): Promise<FakeDirectoryHandle> {
    const disk = new FakeDirectoryHandle('Pictures');
    const writable = await (await disk.getFileHandle(INDEX_FILE_NAME, { create: true })).createWritable();
    await writable.write(new Blob([JSON.stringify({ version: 1, rootId, seq: 5, entries, tombstones: [] })]));
    await writable.close();
    return disk;
  }

  const root = entry('root', null, { diskName: undefined });

  it('drops a parent cycle instead of hanging', async () => {
    const disk = await diskWithIndex([root, entry('a', 'b'), entry('b', 'a'), entry('ok', 'root')]);
    const adapter = await open(disk);
    expect(await adapter.getFile('a')).toBeNull();
    expect(await adapter.getFile('b')).toBeNull();
    expect((await adapter.listChildren('root')).map((child) => child.id)).toEqual(['ok']);
    expect(await adapter.findByProperty('x', 'y')).toEqual([]);
    const reopened = await open(disk);
    expect(await reopened.getFile('a')).toBeNull();
  });

  it('drops entries whose names on disk are unsafe or reserved', async () => {
    const disk = await diskWithIndex([
      root,
      entry('up', 'root', { diskName: '../escape' }),
      entry('index', 'root', { isFolder: false, mimeType: 'application/json', diskName: INDEX_FILE_NAME }),
      entry('trash', 'root', { diskName: TRASH_FOLDER_NAME.toUpperCase() }),
      entry('implicit', 'root', { isFolder: false, mimeType: 'text/plain', diskName: undefined, name: INDEX_FILE_NAME }),
      entry('evil/id', 'root', { explicitlyTrashed: true, diskName: 'fine' }),
      entry('first', 'root', { diskName: 'Same' }),
      entry('second', 'root', { diskName: 'same' }),
      entry('nested', 'up'),
    ]);
    const adapter = await open(disk);
    for (const id of ['up', 'index', 'trash', 'implicit', 'evil/id', 'second', 'nested']) {
      expect(await adapter.getFile(id), id).toBeNull();
    }
    expect(await adapter.getFile('first')).not.toBeNull();
    await expect(adapter.updateContent('index', new Blob(['{}']))).rejects.toMatchObject({ code: 'not-found' });
    const reopened = await open(disk);
    expect((await reopened.getRoot()).id).toBe('root');
  });

  it('refuses an index with no root or a repeated ID', async () => {
    await expect(open(await diskWithIndex([entry('a', 'root')]))).rejects.toMatchObject({ code: 'unknown' });
    await expect(open(await diskWithIndex([entry('root', 'x')]))).rejects.toMatchObject({ code: 'unknown' });
    await expect(open(await diskWithIndex([root, entry('a', 'root'), entry('a', 'root')]))).rejects.toMatchObject({
      code: 'unknown',
      message: expect.stringContaining('twice'),
    });
  });
});
