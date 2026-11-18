/** React hooks onto the open library. */

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Asset, AssetId, LibrarySession, LibraryView, PreviewRef, SyncStatus, Version } from '@lopsy/photos-core/library/types';
import type { ImportItemState, ImportJob, ImportProgress } from '@lopsy/photos-core/import/types';
import type { ExportJob, ExportProgress } from './backend';
import type { DownloadProgress, OriginalsDownload } from '@lopsy/photos-core/cache/keep-originals';
import { useUi } from './store';
import { listExportPresets, listPresets } from '../library/presets-list';
import type { ExportPreset, Preset } from '@lopsy/photos-core/library/types';
import { findAssets, type FacetFilter, type FindResult } from '../library/finding';
import { parseTextQuery, TextIndex } from '@lopsy/photos-core/search/text';
import { readSavedSearches, type SavedSearch } from '@lopsy/photos-core/search/rules';
import { pairPartners, versionCounts, type Collection, type SortOrder } from '../library/asset-query';
import { loadPreviewUrl, peekPreviewUrl } from './preview-cache';

export function useSession(): LibrarySession {
  const connection = useUi((s) => s.connection);
  if (!connection) throw new Error('No library is open');
  return connection.session;
}

export function useLibraryView(): LibraryView {
  const session = useSession();
  return useSyncExternalStore(
    (l) => session.subscribe(l),
    () => session.getView(),
  );
}

export function useSyncStatus(): SyncStatus {
  const session = useSession();
  return useSyncExternalStore(
    (l) => session.subscribeSync(l),
    () => session.getSyncStatus(),
  );
}

export function useAsset(id: AssetId | null): Asset | null {
  const view = useLibraryView();
  return id === null ? null : (view.assets.get(id) ?? null);
}

export function usePrimaryVersion(asset: Asset | null): Version | null {
  const view = useLibraryView();
  return asset === null ? null : (view.versions.get(asset.primaryVersionId) ?? null);
}

interface FindMemo {
  view: LibraryView;
  collection: Collection;
  sort: SortOrder;
  text: string;
  facets: FacetFilter;
  groupBursts: boolean;
  expanded: ReadonlySet<AssetId>;
  result: FindResult;
}
let findMemo: FindMemo | null = null;

/** One text index per session, updated (incrementally) when the view changes. */
const textIndexes = new WeakMap<LibrarySession, TextIndex>();

let savedMemo: { settings: LibraryView['settings']; list: readonly SavedSearch[] } | null = null;

/** The library's saved searches, read once per settings change. */
export function useSavedSearches(): readonly SavedSearch[] {
  const view = useLibraryView();
  if (savedMemo && savedMemo.settings === view.settings) return savedMemo.list;
  savedMemo = { settings: view.settings, list: readSavedSearches(view) };
  return savedMemo.list;
}

/** What the grid shows and the filter bar counts; computed once per change of its inputs, shared by every caller. */
export function useFindResult(): FindResult {
  const session = useSession();
  const view = useLibraryView();
  const savedSearches = useSavedSearches();
  const collection = useUi((s) => s.collection);
  const sort = useUi((s) => s.sort);
  const text = useUi((s) => s.text);
  const facets = useUi((s) => s.facets);
  const groupBursts = useUi((s) => s.groupBursts);
  const expanded = useUi((s) => s.expandedBursts);
  const m = findMemo;
  if (
    m &&
    m.view === view &&
    m.collection === collection &&
    m.sort === sort &&
    m.text === text &&
    m.facets === facets &&
    m.groupBursts === groupBursts &&
    m.expanded === expanded
  ) {
    return m.result;
  }
  let textMatch: ((asset: Asset) => boolean) | null = null;
  if (text.trim() !== '') {
    let index = textIndexes.get(session);
    if (!index) {
      index = new TextIndex();
      textIndexes.set(session, index);
    }
    index.update(view);
    const query = parseTextQuery(text);
    const idx = index;
    textMatch = (asset) => idx.matches(asset.id, query);
  }
  const result = findAssets(view, { collection, sort, text, facets, groupBursts, expanded, savedSearches }, textMatch);
  findMemo = { view, collection, sort, text, facets, groupBursts, expanded, result };
  return result;
}

/** The ids the grid shows, in order. */
export function useOrderedIds(): readonly AssetId[] {
  return useFindResult().ids;
}

let versionMemo: { view: LibraryView; counts: ReadonlyMap<AssetId, number> } | null = null;

/** Versions per asset, computed once per library view. */
export function useVersionCounts(): ReadonlyMap<AssetId, number> {
  const view = useLibraryView();
  if (versionMemo && versionMemo.view === view) return versionMemo.counts;
  versionMemo = { view, counts: versionCounts(view) };
  return versionMemo.counts;
}

let pairMemo: { assets: LibraryView['assets']; partners: ReadonlyMap<AssetId, AssetId> } | null = null;

/** RAW+JPEG partners both ways, once per change of the assets. */
export function usePairPartners(): ReadonlyMap<AssetId, AssetId> {
  const view = useLibraryView();
  if (pairMemo && pairMemo.assets === view.assets) return pairMemo.partners;
  pairMemo = { assets: view.assets, partners: pairPartners(view.assets) };
  return pairMemo.partners;
}

/** An object URL for the preview, or null while it loads (or when there is none). */
export function usePreviewUrl(ref: PreviewRef | null, size: 'thumb' | 'screen'): string | null {
  const session = useSession();
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null);
  const key = ref ? `${ref.fileId}|${ref.recipeHash}` : null;
  const peeked = ref ? peekPreviewUrl(size, ref) : undefined;

  useEffect(() => {
    if (!ref || !key || peeked) return;
    let live = true;
    loadPreviewUrl(session, size, ref)
      .then((url) => {
        if (live) setLoaded({ key, url });
      })
      .catch((error: unknown) => console.warn('Preview failed', error));
    return () => {
      live = false;
    };
    // The key stands for the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, size, key, peeked]);

  if (peeked) return peeked;
  return loaded && loaded.key === key ? loaded.url : null;
}

/** Whether an import item has stopped moving (done, skipped or failed). */
export function isSettled(state: ImportItemState): boolean {
  return state === 'done' || state === 'duplicate' || state === 'unsupported' || state === 'failed' || state === 'skipped';
}

const noSubscribe = () => () => {};

export function useImportProgress(job: ImportJob | null): ImportProgress | null {
  return useSyncExternalStore(
    job ? (l) => job.subscribe(l) : noSubscribe,
    () => (job ? job.getProgress() : null),
  );
}

/** The All download's progress (Keep originals), or null when it is not running for this library. */
export function useOriginalsDownload(download: OriginalsDownload | null): DownloadProgress | null {
  return useSyncExternalStore(
    download ? (l) => download.subscribe(l) : noSubscribe,
    () => (download ? download.getProgress() : null),
  );
}

export function useExportProgress(job: ExportJob | null): ExportProgress | null {
  return useSyncExternalStore(
    job ? (l) => job.subscribe(l) : noSubscribe,
    () => (job ? job.getProgress() : null),
  );
}

let presetMemo: { presets: LibraryView['presets']; list: readonly Preset[] } | null = null;

/** Lopsy's edit presets and the user's own. */
export function usePresets(): readonly Preset[] {
  const view = useLibraryView();
  if (presetMemo && presetMemo.presets === view.presets) return presetMemo.list;
  presetMemo = { presets: view.presets, list: listPresets(view) };
  return presetMemo.list;
}

let exportPresetMemo: { presets: LibraryView['exportPresets']; list: readonly ExportPreset[] } | null = null;

/** Lopsy's export presets and the user's own. */
export function useExportPresets(): readonly ExportPreset[] {
  const view = useLibraryView();
  if (exportPresetMemo && exportPresetMemo.presets === view.exportPresets) return exportPresetMemo.list;
  exportPresetMemo = { presets: view.exportPresets, list: listExportPresets(view) };
  return exportPresetMemo.list;
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
