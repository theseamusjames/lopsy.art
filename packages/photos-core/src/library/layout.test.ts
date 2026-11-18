import { describe, expect, it } from 'vitest';
import { ensureLibrary, parseManifest, README_TEXT } from './layout';
import { TestAdapter } from './test-support/test-adapter';

async function childrenByName(adapter: TestAdapter, parentId: string) {
  return Object.fromEntries((await adapter.listChildren(parentId)).map((f) => [f.name, f]));
}

describe('ensureLibrary', () => {
  it('creates the layout with tags, README and library.json', async () => {
    const adapter = new TestAdapter();
    const { layout, created, manifest } = await ensureLibrary(adapter, { now: () => Date.UTC(2026, 10, 18) });
    expect(created).toBe(true);
    const root = await adapter.getFile(layout.rootId);
    expect(root?.name).toBe('Lopsy Photos');
    expect(root?.properties).toEqual({ 'lp.lib': layout.libraryId, 'lp.role': 'library' });

    const top = await childrenByName(adapter, layout.rootId);
    expect(Object.keys(top).sort()).toEqual(['Exports', 'Library data', 'Lopsy documents', 'Originals', 'README.txt']);
    expect(top['Originals']?.properties['lp.role']).toBe('originals');
    expect(top['Lopsy documents']?.properties['lp.role']).toBe('documents');
    expect(top['Exports']?.properties['lp.role']).toBe('exports');
    expect(top['Library data']?.properties['lp.role']).toBe('data');
    expect(await (await adapter.readContent(top['README.txt']!.id)).text()).toBe(README_TEXT);

    const data = await childrenByName(adapter, layout.dataId);
    expect(Object.keys(data).sort()).toEqual(['devices', 'journal', 'library.json', 'previews', 'snapshots']);
    for (const file of adapter.allFiles()) {
      if (file.id === (await adapter.getRoot()).id) continue;
      expect(file.properties['lp.lib']).toBe(layout.libraryId);
      expect(file.properties['lp.role']).toBeTruthy();
    }

    const json = parseManifest(JSON.parse(await (await adapter.readContent(data['library.json']!.id)).text()));
    expect(json).toEqual(manifest);
    expect(json?.schemaVersion).toBe(1);
    expect(json?.createdAt).toBe('2026-11-18T00:00:00.000Z');
    expect(json?.folders.journal).toBe(layout.journalId);
  });

  it('finds the existing library on a rerun without creating anything', async () => {
    const adapter = new TestAdapter();
    const first = await ensureLibrary(adapter);
    const count = adapter.allFiles().length;
    const second = await ensureLibrary(adapter);
    expect(second.created).toBe(false);
    expect(second.layout).toEqual(first.layout);
    expect(adapter.allFiles().length).toBe(count);
  });

  it('fills the gaps after a partial creation', async () => {
    const adapter = new TestAdapter();
    const first = await ensureLibrary(adapter);
    await adapter.deletePermanently(first.layout.snapshotsId);
    await adapter.trash(first.layout.exportsId);
    const readme = (await adapter.listChildren(first.layout.rootId)).find((f) => f.name === 'README.txt');
    await adapter.deletePermanently(readme!.id);

    const second = await ensureLibrary(adapter);
    expect(second.layout.libraryId).toBe(first.layout.libraryId);
    expect(second.layout.journalId).toBe(first.layout.journalId);
    expect(second.layout.snapshotsId).not.toBe(first.layout.snapshotsId);
    expect(second.layout.exportsId).not.toBe(first.layout.exportsId);
    expect((await adapter.listChildren(first.layout.rootId)).some((f) => f.name === 'README.txt')).toBe(true);
    const manifestFile = (await adapter.listChildren(second.layout.dataId)).find((f) => f.name === 'library.json');
    const manifest = parseManifest(JSON.parse(await (await adapter.readContent(manifestFile!.id)).text()));
    expect(manifest?.folders.snapshots).toBe(second.layout.snapshotsId);
  });

  it('survives a failure half way and completes on retry', async () => {
    const adapter = new TestAdapter();
    adapter.failNext('network', { method: 'createFolder', count: 1 });
    await ensureLibrary(adapter).catch(() => undefined);
    // Fail after the top folder exists.
    const partial = new TestAdapter();
    const rootId = (await partial.getRoot()).id;
    await partial.createFolder(rootId, 'Lopsy Photos', { 'lp.lib': 'lib-1', 'lp.role': 'library' });
    const { layout, created } = await ensureLibrary(partial);
    expect(created).toBe(false);
    expect(layout.libraryId).toBe('lib-1');
    expect((await ensureLibrary(adapter)).created).toBe(true);
  });

  it('rewrites a damaged library.json', async () => {
    const adapter = new TestAdapter();
    const { layout } = await ensureLibrary(adapter);
    const file = (await adapter.listChildren(layout.dataId)).find((f) => f.name === 'library.json')!;
    await adapter.updateContent(file.id, new Blob(['{ broken']));
    await ensureLibrary(adapter);
    const manifest = parseManifest(JSON.parse(await (await adapter.readContent(file.id)).text()));
    expect(manifest?.libraryId).toBe(layout.libraryId);
  });
});
