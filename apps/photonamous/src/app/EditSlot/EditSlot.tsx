import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Paintbrush } from 'lucide-react';
import type { Asset, AssetId, Json, PresetId, PreviewRef, VersionId } from '@lopsy/photos-core/library/types';
import type { Recipe, RecipeGroupId } from '@lopsy/photos-core/library/recipe';
import type { FilmstripItem } from '../../edit/Filmstrip/Filmstrip';
import { pasteRecipeValues, type CopiedEdits } from '../../library/recipe-copy';
import { versionsByAsset, type ItemId } from '../../library/items';
import { currentStripId, editTargetOf, filmstripEntries, type PhotoVersion } from '../../library/filmstrip';
import { loadPreviewUrl, peekPreviewUrl } from '../preview-cache';
import { useUi } from '../store';
import { useOrderedIds, usePresets, usePreviewUrl } from '../hooks';
import { EditView } from '../../edit/EditView/EditView';
import { EditNotice } from '../../edit/EditNotice/EditNotice';
import { getBackend } from '../backend-registry';
import { useLibraryView, useSession } from '../hooks';
import { openInLopsy } from '../lopsy-handoff';
import { showErrorToast, showToast } from '../toasts';
import { formatBytes } from '../../import/import-summary';
import { downloadBlob } from '../download';
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
  const filmstrip = useFilmstrip(orderedIds, { assetId, versionId });
  // The stored screen preview shows at once while the engine loads the original.
  const storedPreviewUrl = usePreviewUrl(version?.screen ?? null, 'screen');
  const abort = useRef<AbortController | null>(null);

  // Keep the original in the device cache while it is open here (a Lopsy document never is).
  const pinned = asset && asset.kind !== 'document' ? asset : null;
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
          showErrorToast('The edited thumbnail could not be saved; the grid shows the old one for now.');
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
    return <EditNotice heading="This photo is no longer in the library" documentTitle="Not in the library – Photonamous" onClose={onClose} />;
  }

  // Nothing opens a Lopsy document here (openEdit sends it to Lopsy, the filmstrip leaves it out); a stale request says so.
  if (asset.kind === 'document') {
    return (
      <EditNotice
        heading={asset.fileName}
        documentTitle={`${asset.fileName} – Lopsy document – Photonamous`}
        onClose={onClose}
        action={{
          label: 'Open in Lopsy',
          icon: <Paintbrush size={14} />,
          onClick: () => {
            openInLopsy(session, asset.id);
            onClose();
          },
        }}
      >
        This is a Lopsy document. It opens in Lopsy, not in the Edit view.
      </EditNotice>
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
          filmstrip.items.length > 1
            ? {
                items: filmstrip.items,
                currentId: filmstrip.currentId,
                onOpen: (id: ItemId) => {
                  // The Edit view calls this once this photo's previews are saved: read the tile from the library as it is then.
                  const next = editTargetOf(session.getView(), id);
                  if (next) setEditing(next);
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

/** How many tiles either side of the open one the filmstrip loads thumbnails for. */
const FILMSTRIP_REACH = 40;

function thumbKey(ref: PreviewRef): string {
  return `${ref.fileId}|${ref.recipeHash}`;
}

/**
 * The grid's tiles for the filmstrip: its photos and their versions' own
 * tiles, without Lopsy documents (library/filmstrip.ts); the open one, and
 * thumbnails loaded around it.
 */
function useFilmstrip(orderedIds: readonly ItemId[], open: PhotoVersion): { items: FilmstripItem[]; currentId: ItemId } {
  const session = useSession();
  const view = useLibraryView();
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());
  const entries = useMemo(() => filmstripEntries(orderedIds, view), [orderedIds, view]);
  const currentId = currentStripId(entries, view, open);
  const index = entries.findIndex((e) => e.id === currentId);

  useEffect(() => {
    let live = true;
    entries.forEach((entry, i) => {
      const isNear = index < 0 || Math.abs(i - index) <= FILMSTRIP_REACH;
      if (!isNear || !entry.thumb || peekPreviewUrl('thumb', entry.thumb)) return;
      const key = thumbKey(entry.thumb);
      loadPreviewUrl(session, 'thumb', entry.thumb)
        .then((url) => {
          if (live) setUrls((prev) => new Map(prev).set(key, url));
        })
        .catch(() => undefined);
    });
    return () => {
      live = false;
    };
  }, [entries, index, session]);

  const items = entries.map((e) => ({
    id: e.id,
    label: e.label,
    thumbnail: e.thumb ? (peekPreviewUrl('thumb', e.thumb) ?? urls.get(thumbKey(e.thumb)) ?? null) : null,
  }));
  return { items, currentId };
}
