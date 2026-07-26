/**
 * TypeScript mirrors of the engine's color-space math
 * (`lopsy-core/src/lab.rs` and `cmyk.rs`).
 *
 * These exist so the color picker can show L/a/b and C/M/Y/K values for a
 * single color without a WASM round trip. All batch pixel work stays in Rust —
 * duplicating it here would invite the two implementations to drift.
 */

import type { Color } from '../types/color';

const D50_WHITE: readonly [number, number, number] = [0.9642, 1.0, 0.8249];
const LAB_DELTA = 6 / 29;

// Column-consistent with lab.rs: row-major 3x3 applied to a column vector.
const SRGB_TO_XYZ_D65 = [
  0.4124564, 0.3575761, 0.1804375,
  0.2126729, 0.7151522, 0.0721750,
  0.0193339, 0.1191920, 0.9503041,
] as const;

const XYZ_D65_TO_SRGB = [
  3.2404542, -1.5371385, -0.4985314,
  -0.9692660, 1.8760108, 0.0415560,
  0.0556434, -0.2040259, 1.0572252,
] as const;

const BRADFORD_D65_TO_D50 = [
  1.0478112, 0.0228866, -0.0501270,
  0.0295424, 0.9904844, -0.0170491,
  -0.0092345, 0.0150436, 0.7521316,
] as const;

const BRADFORD_D50_TO_D65 = [
  0.9555766, -0.0230393, 0.0631636,
  -0.0282895, 1.0099416, 0.0210077,
  0.0122982, -0.0204830, 1.3299098,
] as const;

function matVec3(m: readonly number[], v: readonly [number, number, number]): [number, number, number] {
  return [
    m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
    m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
    m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
  ];
}

function srgbToLinear(v: number): number {
  const n = v / 255;
  return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v: number): number {
  const c = Math.min(1, Math.max(0, v));
  const n = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(Math.min(255, Math.max(0, n * 255)));
}

function labF(t: number): number {
  return t > LAB_DELTA ** 3 ? Math.cbrt(t) : t / (3 * LAB_DELTA * LAB_DELTA) + 4 / 29;
}

function labFInv(t: number): number {
  return t > LAB_DELTA ? t ** 3 : 3 * LAB_DELTA * LAB_DELTA * (t - 4 / 29);
}

export interface LabColor {
  /** 0..100 */
  readonly l: number;
  /** roughly -128..127 */
  readonly a: number;
  /** roughly -128..127 */
  readonly b: number;
}

export function rgbToLab(color: Color): LabColor {
  const linear: [number, number, number] = [
    srgbToLinear(color.r),
    srgbToLinear(color.g),
    srgbToLinear(color.b),
  ];
  const xyz = matVec3(BRADFORD_D65_TO_D50, matVec3(SRGB_TO_XYZ_D65, linear));
  const fx = labF(xyz[0] / D50_WHITE[0]);
  const fy = labF(xyz[1] / D50_WHITE[1]);
  const fz = labF(xyz[2] / D50_WHITE[2]);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function labToRgb(lab: LabColor, alpha = 1): Color {
  const fy = (lab.l + 16) / 116;
  const xyzD50: [number, number, number] = [
    labFInv(fy + lab.a / 500) * D50_WHITE[0],
    labFInv(fy) * D50_WHITE[1],
    labFInv(fy - lab.b / 200) * D50_WHITE[2],
  ];
  const linear = matVec3(XYZ_D65_TO_SRGB, matVec3(BRADFORD_D50_TO_D65, xyzD50));
  return {
    r: linearToSrgb(linear[0]),
    g: linearToSrgb(linear[1]),
    b: linearToSrgb(linear[2]),
    a: alpha,
  };
}

/** Pack real Lab units into the 0..255 bytes the engine's textures hold. */
export function labToEncodedBytes(lab: LabColor): { r: number; g: number; b: number } {
  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  return { r: clamp(lab.l * 2.55), g: clamp(lab.a + 128), b: clamp(lab.b + 128) };
}

export interface CmykColor {
  /** Each channel 0..100 (%). */
  readonly c: number;
  readonly m: number;
  readonly y: number;
  readonly k: number;
}

export function rgbToCmyk(color: Color): CmykColor {
  const max = Math.max(color.r, color.g, color.b);
  if (max === 0) return { c: 0, m: 0, y: 0, k: 100 };
  const toPct = (v: number) => ((max - v) / max) * 100;
  return {
    c: toPct(color.r),
    m: toPct(color.g),
    y: toPct(color.b),
    k: ((255 - max) / 255) * 100,
  };
}

export function cmykToRgb(cmyk: CmykColor, alpha = 1): Color {
  const ink = (v: number) => Math.min(255, Math.max(0, Math.round((v / 100) * 255)));
  const k = ink(cmyk.k);
  const channel = (v: number) => Math.round(((255 - ink(v)) * (255 - k)) / 255);
  return { r: channel(cmyk.c), g: channel(cmyk.m), b: channel(cmyk.y), a: alpha };
}
