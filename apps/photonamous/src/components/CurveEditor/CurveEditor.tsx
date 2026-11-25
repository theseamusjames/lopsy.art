import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { Plus } from 'lucide-react';
import { normalizePoints, type CurvePoint } from '../../engine/curves';
import { addPoint, curvePath, describeCurve, hitPoint, keyMovePoint, movePoint, newPointX, pointName, removePoint, toLevel } from './curve-editor-math';
import styles from './CurveEditor.module.css';

export interface CurveEditorProps {
  readonly label: string;
  readonly points: readonly CurvePoint[];
  /** The line colour (a CSS colour or custom property). */
  readonly color: string;
  readonly isDisabled?: boolean;
  /** Every change while dragging, or while a key is held. */
  readonly onChange: (points: CurvePoint[]) => void;
  /** Once per gesture: release, a key let go, an added or a removed point. */
  readonly onCommit: (points: CurvePoint[]) => void;
}

const SIZE = 200;
/** A point's focus and touch circle, in the editor's 200-unit box: 24 px or more across at its usual width. */
const TARGET_RADIUS = 10;

const MOVE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);

interface Drag {
  readonly pointerId: number;
  readonly index: number;
  readonly before: string;
  points: CurvePoint[];
}

/**
 * A point curve: press on the line to add a point, drag a point to move
 * it, double-click a point to remove it. The end points move only up and
 * down. Each point is also a slider for the keyboard: up and down set its
 * output, left and right its input, Delete removes it; Add point adds one.
 */
export function CurveEditor({ label, points, color, isDisabled = false, onChange, onCommit }: CurveEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const keyPoints = useRef<CurvePoint[] | null>(null);
  const pointRefs = useRef<(SVGCircleElement | null)[]>([]);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const descriptionId = useId();
  const hintId = useId();
  const curve = normalizePoints(points);
  const addX = newPointX(curve);
  const canAdd = addPoint(curve, addX).points.length > curve.length;

  useEffect(() => {
    if (focusIndex === null) return;
    pointRefs.current[focusIndex]?.focus();
    setFocusIndex(null);
  }, [focusIndex]);

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

  const handlePointKeyDown = (index: number) => (e: KeyboardEvent<SVGCircleElement>) => {
    if (isDisabled) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (index === 0 || index === curve.length - 1) return;
      const next = removePoint(curve, index);
      onChange(next);
      onCommit(next);
      setFocusIndex(index - 1);
      return;
    }
    const base = keyPoints.current ?? curve;
    const next = keyMovePoint(base, index, e.key, e.shiftKey);
    if (!next) return;
    e.preventDefault();
    if (JSON.stringify(next) === JSON.stringify(base)) return;
    keyPoints.current = next;
    onChange(next);
  };

  const handlePointKeyUp = (e: KeyboardEvent<SVGCircleElement>) => {
    if (!MOVE_KEYS.has(e.key)) return;
    const next = keyPoints.current;
    keyPoints.current = null;
    if (next) onCommit(next);
  };

  const handleAdd = () => {
    const { points: next, index } = addPoint(curve, addX);
    if (next.length === curve.length) return;
    onChange(next);
    onCommit(next);
    setFocusIndex(index);
  };

  return (
    <div className={styles.wrapper}>
      <svg
        ref={svgRef}
        className={styles.curveEditor}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="group"
        aria-label={label}
        aria-describedby={descriptionId}
        data-disabled={isDisabled || undefined}
        style={{ '--curve-color': color } as CSSProperties}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        {[0.25, 0.5, 0.75].map((t) => (
          <g key={t} className={styles.grid} aria-hidden="true">
            <line x1={t * SIZE} y1={0} x2={t * SIZE} y2={SIZE} />
            <line x1={0} y1={t * SIZE} x2={SIZE} y2={t * SIZE} />
          </g>
        ))}
        <line className={styles.diagonal} x1={0} y1={SIZE} x2={SIZE} y2={0} aria-hidden="true" />
        <path className={styles.curve} d={curvePath(curve, SIZE)} aria-hidden="true" />
        {curve.map((p, i) => (
          <g key={i}>
            <circle
              ref={(el) => {
                pointRefs.current[i] = el;
              }}
              className={styles.target}
              cx={p.x * SIZE}
              cy={(1 - p.y) * SIZE}
              r={TARGET_RADIUS}
              role="slider"
              tabIndex={isDisabled ? -1 : 0}
              aria-label={pointName(i, curve.length)}
              aria-valuemin={0}
              aria-valuemax={255}
              aria-valuenow={toLevel(p.y)}
              aria-valuetext={`input ${toLevel(p.x)}, output ${toLevel(p.y)}`}
              aria-describedby={hintId}
              aria-disabled={isDisabled || undefined}
              onKeyDown={handlePointKeyDown(i)}
              onKeyUp={handlePointKeyUp}
            />
            <circle className={styles.point} cx={p.x * SIZE} cy={(1 - p.y) * SIZE} r={4} aria-hidden="true" />
          </g>
        ))}
      </svg>
      <p id={descriptionId} className={styles.srOnly}>
        {describeCurve(curve)}
      </p>
      <p id={hintId} className={styles.srOnly}>
        Up and down arrows change the output, left and right the input; Shift moves ten levels. Delete removes the point.
      </p>
      <button type="button" className={styles.add} disabled={isDisabled || !canAdd} onClick={handleAdd}>
        <Plus size={13} aria-hidden />
        <span>Add point</span>
      </button>
    </div>
  );
}
