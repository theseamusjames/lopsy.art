import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Button } from '../Button/Button';
import styles from './ShapeSizeModal.module.css';
import { clampDocumentSide } from '../../utils/document-size';
import { getMaxDocumentSide } from '../../engine-wasm/gpu-limits';

interface ShapeSizeModalProps {
  onConfirm: (width: number, height: number) => void;
  onCancel: () => void;
}

export function ShapeSizeModal({ onConfirm, onCancel }: ShapeSizeModalProps) {
  const [width, setWidth] = useState('200');
  const [height, setHeight] = useState('200');
  const widthRef = useRef<HTMLInputElement>(null);
  const maxSide = useMemo(() => getMaxDocumentSide(), []);

  useEffect(() => {
    widthRef.current?.select();
  }, []);

  const handleConfirm = useCallback(() => {
    const w = clampDocumentSide(parseFloat(width) || 1, maxSide);
    const h = clampDocumentSide(parseFloat(height) || 1, maxSide);
    onConfirm(w, h);
  }, [width, height, maxSide, onConfirm]);

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
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Shape Size" onMouseDown={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
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
                max={maxSide}
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
                max={maxSide}
                value={height}
                onChange={(e) => setHeight(e.target.value)}
              />
            </div>
            <span className={styles.unit}>px</span>
          </div>
        </div>
        <div className={styles.footer}>
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={handleConfirm}>Create</Button>
        </div>
      </div>
    </div>
  );
}
