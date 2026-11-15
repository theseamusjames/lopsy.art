import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { Point } from '../../types';
import type { MarqueeShape } from '../../tools/marquee/marquee-region';
import { regionFromCorners } from '../../tools/marquee/marquee-region';
import { Button } from '../Button/Button';
import styles from './MarqueeRegionModal.module.css';

interface MarqueeRegionModalProps {
  shape: MarqueeShape;
  initialFrom: Point;
  initialTo: Point;
  onConfirm: (from: Point, to: Point) => void;
  onCancel: () => void;
}

interface CoordinateFieldProps {
  label: string;
  axis: 'X' | 'Y';
  value: string;
  onChange: (value: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}

function CoordinateField({ label, axis, value, onChange, inputRef }: CoordinateFieldProps) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{axis}</span>
      <input
        ref={inputRef}
        className={styles.fieldInput}
        type="number"
        step="1"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function parseCoord(value: string): number | null {
  const n = parseFloat(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function MarqueeRegionModal({ shape, initialFrom, initialTo, onConfirm, onCancel }: MarqueeRegionModalProps) {
  const [fromX, setFromX] = useState(String(initialFrom.x));
  const [fromY, setFromY] = useState(String(initialFrom.y));
  const [toX, setToX] = useState(String(initialTo.x));
  const [toY, setToY] = useState(String(initialTo.y));
  const fromXRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fromXRef.current?.select();
  }, []);

  const corners = useMemo(() => {
    const fx = parseCoord(fromX);
    const fy = parseCoord(fromY);
    const tx = parseCoord(toX);
    const ty = parseCoord(toY);
    if (fx === null || fy === null || tx === null || ty === null) return null;
    return { from: { x: fx, y: fy }, to: { x: tx, y: ty } };
  }, [fromX, fromY, toX, toY]);
  const region = corners ? regionFromCorners(corners.from, corners.to) : null;

  const handleConfirm = useCallback(() => {
    if (!corners || !region) return;
    onConfirm(corners.from, corners.to);
  }, [corners, region, onConfirm]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }, [handleConfirm, onCancel]);

  const title = shape === 'ellipse' ? 'Elliptical Selection' : 'Rectangular Selection';

  return (
    <div className={styles.overlay} onMouseDown={onCancel}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className={styles.header}>
          <h2>{title}</h2>
        </div>
        <div className={styles.body}>
          <div className={styles.row}>
            <span className={styles.rowLabel}>From</span>
            <CoordinateField label="From X" axis="X" value={fromX} onChange={setFromX} inputRef={fromXRef} />
            <CoordinateField label="From Y" axis="Y" value={fromY} onChange={setFromY} />
            <span className={styles.unit}>px</span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>To</span>
            <CoordinateField label="To X" axis="X" value={toX} onChange={setToX} />
            <CoordinateField label="To Y" axis="Y" value={toY} onChange={setToY} />
            <span className={styles.unit}>px</span>
          </div>
          <div className={styles.summary} aria-live="polite">
            {region ? `${region.width} × ${region.height} px` : 'Region must have a width and height'}
          </div>
        </div>
        <div className={styles.footer}>
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={handleConfirm} disabled={!region}>Select</Button>
        </div>
      </div>
    </div>
  );
}
