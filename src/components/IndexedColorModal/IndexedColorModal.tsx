import { useState, useCallback } from 'react';
import { useEditorStore } from '../../app/editor-store';
import styles from './IndexedColorModal.module.css';

const MIN_COLORS = 2;
const MAX_COLORS = 256;

interface IndexedColorModalProps {
  onClose: () => void;
}

export function IndexedColorModal({ onClose }: IndexedColorModalProps) {
  const convertColorMode = useEditorStore((s) => s.convertColorMode);
  const layerCount = useEditorStore(
    (s) => s.document.layers.filter((l) => l.type !== 'group').length,
  );

  const [colors, setColors] = useState(String(MAX_COLORS));
  const [dither, setDither] = useState(false);

  const handleApply = useCallback(() => {
    const parsed = parseInt(colors, 10) || MAX_COLORS;
    const maxColors = Math.max(MIN_COLORS, Math.min(MAX_COLORS, parsed));
    convertColorMode('indexed', { maxColors, dither });
    onClose();
  }, [colors, dither, convertColorMode, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [handleApply, onClose]);

  return (
    <div className={styles.overlay} role="presentation">
      <div className={styles.modal} role="dialog" aria-label="Indexed Color" onKeyDown={handleKeyDown}>
        <div className={styles.header}>
          <h2>Indexed Color</h2>
        </div>
        <div className={styles.body}>
          <div className={styles.fields}>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="indexed-colors">Colors</label>
              <input
                id="indexed-colors"
                className={styles.fieldInput}
                type="number"
                min={MIN_COLORS}
                max={MAX_COLORS}
                value={colors}
                onChange={(e) => setColors(e.target.value)}
              />
            </div>
          </div>
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={dither}
              onChange={(e) => setDither(e.target.checked)}
            />
            Dither (Floyd–Steinberg)
          </label>
          {layerCount > 1 && (
            <p className={styles.warning}>
              Indexed color does not support layers. This will flatten the {layerCount} layers
              in this document into one.
            </p>
          )}
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={onClose}>Cancel</button>
          <button className={styles.applyButton} onClick={handleApply}>Convert</button>
        </div>
      </div>
    </div>
  );
}
