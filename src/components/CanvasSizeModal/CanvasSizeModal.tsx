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
import styles from './CanvasSizeModal.module.css';

type AnchorX = 0 | 0.5 | 1;
type AnchorY = 0 | 0.5 | 1;

interface CanvasSizeModalProps {
  onClose: () => void;
}

const DEFAULT_DPI = 72;

export function CanvasSizeModal({ onClose }: CanvasSizeModalProps) {
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const resizeCanvas = useEditorStore((s) => s.resizeCanvas);

  const [unit, setUnit] = useState<DimensionUnit>('px');
  const [dpi, setDpi] = useState(String(DEFAULT_DPI));
  const [width, setWidth] = useState(formatForInput(docWidth, 'px', DEFAULT_DPI));
  const [height, setHeight] = useState(formatForInput(docHeight, 'px', DEFAULT_DPI));
  const [anchorX, setAnchorX] = useState<AnchorX>(0.5);
  const [anchorY, setAnchorY] = useState<AnchorY>(0.5);

  const dpiNum = parseFloat(dpi) || DEFAULT_DPI;

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
    resizeCanvas(wPx, hPx, anchorX, anchorY);
    onClose();
  }, [width, height, unit, dpiNum, anchorX, anchorY, docWidth, docHeight, resizeCanvas, onClose]);

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

  const step = unitStep(unit);

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
                min="0"
                step={step}
                value={width}
                onChange={(e) => setWidth(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Height</label>
              <input
                className={styles.fieldInput}
                type="number"
                min="0"
                step={step}
                value={height}
                onChange={(e) => setHeight(e.target.value)}
              />
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
