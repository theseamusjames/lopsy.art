import { describe, expect, it, vi } from 'vitest';
import { SIDECAR_APPLIED_DUPLICATE, SIDECAR_NOT_APPLIED_DUPLICATE } from '../xmp/sidecars';
import { LIGHTROOM_XMP } from '../xmp/test-support/samples';
import { resumeImports, startImport } from './importer';
import { MemoryImportQueueStore } from './queue-store';
import { MemoryStagingStore } from './staging';
import { buildJpeg, buildTiff } from './test-support/builders';
import { FakeLibrarySession } from './test-support/fake-session';
import { TestMemoryAdapter } from './test-support/memory-adapter';
import type { PreviewRenderer } from './types';

function jpegFile(name: string, seed: number): File {
  const exif = buildTiff({
    entries: [{ tag: 0x8769, ifds: [{ entries: [{ tag: 0x9003, ascii: '2026:11:14 16:02:11' }, { tag: 0x8827, type: 3, values: [100 + seed] }] }] }],
  });
  return new File([buildJpeg({ width: 600 + seed, height: 400, exif })], name);
}

const renderer: PreviewRenderer = {
  async render(_source, maxSize) {
    return { blob: new Blob(['p'], { type: 'image/jpeg' }), width: maxSize, height: maxSize };
  },
};

async function setup() {
  const adapter = new TestMemoryAdapter();
  const root = await adapter.getRoot();
  const originals = await adapter.createFolder(root.id, 'Originals');
  const previews = await adapter.createFolder(root.id, 'previews');
  const session = new FakeLibrarySession(adapter, { rootId: root.id, originalsId: originals.id, previewsId: previews.id });
  const marks: { ids: string[]; m: Record<string, unknown> }[] = [];
  // The fake session leaves these unimplemented; record what the importer asks for.
  Object.assign(session, {
    setRecipe: () => undefined,
    setMarks: (ids: string[], m: Record<string, unknown>) => marks.push({ ids, m }),
  });
  return { adapter, session, marks };
}

describe('sidecars across a reload and for duplicates', () => {
  it('stages a sidecar with its photo, keeps it in the queue and applies it after resuming', async () => {
    const { adapter, session, marks } = await setup();
    const queueStore = new MemoryImportQueueStore();
    const staging = new MemoryStagingStore();
    adapter.hooks.createDelay = (file) => (file.properties?.['lp.role'] === 'original' ? new Promise<void>(() => {}) : null);
    const files = [jpegFile('A.JPG', 1), new File([LIGHTROOM_XMP], 'A.xmp')];
    const first = startImport(files, { session, previewRenderer: renderer, queueStore, staging });
    await vi.waitFor(() => expect(first.getProgress().items.map((i) => i.state)).toEqual(['uploading', 'skipped']));
    expect((await staging.list()).filter((k) => k.endsWith('.xmp'))).toHaveLength(1);
    expect([...queueStore.jobs.values()][0]?.items[0]?.sidecarStaged).toBe(true);
    first.pause();
    await first.finished;

    adapter.hooks = {};
    const resumed = await resumeImports({ session, previewRenderer: renderer, queueStore, staging });
    const result = await resumed?.finished;
    expect(result?.items.map((i) => i.state)).toEqual(['done']);
    const asset = session.getView().assets.get(result?.items[0]?.assetId ?? '');
    expect(asset?.keywords).toEqual(['harbour', 'France', 'Boats']);
    expect(marks[0]?.m).toMatchObject({ rating: 4, label: 'green' });
    expect(await staging.list()).toEqual([]);
  });

  it("applies a duplicate's sidecar to the untouched asset already in the library", async () => {
    const { session, marks } = await setup();
    const photo = jpegFile('B.JPG', 2);
    const first = await startImport([photo], { session, previewRenderer: renderer }).finished;
    const existing = first.items[0]?.assetId;
    const again = await startImport([new File([photo], 'B copy.JPG'), new File([LIGHTROOM_XMP], 'B copy.xmp')], {
      session,
      previewRenderer: renderer,
    }).finished;
    expect(again.items.map((i) => [i.state, i.assetId, i.error])).toEqual([
      ['duplicate', existing, SIDECAR_APPLIED_DUPLICATE],
      ['skipped', null, 'XMP sidecar, applied to B copy.JPG'],
    ]);
    expect(session.getView().assets.get(existing ?? '')?.keywords).toContain('Boats');
    expect(marks).toHaveLength(1);
  });

  it('leaves an asset someone has already marked alone', async () => {
    const { session, marks } = await setup();
    const photo = jpegFile('C.JPG', 3);
    const first = await startImport([photo], { session, previewRenderer: renderer }).finished;
    const existing = first.items[0]?.assetId ?? '';
    session.setKeyword([existing], 'mine', true);
    const again = await startImport([new File([photo], 'C.JPG'), new File([LIGHTROOM_XMP], 'C.xmp')], {
      session,
      previewRenderer: renderer,
    }).finished;
    expect(again.items[0]).toMatchObject({ state: 'duplicate', error: SIDECAR_NOT_APPLIED_DUPLICATE });
    expect(session.getView().assets.get(existing)?.keywords).toEqual(['mine']);
    expect(marks).toEqual([]);
  });
});
