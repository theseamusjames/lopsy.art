import type { Color, HSLColor } from '../types/index';

// ============================================================
// Color Constants
// ============================================================

export const BLACK: Color = { r: 0, g: 0, b: 0, a: 1 };
export const WHITE: Color = { r: 255, g: 255, b: 255, a: 1 };
export const TRANSPARENT: Color = { r: 0, g: 0, b: 0, a: 0 };

// ============================================================
// Color Conversions
// ============================================================

export function rgbToHsl(color: Color): HSLColor {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

    if (max === r) {
      h = ((g - b) / delta + (g < b ? 6 : 0)) * 60;
    } else if (max === g) {
      h = ((b - r) / delta + 2) * 60;
    } else {
      h = ((r - g) / delta + 4) * 60;
    }
  }

  return {
    h: Math.round(h * 10) / 10,
    s: Math.round(s * 1000) / 10,
    l: Math.round(l * 1000) / 10,
    a: color.a,
  };
}

function hueToRgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

export function hslToRgb(hsl: HSLColor): Color {
  const h = hsl.h / 360;
  const s = hsl.s / 100;
  const l = hsl.l / 100;

  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v, a: hsl.a };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return {
    r: Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hueToRgb(p, q, h) * 255),
    b: Math.round(hueToRgb(p, q, h - 1 / 3) * 255),
    a: hsl.a,
  };
}

export function rgbToHex(color: Color): string {
  const r = color.r.toString(16).padStart(2, '0');
  const g = color.g.toString(16).padStart(2, '0');
  const b = color.b.toString(16).padStart(2, '0');

  if (color.a < 1) {
    const a = Math.round(color.a * 255)
      .toString(16)
      .padStart(2, '0');
    return `#${r}${g}${b}${a}`;
  }

  return `#${r}${g}${b}`;
}

/** Always returns #RRGGBB (no alpha), suitable for <input type="color">. */
export function rgbToHex6(color: Color): string {
  const r = color.r.toString(16).padStart(2, '0');
  const g = color.g.toString(16).padStart(2, '0');
  const b = color.b.toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

export function hexToRgb(hex: string): Color | null {
  const cleaned = hex.startsWith('#') ? hex.slice(1) : hex;

  let r: number;
  let g: number;
  let b: number;
  let a = 1;

  if (cleaned.length === 3) {
    r = parseInt((cleaned[0] ?? '') + (cleaned[0] ?? ''), 16);
    g = parseInt((cleaned[1] ?? '') + (cleaned[1] ?? ''), 16);
    b = parseInt((cleaned[2] ?? '') + (cleaned[2] ?? ''), 16);
  } else if (cleaned.length === 6) {
    r = parseInt(cleaned.slice(0, 2), 16);
    g = parseInt(cleaned.slice(2, 4), 16);
    b = parseInt(cleaned.slice(4, 6), 16);
  } else if (cleaned.length === 8) {
    r = parseInt(cleaned.slice(0, 2), 16);
    g = parseInt(cleaned.slice(2, 4), 16);
    b = parseInt(cleaned.slice(4, 6), 16);
    a = parseInt(cleaned.slice(6, 8), 16) / 255;
  } else {
    return null;
  }

  if (isNaN(r) || isNaN(g) || isNaN(b) || isNaN(a)) {
    return null;
  }

  return { r, g, b, a };
}

// ============================================================
// HSV Conversions
// ============================================================

export interface HSVColor {
  readonly h: number; // 0-360
  readonly s: number; // 0-100
  readonly v: number; // 0-100
}

export function rgbToHsv(color: Color): HSVColor {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) {
      h = ((g - b) / delta + (g < b ? 6 : 0)) * 60;
    } else if (max === g) {
      h = ((b - r) / delta + 2) * 60;
    } else {
      h = ((r - g) / delta + 4) * 60;
    }
  }

  const s = max === 0 ? 0 : (delta / max) * 100;
  const v = max * 100;

  return { h: Math.round(h * 10) / 10, s: Math.round(s * 10) / 10, v: Math.round(v * 10) / 10 };
}

export function hsvToRgb(hsv: HSVColor): Color {
  const h = hsv.h / 60;
  const s = hsv.s / 100;
  const v = hsv.v / 100;

  const c = v * s;
  const x = c * (1 - Math.abs(h % 2 - 1));
  const m = v - c;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 1) { r = c; g = x; b = 0; }
  else if (h < 2) { r = x; g = c; b = 0; }
  else if (h < 3) { r = 0; g = c; b = x; }
  else if (h < 4) { r = 0; g = x; b = c; }
  else if (h < 5) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
    a: 1,
  };
}

// ============================================================
// Color Utilities
// ============================================================

export function colorToCSS(color: Color): string {
  return `rgba(${color.r},${color.g},${color.b},${color.a})`;
}

export function lerpColor(a: Color, b: Color, t: number): Color {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    r: Math.round(a.r + (b.r - a.r) * clamped),
    g: Math.round(a.g + (b.g - a.g) * clamped),
    b: Math.round(a.b + (b.b - a.b) * clamped),
    a: a.a + (b.a - a.a) * clamped,
  };
}

export function colorEquals(a: Color, b: Color): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}
