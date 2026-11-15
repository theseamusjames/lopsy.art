import type { Color } from '../../types';
import { rgbToHex6, hexToRgb } from '../../utils/color';

export function colorToHex(c: Color): string {
  return rgbToHex6(c);
}

export function hexToColor(hex: string, alpha: number): Color {
  const parsed = hexToRgb(hex);
  if (!parsed) return { r: 0, g: 0, b: 0, a: alpha };
  return { ...parsed, a: alpha };
}
