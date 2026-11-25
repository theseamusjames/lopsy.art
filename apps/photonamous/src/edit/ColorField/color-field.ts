/**
 * The hue and saturation field (pure): hue runs left to right, 0° to
 * 360°, and saturation top to bottom, 100 at the top edge down to 0
 * (white) at the bottom. Both are kept to a tenth, finer than the whole
 * steps of their sliders, so every pixel of the field is a colour of its
 * own, the enlarged field's 500 across included.
 */

export interface FieldColor {
  /** Degrees, 0..360. */
  readonly hue: number;
  /** 0..100. */
  readonly saturation: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** To a tenth, with no float dust left over. */
const tenth = (value: number) => Math.round(value * 10) / 10;

/** The smallest step of either value. */
export const FINE_STEP = 0.1;

/** The colour at a point of a field `width` by `height`; a point outside it reads as the nearest edge, so a drag can overshoot. */
export function pointToColor(x: number, y: number, width: number, height: number): FieldColor {
  if (width <= 0 || height <= 0) return { hue: 0, saturation: 0 };
  return {
    hue: clamp(tenth((x / width) * 360), 0, 360),
    saturation: clamp(tenth((1 - y / height) * 100), 0, 100),
  };
}

/** Where the colour is in the field, as fractions of its width and height. */
export function colorToPoint(color: FieldColor): { readonly x: number; readonly y: number } {
  return { x: clamp(color.hue / 360, 0, 1), y: clamp(1 - color.saturation / 100, 0, 1) };
}

/** The colour an arrow key moves to: left and right change the hue, up and down the saturation. Null for other keys. */
export function stepColor(color: FieldColor, key: string, step: number): FieldColor | null {
  switch (key) {
    case 'ArrowLeft':
      return { ...color, hue: clamp(tenth(color.hue - step), 0, 360) };
    case 'ArrowRight':
      return { ...color, hue: clamp(tenth(color.hue + step), 0, 360) };
    case 'ArrowUp':
      return { ...color, saturation: clamp(tenth(color.saturation + step), 0, 100) };
    case 'ArrowDown':
      return { ...color, saturation: clamp(tenth(color.saturation - step), 0, 100) };
    default:
      return null;
  }
}

/** A value as the field says it: '216.7', and '216' when it is whole. */
export function fieldNumber(value: number): string {
  const rounded = tenth(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** The colour the field shows at that point, for the marker: the hue at full strength, mixed towards white as saturation falls. */
export function fieldCss(color: FieldColor): string {
  return `hsl(${color.hue} 100% ${100 - color.saturation / 2}%)`;
}

/** The side of the enlarged field, when the window has the room. */
export const EXPANDED_SIZE = 500;
/** Kept clear at the window's edge. */
const MARGIN = 8;

export interface FieldBox {
  readonly left: number;
  readonly top: number;
  readonly size: number;
}

/**
 * Where the enlarged field goes, in the window: its top right corner on
 * the small field's, so it grows out to the left and down, moved only as
 * far as it takes to stay in the window.
 */
export function expandedBox(slot: { readonly top: number; readonly right: number }, viewport: { readonly width: number; readonly height: number }): FieldBox {
  const size = Math.max(0, Math.min(EXPANDED_SIZE, viewport.width - 2 * MARGIN, viewport.height - 2 * MARGIN));
  return {
    left: clamp(slot.right - size, MARGIN, Math.max(MARGIN, viewport.width - MARGIN - size)),
    top: clamp(slot.top, MARGIN, Math.max(MARGIN, viewport.height - MARGIN - size)),
    size,
  };
}
