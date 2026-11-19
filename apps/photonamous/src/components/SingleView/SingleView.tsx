import { useId, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, EyeOff, Paintbrush, SlidersHorizontal } from 'lucide-react';
import type { AssetId } from '@lopsy/photos-core/library/types';
import { useAsset } from '../../app/hooks';
import { useUi } from '../../app/store';
import { parseItem } from '../../library/items';
import { backOut, openEdit, openFocusedInLopsy, runCommand, setLabel, setRating, toggleSetAside } from '../../app/commands';
import { Button } from '../Button/Button';
import { IconButton } from '../IconButton/IconButton';
import { LabelPicker } from '../LabelPicker/LabelPicker';
import { VersionStrip } from '../VersionStrip/VersionStrip';
import { DocumentList } from '../DocumentList/DocumentList';
import { Preview, type ZoomPoint } from '../Preview/Preview';
import { Stars } from '../Stars/Stars';
import { useViewFocus } from './use-view-focus';
import styles from './SingleView.module.css';

interface SingleViewProps {
  orderedIds: readonly AssetId[];
  /** Cull mode: full screen, and marking moves to the next photo. */
  cull?: boolean;
}

export function SingleView({ orderedIds, cull = false }: SingleViewProps) {
  const focus = useUi((s) => s.selection.focus);
  const asset = useAsset(focus === null ? null : parseItem(focus).assetId);
  const index = focus === null ? -1 : orderedIds.indexOf(focus);
  // Zoom belongs to one photo; moving on fits the next one again.
  const [zoomed, setZoomed] = useState<{ id: AssetId; point: ZoomPoint } | null>(null);
  const zoom = zoomed !== null && zoomed.id === focus ? zoomed.point : null;
  const root = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const hintId = useId();
  useViewFocus(root);
  const position = index >= 0 ? `${(index + 1).toLocaleString()} of ${orderedIds.length.toLocaleString()}` : '';

  return (
    <div
      ref={root}
      className={`${styles.view} ${cull ? styles.cull : ''}`}
      tabIndex={-1}
      // Cull covers the whole screen and the library behind it is inert: a modal dialog.
      role={cull ? 'dialog' : 'region'}
      aria-modal={cull ? true : undefined}
      aria-label={cull ? `Cull: ${asset?.fileName ?? 'no photo'}` : undefined}
      aria-labelledby={cull ? undefined : headingId}
      aria-describedby={cull ? hintId : undefined}
    >
      <div className={styles.top}>
        <Button variant="ghost" size="sm" onClick={backOut}>
          <ArrowLeft size={14} />
          {cull ? 'Leave full screen' : 'Back to the grid'}
        </Button>
        <h1 id={headingId} className={styles.name}>
          {asset?.fileName ?? 'No photo'}
        </h1>
        <span className={styles.position}>{position}</span>
        <p className={styles.visuallyHidden} role="status">
          {asset ? `${asset.fileName}, ${position}` : ''}
        </p>
      </div>

      <div className={styles.stage}>
        {focus !== null && asset ? (
          <>
            <Preview
              key={focus}
              itemId={focus}
              zoom={zoom}
              onZoom={(point) => setZoomed(point ? { id: focus, point } : null)}
            />
            {asset.setAside && <span className={styles.asideTag}>Set aside</span>}
          </>
        ) : (
          <p className={styles.empty}>No photo to show.</p>
        )}
        <IconButton
          className={`${styles.nav} ${styles.prev}`}
          label="Previous photo (←)"
          icon={<ChevronLeft size={24} />}
          disabled={index <= 0}
          onClick={() => runCommand('move-left', orderedIds)}
        />
        <IconButton
          className={`${styles.nav} ${styles.next}`}
          label="Next photo (→)"
          icon={<ChevronRight size={24} />}
          disabled={index < 0 || index >= orderedIds.length - 1}
          onClick={() => runCommand('move-right', orderedIds)}
        />
      </div>

      {asset && focus !== null && <VersionStrip itemId={focus} />}
      {asset && <DocumentList assetId={asset.id} />}
      {asset && (
        <div className={styles.bar}>
          <Stars rating={asset.rating} size={18} onChange={(r) => setRating(r, orderedIds, [asset.id])} />
          <LabelPicker value={asset.label} onChange={(l) => setLabel(l, orderedIds, [asset.id])} />
          <Button size="sm" variant={asset.setAside ? 'primary' : 'secondary'} onClick={() => toggleSetAside(orderedIds, [asset.id])}>
            <EyeOff size={14} />
            {asset.setAside ? 'Bring back' : 'Set aside'}
          </Button>
          <span className={styles.spacer} />
          {cull && (
            <span id={hintId} className={styles.hint}>
              1–5 rate · X set aside · each moves on · Esc leaves
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={openFocusedInLopsy}
          >
            <Paintbrush size={14} />
            Edit in Lopsy
          </Button>
          <Button size="sm" onClick={openEdit}>
            <SlidersHorizontal size={14} />
            Edit
          </Button>
        </div>
      )}
    </div>
  );
}
