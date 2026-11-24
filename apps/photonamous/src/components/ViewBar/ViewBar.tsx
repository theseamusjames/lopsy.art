import { Columns2, Grid2x2, Grid3x3, Maximize, Square } from 'lucide-react';
import type { AssetId } from '@lopsy/photos-core/library/types';
import { backOut, compareTwo, openCompare, openCull, openSingle } from '../../app/commands';
import { THUMB_SIZE, useUi } from '../../app/store';
import { isMac } from '../../app/hooks';
import { formatChord, SHORTCUTS, type CommandId } from '../../shortcuts/registry';
import { IconButton } from '../IconButton/IconButton';
import styles from './ViewBar.module.css';

interface ViewBarProps {
  orderedIds: readonly AssetId[];
  /**
   * In the four-up view: the photos ticked there. With two or more
   * ticked, Two up shows the first two of them; without, the first two on
   * show.
   */
  picked?: readonly string[];
}

/**
 * The bar under the gallery, and under the photos side by side: how big
 * the thumbnails are at the left, and at the right the ways of looking,
 * as one set of buttons of which the current one is on.
 */
export function ViewBar({ orderedIds, picked = [] }: ViewBarProps) {
  const mode = useUi((s) => s.mode);
  const compareSize = useUi((s) => s.compareSize);
  const thumbSize = useUi((s) => s.thumbSize);
  const setThumbSize = useUi((s) => s.setThumbSize);
  const few = orderedIds.length < 2;
  const narrowing = mode === 'compare' && picked.length >= 2;

  return (
    <div className={styles.bar}>
      <div className={styles.start}>
        {mode === 'grid' && (
          <label className={styles.size}>
            <span className={styles.label}>Size</span>
            <input
              type="range"
              min={THUMB_SIZE.min}
              max={THUMB_SIZE.max}
              value={thumbSize}
              onChange={(e) => setThumbSize(Number(e.target.value))}
              aria-label="Thumbnail size"
            />
          </label>
        )}
      </div>
      <div className={styles.views} role="group" aria-label="View">
        <IconButton label="Grid" icon={<Grid3x3 size={16} />} pressed={mode === 'grid'} onClick={() => mode !== 'grid' && backOut()} />
        <IconButton label={`One photo (${keyOf('open-single')})`} icon={<Square size={16} />} pressed={mode === 'single'} onClick={() => openSingle(orderedIds)} />
        <IconButton
          label={`Two up (${keyOf('open-compare')})`}
          icon={<Columns2 size={16} />}
          pressed={mode === 'compare' && compareSize === 2}
          disabled={few}
          onClick={() => (narrowing ? compareTwo(picked) : openCompare(orderedIds, 2))}
        />
        <IconButton
          label="Four up"
          icon={<Grid2x2 size={16} />}
          pressed={mode === 'compare' && compareSize === 4}
          disabled={orderedIds.length < 3}
          onClick={() => openCompare(orderedIds, 4)}
        />
        <IconButton label={`Full screen (${keyOf('open-cull')})`} icon={<Maximize size={16} />} pressed={mode === 'cull'} onClick={() => openCull(orderedIds)} />
      </div>
    </div>
  );
}

/** A command's first key, as the shortcut help writes it. */
function keyOf(id: CommandId): string {
  const chord = SHORTCUTS.find((s) => s.id === id)?.chords[0];
  return chord ? formatChord(chord, isMac) : '';
}
