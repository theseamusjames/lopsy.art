import { memo, type MouseEvent } from 'react';
import { Images, Layers, SlidersHorizontal } from 'lucide-react';
import type { AssetId } from '@lopsy/photos-core/library/types';
import { useFindResult, useLibraryView, usePreviewUrl, useVersionCounts } from '../../app/hooks';
import { useUi } from '../../app/store';
import { writeDraggedIds } from '../../app/drag';
import { isEdited } from '../../library/asset-query';
import { Stars } from '../Stars/Stars';
import styles from './PhotoTile.module.css';

interface PhotoTileProps {
  assetId: AssetId;
  selected: boolean;
  focused: boolean;
  onPick: (id: AssetId, e: MouseEvent) => void;
  onOpen: (id: AssetId) => void;
}

export const PhotoTile = memo(function PhotoTile({ assetId, selected, focused, onPick, onOpen }: PhotoTileProps) {
  const view = useLibraryView();
  const counts = useVersionCounts();
  const burst = useFindResult().bursts.get(assetId) ?? 0;
  const burstOpen = useUi((s) => s.expandedBursts.has(assetId));
  // Everything in the Set aside list is set aside; dimming it all would hide nothing.
  const inSetAsideList = useUi((s) => s.collection.kind === 'set-aside');
  const asset = view.assets.get(assetId);
  const version = asset ? view.versions.get(asset.primaryVersionId) : undefined;
  const url = usePreviewUrl(version?.thumb ?? null, 'thumb');
  if (!asset) return null;
  const edited = isEdited(asset, view);
  const versions = counts.get(asset.id) ?? 1;
  const paired = asset.pairedWith !== null && view.assets.get(asset.pairedWith)?.deleted === false;

  return (
    <div
      className={styles.tile}
      role="gridcell"
      aria-selected={selected}
      data-focused={focused}
      data-aside={asset.setAside && !inSetAsideList}
      data-asset-id={asset.id}
      data-rating={asset.rating}
      data-edited={edited}
      data-preview-hash={version?.thumb?.recipeHash ?? ''}
      title={asset.fileName}
      draggable
      onDragStart={(e) => {
        const sel = useUi.getState().selection.ids;
        writeDraggedIds(e.dataTransfer, sel.has(asset.id) ? [...sel] : [asset.id]);
      }}
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault();
      }}
      onClick={(e) => onPick(asset.id, e)}
      onDoubleClick={() => onOpen(asset.id)}
    >
      <div className={styles.frame}>
        {url ? (
          <img className={styles.image} src={url} alt={asset.title || asset.fileName} draggable={false} decoding="async" />
        ) : (
          <div className={styles.placeholder} />
        )}
      </div>
      <div className={styles.overlay}>
        <span className={styles.marks}>
          {asset.label && <span className={styles.label} data-label={asset.label} aria-label={`${asset.label} label`} />}
          {asset.rating > 0 && <Stars rating={asset.rating} size={11} />}
        </span>
        <span className={styles.badges}>
          {burst > 1 && (
            <button
              type="button"
              className={`${styles.badge} ${styles.burst}`}
              title={burstOpen ? 'Fold this burst back into one photo' : `A burst of ${burst} photos: show them all`}
              aria-expanded={burstOpen}
              onClick={(e) => {
                e.stopPropagation();
                useUi.getState().toggleBurst(assetId);
              }}
            >
              <Images size={11} />
              {burst}
            </button>
          )}
          {paired && (
            <span className={styles.badge} title="RAW and JPEG shot together; the RAW is shown">
              <Layers size={11} />
              RAW+JPEG
            </span>
          )}
          {versions > 1 && (
            <span className={styles.badge} title={`${versions} versions`}>
              {versions}
            </span>
          )}
          {edited && (
            <span className={styles.badge} title="Edited">
              <SlidersHorizontal size={11} />
            </span>
          )}
        </span>
      </div>
    </div>
  );
});
