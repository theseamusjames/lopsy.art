import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IDENTITY_POINTS,
  buildCurveLUT,
  evaluateCurve,
  normalizePoints,
  type CurvePoint,
} from '../../filters/curves';
import { histogramPercentile, type Histogram } from '../../panels/AdjustmentsPanel/histogram-compute';
import styles from './CurveEditor.module.css';

type ChannelKey = 'rgb' | 'r' | 'g' | 'b';

interface CurveEditorProps {
  /**
   * Control points for the active channel. Endpoints at x=0 and x=1 must
   * be present; the editor enforces this on every commit.
   */
  points: readonly CurvePoint[];
  onChange: (points: CurvePoint[]) => void;
  /** Tint of the curve stroke and active control point. */
  color?: string;
  histogram?: Histogram;
  channel?: ChannelKey;
}

const HIT_RADIUS_PX = 8;
const POINT_RADIUS_PX = 4;
const POINT_REMOVE_THRESHOLD_PX = 24;

const HIST_SHADES: Record<'r' | 'g' | 'b', string> = {
  r: 'rgba(180, 60, 60, 0.45)',
  g: 'rgba(60, 160, 80, 0.45)',
  b: 'rgba(60, 90, 180, 0.45)',
};
const HIST_SHADE_FOCUS: Record<ChannelKey, string> = {
  rgb: 'rgba(220, 220, 220, 0.92)',
  r: 'rgba(200, 80, 80, 0.85)',
  g: 'rgba(80, 200, 100, 0.85)',
  b: 'rgba(80, 120, 220, 0.85)',
};
const HIST_SHADE_MUTED = 'rgba(60, 60, 60, 0.35)';

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
  histogram,
  channel = 'rgb',
}: CurveEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
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
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Background.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, cw, ch);

    // Histogram behind everything.
    if (histogram && histogram.total > 0) {
      const cap = Math.max(
        histogramPercentile(histogram.r, 0.995),
        histogramPercentile(histogram.g, 0.995),
        histogramPercentile(histogram.b, 0.995),
        1,
      );

      const drawHistChannel = (bins: Uint32Array, fill: string) => {
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.moveTo(0, ch);
        for (let i = 0; i < 256; i++) {
          const x = (i / 255) * cw;
          const barH = Math.min(1, bins[i]! / cap) * ch;
          ctx.lineTo(x, ch - barH);
        }
        ctx.lineTo(cw, ch);
        ctx.closePath();
        ctx.fill();
      };

      if (channel === 'rgb') {
        ctx.globalCompositeOperation = 'lighter';
        drawHistChannel(histogram.b, HIST_SHADES.b);
        drawHistChannel(histogram.g, HIST_SHADES.g);
        drawHistChannel(histogram.r, HIST_SHADES.r);
        ctx.globalCompositeOperation = 'source-over';
      } else {
        const others: Array<'r' | 'g' | 'b'> = (['r', 'g', 'b'] as const).filter((c) => c !== channel);
        drawHistChannel(histogram[others[0]!], HIST_SHADE_MUTED);
        drawHistChannel(histogram[others[1]!], HIST_SHADE_MUTED);
        drawHistChannel(histogram[channel], HIST_SHADE_FOCUS[channel]);
      }
    }

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
  }, [localPoints, color, histogram, channel]);

  useEffect(() => { draw(); }, [draw]);

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
