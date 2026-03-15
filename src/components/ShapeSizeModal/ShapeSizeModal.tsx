import { useState, useCallback, useEffect, useRef } from 'react';
import styles from './ShapeSizeModal.module.css';

interface ShapeSizeModalProps {
  onConfirm: (width: number, height: number) => void;
  onCancel: () => void;
}

export function ShapeSizeModal({ onConfirm, onCancel }: ShapeSizeModalProps) {
  const [width, setWidth] = useState('200');
  const [height, setHeight] = useState('200');
  const widthRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    widthRef.current?.select();
  }, []);

  const handleConfirm = useCallback(() => {
    const w = Math.max(1, Math.min(16384, Math.round(parseFloat(width) || 1)));
    const h = Math.max(1, Math.min(16384, Math.round(parseFloat(height) || 1)));
    onConfirm(w, h);
  }, [width, height, onConfirm]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }, [handleConfirm, onCancel]);

  return (
    <div className={styles.overlay} onMouseDown={onCancel}>
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className={styles.header}>
          <h2>Shape Size</h2>
        </div>
        <div className={styles.body}>
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Width</label>
              <input
                ref={widthRef}
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
            <span className={styles.unit}>px</span>
          </div>
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={onCancel}>Cancel</button>
          <button className={styles.confirmButton} onClick={handleConfirm}>Create</button>
        </div>
      </div>
    </div>
  );
}
