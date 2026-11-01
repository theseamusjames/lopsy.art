import type { ColorGradeWheel, ColorGradingNode } from '../types/adjustment-nodes';
import { hsvToRgb } from '../utils/color';

export type ColorGrade = Pick<
  ColorGradingNode,
  'shadows' | 'midtones' | 'highlights' | 'global' | 'blending' | 'balance'
>;

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

/** The block `setGroupColorGrading` expects. */
export function compileColorGrade(grade: ColorGrade): Float32Array {
  return Float32Array.from([
    ...compileGradeWheel(grade.shadows),
    ...compileGradeWheel(grade.midtones),
    ...compileGradeWheel(grade.highlights),
    ...compileGradeWheel(grade.global),
    balanceToExponent(grade.balance),
    blendingToMaskWidth(grade.blending),
  ]);
}
