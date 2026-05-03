import { useCallback, useState } from 'react';
import { ColorPicker } from '../ColorPicker/ColorPicker';
import type { Color } from '../../types';
import type { FillConfig, GradientFill, SolidColorFill } from '../../types';
import styles from './FillLayerDialog.module.css';

interface FillLayerDialogProps {
  initialFill?: FillConfig;
  onApply: (fill: FillConfig) => void;
  onCancel: () => void;
}

export function FillLayerDialog({ initialFill, onApply, onCancel }: FillLayerDialogProps) {
  const defaultColor: Color = { r: 0, g: 0, b: 0, a: 1 };
  const [color, setColor] = useState<Color>(
    initialFill?.type === 'solid-color' ? initialFill.color : defaultColor,
  );

  const handleApply = useCallback(() => {
    const fill: SolidColorFill = { type: 'solid-color', color };
    onApply(fill);
  }, [color, onApply]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel();
  }, [onCancel]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    }
  }, [onCancel, handleApply]);

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.modal} role="dialog" aria-label="Solid Color Fill">
        <div className={styles.header}>
          <h2>Solid Color</h2>
        </div>
        <div className={styles.body}>
          <ColorPicker color={color} onChange={setColor} />
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelBtn} type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className={styles.applyBtn} type="button" onClick={handleApply}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

interface GradientFillDialogProps {
  initialFill?: GradientFill;
  onApply: (fill: FillConfig) => void;
  onCancel: () => void;
}

export function GradientFillDialog({ initialFill, onApply, onCancel }: GradientFillDialogProps) {
  const [gradientType, setGradientType] = useState<'linear' | 'radial'>(
    initialFill?.gradientType ?? 'linear',
  );
  const [angle, setAngle] = useState(initialFill?.angle ?? 90);
  const [reverse, setReverse] = useState(initialFill?.reverse ?? false);
  const [stops, setStops] = useState(
    initialFill?.stops ?? [
      { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
      { position: 1, color: { r: 255, g: 255, b: 255, a: 1 } },
    ],
  );
  const [selectedStopIndex, setSelectedStopIndex] = useState(0);

  const selectedStop = stops[selectedStopIndex];

  const handleColorChange = useCallback((color: Color) => {
    setStops((prev) => prev.map((s, i) => i === selectedStopIndex ? { ...s, color } : s));
  }, [selectedStopIndex]);

  const handleApply = useCallback(() => {
    const fill: GradientFill = {
      type: 'gradient',
      stops,
      gradientType,
      angle,
      reverse,
    };
    onApply(fill);
  }, [stops, gradientType, angle, reverse, onApply]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel();
  }, [onCancel]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    }
  }, [onCancel, handleApply]);

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.modal} role="dialog" aria-label="Gradient Fill">
        <div className={styles.header}>
          <h2>Gradient Fill</h2>
        </div>
        <div className={styles.body}>
          <div className={styles.row}>
            <label className={styles.label}>Type</label>
            <select
              className={styles.select}
              value={gradientType}
              onChange={(e) => setGradientType(e.target.value as 'linear' | 'radial')}
              aria-label="Gradient type"
            >
              <option value="linear">Linear</option>
              <option value="radial">Radial</option>
            </select>
          </div>
          {gradientType === 'linear' && (
            <div className={styles.row}>
              <label className={styles.label}>Angle</label>
              <input
                type="number"
                className={styles.numberInput}
                value={angle}
                min={0}
                max={360}
                onChange={(e) => setAngle(Number(e.target.value))}
                aria-label="Gradient angle"
              />
              <span className={styles.unit}>°</span>
            </div>
          )}
          <div className={styles.row}>
            <label className={styles.label}>Reverse</label>
            <input
              type="checkbox"
              checked={reverse}
              onChange={(e) => setReverse(e.target.checked)}
              aria-label="Reverse gradient"
            />
          </div>
          <div className={styles.stopsRow}>
            {stops.map((stop, i) => (
              <button
                key={i}
                type="button"
                className={`${styles.stopSwatch} ${i === selectedStopIndex ? styles.stopSwatchActive : ''}`}
                style={{ background: `rgb(${stop.color.r}, ${stop.color.g}, ${stop.color.b})` } as React.CSSProperties}
                onClick={() => setSelectedStopIndex(i)}
                aria-label={`Gradient stop ${i + 1} at ${Math.round(stop.position * 100)}%`}
                title={`Stop ${i + 1}: ${Math.round(stop.position * 100)}%`}
              />
            ))}
          </div>
          {selectedStop && (
            <ColorPicker color={selectedStop.color} onChange={handleColorChange} />
          )}
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelBtn} type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className={styles.applyBtn} type="button" onClick={handleApply}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
