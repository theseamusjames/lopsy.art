/**
 * Color Grading compiled for the engine, ported from lopsy-web's
 * filters/color-grading.ts so a grade looks the same in both apps: four
 * wheels (shadows, midtones, highlights, global) of hue 0..360,
 * saturation 0..100 and luminance −150..150, plus Blending 0..100 and
 * Balance −150..150 (Lopsy runs ±100), packed into the 18 floats `setImageColorGrading`
 * takes.
 */

export interface GradeWheel {
  readonly hue: number;
  readonly saturation: number;
  readonly luminance: number;
}

export interface ColorGrade {
  readonly shadows: GradeWheel;
  readonly midtones: GradeWheel;
  readonly highlights: GradeWheel;
  readonly global: GradeWheel;
  readonly blending: number;
  readonly balance: number;
}

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

function isNeutralWheel(wheel: GradeWheel): boolean {
  return wheel.saturation === 0 && wheel.luminance === 0;
}

/** Blending and Balance only shape how wheels apply, so neutral wheels change nothing. */
export function isIdentityColorGrade(grade: ColorGrade): boolean {
  return isNeutralWheel(grade.shadows) && isNeutralWheel(grade.midtones) && isNeutralWheel(grade.highlights) && isNeutralWheel(grade.global);
}

/** Fully saturated, full-value colour of a hue, 0..1 per channel. */
export function hueToRgb(hue: number): [number, number, number] {
  const h = ((((hue % 360) + 360) % 360) / 60);
  const x = 1 - Math.abs((h % 2) - 1);
  if (h < 1) return [1, x, 0];
  if (h < 2) return [x, 1, 0];
  if (h < 3) return [0, 1, x];
  if (h < 4) return [0, x, 1];
  if (h < 5) return [x, 0, 1];
  return [1, 0, x];
}

/**
 * A wheel as [tint_r, tint_g, tint_b, luminance] offsets. The tint has its
 * luma removed so a wheel changes colour without changing brightness (the
 * Luminance slider's job), then is normalized so every hue reaches as far.
 * Lopsy rounds the hue's colour to 8 bits first; so does this, to match.
 */
export function compileGradeWheel(wheel: GradeWheel): [number, number, number, number] {
  const [r, g, b] = hueToRgb(wheel.hue).map((v) => Math.round(v * 255) / 255) as [number, number, number];
  const luma = r * LUMA_R + g * LUMA_G + b * LUMA_B;
  const tr = r - luma;
  const tg = g - luma;
  const tb = b - luma;
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

/** The block `setImageColorGrading` expects. */
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
