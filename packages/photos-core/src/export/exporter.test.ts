import { describe, expect, it, vi } from 'vitest';
import { readMetadata } from '../import/exif';
import { buildPng } from '../import/test-support/builders';
import { FakeLibrarySession } from '../import/test-support/fake-session';
import { TestMemoryAdapter } from '../import/test-support/memory-adapter';
import type { NewAsset } from '../library/types';
import { StorageError } from '../storage/errors';
import { startExport } from './exporter';
import type { ExportContext, ExportSelection } from './exporter';
import { browserJpeg } from './test-support/fixtures';
import type { ExportRenderer } from './types';

const facts = (name: string, sha: string): NewAsset => ({
  kind: 'original',
  fileId: `orig-${name}`,
  sha256: sha,
  fileName: name,
  byteSize: 100,
  format: 'raf',
  mimeType: 'image/x-fuji-raf',
  capturedAt: '2026-11-14T16:02:11',
  importedAt: '2026-11-18T10:00:00.000Z',
  importId: 'i',
  width: 600,
  height: 400,
  orientation: 1,
  camera: { make: 'FUJIFILM', model: 'X-E5' },
  lens: null,
  exposure: { iso: 200, shutter: '1/100', aperture: 2.8, focalLength: 23 },
  gps: { lat: 1, lon: 2, alt: null },
  pairedWith: null,
  source: null,
  renderFileId: null,
});

function renderer(options: { failFor?: string; hang?: boolean } = {}): ExportRenderer & { calls: string[] } {
  return {
    calls: [],
    async render(asset, _version, settings, signal) {
      this.calls.push(asset.fileName);
      if (options.hang) {
        await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      }
      if (asset.fileName === options.failFor) throw new Error('GPU lost');
      const bytes = settings.format === 'png' ? buildPng({ width: 60, height: 40 }) : browserJpeg(60, 40);
      return new Blob([bytes], { type: settings.format === 'png' ? 'image/png' : 'image/jpeg' });
    },
  };
}

async function setup(names = ['DSCF0001.RAF', 'DSCF0002.RAF', 'DSCF0003.RAF']) {
  const adapter = new TestMemoryAdapter();
  const root = await adapter.getRoot();
  const exports = await adapter.createFolder(root.id, 'Exports');
  const session = new FakeLibrarySession(adapter, { rootId: root.id, originalsId: root.id, previewsId: root.id, exportsId: exports.id });
  const selection: ExportSelection[] = names.map((name, i) => {
    const { assetId, versionId } = session.addAsset(facts(name, String(i).repeat(64)));
    return { assetId, versionId };
  });
  const ctx = (extra: Partial<ExportContext>): ExportContext => ({
    session,
    renderer: renderer(),
    settings: {},
    destination: { kind: 'download' },
    now: () => new Date(2026, 10, 18, 9),
    ...extra,
  });
  return { adapter, session, selection, exportsId: exports.id, ctx };
}

describe('startExport', () => {
  it('writes into Exports/<folder> with tags, metadata and unique names', async () => {
    const { adapter, selection, exportsId, ctx } = await setup(['A.RAF', 'A.DNG']);
    const existing = await adapter.createFolder(exportsId, '2026-11-18 Web');
    await adapter.createFile({ parentId: existing.id, name: 'A.jpg', mimeType: 'image/jpeg' }, new Blob(['x']));
    const job = startExport(selection, ctx({ destination: { kind: 'library', folderName: '2026-11-18 Web' } }));
    const listener = vi.fn();
    job.subscribe(listener);
    const result = await job.finished;
    expect(result.items.map((i) => [i.state, i.fileName])).toEqual([
      ['done', 'A (2).jpg'],
      ['done', 'A (3).jpg'],
    ]);
    expect(result.folderId).toBe(existing.id);
    expect(result.files).toEqual([]);
    expect(listener).toHaveBeenCalled();
    const file = await adapter.getFile(result.items[0]?.fileId ?? '');
    expect(file).toMatchObject({ parentId: existing.id, mimeType: 'image/jpeg' });
    expect(file?.properties).toEqual({ 'lp.lib': 'lib-test', 'lp.role': 'export', 'lp.asset': selection[0]?.assetId });
    const written = new Uint8Array(await (await adapter.readContent(file?.id ?? '')).arrayBuffer());
    const m = readMetadata(written);
    expect(m).toMatchObject({ camera: { model: 'X-E5' }, exposure: { shutter: '1/100' }, gps: null });
  });

  it('tags library exports with the media type of every format', async () => {
    for (const [format, mimeType, ext] of [
      ['jpeg', 'image/jpeg', '.jpg'],
      ['png', 'image/png', '.png'],
      ['tiff', 'image/tiff', '.tif'],
    ] as const) {
      const { adapter, selection, ctx } = await setup(['A.RAF']);
      const result = await startExport(
        selection,
        ctx({ settings: { format }, destination: { kind: 'library', folderName: format } }),
      ).finished;
      const file = await adapter.getFile(result.items[0]?.fileId ?? '');
      expect(file, format).toMatchObject({ mimeType });
      expect(file?.name.endsWith(ext)).toBe(true);
    }
  });

  it('creates the export folder when missing', async () => {
    const { adapter, selection, exportsId, ctx } = await setup(['A.RAF']);
    const result = await startExport(selection, ctx({ destination: { kind: 'library', folderName: 'My/Export' } })).finished;
    const folder = await adapter.getFile(result.folderId ?? '');
    expect(folder).toMatchObject({ parentId: exportsId, name: 'My_Export', isFolder: true });
  });

  it('collects downloads and zips several, with the name template and PNG', async () => {
    const { selection, ctx } = await setup();
    const result = await startExport(
      selection,
      ctx({ settings: { format: 'png', fileNameTemplate: '{date}-{seq:2}', metadata: 'all', removeLocation: false } }),
    ).finished;
    expect(result.files.map((f) => f.name)).toEqual(['2026-11-14-01.png', '2026-11-14-02.png', '2026-11-14-03.png']);
    const first = new Uint8Array(await (result.files[0]?.blob ?? new Blob()).arrayBuffer());
    expect(readMetadata(first)).toMatchObject({ format: 'png', gps: { lat: 1, lon: 2 } });
    expect(result.zip?.name).toBe('Lopsy export 2026-11-18.zip');
    const zip = new Uint8Array(await (result.zip?.blob ?? new Blob()).arrayBuffer());
    expect(new DataView(zip.buffer).getUint16(zip.length - 12, true)).toBe(3);
  });

  it('does not zip a single download', async () => {
    const { selection, ctx } = await setup(['ONE.RAF']);
    const result = await startExport(selection, ctx({ destination: { kind: 'download', zipName: 'x' } })).finished;
    expect(result.files).toHaveLength(1);
    expect(result.zip).toBeNull();
  });

  it('fails single items (render failure, missing version, storage error) and goes on', async () => {
    const { adapter, selection, ctx } = await setup();
    const bad = [...selection, { assetId: selection[0]?.assetId ?? '', versionId: 'nope' }];
    adapter.hooks.failCreate = (file) => (file.name === 'DSCF0003.jpg' ? new StorageError('quota-exceeded', 'The storage is full') : null);
    const result = await startExport(
      bad,
      ctx({ renderer: renderer({ failFor: 'DSCF0002.RAF' }), destination: { kind: 'library', folderName: 'Out' } }),
    ).finished;
    expect(result.items.map((i) => [i.state, i.error])).toEqual([
      ['done', null],
      ['failed', 'GPU lost'],
      ['failed', 'The storage is full'],
      ['failed', 'Version not found'],
    ]);
  });

  it('renders one item at a time', async () => {
    const { selection, ctx } = await setup();
    let active = 0;
    let max = 0;
    const slow: ExportRenderer = {
      async render(asset, version, settings, signal) {
        active++;
        max = Math.max(max, active);
        await new Promise((r) => setTimeout(r, 2));
        active--;
        return renderer().render(asset, version, settings, signal);
      },
    };
    await startExport(selection, ctx({ renderer: slow })).finished;
    expect(max).toBe(1);
  });

  it('cancels: the render in flight aborts and queued items stop', async () => {
    const { selection, ctx } = await setup();
    const r = renderer({ hang: true });
    const job = startExport(selection, ctx({ renderer: r }));
    await vi.waitFor(() => expect(job.getProgress().items[0]?.state).toBe('rendering'));
    job.cancel();
    const result = await job.finished;
    expect(result.items.map((i) => [i.state, i.error])).toEqual(Array.from({ length: 3 }, () => ['failed', 'Cancelled']));
    expect(r.calls).toHaveLength(1);
    expect(result.zip).toBeNull();
    expect(result.finished).toBe(true);
  });
});
