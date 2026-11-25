/**
 * Where the crop's options bar sits once someone has moved it by its grip.
 * Until then it places itself (isBarOnTop in crop-keys.ts). A place is kept
 * as fractions of the room the stage leaves around the bar, so a bar put in
 * a corner stays in that corner in a window of another size, and stays
 * inside it. Dragging the grip moves the bar; so do the arrow keys (WCAG
 * 2.1.1), and a click sends it to the other end of the stage (2.5.7).
 */

/** 0 puts the bar against the stage's left (x) or top (y) margin, 1 against the right or bottom one. */
export interface BarPlace {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** The space kept between the bar and the stage's edges, in CSS pixels. */
export const BAR_MARGIN = 8;
/** How far an arrow key moves the bar, and with Shift. */
export const BAR_STEP = 10;
export const BAR_LARGE_STEP = 50;
/** How far the pointer moves on the grip before it drags the bar; less is a click. */
export const BAR_DRAG_THRESHOLD = 3;
/** Where a moved bar is remembered, on this device. */
export const BAR_PLACE_KEY = 'photonamous.crop-options-place';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function room(stage: Size, bar: Size): Size {
  return { width: Math.max(0, stage.width - bar.width - 2 * BAR_MARGIN), height: Math.max(0, stage.height - bar.height - 2 * BAR_MARGIN) };
}

/** The bar's left and top in stage pixels. */
export function barOffset(place: BarPlace, stage: Size, bar: Size): { readonly left: number; readonly top: number } {
  const r = room(stage, bar);
  return { left: BAR_MARGIN + clamp01(place.x) * r.width, top: BAR_MARGIN + clamp01(place.y) * r.height };
}

/** The place that puts the bar's left and top at these stage pixels, or as near as the stage allows. */
export function placeAt(left: number, top: number, stage: Size, bar: Size): BarPlace {
  const r = room(stage, bar);
  return {
    x: r.width > 0 ? clamp01((left - BAR_MARGIN) / r.width) : 0.5,
    y: r.height > 0 ? clamp01((top - BAR_MARGIN) / r.height) : 0.5,
  };
}

/** Whether a pointer that went down on the grip has moved far enough to drag the bar. */
export function isBarDrag(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= BAR_DRAG_THRESHOLD;
}

function arrowDirection(key: string): readonly [number, number] | null {
  switch (key) {
    case 'ArrowLeft':
      return [-1, 0];
    case 'ArrowRight':
      return [1, 0];
    case 'ArrowUp':
      return [0, -1];
    case 'ArrowDown':
      return [0, 1];
    default:
      return null;
  }
}

/** Where an arrow key moves the bar: BAR_STEP pixels, BAR_LARGE_STEP with Shift. Null for any other key. */
export function placeAfterKey(place: BarPlace, key: string, isLarge: boolean, stage: Size, bar: Size): BarPlace | null {
  const direction = arrowDirection(key);
  if (!direction) return null;
  const step = isLarge ? BAR_LARGE_STEP : BAR_STEP;
  const at = barOffset(place, stage, bar);
  return placeAt(at.left + direction[0] * step, at.top + direction[1] * step, stage, bar);
}

/** Whether the bar is in the upper half of its room, so that a click on the grip sends it to the bottom. */
export function isBarHigh(place: BarPlace): boolean {
  return place.y < 0.5;
}

/** Where a click on the grip, or Enter, sends the bar: to the other end of the stage, on the same side. */
export function otherEnd(place: BarPlace): BarPlace {
  return { x: place.x, y: isBarHigh(place) ? 1 : 0 };
}

/** A place as stored: JSON with numbers x and y. Anything else is no place. */
export function parseBarPlace(raw: string | null): BarPlace | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { x, y } = value as { x?: unknown; y?: unknown };
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: clamp01(x), y: clamp01(y) };
  } catch {
    return null;
  }
}

export function loadBarPlace(): BarPlace | null {
  try {
    return parseBarPlace(localStorage.getItem(BAR_PLACE_KEY));
  } catch {
    return null;
  }
}

export function saveBarPlace(place: BarPlace): void {
  try {
    localStorage.setItem(BAR_PLACE_KEY, JSON.stringify({ x: place.x, y: place.y }));
  } catch {
    // Blocked storage: the place lasts until the crop closes.
  }
}
