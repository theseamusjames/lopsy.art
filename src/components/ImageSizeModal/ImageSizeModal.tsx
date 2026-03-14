import { useState, useCallback } from 'react';
import { useEditorStore } from '../../app/editor-store';
import styles from './ImageSizeModal.module.css';

interface ImageSizeModalProps {
  onClose: () => void;
}

export function ImageSizeModal({ onClose }: ImageSizeModalProps) {
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const resizeImage = useEditorStore((s) => s.resizeImage);

  const [width, setWidth] = useState(String(docWidth));
  const [height, setHeight] = useState(String(docHeight));
  const [isConstrained, setIsConstrained] = useState(true);
  const aspectRatio = docWidth / docHeight;

  const handleWidthChange = useCallback((value: string) => {
    setWidth(value);
    if (isConstrained) {
      const w = parseInt(value, 10);
      if (!isNaN(w) && w > 0) {
        setHeight(String(Math.round(w / aspectRatio)));
      }
    }
  }, [isConstrained, aspectRatio]);

  const handleHeightChange = useCallback((value: string) => {
    setHeight(value);
    if (isConstrained) {
      const h = parseInt(value, 10);
      if (!isNaN(h) && h > 0) {
        setWidth(String(Math.round(h * aspectRatio)));
      }
    }
  }, [isConstrained, aspectRatio]);

  const handleApply = useCallback(() => {
    const w = Math.max(1, Math.min(16384, Math.round(parseInt(width, 10) || docWidth)));
    const h = Math.max(1, Math.min(16384, Math.round(parseInt(height, 10) || docHeight)));
    resizeImage(w, h);
    onClose();
  }, [width, height, docWidth, docHeight, resizeImage, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [handleApply, onClose]);

  const pctW = Math.round((parseInt(width, 10) || docWidth) / docWidth * 100);
  const pctH = Math.round((parseInt(height, 10) || docHeight) / docHeight * 100);

  return (
    <div className={styles.overlay}>
      <div className={styles.modal} onKeyDown={handleKeyDown}>
        <div className={styles.header}>
          <h2>Image Size</h2>
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
                onChange={(e) => handleWidthChange(e.target.value)}
              />
              <span className={styles.pct}>{pctW}%</span>
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Height</label>
              <input
                className={styles.fieldInput}
                type="number"
                min="1"
                max="16384"
                value={height}
                onChange={(e) => handleHeightChange(e.target.value)}
              />
              <span className={styles.pct}>{pctH}%</span>
            </div>
          </div>
          <label className={styles.constrainRow}>
            <input
              type="checkbox"
              checked={isConstrained}
              onChange={(e) => setIsConstrained(e.target.checked)}
            />
            <span className={styles.constrainLabel}>Constrain proportions</span>
          </label>
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={onClose}>Cancel</button>
          <button className={styles.applyButton} onClick={handleApply}>Apply</button>
        </div>
      </div>
    </div>
  );
}
