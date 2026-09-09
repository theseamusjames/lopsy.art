import { useState, useCallback } from 'react';
import { useEditorStore } from '../../app/editor-store';
import {
  DIMENSION_UNITS,
  UNIT_LABEL,
  formatForInput,
  unitStep,
  unitToPixels,
  type DimensionUnit,
} from '../../utils/dimension-units';
import styles from './ImageSizeModal.module.css';

interface ImageSizeModalProps {
  onClose: () => void;
}

const DEFAULT_DPI = 72;

export function ImageSizeModal({ onClose }: ImageSizeModalProps) {
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const resizeImage = useEditorStore((s) => s.resizeImage);

  const [unit, setUnit] = useState<DimensionUnit>('px');
  const [dpi, setDpi] = useState(String(DEFAULT_DPI));
  const [width, setWidth] = useState(formatForInput(docWidth, 'px', DEFAULT_DPI));
  const [height, setHeight] = useState(formatForInput(docHeight, 'px', DEFAULT_DPI));
  const [isConstrained, setIsConstrained] = useState(true);
  const aspectRatio = docWidth / docHeight;

  const dpiNum = parseFloat(dpi) || DEFAULT_DPI;

  const handleWidthChange = useCallback((value: string) => {
    setWidth(value);
    if (!isConstrained) return;
    const wPx = unitToPixels(parseFloat(value) || 0, unit, dpiNum);
    if (wPx > 0) {
      const hPx = Math.round(wPx / aspectRatio);
      setHeight(formatForInput(hPx, unit, dpiNum));
    }
  }, [isConstrained, aspectRatio, unit, dpiNum]);

  const handleHeightChange = useCallback((value: string) => {
    setHeight(value);
    if (!isConstrained) return;
    const hPx = unitToPixels(parseFloat(value) || 0, unit, dpiNum);
    if (hPx > 0) {
      const wPx = Math.round(hPx * aspectRatio);
      setWidth(formatForInput(wPx, unit, dpiNum));
    }
  }, [isConstrained, aspectRatio, unit, dpiNum]);

  const handleUnitChange = useCallback((newUnit: DimensionUnit) => {
    const wPx = unitToPixels(parseFloat(width) || 0, unit, dpiNum);
    const hPx = unitToPixels(parseFloat(height) || 0, unit, dpiNum);
    setWidth(formatForInput(wPx, newUnit, dpiNum));
    setHeight(formatForInput(hPx, newUnit, dpiNum));
    setUnit(newUnit);
  }, [unit, dpiNum, width, height]);

  const handleDpiChange = useCallback((value: string) => {
    setDpi(value);
    if (unit === 'px') return;
    const nextDpi = parseFloat(value) || DEFAULT_DPI;
    const wPx = unitToPixels(parseFloat(width) || 0, unit, dpiNum);
    const hPx = unitToPixels(parseFloat(height) || 0, unit, dpiNum);
    setWidth(formatForInput(wPx, unit, nextDpi));
    setHeight(formatForInput(hPx, unit, nextDpi));
  }, [unit, dpiNum, width, height]);

  const handleApply = useCallback(() => {
    const wIn = parseFloat(width);
    const hIn = parseFloat(height);
    const wPx = Number.isFinite(wIn)
      ? Math.max(1, Math.min(16384, unitToPixels(wIn, unit, dpiNum)))
      : docWidth;
    const hPx = Number.isFinite(hIn)
      ? Math.max(1, Math.min(16384, unitToPixels(hIn, unit, dpiNum)))
      : docHeight;
    resizeImage(wPx, hPx);
    onClose();
  }, [width, height, unit, dpiNum, docWidth, docHeight, resizeImage, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [handleApply, onClose]);

  const wPxCurrent = unitToPixels(parseFloat(width) || docWidth, unit, dpiNum);
  const hPxCurrent = unitToPixels(parseFloat(height) || docHeight, unit, dpiNum);
  const pctW = Math.round((wPxCurrent / docWidth) * 100);
  const pctH = Math.round((hPxCurrent / docHeight) * 100);
  const step = unitStep(unit);

  return (
    <div className={styles.overlay} role="presentation">
      <div className={styles.modal} role="dialog" aria-label="Image Size" onKeyDown={handleKeyDown}>
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
                min="0"
                step={step}
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
                min="0"
                step={step}
                value={height}
                onChange={(e) => handleHeightChange(e.target.value)}
              />
              <span className={styles.pct}>{pctH}%</span>
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Unit</label>
              <select
                className={styles.unitSelect}
                value={unit}
                onChange={(e) => handleUnitChange(e.target.value as DimensionUnit)}
                aria-label="Unit"
              >
                {DIMENSION_UNITS.map((u) => (
                  <option key={u} value={u}>{UNIT_LABEL[u]}</option>
                ))}
              </select>
            </div>
          </div>
          {unit !== 'px' && (
            <div className={styles.fields}>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Resolution (DPI)</label>
                <input
                  className={styles.fieldInput}
                  type="number"
                  min="1"
                  max="1200"
                  value={dpi}
                  onChange={(e) => handleDpiChange(e.target.value)}
                />
              </div>
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
