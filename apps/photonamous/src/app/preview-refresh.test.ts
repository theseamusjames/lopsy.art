import { describe, expect, it } from 'vitest';
import type { LibrarySession, PreviewRef, Version, VersionId } from '@lopsy/photos-core/library/types';
import { MemoryAdapter } from '@lopsy/photos-core/storage/memory-adapter';
import { MemoryLocalStore } from '@lopsy/photos-core/library/local-store';
import { openLibrary } from '@lopsy/photos-core/library/session';
import { NoopLibraryLock } from '@lopsy/photos-core/library/lock';
import { recipeHash, DEFAULT_RECIPE } from '@lopsy/photos-core/library/recipe';
import { PreviewRefresher, staleVersions, type PreviewRefresherOptions } from './preview-refresh';

async function library(): Promise<{ session: LibrarySession; assetId: string; versionId: VersionId }> {
  const adapter = new MemoryAdapter();
  const session = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false, lock: new NoopLibraryLock() });
  const { assetId, versionId } = session.addAsset({
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
  const ref = (size: string): PreviewRef => ({ fileId: `${versionId}-${size}`, recipeHash: recipeHash(DEFAULT_RECIPE), width: 3, height: 2 });
  session.setPreview(versionId, 'thumb', ref('thumb'));
  session.setPreview(versionId, 'screen', ref('screen'));
  return { session, assetId, versionId };
}

interface Harness {
  readonly refresher: PreviewRefresher;
  readonly renders: { versionId: VersionId; hash: string; signal: AbortSignal }[];
  readonly stored: { versionId: VersionId; hash: string }[];
  readonly reused: VersionId[];
  /** Runs scheduled work until nothing is left. */
  settle(): Promise<void>;
  paused: boolean;
}

function harness(session: LibrarySession, render?: PreviewRefresherOptions['render']): Harness {
  const tasks: (() => void)[] = [];
  const h: Harness = {
    renders: [],
    stored: [],
    reused: [],
    paused: false,
    refresher: undefined as unknown as PreviewRefresher,
    async settle() {
      for (let round = 0; round < 200; round++) {
        const task = tasks.shift();
        if (task) task();
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (!task && tasks.length === 0) return;
      }
    },
  };
  const refresher = new PreviewRefresher({
    source: session,
    isPaused: () => h.paused,
    schedule: (task) => tasks.push(task),
    render:
      render ??
      (async (_asset, version: Version, signal) => {
        h.renders.push({ versionId: version.id, hash: recipeHash(version.recipe), signal });
        return { thumb: new Blob(['t']), screen: new Blob(['s']) };
      }),
    store: async (versionId, previews) => {
      h.stored.push({ versionId, hash: previews.recipeHash });
      const ref = (size: string): PreviewRef => ({ fileId: `${versionId}-${size}-${previews.recipeHash}`, recipeHash: previews.recipeHash, width: 3, height: 2 });
      session.setPreview(versionId, 'thumb', ref('thumb'));
      session.setPreview(versionId, 'screen', ref('screen'));
    },
    reuse: (versionId, thumb, screen) => {
      h.reused.push(versionId);
      session.setPreview(versionId, 'thumb', thumb);
      session.setPreview(versionId, 'screen', screen);
    },
  });
  Object.assign(h, { refresher });
  refresher.start();
  return h;
}

describe('background previews', () => {
  it('finds versions whose previews do not show their recipe', async () => {
    const { session, versionId } = await library();
    expect(staleVersions(session.getView())).toEqual([]);
    session.editRecipe(versionId, { 'tone.exposure': 0.5 }, 'Exposure');
    expect(staleVersions(session.getView()).map((t) => t.versionId)).toEqual([versionId]);
  });

  it('finds a Lopsy document edited on its flattened render, but not one saved without a render', async () => {
    const { session } = await library();
    const lopsyDocument = (fileName: string, renderFileId: string | null) =>
      session.addAsset({
        kind: 'document',
        fileId: `${fileName}-file`,
        sha256: fileName,
        fileName,
        byteSize: 3,
        format: 'lopsy',
        mimeType: 'application/x-lopsy',
        capturedAt: null,
        importedAt: '2026-01-02T00:00:00Z',
        importId: 'lopsy',
        width: 3,
        height: 2,
        orientation: 1,
        camera: null,
        lens: null,
        exposure: null,
        gps: null,
        pairedWith: null,
        source: null,
        renderFileId,
      }).versionId;
    const rendered = lopsyDocument('poster.lopsy', 'poster-render');
    const bare = lopsyDocument('old.lopsy', null);
    for (const versionId of [rendered, bare]) {
      for (const size of ['thumb', 'screen'] as const) {
        session.setPreview(versionId, size, { fileId: `${versionId}-${size}`, recipeHash: recipeHash(DEFAULT_RECIPE), width: 3, height: 2 });
      }
      session.editRecipe(versionId, { 'tone.exposure': 0.5 }, 'Exposure');
    }
    expect(staleVersions(session.getView()).map((t) => t.versionId)).toEqual([rendered]);
  });

  it('renders a version changed outside Edit and stores previews for its new recipe', async () => {
    const { session, versionId } = await library();
    const h = harness(session);
    session.editRecipe(versionId, { 'tone.exposure': 0.5 }, 'Preset');
    await h.settle();
    const hash = recipeHash(session.getView().versions.get(versionId)?.recipe ?? DEFAULT_RECIPE);
    expect(h.stored).toEqual([{ versionId, hash }]);
    expect(h.renders).toHaveLength(1);
    expect(staleVersions(session.getView())).toEqual([]);
    expect(h.refresher.getProgress().pending).toBe(0);
  });

  it('coalesces repeated changes to one render of the latest recipe', async () => {
    const { session, versionId } = await library();
    const h = harness(session);
    session.editRecipe(versionId, { 'tone.exposure': 0.2 }, 'a');
    session.editRecipe(versionId, { 'tone.exposure': 0.4 }, 'b');
    session.editRecipe(versionId, { 'tone.exposure': 0.6 }, 'c');
    await h.settle();
    expect(h.renders).toHaveLength(1);
    expect(h.stored.map((s) => s.hash)).toEqual([recipeHash(session.getView().versions.get(versionId)?.recipe ?? DEFAULT_RECIPE)]);
  });

  it('cancels a render whose recipe changed meanwhile, and renders the new one', async () => {
    const { session, versionId } = await library();
    let release: () => void = () => undefined;
    const signals: AbortSignal[] = [];
    let calls = 0;
    const h = harness(session, async (_asset, _version, signal) => {
      calls++;
      signals.push(signal);
      if (calls === 1) await new Promise<void>((resolve) => (release = resolve));
      return { thumb: new Blob(['t']), screen: new Blob(['s']) };
    });
    session.editRecipe(versionId, { 'tone.exposure': 0.2 }, 'a');
    await h.settle();
    expect(calls).toBe(1);
    session.editRecipe(versionId, { 'tone.exposure': 0.9 }, 'b');
    await h.settle();
    expect(signals[0]?.aborted).toBe(true);
    release();
    await h.settle();
    const latest = recipeHash(session.getView().versions.get(versionId)?.recipe ?? DEFAULT_RECIPE);
    expect(h.stored.map((s) => s.hash)).toEqual([latest]);
    expect(calls).toBe(2);
  });

  it('reuses previews of a version of the same photo with the same recipe', async () => {
    const { session, assetId, versionId } = await library();
    const h = harness(session);
    const second = session.createVersion(assetId, 'Version 2');
    await h.settle();
    expect(h.reused).toEqual([second]);
    expect(h.renders).toEqual([]);
    expect(session.getView().versions.get(second)?.thumb?.fileId).toBe(session.getView().versions.get(versionId)?.thumb?.fileId);
  });

  it('waits while paused (the Edit view is open)', async () => {
    const { session, versionId } = await library();
    const h = harness(session);
    h.paused = true;
    session.editRecipe(versionId, { 'tone.exposure': 0.5 }, 'Preset');
    await h.settle();
    expect(h.renders).toEqual([]);
    expect(h.refresher.getProgress()).toMatchObject({ pending: 1, paused: true });
    h.paused = false;
    h.refresher.refresh();
    await h.settle();
    expect(h.stored).toHaveLength(1);
  });

  it('does not retry a failed render until the recipe changes', async () => {
    const { session, versionId } = await library();
    let calls = 0;
    const h = harness(session, async () => {
      calls++;
      throw new Error('no engine');
    });
    session.editRecipe(versionId, { 'tone.exposure': 0.5 }, 'Preset');
    await h.settle();
    session.setMarks([session.getView().versions.get(versionId)?.assetId ?? ''], { rating: 3 });
    await h.settle();
    expect(calls).toBe(1);
    expect(h.refresher.getProgress().failed).toBe(1);
    session.editRecipe(versionId, { 'tone.exposure': 0.7 }, 'Again');
    await h.settle();
    expect(calls).toBe(2);
  });
});
