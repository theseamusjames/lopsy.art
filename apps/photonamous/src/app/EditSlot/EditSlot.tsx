import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Asset, AssetId, Json, PresetId, PreviewRef, VersionId } from '@lopsy/photos-core/library/types';
import type { Recipe, RecipeGroupId } from '@lopsy/photos-core/library/recipe';
import type { FilmstripItem } from '../../edit/Filmstrip/Filmstrip';
import { pasteRecipeValues, type CopiedEdits } from '../../library/recipe-copy';
import { versionsByAsset } from '../../library/items';
import { loadPreviewUrl, peekPreviewUrl } from '../preview-cache';
import { useUi } from '../store';
import { useOrderedIds, usePresets, usePreviewUrl } from '../hooks';
import { EditView } from '../../edit/EditView/EditView';
import { getBackend } from '../backend-registry';
import { useLibraryView, useSession } from '../hooks';
import { showToast } from '../toasts';
import { formatBytes } from '../../import/import-summary';
import { downloadBlob } from '../download';
import { Button } from '../../components/Button/Button';
import styles from './EditSlot.module.css';

export interface EditSlotProps {
  assetId: AssetId;
  versionId: VersionId;
  onClose: () => void;
}

interface Download {
  readonly loaded: number;
  readonly total: number | null;
}

/** The Edit view, wired to the library: the original from the device cache, edits and previews into the session. */
export function EditSlot({ assetId, versionId, onClose }: EditSlotProps) {
  const session = useSession();
  const view = useLibraryView();
  const asset = view.assets.get(assetId);
  const version = view.versions.get(versionId);
  const [download, setDownload] = useState<Download | null>(null);
  const setEditing = useUi((s) => s.setEditing);
  const copiedEdits = useUi((s) => s.copiedEdits);
  const setCopiedEdits = useUi((s) => s.setCopiedEdits);
  const orderedIds = useOrderedIds();
  const allPresets = usePresets();
  const presets = useMemo(() => allPresets.filter((p) => !p.deleted), [allPresets]);
  // The history and the versions change with the library view.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const history = useMemo(() => session.history(versionId), [session, versionId, view]);
  const versions = useMemo(() => versionsByAsset(view).get(assetId) ?? [], [view, assetId]);
  const filmstrip = useFilmstrip(orderedIds, assetId);
  // The stored screen preview shows at once while the engine loads the original.
  const storedPreviewUrl = usePreviewUrl(version?.screen ?? null, 'screen');
  const abort = useRef<AbortController | null>(null);

  // Keep the original in the device cache while it is open here.
  const pinned = asset ?? null;
  useEffect(() => {
    if (!pinned) return;
    return getBackend().pinOriginal(session, pinned);
    // Pin by identity of the file, not of the asset object (marks change it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, pinned?.sha256]);

  useEffect(() => () => abort.current?.abort(), []);

  const loadOriginal = useCallback(
    async (a: Asset): Promise<Blob> => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setDownload({ loaded: 0, total: a.byteSize });
      try {
        return await getBackend().loadOriginal(session, a, {
          signal: controller.signal,
          onProgress: (loaded, total) => setDownload({ loaded, total: total ?? a.byteSize }),
        });
      } finally {
        setDownload(null);
      }
    },
    [session],
  );

  const onEdit = useCallback(
    (changes: Readonly<Record<string, Json>>, label: string) => session.editRecipe(versionId, changes, label),
    [session, versionId],
  );
  const onSetRecipe = useCallback((recipe: Recipe, label: string) => session.setRecipe(versionId, recipe, label), [session, versionId]);
  const onUndo = useCallback(() => void session.undo(versionId), [session, versionId]);
  const onRedo = useCallback(() => void session.redo(versionId), [session, versionId]);
  const onPreviewRendered = useCallback(
    (previews: { thumb: Blob; screen: Blob; recipeHash: string }) => {
      getBackend()
        .storeEditPreviews(session, versionId, previews)
        .catch((error: unknown) => {
          console.warn('The edited previews could not be saved', error);
          showToast('The edited thumbnail could not be saved; the grid shows the old one for now.');
        });
    },
    [session, versionId],
  );

  const onSelectVersion = useCallback((id: VersionId) => setEditing({ assetId, versionId: id }), [setEditing, assetId]);
  const onCreateVersion = useCallback(
    (name: string, recipe: Recipe) => {
      const id = session.createVersion(assetId, name, recipe);
      setEditing({ assetId, versionId: id });
    },
    [session, assetId, setEditing],
  );
  const onRenameVersion = useCallback((id: VersionId, name: string) => session.renameVersion(id, name), [session]);
  const onDeleteVersion = useCallback(
    (id: VersionId) => {
      const others = versions.filter((v) => v.id !== id);
      const next = others[0];
      if (!next) return;
      // Leave the version before it goes, and keep the photo's own version a live one.
      if (id === versionId) setEditing({ assetId, versionId: next.id });
      // One undo step for both.
      session.libraryStep('Delete version', () => {
        if (asset && asset.primaryVersionId === id) session.setPrimaryVersion(assetId, next.id);
        session.deleteVersion(id);
      });
    },
    [versions, versionId, asset, session, assetId, setEditing],
  );
  const onSavePreset = useCallback(
    (name: string, recipe: Recipe, groups: readonly RecipeGroupId[]) => {
      session.savePreset(name, recipe, groups);
      showToast(`Saved the preset “${name}”.`);
    },
    [session],
  );
  const onDeletePreset = useCallback((id: PresetId) => session.deletePreset(id), [session]);
  const onCopyEdits = useCallback(
    (copied: CopiedEdits) => {
      setCopiedEdits(copied);
      showToast(`Copied edits from ${copied.sourceName}.`);
    },
    [setCopiedEdits],
  );
  const onPasteEdits = useCallback(() => {
    if (copiedEdits) pasteRecipeValues(session, [versionId], copiedEdits);
  }, [session, versionId, copiedEdits]);

  if (!asset || !version || asset.deleted || version.deleted) {
    return (
      <div className={styles.slot} role="region" aria-label="Edit">
        <p className={styles.message}>This photo is no longer in the library.</p>
        <Button variant="primary" onClick={onClose}>
          Back to the library
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.frame}>
      <EditView
        asset={asset}
        version={version}
        loadOriginal={loadOriginal}
        onEdit={onEdit}
        onSetRecipe={onSetRecipe}
        onUndo={onUndo}
        onRedo={onRedo}
        onClose={onClose}
        onPreviewRendered={onPreviewRendered}
        onExport={downloadBlob}
        storedPreviewUrl={storedPreviewUrl}
        history={history}
        versions={versions}
        onSelectVersion={onSelectVersion}
        onCreateVersion={onCreateVersion}
        onRenameVersion={onRenameVersion}
        onDeleteVersion={onDeleteVersion}
        presets={presets}
        onSavePreset={onSavePreset}
        onDeletePreset={onDeletePreset}
        onCopyEdits={onCopyEdits}
        onPasteEdits={onPasteEdits}
        canPasteEdits={copiedEdits !== null}
        filmstrip={
          filmstrip.length > 1
            ? {
                items: filmstrip,
                currentId: assetId,
                onOpen: (id: string) => {
                  const next = view.assets.get(id);
                  if (next) setEditing({ assetId: id, versionId: next.primaryVersionId });
                },
              }
            : undefined
        }
      />
      {download && download.loaded < (download.total ?? Infinity) && (
        <div className={styles.download} role="status" aria-live="polite">
          <span>
            Getting the original: {formatBytes(download.loaded)}
            {download.total !== null && ` of ${formatBytes(download.total)}`}
          </span>
          <span className={styles.bar}>
            <span
              className={styles.fill}
              style={
                { '--fraction': `${download.total ? Math.min(100, (download.loaded / download.total) * 100) : 0}%` } as React.CSSProperties
              }
            />
          </span>
        </div>
      )}
    </div>
  );
}

/** How many photos either side of the open one the filmstrip loads thumbnails for. */
const FILMSTRIP_REACH = 40;

/** The grid's photos for the filmstrip, with thumbnails loaded around the open one. */
function useFilmstrip(orderedIds: readonly AssetId[], currentId: AssetId): FilmstripItem[] {
  const session = useSession();
  const view = useLibraryView();
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());

  const entries = useMemo(() => {
    const index = orderedIds.indexOf(currentId);
    return orderedIds.map((id, i) => {
      const asset = view.assets.get(id);
      const version = asset ? view.versions.get(asset.primaryVersionId) : undefined;
      const ref: PreviewRef | null = version?.thumb ?? null;
      return { id, label: asset?.fileName ?? id, ref, isNear: index < 0 || Math.abs(i - index) <= FILMSTRIP_REACH };
    });
  }, [orderedIds, currentId, view]);

  useEffect(() => {
    let live = true;
    for (const entry of entries) {
      if (!entry.isNear || !entry.ref || peekPreviewUrl('thumb', entry.ref)) continue;
      const key = `${entry.ref.fileId}|${entry.ref.recipeHash}`;
      loadPreviewUrl(session, 'thumb', entry.ref)
        .then((url) => {
          if (live) setUrls((prev) => new Map(prev).set(key, url));
        })
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
  }, [entries, session]);

  return entries.map((e) => ({
    id: e.id,
    label: e.label,
    thumbnail: e.ref ? (peekPreviewUrl('thumb', e.ref) ?? urls.get(`${e.ref.fileId}|${e.ref.recipeHash}`) ?? null) : null,
  }));
}
