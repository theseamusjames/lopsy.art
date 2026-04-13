import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IDENTITY_POINTS,
  buildCurveLUT,
  evaluateCurve,
  normalizePoints,
  type CurvePoint,
} from '../../filters/curves';
import styles from './CurveEditor.module.css';

interface CurveEditorProps {
  /**
   * Control points for the active channel. Endpoints at x=0 and x=1 must
   * be present; the editor enforces this on every commit.
   */
  points: readonly CurvePoint[];
  onChange: (points: CurvePoint[]) => void;
  /** Tint of the curve stroke and active control point. */
  color?: string;
  /** Square size in CSS pixels. */
  size?: number;
}

const HIT_RADIUS_PX = 8;
const POINT_RADIUS_PX = 4;
const POINT_REMOVE_THRESHOLD_PX = 24;

interface DragState {
  index: number;
  /** Pointer-down position in canvas-space, used to detect "click without drag". */
  startCanvasX: number;
  startCanvasY: number;
}

export function CurveEditor({
  points,
  onChange,
  color = 'var(--color-text-primary)',
  size = 220,
}: CurveEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  // Mirror of the props points so dragging stays smooth without waiting
  // for the parent to re-render between pointer events.
  const [localPoints, setLocalPoints] = useState<readonly CurvePoint[]>(points);

  useEffect(() => {
    if (!drag) setLocalPoints(points);
  }, [points, drag]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width;
    const h = canvas.height;

    ctx.save();
    ctx.scale(dpr, dpr);
    const cw = w / dpr;
    const ch = h / dpr;

    // Background.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(0, 0, cw, ch);

    // Grid (quarters + diagonal reference).
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const x = (i / 4) * cw;
      const y = (i / 4) * ch;
      ctx.beginPath();
      ctx.moveTo(x, 0); ctx.lineTo(x, ch);
      ctx.moveTo(0, y); ctx.lineTo(cw, y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.moveTo(0, ch); ctx.lineTo(cw, 0);
    ctx.stroke();

    // Curve from the LUT (256 samples — matches the GPU sampling).
    const lut = buildCurveLUT(localPoints);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * cw;
      const y = ch - (lut[i]! / 255) * ch;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Control points.
    for (let i = 0; i < localPoints.length; i++) {
      const p = localPoints[i]!;
      const x = p.x * cw;
      const y = ch - p.y * ch;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, POINT_RADIUS_PX, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.restore();
  }, [localPoints, color]);

  // Resize for HiDPI.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    draw();
  }, [size, draw]);

  useEffect(() => { draw(); }, [draw]);

  const canvasToNormalized = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0, cx: 0, cy: 0 };
    const rect = canvas.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    return {
      x: clamp01(cx / rect.width),
      y: clamp01(1 - cy / rect.height),
      cx, cy,
    };
  }, []);

  const findHitIndex = useCallback((cx: number, cy: number, rect: DOMRect): number => {
    for (let i = 0; i < localPoints.length; i++) {
      const p = localPoints[i]!;
      const px = p.x * rect.width;
      const py = (1 - p.y) * rect.height;
      const dx = cx - px;
      const dy = cy - py;
      if (dx * dx + dy * dy <= HIT_RADIUS_PX * HIT_RADIUS_PX) return i;
    }
    return -1;
  }, [localPoints]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const { x, y, cx, cy } = canvasToNormalized(e.clientX, e.clientY);
    const hit = findHitIndex(cx, cy, rect);
    if (hit >= 0) {
      setDrag({ index: hit, startCanvasX: cx, startCanvasY: cy });
      return;
    }
    // Add a new control point at the cursor.
    const next = normalizePoints([...localPoints, { x, y }]);
    const newIdx = next.findIndex((p) => Math.abs(p.x - x) < 1e-6);
    setLocalPoints(next);
    onChange(next);
    setDrag({ index: newIdx >= 0 ? newIdx : next.length - 1, startCanvasX: cx, startCanvasY: cy });
  }, [canvasToNormalized, findHitIndex, localPoints, onChange]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag) return;
    const { x, y, cx, cy } = canvasToNormalized(e.clientX, e.clientY);
    const isEndpoint = drag.index === 0 || drag.index === localPoints.length - 1;

    // Allow yank-to-remove: drag a non-endpoint far below the canvas to delete.
    if (!isEndpoint) {
      const dx = cx - drag.startCanvasX;
      const dy = cy - drag.startCanvasY;
      if (dx * dx + dy * dy > POINT_REMOVE_THRESHOLD_PX * POINT_REMOVE_THRESHOLD_PX
        && (cy < -POINT_REMOVE_THRESHOLD_PX || cy > (canvasRef.current?.getBoundingClientRect().height ?? 0) + POINT_REMOVE_THRESHOLD_PX)) {
        const next = localPoints.filter((_, i) => i !== drag.index);
        const normalized = normalizePoints(next);
        setLocalPoints(normalized);
        onChange(normalized);
        setDrag(null);
        return;
      }
    }

    const updated = localPoints.map((p, i) => {
      if (i !== drag.index) return p;
      // Endpoints are pinned to their x=0 / x=1 anchor; only y is movable.
      const nextX = isEndpoint ? p.x : x;
      return { x: nextX, y };
    });
    const normalized = normalizePoints(updated);
    setLocalPoints(normalized);
    onChange(normalized);
  }, [drag, canvasToNormalized, localPoints, onChange]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    canvasRef.current?.releasePointerCapture(e.pointerId);
    setDrag(null);
  }, []);

  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const hit = findHitIndex(cx, cy, rect);
    if (hit > 0 && hit < localPoints.length - 1) {
      const next = localPoints.filter((_, i) => i !== hit);
      const normalized = normalizePoints(next);
      setLocalPoints(normalized);
      onChange(normalized);
    }
  }, [findHitIndex, localPoints, onChange]);

  return (
    <div className={styles.container}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        aria-label="Tone curve editor"
      />
      <div className={styles.hint}>
        Click to add a point · Drag to move · Double-click to remove
      </div>
    </div>
  );
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Re-export so callers can render an identity curve without a deep import. */
export { IDENTITY_POINTS, evaluateCurve };
