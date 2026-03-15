import type { Color } from '../../types';

export function colorToHex(c: Color): string {
  const r = c.r.toString(16).padStart(2, '0');
  const g = c.g.toString(16).padStart(2, '0');
  const b = c.b.toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

export function hexToColor(hex: string, alpha: number): Color {
  const val = hex.replace('#', '');
  return {
    r: parseInt(val.slice(0, 2), 16),
    g: parseInt(val.slice(2, 4), 16),
    b: parseInt(val.slice(4, 6), 16),
    a: alpha,
  };
}
