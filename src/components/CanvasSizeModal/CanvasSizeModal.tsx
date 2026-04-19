import { useState, useCallback } from 'react';
import { useEditorStore } from '../../app/editor-store';
import styles from './CanvasSizeModal.module.css';

type AnchorX = 0 | 0.5 | 1;
type AnchorY = 0 | 0.5 | 1;

interface CanvasSizeModalProps {
  onClose: () => void;
}

export function CanvasSizeModal({ onClose }: CanvasSizeModalProps) {
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const resizeCanvas = useEditorStore((s) => s.resizeCanvas);

  const [width, setWidth] = useState(String(docWidth));
  const [height, setHeight] = useState(String(docHeight));
  const [anchorX, setAnchorX] = useState<AnchorX>(0.5);
  const [anchorY, setAnchorY] = useState<AnchorY>(0.5);

  const handleApply = useCallback(() => {
    const w = Math.max(1, Math.min(16384, Math.round(parseInt(width, 10) || docWidth)));
    const h = Math.max(1, Math.min(16384, Math.round(parseInt(height, 10) || docHeight)));
    resizeCanvas(w, h, anchorX, anchorY);
    onClose();
  }, [width, height, anchorX, anchorY, docWidth, docHeight, resizeCanvas, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [handleApply, onClose]);

  const anchorPositions: Array<{ x: AnchorX; y: AnchorY }> = [
    { x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 },
    { x: 0, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0.5 },
    { x: 0, y: 1 }, { x: 0.5, y: 1 }, { x: 1, y: 1 },
  ];

  return (
    <div className={styles.overlay} role="presentation">
      <div className={styles.modal} role="dialog" aria-label="Canvas Size" onKeyDown={handleKeyDown}>
        <div className={styles.header}>
          <h2>Canvas Size</h2>
        </div>
        <div className={styles.body}>
          <div className={styles.info}>
            Current: {docWidth} × {docHeight} px
          </div>
          <div className={styles.fields}>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Width</label>
              <input
                className={styles.fieldInput}
                type="number"
                min="1"
                max="16384"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Height</label>
              <input
                className={styles.fieldInput}
                type="number"
                min="1"
                max="16384"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
              />
            </div>
          </div>
          <div className={styles.anchorSection}>
            <span className={styles.fieldLabel}>Anchor</span>
            <div className={styles.anchorGrid}>
              {anchorPositions.map((pos) => (
                <button
                  key={`${pos.x}-${pos.y}`}
                  type="button"
                  className={`${styles.anchorDot} ${anchorX === pos.x && anchorY === pos.y ? styles.anchorDotActive : ''}`}
                  onClick={() => { setAnchorX(pos.x); setAnchorY(pos.y); }}
                  aria-label={`Anchor ${pos.x === 0 ? 'left' : pos.x === 0.5 ? 'center' : 'right'} ${pos.y === 0 ? 'top' : pos.y === 0.5 ? 'middle' : 'bottom'}`}
                  aria-pressed={anchorX === pos.x && anchorY === pos.y}
                />
              ))}
            </div>
          </div>
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={onClose}>Cancel</button>
          <button className={styles.applyButton} onClick={handleApply}>Apply</button>
        </div>
      </div>
    </div>
  );
}
