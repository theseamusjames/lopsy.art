import { useCallback, useEffect, useRef, useState } from 'react';
import type { Asset, AssetId, Json, VersionId } from '@lopsy/photos-core/library/types';
import type { Recipe } from '@lopsy/photos-core/library/recipe';
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
