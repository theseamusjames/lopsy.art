/** React hooks onto the open library. */

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Asset, AssetId, LibrarySession, LibraryView, PreviewRef, SyncStatus, Version } from '@lopsy/photos-core/library/types';
import type { ImportItemState, ImportJob, ImportProgress } from '@lopsy/photos-core/import/types';
import type { ExportJob, ExportProgress } from './backend';
import { useUi } from './store';
import { queryAssets, versionCounts, type Collection, type SortOrder } from '../library/asset-query';
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

interface OrderedMemo {
  view: LibraryView;
  collection: Collection;
  sort: SortOrder;
  text: string;
  ids: readonly AssetId[];
}
let orderedMemo: OrderedMemo | null = null;

/** The ids the grid shows, in order; shared by every caller for the same inputs. */
export function useOrderedIds(): readonly AssetId[] {
  const view = useLibraryView();
  const collection = useUi((s) => s.collection);
  const sort = useUi((s) => s.sort);
  const text = useUi((s) => s.text);
  const m = orderedMemo;
  if (m && m.view === view && m.collection === collection && m.sort === sort && m.text === text) return m.ids;
  const ids = queryAssets(view, { collection, sort, text });
  orderedMemo = { view, collection, sort, text, ids };
  return ids;
}

let versionMemo: { view: LibraryView; counts: ReadonlyMap<AssetId, number> } | null = null;

/** Versions per asset, computed once per library view. */
export function useVersionCounts(): ReadonlyMap<AssetId, number> {
  const view = useLibraryView();
  if (versionMemo && versionMemo.view === view) return versionMemo.counts;
  versionMemo = { view, counts: versionCounts(view) };
  return versionMemo.counts;
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
  return state === 'done' || state === 'duplicate' || state === 'unsupported' || state === 'failed';
}

const noSubscribe = () => () => {};

export function useImportProgress(job: ImportJob | null): ImportProgress | null {
  return useSyncExternalStore(
    job ? (l) => job.subscribe(l) : noSubscribe,
    () => (job ? job.getProgress() : null),
  );
}

export function useExportProgress(job: ExportJob | null): ExportProgress | null {
  return useSyncExternalStore(
    job ? (l) => job.subscribe(l) : noSubscribe,
    () => (job ? job.getProgress() : null),
  );
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
