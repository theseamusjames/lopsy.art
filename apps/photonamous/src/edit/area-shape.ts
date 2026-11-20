/**
 * An area's shape as sliders (WCAG 2.1.1, 2.5.7): what dragging its
 * handles does, by keyboard or by typing a number. Values are on the photo
 * as it shows, cropped and turned: positions and sizes in percent of its
 * width and height, the turn in degrees, the feather in percent of the
 * radius. They go back to the recipe's source geometry through
 * engine/areas.ts, as the handles' drags do.
 */

import type { Area, LinearGeometry, RadialGeometry } from '@lopsy/photos-core/library/recipe';
import { linearFromDoc, linearToDoc, radialFromDoc, radialToDoc, type AreaFrame, type Point } from '../engine/areas';

export type AreaShapeKey = 'startX' | 'startY' | 'endX' | 'endY' | 'centerX' | 'centerY' | 'width' | 'height' | 'turn' | 'feather';

export type ShapeUnit = 'percent' | 'degrees';

export interface AreaShapeControl {
  readonly key: AreaShapeKey;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** What a double-click puts it back to: a new area's value on an uncropped photo. */
  readonly defaultValue: number;
  readonly unit: ShapeUnit;
  /** The history step a release makes, as a drag of the matching handle names it. */
  readonly historyLabel: string;
}

export interface DocSize {
  readonly width: number;
  readonly height: number;
}

const POSITION = { min: -100, max: 200, step: 1, unit: 'percent' } as const;
const SIZE = { min: 1, max: 400, step: 1, unit: 'percent' } as const;

/** A linear area: full effect at its start, none past its end. */
export const LINEAR_SHAPE: readonly AreaShapeControl[] = [
  { key: 'startX', label: 'Start X', ...POSITION, defaultValue: 50, historyLabel: 'Mask: resize' },
  { key: 'startY', label: 'Start Y', ...POSITION, defaultValue: 25, historyLabel: 'Mask: resize' },
  { key: 'endX', label: 'End X', ...POSITION, defaultValue: 50, historyLabel: 'Mask: resize' },
  { key: 'endY', label: 'End Y', ...POSITION, defaultValue: 75, historyLabel: 'Mask: resize' },
];

/** A radial area: an ellipse's centre, its width and height along its own axes, its turn and its feather. */
export const RADIAL_SHAPE: readonly AreaShapeControl[] = [
  { key: 'centerX', label: 'Center X', ...POSITION, defaultValue: 50, historyLabel: 'Mask: move' },
  { key: 'centerY', label: 'Center Y', ...POSITION, defaultValue: 50, historyLabel: 'Mask: move' },
  { key: 'width', label: 'Width', ...SIZE, defaultValue: 50, historyLabel: 'Mask: resize' },
  { key: 'height', label: 'Height', ...SIZE, defaultValue: 50, historyLabel: 'Mask: resize' },
  { key: 'turn', label: 'Turn', min: -180, max: 180, step: 1, unit: 'degrees', defaultValue: 0, historyLabel: 'Mask: turn' },
  { key: 'feather', label: 'Feather', min: 0, max: 100, step: 1, unit: 'percent', defaultValue: 50, historyLabel: 'Mask: feather' },
];

export function shapeControls(area: Area): readonly AreaShapeControl[] {
  return area.kind === 'linear' ? LINEAR_SHAPE : RADIAL_SHAPE;
}

function percentOf(value: number, whole: number): number {
  return whole > 0 ? (value / whole) * 100 : 0;
}

function fromPercent(percent: number, whole: number): number {
  return (percent / 100) * whole;
}

/** One of the area's shape values on the photo as it shows. */
export function shapeValue(area: Area, frame: AreaFrame, doc: DocSize, key: AreaShapeKey): number {
  if (area.kind === 'linear') {
    const { p0, p1 } = linearToDoc(area.geometry, frame);
    if (key === 'startX') return percentOf(p0.x, doc.width);
    if (key === 'startY') return percentOf(p0.y, doc.height);
    if (key === 'endX') return percentOf(p1.x, doc.width);
    if (key === 'endY') return percentOf(p1.y, doc.height);
    return 0;
  }
  const e = radialToDoc(area.geometry, frame);
  if (key === 'centerX') return percentOf(e.cx, doc.width);
  if (key === 'centerY') return percentOf(e.cy, doc.height);
  if (key === 'width') return percentOf(2 * e.rx, doc.width);
  if (key === 'height') return percentOf(2 * e.ry, doc.height);
  if (key === 'turn') return e.angle;
  if (key === 'feather') return area.geometry.feather;
  return 0;
}

/**
 * The area's geometry with one shape value set and the rest as they are.
 * A linear area whose ends would meet keeps its geometry: it would have no
 * direction, and the recipe drops such an area.
 */
export function withShapeValue(area: Area, frame: AreaFrame, doc: DocSize, key: AreaShapeKey, value: number): LinearGeometry | RadialGeometry {
  if (area.kind === 'linear') {
    const { p0, p1 } = linearToDoc(area.geometry, frame);
    const start: Point = {
      x: key === 'startX' ? fromPercent(value, doc.width) : p0.x,
      y: key === 'startY' ? fromPercent(value, doc.height) : p0.y,
    };
    const end: Point = {
      x: key === 'endX' ? fromPercent(value, doc.width) : p1.x,
      y: key === 'endY' ? fromPercent(value, doc.height) : p1.y,
    };
    if (Math.hypot(end.x - start.x, end.y - start.y) < 1) return area.geometry;
    return linearFromDoc(start, end, frame);
  }
  const e = radialToDoc(area.geometry, frame);
  const ellipse = {
    cx: key === 'centerX' ? fromPercent(value, doc.width) : e.cx,
    cy: key === 'centerY' ? fromPercent(value, doc.height) : e.cy,
    rx: key === 'width' ? fromPercent(value, doc.width) / 2 : e.rx,
    ry: key === 'height' ? fromPercent(value, doc.height) / 2 : e.ry,
    angle: key === 'turn' ? value : e.angle,
  };
  const feather = key === 'feather' ? Math.round(Math.min(100, Math.max(0, value))) : area.geometry.feather;
  return radialFromDoc(ellipse, feather, frame);
}

/** How a shape slider's readout shows its value: '50 %', '−15°'. */
export function formatShape(value: number, unit: ShapeUnit): string {
  const rounded = Math.round(value);
  const text = rounded < 0 ? `−${Math.abs(rounded)}` : String(rounded === 0 ? 0 : rounded);
  return unit === 'degrees' ? `${text}°` : `${text} %`;
}

/** What was typed in a shape slider's readout ('40', '40 %', '−15°'), or null when it is not a number. */
export function parseShape(text: string): number | null {
  const cleaned = text.trim().replace(/−/g, '-').replace(',', '.').replace(/\s*(%|°)$/, '');
  if (cleaned === '' || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  return Number(cleaned);
}
