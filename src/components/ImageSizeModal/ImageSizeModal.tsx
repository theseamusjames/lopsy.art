import { useState, useCallback } from 'react';
import { useEditorStore } from '../../app/editor-store';
import { formatDimension, toPixels, type DimensionUnit } from '../../utils/dimension-units';
import styles from './ImageSizeModal.module.css';

interface ImageSizeModalProps {
  onClose: () => void;
}

export function ImageSizeModal({ onClose }: ImageSizeModalProps) {
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const resizeImage = useEditorStore((s) => s.resizeImage);

  const [unit, setUnit] = useState<DimensionUnit>('px');
  const [dpi, setDpi] = useState('72');
  const [width, setWidth] = useState(String(docWidth));
  const [height, setHeight] = useState(String(docHeight));
  const [isConstrained, setIsConstrained] = useState(true);
  const aspectRatio = docWidth / docHeight;

  const formatValue = useCallback((pixels: number, u: DimensionUnit, dpiNum: number): string => {
    if (u === 'in') return (pixels / dpiNum).toFixed(2);
    return String(Math.round(pixels));
  }, []);

  const handleWidthChange = useCallback((value: string) => {
    setWidth(value);
    if (isConstrained) {
      const currentDpi = Math.max(1, parseInt(dpi, 10) || 72);
      const rawW = parseFloat(value);
      if (!Number.isFinite(rawW) || rawW <= 0) return;
      const pxW = toPixels(rawW, unit, currentDpi);
      const pxH = Math.round(pxW / aspectRatio);
      setHeight(formatValue(pxH, unit, currentDpi));
    }
  }, [isConstrained, aspectRatio, unit, dpi, formatValue]);

  const handleHeightChange = useCallback((value: string) => {
    setHeight(value);
    if (isConstrained) {
      const currentDpi = Math.max(1, parseInt(dpi, 10) || 72);
      const rawH = parseFloat(value);
      if (!Number.isFinite(rawH) || rawH <= 0) return;
      const pxH = toPixels(rawH, unit, currentDpi);
      const pxW = Math.round(pxH * aspectRatio);
      setWidth(formatValue(pxW, unit, currentDpi));
    }
  }, [isConstrained, aspectRatio, unit, dpi, formatValue]);

  const handleUnitChange = useCallback((newUnit: DimensionUnit) => {
    if (newUnit === unit) return;
    const currentDpi = Math.max(1, parseInt(dpi, 10) || 72);
    const wNum = parseFloat(width) || 0;
    const hNum = parseFloat(height) || 0;
    if (unit === 'px' && newUnit === 'in') {
      setWidth((wNum / currentDpi).toFixed(2));
      setHeight((hNum / currentDpi).toFixed(2));
    } else if (unit === 'in' && newUnit === 'px') {
      setWidth(String(Math.round(wNum * currentDpi)));
      setHeight(String(Math.round(hNum * currentDpi)));
    }
    setUnit(newUnit);
  }, [unit, dpi, width, height]);

  const handleApply = useCallback(() => {
    const dpiNum = Math.max(1, parseInt(dpi, 10) || 72);
    const rawW = parseFloat(width);
    const rawH = parseFloat(height);
    const pxW = Number.isFinite(rawW) ? toPixels(rawW, unit, dpiNum) : docWidth;
    const pxH = Number.isFinite(rawH) ? toPixels(rawH, unit, dpiNum) : docHeight;
    const w = Math.max(1, Math.min(16384, pxW));
    const h = Math.max(1, Math.min(16384, pxH));
    resizeImage(w, h);
    onClose();
  }, [width, height, unit, dpi, docWidth, docHeight, resizeImage, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [handleApply, onClose]);

  const currentDpi = Math.max(1, parseInt(dpi, 10) || 72);
  const rawW = parseFloat(width);
  const rawH = parseFloat(height);
  const pxW = Number.isFinite(rawW) ? toPixels(rawW, unit, currentDpi) : docWidth;
  const pxH = Number.isFinite(rawH) ? toPixels(rawH, unit, currentDpi) : docHeight;
  const pctW = Math.round((pxW / docWidth) * 100);
  const pctH = Math.round((pxH / docHeight) * 100);
  const currentDisplay = `${formatDimension(docWidth, unit, currentDpi)} × ${formatDimension(docHeight, unit, currentDpi)} ${unit}`;

  return (
    <div className={styles.overlay} role="presentation">
      <div className={styles.modal} role="dialog" aria-label="Image Size" onKeyDown={handleKeyDown}>
        <div className={styles.header}>
          <h2>Image Size</h2>
        </div>
        <div className={styles.body}>
          <div className={styles.info}>
            Current: {currentDisplay}
          </div>
          <div className={styles.fields}>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Width</label>
              <input
                className={styles.fieldInput}
                type="number"
                min="0.01"
                step={unit === 'in' ? '0.01' : '1'}
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
                min="0.01"
                step={unit === 'in' ? '0.01' : '1'}
                value={height}
                onChange={(e) => handleHeightChange(e.target.value)}
              />
              <span className={styles.pct}>{pctH}%</span>
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Unit</label>
              <select
                className={styles.unitSelect}
                aria-label="Unit"
                value={unit}
                onChange={(e) => handleUnitChange(e.target.value as DimensionUnit)}
              >
                <option value="px">Pixels</option>
                <option value="in">Inches</option>
              </select>
            </div>
          </div>
          {unit === 'in' && (
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Resolution (DPI)</label>
              <input
                className={styles.fieldInput}
                type="number"
                min="1"
                max="1200"
                value={dpi}
                onChange={(e) => setDpi(e.target.value)}
              />
            </div>
          )}
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
