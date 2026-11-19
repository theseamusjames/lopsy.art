/**
 * Maps a recipe onto the engine's per-document image adjustments, the
 * shader Lopsy's own Adjustments panel drives (adjustments.wgsl). Until the
 * develop pipeline of spec 6.10 exists in the engine, this is how Photos
 * renders an edit.
 *
 * The engine takes the recipe's numbers as they are: exposure in EV, and
 * contrast, highlights, shadows, whites, blacks, saturation, vibrance and
 * vignette on -100..100 (the engine divides by 100 itself). A positive
 * vignette darkens the corners, as Lopsy's Vignette does; a negative one
 * lightens them.
 *
 * White balance is an approximation. The engine has no white-balance stage
 * yet, so Temperature and Tint become a Photo Filter at full density with
 * luminosity preserved: a per-channel gain (warmer raises red and lowers
 * blue, more magenta lowers green) on the display-encoded image, rescaled
 * to keep each pixel's luminance. It is a relative shift, not kelvin, and
 * it runs after the tone controls rather than before them in linear light.
 */

import type { QuarterTurns, Recipe } from '@lopsy/photos-core/library/recipe';

export interface PhotoFilter {
  /** Per-channel gain, the largest of the three is 1. */
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** 0 turns the filter off. */
  readonly density: number;
}

export interface EngineAdjustments {
  readonly exposure: number;
  readonly contrast: number;
  readonly highlights: number;
  readonly shadows: number;
  readonly whites: number;
  readonly blacks: number;
  readonly saturation: number;
  readonly vibrance: number;
  readonly vignette: number;
  readonly photoFilter: PhotoFilter;
}

/** Stops of red/blue gain at Temperature ±100. */
export const TEMPERATURE_STOPS = 0.5;
/** Stops of green gain at Tint ±100. */
export const TINT_STOPS = 0.35;

export const NO_PHOTO_FILTER: PhotoFilter = { r: 1, g: 1, b: 1, density: 0 };

export function whiteBalanceFilter(temperature: number, tint: number): PhotoFilter {
  if (temperature === 0 && tint === 0) return NO_PHOTO_FILTER;
  const t = temperature / 100;
  const m = tint / 100;
  const r = 2 ** (TEMPERATURE_STOPS * t);
  const g = 2 ** (-TINT_STOPS * m);
  const b = 2 ** (-TEMPERATURE_STOPS * t);
  const max = Math.max(r, g, b);
  return { r: r / max, g: g / max, b: b / max, density: 1 };
}

/**
 * `isRaw`: the photo goes through the engine's RAW develop stage
 * (raw-develop.ts), which applies exposure and white balance in linear
 * light, so they are left out here rather than applied twice.
 */
export function recipeToAdjustments(recipe: Recipe, options: { readonly isRaw?: boolean } = {}): EngineAdjustments {
  const { tone, color, finish, whiteBalance } = recipe;
  const isRaw = options.isRaw === true;
  return {
    exposure: isRaw ? 0 : tone.exposure,
    contrast: tone.contrast,
    highlights: tone.highlights,
    shadows: tone.shadows,
    whites: tone.whites,
    blacks: tone.blacks,
    // Monochrome on an image that is not RAW: no colour left after the
    // adjustments' saturation (the RAW stage has its own, see raw-develop.ts).
    saturation: !isRaw && recipe.profile.id === 'monochrome' ? -100 : color.saturation,
    vibrance: color.vibrance,
    vignette: finish.vignette,
    photoFilter: isRaw ? NO_PHOTO_FILTER : whiteBalanceFilter(whiteBalance.temperature, whiteBalance.tint),
  };
}

export function sameAdjustments(a: EngineAdjustments, b: EngineAdjustments): boolean {
  return (
    a.exposure === b.exposure &&
    a.contrast === b.contrast &&
    a.highlights === b.highlights &&
    a.shadows === b.shadows &&
    a.whites === b.whites &&
    a.blacks === b.blacks &&
    a.saturation === b.saturation &&
    a.vibrance === b.vibrance &&
    a.vignette === b.vignette &&
    a.photoFilter.r === b.photoFilter.r &&
    a.photoFilter.g === b.photoFilter.g &&
    a.photoFilter.b === b.photoFilter.b &&
    a.photoFilter.density === b.photoFilter.density
  );
}

/** The framing the engine's layer texture is in: rotated clockwise, then mirrored left to right. */
export interface Framing {
  readonly rotate: QuarterTurns;
  readonly flipH: boolean;
}

export type FramingOp = { readonly kind: 'rotate'; readonly clockwise: boolean } | { readonly kind: 'flipH' };

function rotateOps(quarterTurnsClockwise: number): FramingOp[] {
  const turns = ((quarterTurnsClockwise % 4) + 4) % 4;
  if (turns === 0) return [];
  if (turns === 3) return [{ kind: 'rotate', clockwise: false }];
  return Array.from({ length: turns }, () => ({ kind: 'rotate', clockwise: true }) as const);
}

/**
 * The texture operations that take an image framed as `from` to `to`: undo
 * the mirror, rotate by the difference, mirror again. Mirroring after a
 * rotation by θ equals rotating by -θ after mirroring, so undoing and
 * redoing the mirror around the rotation is exact.
 */
export function framingOps(from: Framing, to: Framing): FramingOp[] {
  const ops: FramingOp[] = [];
  if (from.flipH) ops.push({ kind: 'flipH' });
  ops.push(...rotateOps((to.rotate - from.rotate) / 90));
  if (to.flipH) ops.push({ kind: 'flipH' });
  const isNoop = ops.length === 2 && ops[0]?.kind === 'flipH' && ops[1]?.kind === 'flipH';
  return isNoop ? [] : ops;
}

/** Image size after framing an oriented `width`×`height` image. */
export function framedSize(width: number, height: number, rotate: QuarterTurns): { width: number; height: number } {
  return rotate === 90 || rotate === 270 ? { width: height, height: width } : { width, height };
}

/** The recipe's straighten angle in degrees (framing.angle, −45..45); 0 when the recipe has none. */
export function framingAngle(framing: Recipe['framing']): number {
  const v = (framing as { readonly angle?: unknown }).angle;
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(-45, Math.min(45, v)) : 0;
}

export function framingFlipV(framing: Recipe['framing']): boolean {
  return (framing as { readonly flipV?: unknown }).flipV === true;
}

/**
 * Rotate, Flip and Flip vertical as the texture operations see them. A
 * vertical flip is a horizontal one turned half a turn, so it folds into
 * the other two.
 */
export function effectiveFraming(framing: Recipe['framing']): Framing {
  const isFlipV = framingFlipV(framing);
  const rotate = (((framing.rotate + (isFlipV ? 180 : 0)) % 360) as QuarterTurns);
  return { rotate, flipH: framing.flipH !== isFlipV };
}
