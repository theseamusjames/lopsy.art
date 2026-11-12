import type { Color } from '../types/color';

/** Colour space of a 2D canvas context; matches `CanvasColorSpace` in engine/color-space. */
export type CanvasContextColorSpace = 'srgb' | 'display-p3';

/**
 * A CSS colour string that writes `color`'s channel values unchanged into a
 * 2D context of `space`. Document colours are raw channel values in the
 * session's canvas colour space, the same numbers the GPU brush writes. CSS
 * `rgba()` is always sRGB, so on a display-p3 context the browser would
 * convert it and shift every colour (pure red would land as P3
 * (234, 51, 35)). `color(display-p3 …)` names the P3 values directly.
 */
export function canvasColorString(color: Color, space: CanvasContextColorSpace): string {
  if (space === 'display-p3') {
    return `color(display-p3 ${color.r / 255} ${color.g / 255} ${color.b / 255} / ${color.a})`;
  }
  return `rgba(${color.r},${color.g},${color.b},${color.a})`;
}
