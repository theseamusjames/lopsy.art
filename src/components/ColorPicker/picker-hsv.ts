import { rgbToHsv, hsvToRgb } from '../../utils/color';
import type { HSVColor } from '../../utils/color';
import type { Color } from '../../types';

/**
 * Reconcile the picker's HSV with the RGB colour it is showing.
 *
 * Many HSV values map to the same RGB (any hue at s = 0, any hue and
 * saturation at v = 0), so the picker keeps its own HSV to stop the hue
 * cursor snapping to red when the user drags through grey or black. That
 * HSV is kept while it still produces `color`; otherwise it is rebuilt from
 * `color`, holding on to the hue for neutral colours.
 *
 * Returns `prev` itself when nothing changes, so callers can compare by
 * identity.
 */
export function syncHsvToColor(prev: HSVColor, color: Color): HSVColor {
  const current = hsvToRgb(prev);
  if (current.r === color.r && current.g === color.g && current.b === color.b) {
    return prev;
  }
  const next = rgbToHsv(color);
  if (color.r === color.g && color.g === color.b) {
    return { h: prev.h, s: 0, v: next.v };
  }
  return next;
}
