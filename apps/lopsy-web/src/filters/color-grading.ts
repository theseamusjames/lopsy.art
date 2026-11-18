import type { ColorGradeWheel, ColorGradingNode } from '../types/adjustment-nodes';
import type { GradientStop } from '../tools/gradient/gradient';
import { hsvToRgb, rgbToHsv } from '../utils/color';

export type ColorGrade = Pick<
  ColorGradingNode,
  'shadows' | 'midtones' | 'highlights' | 'global' | 'blending' | 'balance' | 'toneStops'
>;

/** A new node's tone stops: the bar's own black and white, so no tint. */
export const DEFAULT_TONE_STOPS: readonly GradientStop[] = [
  { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
  { position: 1, color: { r: 255, g: 255, b: 255, a: 1 } },
];

const NEUTRAL_WHEEL: ColorGradeWheel = { hue: 0, saturation: 0, luminance: 0 };

export const DEFAULT_GRADE_BLENDING = 50;

export const IDENTITY_COLOR_GRADE: ColorGrade = {
  shadows: NEUTRAL_WHEEL,
  midtones: NEUTRAL_WHEEL,
  highlights: NEUTRAL_WHEEL,
  global: NEUTRAL_WHEEL,
  blending: DEFAULT_GRADE_BLENDING,
  balance: 0,
};

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/** Largest per-channel shift a wheel makes, at 100 saturation. */
const MAX_TINT = 0.4;
/** Largest brightness shift a wheel makes, at ±100 luminance. */
const MAX_LUMINANCE = 0.5;

/** Hard edge at Blending 0 (not zero, smoothstep needs a span), full overlap at 100. */
const MIN_MASK_WIDTH = 0.02;
const MAX_MASK_WIDTH = 1 / 3;

function isNeutralWheel(wheel: ColorGradeWheel): boolean {
  return wheel.saturation === 0 && wheel.luminance === 0;
}

/** Blending and Balance only shape how wheels apply, so neutral wheels change nothing. */
export function isIdentityColorGrade(grade: ColorGrade): boolean {
  if (grade.toneStops) return grade.toneStops.every((s) => isNeutralColor(s.color));
  return isNeutralWheel(grade.shadows)
    && isNeutralWheel(grade.midtones)
    && isNeutralWheel(grade.highlights)
    && isNeutralWheel(grade.global);
}

/**
 * A wheel as [tint_r, tint_g, tint_b, luminance] offsets. The tint has its
 * luma removed so that moving a wheel changes colour without changing
 * brightness, which is the Luminance slider's job. It is then normalized,
 * since a full-strength blue and a full-strength orange otherwise differ in
 * reach by half.
 */
export function compileGradeWheel(wheel: ColorGradeWheel): [number, number, number, number] {
  const { r, g, b } = hsvToRgb({ h: wheel.hue % 360, s: 100, v: 100 });
  const luma = (r * LUMA_R + g * LUMA_G + b * LUMA_B) / 255;
  const tr = r / 255 - luma;
  const tg = g / 255 - luma;
  const tb = b / 255 - luma;
  const scale = (MAX_TINT * wheel.saturation) / 100 / Math.max(Math.abs(tr), Math.abs(tg), Math.abs(tb));
  return [tr * scale, tg * scale, tb * scale, (MAX_LUMINANCE * wheel.luminance) / 100];
}

/** Balance as the exponent that bends luma before the tone masks; positive widens highlights. */
export function balanceToExponent(balance: number): number {
  return Math.pow(2, -balance / 50);
}

/** Blending as the half-width of the crossovers between tone masks. */
export function blendingToMaskWidth(blending: number): number {
  return MIN_MASK_WIDTH + (MAX_MASK_WIDTH - MIN_MASK_WIDTH) * (blending / 100);
}

function isNeutralColor(c: { r: number; g: number; b: number }): boolean {
  return c.r === c.g && c.g === c.b;
}

/** A tone stop's tint offsets: its colour's hue and saturation, as a wheel would give them. */
export function toneStopTint(stop: GradientStop): [number, number, number] {
  if (isNeutralColor(stop.color)) return [0, 0, 0];
  const { h, s } = rgbToHsv(stop.color);
  const [r, g, b] = compileGradeWheel({ hue: h, saturation: s, luminance: 0 });
  return [r, g, b];
}

/** Tint range the LUT stores, matching `CG_LUT_RANGE` in adjustments.wgsl. */
const TONE_LUT_RANGE = 0.5;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** How far from stop `a` to stop `b` the tint has gone at `f` (0..1) of the way. */
function handOver(f: number, blending: number): number {
  const width = blending / 100;
  if (width <= 0) return f < 0.5 ? 0 : 1;
  return smoothstep(0.5 - width / 2, 0.5 + width / 2, f);
}

/** The tint at `tone` (0..1) from sorted stops. */
export function toneStopsTintAt(
  sorted: readonly GradientStop[],
  tints: readonly (readonly [number, number, number])[],
  tone: number,
  blending: number,
): [number, number, number] {
  const last = sorted.length - 1;
  if (last < 0) return [0, 0, 0];
  if (tone <= sorted[0]!.position) return [...tints[0]!];
  if (tone >= sorted[last]!.position) return [...tints[last]!];
  let i = 0;
  while (i < last - 1 && tone > sorted[i + 1]!.position) i++;
  const a = sorted[i]!.position;
  const b = sorted[i + 1]!.position;
  const f = b > a ? handOver((tone - a) / (b - a), blending) : 1;
  const ta = tints[i]!;
  const tb = tints[i + 1]!;
  const mix = (x: number, y: number) => x * (1 - f) + y * f;
  return [mix(ta[0], tb[0]), mix(ta[1], tb[1]), mix(ta[2], tb[2])];
}

/**
 * The 256x1 RGBA LUT `setGroupColorGradingLut` expects: entry i is the tint
 * at tone i / 255, each channel stored as 128 + 127 * tint / 0.5.
 */
export function compileToneStopsLut(stops: readonly GradientStop[], blending: number): Uint8Array {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const tints = sorted.map(toneStopTint);
  const lut = new Uint8Array(256 * 4);
  const encode = (v: number) => Math.max(0, Math.min(255, Math.round(128 + (127 * v) / TONE_LUT_RANGE)));
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = toneStopsTintAt(sorted, tints, i / 255, blending);
    lut[i * 4] = encode(r);
    lut[i * 4 + 1] = encode(g);
    lut[i * 4 + 2] = encode(b);
    lut[i * 4 + 3] = 255;
  }
  return lut;
}

/** The block `setGroupColorGrading` expects. */
export function compileColorGrade(grade: ColorGrade): Float32Array {
  // Tone stops take the grade from their LUT; the wheels stay neutral and
  // the tone is the pixel's own luma.
  if (grade.toneStops) {
    return compileColorGrade({ ...IDENTITY_COLOR_GRADE, blending: grade.blending });
  }
  return Float32Array.from([
    ...compileGradeWheel(grade.shadows),
    ...compileGradeWheel(grade.midtones),
    ...compileGradeWheel(grade.highlights),
    ...compileGradeWheel(grade.global),
    balanceToExponent(grade.balance),
    blendingToMaskWidth(grade.blending),
  ]);
}
