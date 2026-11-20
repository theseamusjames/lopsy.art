import { useRef, type PointerEvent } from 'react';
import type { Area, LinearGeometry, RadialGeometry } from '@lopsy/photos-core/library/recipe';
import { linearFromDoc, linearToDoc, radialFromDoc, radialToDoc, type AreaFrame, type Point } from '../../engine/areas';
import { dragLinear, dragRadial, ellipseAxes, type LinearHandle, type RadialHandle } from '../area-edit';
import styles from './AreaHandles.module.css';

export interface AreaHandlesProps {
  readonly area: Area;
  readonly frame: AreaFrame;
  /** Where the document is on the stage, in CSS pixels, and its size in document pixels. */
  readonly box: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
  readonly docWidth: number;
  /** While dragging. */
  readonly onDraft: (geometry: LinearGeometry | RadialGeometry) => void;
  /** Once, on release. */
  readonly onCommit: (geometry: LinearGeometry | RadialGeometry, label: string) => void;
}

type Handle = LinearHandle | RadialHandle;

interface Drag {
  readonly pointerId: number;
  readonly handle: Handle;
  readonly from: Point;
  readonly area: Area;
  geometry: LinearGeometry | RadialGeometry | null;
}

const ROTATE_OFFSET = 28;

/**
 * The selected mask's handles over the image (an area in the recipe): for
 * a linear mask the lines of full and no effect with a handle at each and
 * one to move both; for a radial one the ellipse, a handle per radius, a
 * turn handle and a feather ring. Drags work in document pixels and hand
 * back source geometry. The handles are for the pointer: the Masks panel's
 * shape sliders do the same by keyboard, so they stay out of the
 * accessibility tree.
 */
export function AreaHandles({ area, frame, box, docWidth, onDraft, onCommit }: AreaHandlesProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const k = docWidth > 0 ? box.width / docWidth : 1;
  const toScreen = (p: Point): Point => ({ x: box.left + p.x * k, y: box.top + p.y * k });

  const toDoc = (clientX: number, clientY: number): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    const x = clientX - (rect?.left ?? 0);
    const y = clientY - (rect?.top ?? 0);
    return { x: (x - box.left) / k, y: (y - box.top) / k };
  };

  const geometryFor = (start: Area, handle: Handle, from: Point, to: Point): LinearGeometry | RadialGeometry => {
    if (start.kind === 'linear') {
      const d = dragLinear(linearToDoc(start.geometry, frame), handle as LinearHandle, from, to);
      return linearFromDoc(d.p0, d.p1, frame);
    }
    const r = dragRadial({ ellipse: radialToDoc(start.geometry, frame), feather: start.geometry.feather }, handle as RadialHandle, from, to);
    return radialFromDoc(r.ellipse, r.feather, frame);
  };

  const begin = (handle: Handle) => (e: PointerEvent<SVGElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointerId: e.pointerId, handle, from: toDoc(e.clientX, e.clientY), area, geometry: null };
  };

  const handleMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    d.geometry = geometryFor(d.area, d.handle, d.from, toDoc(e.clientX, e.clientY));
    onDraft(d.geometry);
  };

  const handleUp = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (d.geometry) onCommit(d.geometry, d.handle === 'move' ? 'Mask: move' : d.handle === 'rotate' ? 'Mask: turn' : d.handle === 'feather' ? 'Mask: feather' : 'Mask: resize');
  };

  return (
    <svg
      ref={svgRef}
      className={styles.handles}
      aria-hidden="true"
      data-testid="area-handles"
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
    >
      {area.kind === 'linear' ? linearShape(area, frame, toScreen, begin) : radialShape(area, frame, k, toScreen, begin)}
    </svg>
  );
}

type Begin = (handle: Handle) => (e: PointerEvent<SVGElement>) => void;

function linearShape(area: Extract<Area, { kind: 'linear' }>, frame: AreaFrame, toScreen: (p: Point) => Point, begin: Begin) {
  const { p0, p1 } = linearToDoc(area.geometry, frame);
  const a = toScreen(p0);
  const b = toScreen(p1);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  // The lines of full and no effect run across the gradient, far past the image.
  const nx = (-dy / len) * 4000;
  const ny = (dx / len) * 4000;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return (
    <>
      <line className={styles.edge} x1={a.x - nx} y1={a.y - ny} x2={a.x + nx} y2={a.y + ny} />
      <line className={styles.edgeFaint} x1={b.x - nx} y1={b.y - ny} x2={b.x + nx} y2={b.y + ny} />
      <line className={styles.axis} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      <circle className={styles.handle} cx={a.x} cy={a.y} r={7} data-handle="start" onPointerDown={begin('start')} />
      <circle className={styles.handle} cx={b.x} cy={b.y} r={7} data-handle="end" onPointerDown={begin('end')} />
      <circle className={styles.move} cx={mid.x} cy={mid.y} r={8} data-handle="move" onPointerDown={begin('move')} />
    </>
  );
}

function radialShape(area: Extract<Area, { kind: 'radial' }>, frame: AreaFrame, k: number, toScreen: (p: Point) => Point, begin: Begin) {
  const e = radialToDoc(area.geometry, frame);
  const c = toScreen({ x: e.cx, y: e.cy });
  const { u, v } = ellipseAxes(e);
  const rx = e.rx * k;
  const ry = e.ry * k;
  const inner = 1 - area.geometry.feather / 100;
  const at = (axis: Point, r: number): Point => ({ x: c.x + axis.x * r, y: c.y + axis.y * r });
  const hx = at(u, rx);
  const hy = at(v, ry);
  const hr = at(u, rx + ROTATE_OFFSET);
  const hf = at(v, -ry * inner);
  return (
    <>
      <ellipse className={styles.edge} cx={c.x} cy={c.y} rx={rx} ry={ry} transform={`rotate(${e.angle} ${c.x} ${c.y})`} />
      <ellipse className={styles.edgeFaint} cx={c.x} cy={c.y} rx={rx * inner} ry={ry * inner} transform={`rotate(${e.angle} ${c.x} ${c.y})`} />
      <line className={styles.axis} x1={hx.x} y1={hx.y} x2={hr.x} y2={hr.y} />
      <circle className={styles.move} cx={c.x} cy={c.y} r={8} data-handle="move" onPointerDown={begin('move')} />
      <circle className={styles.handle} cx={hx.x} cy={hx.y} r={7} data-handle="radiusX" onPointerDown={begin('radiusX')} />
      <circle className={styles.handle} cx={hy.x} cy={hy.y} r={7} data-handle="radiusY" onPointerDown={begin('radiusY')} />
      <circle className={styles.rotate} cx={hr.x} cy={hr.y} r={6} data-handle="rotate" onPointerDown={begin('rotate')} />
      <circle className={styles.feather} cx={hf.x} cy={hf.y} r={6} data-handle="feather" onPointerDown={begin('feather')} />
    </>
  );
}
