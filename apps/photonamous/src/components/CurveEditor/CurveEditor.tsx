import { useRef, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import { normalizePoints, type CurvePoint } from '../../engine/curves';
import { addPoint, curvePath, hitPoint, movePoint, removePoint } from './curve-editor-math';
import styles from './CurveEditor.module.css';

export interface CurveEditorProps {
  readonly label: string;
  readonly points: readonly CurvePoint[];
  /** The line colour (a CSS colour or custom property). */
  readonly color: string;
  readonly isDisabled?: boolean;
  /** Every change while dragging. */
  readonly onChange: (points: CurvePoint[]) => void;
  /** Once per gesture: release, or a removed point. */
  readonly onCommit: (points: CurvePoint[]) => void;
}

const SIZE = 200;

interface Drag {
  readonly pointerId: number;
  readonly index: number;
  readonly before: string;
  points: CurvePoint[];
}

/**
 * A point curve: press on the line to add a point, drag a point to move
 * it, double-click a point to remove it. The end points move only up and
 * down.
 */
export function CurveEditor({ label, points, color, isDisabled = false, onChange, onCommit }: CurveEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const curve = normalizePoints(points);

  const toCurve = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return { x: 0, y: 0 };
    return { x: (clientX - rect.left) / rect.width, y: 1 - (clientY - rect.top) / rect.height };
  };

  const handlePointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (isDisabled || e.button !== 0) return;
    e.preventDefault();
    const at = toCurve(e.clientX, e.clientY);
    const hit = hitPoint(curve, at.x, at.y);
    const { points: next, index } = hit === null ? addPoint(curve, at.x) : { points: curve, index: hit };
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointerId: e.pointerId, index, before: JSON.stringify(curve), points: next };
    if (hit === null) onChange(next);
  };

  const handlePointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const at = toCurve(e.clientX, e.clientY);
    d.points = movePoint(d.points, d.index, at.x, at.y);
    onChange(d.points);
  };

  const handlePointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (JSON.stringify(d.points) !== d.before) onCommit(d.points);
  };

  const handleDoubleClick = (e: MouseEvent<SVGSVGElement>) => {
    if (isDisabled) return;
    const at = toCurve(e.clientX, e.clientY);
    const hit = hitPoint(curve, at.x, at.y);
    if (hit === null || hit === 0 || hit === curve.length - 1) return;
    const next = removePoint(curve, hit);
    onChange(next);
    onCommit(next);
  };

  return (
    <svg
      ref={svgRef}
      className={styles.curveEditor}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={label}
      data-disabled={isDisabled || undefined}
      style={{ '--curve-color': color } as CSSProperties}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={handleDoubleClick}
    >
      {[0.25, 0.5, 0.75].map((t) => (
        <g key={t} className={styles.grid}>
          <line x1={t * SIZE} y1={0} x2={t * SIZE} y2={SIZE} />
          <line x1={0} y1={t * SIZE} x2={SIZE} y2={t * SIZE} />
        </g>
      ))}
      <line className={styles.diagonal} x1={0} y1={SIZE} x2={SIZE} y2={0} />
      <path className={styles.curve} d={curvePath(curve, SIZE)} />
      {curve.map((p, i) => (
        <circle key={i} className={styles.point} cx={p.x * SIZE} cy={(1 - p.y) * SIZE} r={4} />
      ))}
    </svg>
  );
}
