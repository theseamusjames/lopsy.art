import { useCallback, useRef } from 'react';
import styles from './AngleControl.module.css';

interface AngleControlProps {
  angle: number;
  onAngleChange: (degrees: number) => void;
}

export function AngleControl({ angle, onAngleChange }: AngleControlProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const isDragging = useRef(false);

  const computeAngle = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    let deg = Math.atan2(dy, dx) * (180 / Math.PI);
    deg = ((deg % 360) + 360) % 360;
    onAngleChange(Math.round(deg));
  }, [onAngleChange]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isDragging.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
    computeAngle(e.clientX, e.clientY);
  }, [computeAngle]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    computeAngle(e.clientX, e.clientY);
  }, [computeAngle]);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const rad = (angle * Math.PI) / 180;
  const r = 28;
  const cx = 32;
  const cy = 32;
  const lx = cx + Math.cos(rad) * r;
  const ly = cy + Math.sin(rad) * r;

  return (
    <div className={styles.container}>
      <span className={styles.label}>Angle</span>
      <svg
        ref={svgRef}
        className={styles.circle}
        viewBox="0 0 64 64"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--color-border-strong)" strokeWidth="1.5" />
        <line x1={cx} y1={cy} x2={lx} y2={ly} stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" />
        <circle cx={lx} cy={ly} r="3" fill="var(--color-accent)" />
      </svg>
      <span className={styles.value}>{angle}&deg;</span>
    </div>
  );
}
