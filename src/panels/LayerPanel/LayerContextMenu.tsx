import { useCallback, useRef } from 'react';
import type { LayerColorTag } from '../../types/layers';
import styles from './LayerPanel.module.css';

const COLOR_TAG_OPTIONS: Array<{ tag: LayerColorTag; color: string; label: string }> = [
  { tag: 'red',    color: '#e05555', label: 'Red' },
  { tag: 'orange', color: '#e07c30', label: 'Orange' },
  { tag: 'yellow', color: '#c9a820', label: 'Yellow' },
  { tag: 'green',  color: '#4caf50', label: 'Green' },
  { tag: 'blue',   color: '#4a9eff', label: 'Blue' },
  { tag: 'purple', color: '#9c6edd', label: 'Purple' },
  { tag: 'gray',   color: '#808080', label: 'Gray' },
];

interface LayerContextMenuProps {
  x: number;
  y: number;
  currentTag: LayerColorTag | null | undefined;
  onSetColorTag: (tag: LayerColorTag | null) => void;
  onClose: () => void;
}

export function LayerContextMenu({ x, y, currentTag, onSetColorTag, onClose }: LayerContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      ref={menuRef}
      className={styles.contextMenu}
      style={{ '--menu-x': `${x}px`, '--menu-y': `${y}px` } as React.CSSProperties}
      onMouseDown={handleMouseDown}
      role="menu"
      aria-label="Layer options"
      data-testid="layer-context-menu"
    >
      <div className={styles.contextMenuLabel}>Color Tag</div>
      <div className={styles.colorTagGrid}>
        {COLOR_TAG_OPTIONS.map(({ tag, color, label }) => (
          <button
            key={tag}
            className={[
              styles.colorTagSwatch,
              currentTag === tag ? styles.colorTagSwatchActive : '',
            ].filter(Boolean).join(' ')}
            style={{ '--swatch-color': color } as React.CSSProperties}
            onClick={() => onSetColorTag(tag)}
            type="button"
            aria-label={label}
            title={label}
            data-testid={`color-tag-${tag}`}
          />
        ))}
        <button
          className={[styles.colorTagSwatch, styles.colorTagSwatchNone, currentTag === null || currentTag === undefined ? styles.colorTagSwatchActive : ''].filter(Boolean).join(' ')}
          onClick={() => onSetColorTag(null)}
          type="button"
          aria-label="No color"
          title="No color"
          data-testid="color-tag-none"
        >
          ✕
        </button>
      </div>
      <div className={styles.contextMenuDivider} />
      <button
        className={styles.contextMenuItem}
        onClick={onClose}
        type="button"
        role="menuitem"
      >
        Cancel
      </button>
    </div>
  );
}
