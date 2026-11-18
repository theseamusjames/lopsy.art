import { useRef, type PointerEvent, type ReactNode } from 'react';
import type { Area, LinearGeometry, RadialGeometry } from '@lopsy/photos-core/library/recipe';
import type { Json } from '@lopsy/photos-core/library/types';
import {
  ellipseFromDocument,
  ellipseToDocument,
  lineFromDocument,
  lineToDocument,
  type AreaFrame,
  type DocumentEllipse,
  type Point,
} from '../../engine/areas';
import styles from './AreasOverlay.module.css';

export interface AreasOverlayProps {
  /** Where the document is on the stage, in CSS pixels. */
  readonly imageBox: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
  /** The document's size in engine pixels. */
  readonly documentSize: { readonly width: number; readonly height: number };
  readonly frame: AreaFrame;
  readonly area: Area;
  /** The geometry while a handle drags. */
  readonly onDraft: (changes: Readonly<Record<string, Json>>) => void;
  /** Once, when the drag ends: one history step. */
  readonly onCommit: (changes: Readonly<Record<string, Json>>, label: string) => void;
}

type Handle = 'move' | 'a' | 'b' | 'rx' | 'ry' | 'rotate' | 'feather';

interface Drag {
  readonly pointerId: number;
  readonly handle: Handle;
  readonly start: Point;
  readonly line: { a: Point; b: Point } | null;
  readonly ellipse: DocumentEllipse | null;
  geometry: LinearGeometry | RadialGeometry | null;
}

const LABELS: Readonly<Record<Handle, string>> = {
  move: 'Area: move',
  a: 'Area: move the start',
  b: 'Area: move the end',
  rx: 'Area: resize',
  ry: 'Area: resize',
  rotate: 'Area: rotate',
  feather: 'Area: feather',
};

/** Distance from `p` along the unit direction of `angle`. */
function along(p: Point, c: Point, angle: number): number {
  return (p.x - c.x) * Math.cos(angle) + (p.y - c.y) * Math.sin(angle);
}

/**
 * The selected area's handles over the image. Linear: the full-effect and
 * no-effect lines, dragged together or by either end. Radial: the ellipse,
 * moved from inside, with handles for each radius, the rotation and the
 * feather (the inner ring).
 */
export function AreasOverlay({ imageBox, documentSize, frame, area, onDraft, onCommit }: AreasOverlayProps) {
  const drag = useRef<Drag | null>(null);
  const sx = imageBox.width / documentSize.width;
  const sy = imageBox.height / documentSize.height;
  const toCss = (p: Point): Point => ({ x: p.x * sx, y: p.y * sy });
  const toDoc = (clientX: number, clientY: number, target: Element): Point => {
    const box = (target.closest('svg') ?? target).getBoundingClientRect();
    return { x: (clientX - box.left) / sx, y: (clientY - box.top) / sy };
  };
  const path = `areas.${area.id}.geometry`;

  const handleDown = (handle: Handle) => (e: PointerEvent<SVGElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      pointerId: e.pointerId,
      handle,
      start: toDoc(e.clientX, e.clientY, e.currentTarget),
      line: area.kind === 'linear' ? lineToDocument(area.geometry, frame) : null,
      ellipse: area.kind === 'radial' ? ellipseToDocument(area.geometry, frame) : null,
      geometry: null,
    };
  };

  const handleMove = (e: PointerEvent<SVGElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const p = toDoc(e.clientX, e.clientY, e.currentTarget);
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    if (d.line) {
      const a = d.handle === 'b' ? d.line.a : { x: d.line.a.x + dx, y: d.line.a.y + dy };
      const b = d.handle === 'a' ? d.line.b : { x: d.line.b.x + dx, y: d.line.b.y + dy };
      d.geometry = lineFromDocument(a, b, frame);
    } else if (d.ellipse && area.kind === 'radial') {
      const e0 = d.ellipse;
      const c = { x: e0.cx, y: e0.cy };
      let next: DocumentEllipse = e0;
      let feather = area.geometry.feather;
      if (d.handle === 'move') next = { ...e0, cx: e0.cx + dx, cy: e0.cy + dy };
      if (d.handle === 'rx') next = { ...e0, rx: Math.max(2, along(p, c, e0.rotation)) };
      if (d.handle === 'ry') next = { ...e0, ry: Math.max(2, along(p, c, e0.rotation + Math.PI / 2)) };
      if (d.handle === 'rotate') next = { ...e0, rotation: Math.atan2(p.y - c.y, p.x - c.x) };
      if (d.handle === 'feather') {
        const inner = Math.max(0, Math.min(1, along(p, c, e0.rotation) / e0.rx));
        feather = Math.round((1 - inner) * 100);
      }
      d.geometry = ellipseFromDocument(next, feather, frame);
    }
    if (d.geometry) onDraft({ [path]: d.geometry as unknown as Json });
  };

  const handleUp = (e: PointerEvent<SVGElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (d.geometry) onCommit({ [path]: d.geometry as unknown as Json }, LABELS[d.handle]);
  };

  const events = { onPointerMove: handleMove, onPointerUp: handleUp, onPointerCancel: handleUp };
  const knob = (handle: Handle, p: Point, label: string) => (
    <circle
      key={handle}
      className={handle === 'rotate' ? styles.rotateKnob : styles.knob}
      cx={p.x}
      cy={p.y}
      r={6}
      aria-label={label}
      role="slider"
      onPointerDown={handleDown(handle)}
      {...events}
    />
  );

  let content: ReactNode;
  if (area.kind === 'linear') {
    const { a, b } = lineToDocument(area.geometry, frame);
    const ca = toCss(a);
    const cb = toCss(b);
    const len = Math.hypot(cb.x - ca.x, cb.y - ca.y) || 1;
    // The lines run across the image, perpendicular to a → b.
    const nx = (-(cb.y - ca.y) / len) * Math.max(imageBox.width, imageBox.height) * 2;
    const ny = ((cb.x - ca.x) / len) * Math.max(imageBox.width, imageBox.height) * 2;
    content = (
      <>
        <line className={styles.full} x1={ca.x - nx} y1={ca.y - ny} x2={ca.x + nx} y2={ca.y + ny} />
        <line className={styles.none} x1={cb.x - nx} y1={cb.y - ny} x2={cb.x + nx} y2={cb.y + ny} />
        <line className={styles.spine} x1={ca.x} y1={ca.y} x2={cb.x} y2={cb.y} />
        <line
          className={styles.hit}
          x1={ca.x}
          y1={ca.y}
          x2={cb.x}
          y2={cb.y}
          aria-label="Move the area"
          role="slider"
          onPointerDown={handleDown('move')}
          {...events}
        />
        {knob('a', ca, 'Full effect')}
        {knob('b', cb, 'No effect')}
      </>
    );
  } else {
    const e = ellipseToDocument(area.geometry, frame);
    const c = toCss({ x: e.cx, y: e.cy });
    const deg = (e.rotation * 180) / Math.PI;
    const inner = 1 - area.geometry.feather / 100;
    const point = (r: number, angle: number) => toCss({ x: e.cx + Math.cos(angle) * r, y: e.cy + Math.sin(angle) * r });
    content = (
      <>
        <ellipse
          className={styles.hitFill}
          cx={c.x}
          cy={c.y}
          rx={e.rx * sx}
          ry={e.ry * sy}
          transform={`rotate(${deg} ${c.x} ${c.y})`}
          aria-label="Move the area"
          role="slider"
          onPointerDown={handleDown('move')}
          {...events}
        />
        <ellipse className={styles.full} cx={c.x} cy={c.y} rx={e.rx * sx} ry={e.ry * sy} transform={`rotate(${deg} ${c.x} ${c.y})`} />
        <ellipse
          className={styles.none}
          cx={c.x}
          cy={c.y}
          rx={e.rx * sx * inner}
          ry={e.ry * sy * inner}
          transform={`rotate(${deg} ${c.x} ${c.y})`}
        />
        {knob('rx', point(e.rx, e.rotation), 'Width')}
        {knob('ry', point(e.ry, e.rotation + Math.PI / 2), 'Height')}
        {knob('feather', point(e.rx * inner, e.rotation), 'Feather')}
        {knob('rotate', point(e.rx + 24 / sx, e.rotation), 'Rotate')}
      </>
    );
  }

  return (
    <svg
      className={styles.overlay}
      data-testid="areas-overlay"
      style={
        {
          '--box-left': `${imageBox.left}px`,
          '--box-top': `${imageBox.top}px`,
          '--box-width': `${imageBox.width}px`,
          '--box-height': `${imageBox.height}px`,
        } as React.CSSProperties
      }
    >
      {content}
    </svg>
  );
}
