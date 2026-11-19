import { describe, expect, it } from 'vitest';
import { MemoryAdapter } from '../storage/memory-adapter';
import type { StorageAdapter } from '../storage/types';
import { CAMERA_RAW_XMP, REJECTED_CROPPED_XMP } from '../xmp/test-support/samples';
import { startImportFromStorage } from './from-storage';
import { startImport } from './importer';
import { buildJpeg, buildTiff } from './test-support/builders';
import { FakeLibrarySession } from './test-support/fake-session';
import type { PreviewRenderer } from './types';

function jpegBytes(seed: number, orientation = 1): Uint8Array<ArrayBuffer> {
  const exif = buildTiff({
    entries: [
      { tag: 0x0112, type: 3, values: [orientation] },
      { tag: 0x8769, ifds: [{ entries: [{ tag: 0x9003, ascii: '2026:11:14 16:02:11' }, { tag: 0x8827, type: 3, values: [100 + seed] }] }] },
    ],
  });
  return buildJpeg({ width: 600 + seed, height: 400, exif });
}

const renderer: PreviewRenderer = {
  async render(_source, maxSize) {
    return { blob: new Blob(['p'], { type: 'image/jpeg' }), width: maxSize, height: maxSize };
  },
};

async function setup() {
  const adapter = new MemoryAdapter();
  const root = await adapter.getRoot();
  const originals = await adapter.createFolder(root.id, 'Originals');
  const previews = await adapter.createFolder(root.id, 'previews');
  const session = new FakeLibrarySession(adapter as StorageAdapter, { rootId: root.id, originalsId: originals.id, previewsId: previews.id });
  const recipes = new Map<string, unknown>();
  const marks: unknown[] = [];
  // The fake session leaves these unimplemented; record what the importer asks for.
  Object.assign(session, {
    setRecipe: (versionId: string, recipe: unknown) => recipes.set(versionId, recipe),
    setMarks: (ids: string[], m: unknown) => marks.push({ ids, m }),
  });
  return { adapter, root, session, recipes, marks };
}

describe('XMP sidecars at import', () => {
  it('applies a sidecar to its photo and skips the sidecar itself', async () => {
    const { session, recipes, marks } = await setup();
    const files = [
      new File([jpegBytes(1, 6)], 'DSCF1.JPG'),
      new File([CAMERA_RAW_XMP], 'DSCF1.xmp'),
      new File([jpegBytes(2)], 'DSCF2.JPG'),
      new File([REJECTED_CROPPED_XMP], 'DSCF2.JPG.xmp'),
      new File([CAMERA_RAW_XMP], 'orphan.xmp'),
    ];
    const result = await startImport(files, { session, previewRenderer: renderer }).finished;
    expect(result.items.map((i) => [i.state, i.state === 'done' ? null : i.error])).toEqual([
      ['done', null],
      ['skipped', 'XMP sidecar, applied to DSCF1.JPG'],
      ['done', null],
      ['skipped', 'XMP sidecar, applied to DSCF2.JPG'],
      ['skipped', 'XMP sidecar with no matching photo'],
    ]);
    const view = session.getView();
    const first = view.assets.get(result.items[0]?.assetId ?? '');
    const second = view.assets.get(result.items[2]?.assetId ?? '');
    expect(first?.keywords).toEqual(['harbour', 'France', 'Boats']);
    // The two photos import concurrently, so their marks can arrive in either order.
    expect(marks).toHaveLength(2);
    expect(marks).toContainEqual({
      ids: [first?.id],
      m: { rating: 4, setAside: false, label: 'green', title: 'Harbour at dusk', caption: 'Boats & lights, Boulogne' },
    });
    expect(marks).toContainEqual({ ids: [second?.id], m: { rating: 0, setAside: true } });
    const recipe = recipes.get(first?.primaryVersionId ?? '') as { tone: { exposure: number }; framing: { rotate: number } };
    expect(recipe.tone.exposure).toBe(0.65);
    expect(recipe.framing.rotate).toBe(0);
    const cropped = recipes.get(second?.primaryVersionId ?? '') as { framing: { crop: { x: number } } };
    expect(cropped.framing.crop.x).toBeCloseTo(0.2);
  });

  it('leaves sidecars unapplied when asked, still never importing them', async () => {
    const { session, marks } = await setup();
    const files = [new File([jpegBytes(1)], 'A.JPG'), new File([CAMERA_RAW_XMP], 'A.xmp')];
    const result = await startImport(files, { session, previewRenderer: renderer, options: { applySidecars: false } }).finished;
    expect(result.items.map((i) => [i.state, i.state === 'done' ? null : i.error])).toEqual([
      ['done', null],
      ['skipped', 'XMP sidecar for A.JPG, not applied'],
    ]);
    expect(marks).toEqual([]);
  });

  it('applies sidecars picked from Drive', async () => {
    const { adapter, root, session, marks } = await setup();
    const photo = await adapter.createFile({ parentId: root.id, name: 'B.JPG', mimeType: 'image/jpeg' }, new Blob([jpegBytes(3)]));
    const xmp = await adapter.createFile({ parentId: root.id, name: 'B.xmp', mimeType: 'application/rdf+xml' }, new Blob([CAMERA_RAW_XMP]));
    const result = await startImportFromStorage([photo.id, xmp.id], { session, previewRenderer: renderer }).finished;
    expect(result.items.map((i) => i.state)).toEqual(['done', 'skipped']);
    expect(session.getView().assets.get(result.items[0]?.assetId ?? '')?.keywords).toContain('Boats');
    expect(marks).toHaveLength(1);
  });
});
