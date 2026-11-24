import { memo, type MouseEvent } from 'react';
import { Copy, Images, Layers, Paintbrush, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import type { AssetId } from '@lopsy/photos-core/library/types';
import { useAwaitsPreviews, useFindResult, useLibraryView, usePreviewUrl, usePairPartners, useVersionCounts } from '../../app/hooks';
import { useUi } from '../../app/store';
import { editItem } from '../../app/commands';
import { writeDraggedIds } from '../../app/drag';
import { isEdited } from '../../library/asset-query';
import { parseItem } from '../../library/items';
import { isDefaultRecipe } from '@lopsy/photos-core/library/recipe';
import { LABEL_NAMES } from '../LabelPicker/LabelPicker';
import { Stars } from '../Stars/Stars';
import { ImageCheck } from '../../icons/ImageCheck';
import styles from './PhotoTile.module.css';

const ORIGINAL_STATUS_WORDS = {
  missing: 'Missing original',
  trashed: 'In the trash',
  changed: 'Changed',
} as const;

interface PhotoTileProps {
  assetId: AssetId;
  /** The tile's column in its row, from 1. */
  column: number;
  selected: boolean;
  focused: boolean;
  /** The grid's one tab stop: the focused photo, else the first in view. Its badges are reachable with Tab too. */
  tabbable: boolean;
  onPick: (id: AssetId, e: MouseEvent) => void;
  onOpen: (id: AssetId) => void;
}

function stars(n: number): string {
  return `${n} star${n === 1 ? '' : 's'}`;
}

export const PhotoTile = memo(function PhotoTile({ assetId: itemId, column, selected, focused, tabbable, onPick, onOpen }: PhotoTileProps) {
  const { assetId, versionId: ownVersionId } = parseItem(itemId);
  const view = useLibraryView();
  const counts = useVersionCounts();
  const partners = usePairPartners();
  const found = useFindResult();
  const burst = found.bursts.get(assetId) ?? 0;
  const documents = found.documents.get(assetId) ?? 0;
  const burstOpen = useUi((s) => s.expandedBursts.has(assetId));
  // Everything in the Set aside list is set aside; dimming it all would hide nothing.
  const inSetAsideList = useUi((s) => s.collection.kind === 'set-aside');
  const asset = view.assets.get(assetId);
  const version = asset ? view.versions.get(ownVersionId ?? asset.primaryVersionId) : undefined;
  const url = usePreviewUrl(version?.thumb ?? null, 'thumb');
  const updating = useAwaitsPreviews(version);
  if (!asset || !version) return null;
  const isVersionTile = ownVersionId !== null;
  const edited = isVersionTile ? !isDefaultRecipe(version.recipe) : isEdited(asset, view);
  const versions = counts.get(asset.id) ?? 1;
  const paired = partners.has(asset.id);
  const dimmed = asset.setAside && !inSetAsideList;
  const problem = asset.originalStatus !== undefined && asset.originalStatus !== 'ok' ? ORIGINAL_STATUS_WORDS[asset.originalStatus] : null;
  const labelWords = asset.label ? `${LABEL_NAMES[asset.label]} label` : null;
  const inner = tabbable ? 0 : -1;

  // What a screen reader says when the tile gets focus. It reads the tile's visible text in the order it is drawn (the
  // picture's name, the label, the stars, then each badge as its button names it), so what is heard and what speech
  // input expects match what is shown (WCAG 2.5.3); what is not drawn as text comes last.
  const name = [
    asset.title || asset.fileName,
    labelWords,
    asset.rating > 0 ? stars(asset.rating) : null,
    problem,
    burst > 1 ? `Burst of ${burst} photos` : null,
    documents > 0 ? `${documents} Lopsy document${documents === 1 ? '' : 's'}` : null,
    paired ? 'RAW+JPEG' : null,
    isVersionTile ? version.name : versions > 1 ? `${versions} versions` : null,
    edited ? 'Edited' : null,
    updating ? 'Updating' : null,
    asset.setAside ? 'Dropped' : null,
  ]
    .filter((part): part is string => part !== null)
    .join(', ');

  return (
    <div
      className={styles.tile}
      role="gridcell"
      aria-colindex={column}
      aria-selected={selected}
      aria-label={name}
      tabIndex={inner}
      data-focused={focused}
      data-aside={dimmed}
      data-asset-id={isVersionTile ? undefined : asset.id}
      data-version-id={isVersionTile ? version.id : undefined}
      data-item-id={itemId}
      data-rating={asset.rating}
      data-edited={edited}
      data-updating={updating}
      data-preview-hash={version?.thumb?.recipeHash ?? ''}
      title={isVersionTile ? `${asset.fileName} (${version.name})` : asset.fileName}
      draggable
      onDragStart={(e) => {
        const sel = useUi.getState().selection.ids;
        writeDraggedIds(e.dataTransfer, sel.has(itemId) ? [...sel] : [itemId]);
      }}
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault();
      }}
      onClick={(e) => onPick(itemId, e)}
      onDoubleClick={() => onOpen(itemId)}
    >
      <div className={styles.frame}>
        {url ? (
          <img className={styles.image} src={url} alt={asset.title || asset.fileName} draggable={false} decoding="async" />
        ) : (
          <div className={styles.placeholder} />
        )}
        {updating && (
          <span className={styles.updating} role="img" aria-label="Updating" title="Updating this picture to show its edits">
            <span className={styles.spinner} />
          </span>
        )}
      </div>
      {/* Under the pointer, or on the tile the keyboard is on: the Edit view in one click. */}
      <button type="button" className={styles.edit} tabIndex={inner} aria-label={`Edit ${asset.fileName}`} title="Edit (Enter)" {...press(() => editItem(itemId))}>
        <SlidersHorizontal size={14} />
      </button>
      <div className={styles.overlay}>
        <span className={styles.marks}>
          {asset.label && labelWords && (
            <span className={styles.label} data-label={asset.label} role="img" aria-label={labelWords} title={labelWords} />
          )}
          {asset.rating > 0 && (
            <span className={styles.rating} title={stars(asset.rating)}>
              <Stars rating={asset.rating} size={11} />
            </span>
          )}
        </span>
        <span className={styles.badges}>
          {problem && (
            <span className={`${styles.badge} ${styles.problem}`} title="Check library in Settings for what to do">
              <TriangleAlert size={11} />
              {problem}
            </span>
          )}
          {burst > 1 && (
            <button
              type="button"
              className={`${styles.badge} ${styles.burst}`}
              tabIndex={inner}
              title={burstOpen ? 'Fold this burst back into one photo' : `A burst of ${burst} photos: show them all`}
              aria-label={`Burst of ${burst} photos`}
              aria-expanded={burstOpen}
              {...stackToggle(assetId)}
            >
              <Images size={11} />
              {burst}
            </button>
          )}
          {documents > 0 && (
            <button
              type="button"
              className={`${styles.badge} ${styles.burst}`}
              tabIndex={inner}
              title={
                burstOpen
                  ? 'Fold the Lopsy documents back behind this photo'
                  : `${documents} Lopsy document${documents === 1 ? '' : 's'} made from this photo: show ${documents === 1 ? 'it' : 'them'}`
              }
              aria-label={`${documents} Lopsy document${documents === 1 ? '' : 's'}`}
              aria-expanded={burstOpen}
              {...stackToggle(assetId)}
            >
              <Paintbrush size={11} />
              {documents}
            </button>
          )}
          {paired && (
            <span className={styles.badge} title="RAW and JPEG shot together; the RAW is shown">
              <Layers size={11} />
              RAW+JPEG
            </span>
          )}
          {isVersionTile ? (
            <span className={`${styles.badge} ${styles.versionName}`} title={version.name}>
              {version.name}
            </span>
          ) : (
            versions > 1 && (
              <button
                type="button"
                className={`${styles.badge} ${styles.burst}`}
                tabIndex={inner}
                title={burstOpen ? 'Fold the versions back into one tile' : `${versions} versions: show them all`}
                aria-label={`${versions} versions`}
                aria-expanded={burstOpen}
                {...stackToggle(assetId)}
              >
                <Copy size={11} />
                {versions}
              </button>
            )
          )}
          {edited && (
            <span className={`${styles.badge} ${styles.edited}`} role="img" aria-label="Edited" title="Edited">
              <ImageCheck size={13} />
            </span>
          )}
        </span>
      </div>
    </div>
  );
});

/** A stack badge's handlers: it opens and folds its stack. */
function stackToggle(assetId: string) {
  return press(() => useUi.getState().toggleBurst(assetId));
}

/**
 * The handlers of a button on a tile. The press is kept from the tile,
 * which is draggable and selects on click, so the button does its own
 * thing every time instead of now and then starting a drag or a selection.
 */
function press(run: () => void) {
  return {
    draggable: false,
    onMouseDown: (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
    },
    onDragStart: (e: React.DragEvent) => {
      e.stopPropagation();
      e.preventDefault();
    },
    onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      run();
    },
  };
}
