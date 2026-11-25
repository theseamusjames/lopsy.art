import { describe, expect, it, vi } from 'vitest';
import { MemoryAdapter } from '@lopsy/photos-core/storage/memory-adapter';
import { MemoryLocalStore } from '@lopsy/photos-core/library/local-store';
import { NoopLibraryLock } from '@lopsy/photos-core/library/lock';
import { openLibrary } from '@lopsy/photos-core/library/session';
import { DEFAULT_RECIPE, recipeHash } from '@lopsy/photos-core/library/recipe';
import { staleVersions } from './preview-refresh';

// This build plays one with the next pipeline: the library's versions and previews stay pipeline 1.
vi.mock('@lopsy/photos-core/library/recipe', async (original) => ({
  ...(await original<typeof import('@lopsy/photos-core/library/recipe')>()),
  PIPELINE_VERSION: 2,
}));

describe('background previews on a build with a newer pipeline', () => {
  it('finds every preview the older pipeline rendered stale, and none once this one rendered them', async () => {
    const session = await openLibrary({ adapter: new MemoryAdapter(), store: new MemoryLocalStore(), autoSync: false, lock: new NoopLibraryLock() });
    const { versionId } = session.addAsset({
      kind: 'original',
      fileId: 'original',
      sha256: 'x',
      fileName: 'a.jpg',
      byteSize: 3,
      format: 'jpeg',
      mimeType: 'image/jpeg',
      capturedAt: null,
      importedAt: '2026-01-01T00:00:00Z',
      importId: 'i',
      width: 3,
      height: 2,
      orientation: 1,
      camera: null,
      lens: null,
      exposure: null,
      gps: null,
      pairedWith: null,
      source: null,
      renderFileId: null,
    });
    const hash = recipeHash(DEFAULT_RECIPE);
    for (const size of ['thumb', 'screen'] as const) {
      session.setPreview(versionId, size, { fileId: `old-${size}`, recipeHash: hash, pipeline: 1, width: 3, height: 2 });
    }
    expect(session.getView().versions.get(versionId)?.recipe.pipeline).toBe(1);
    expect(staleVersions(session.getView()).map((t) => t.versionId)).toEqual([versionId]);
    // Rendered again here: the version keeps its own pipeline, and the previews are current.
    for (const size of ['thumb', 'screen'] as const) {
      session.setPreview(versionId, size, { fileId: `new-${size}`, recipeHash: hash, pipeline: 2, width: 3, height: 2 });
    }
    expect(staleVersions(session.getView())).toEqual([]);
  });
});
