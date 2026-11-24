/**
 * The recipe mapped onto the engine's develop stages, in one place. An
 * engine runs one of two paths for the whole of its life, chosen when it
 * starts (`createDevelopEngine`):
 *
 * - 'linear', with the working space on (the GPU renders to float
 *   targets): tone on scene data (`setDevelopTone`), colour in OkLab
 *   (`setDevelopLook`) and curves on rendered linear data
 *   (`setDevelopCurves`), and per area `setDevelopAreaLook` and
 *   `setDevelopAreaCurves`. Lopsy's image adjustments change nothing then.
 * - 'legacy', the 8-bit fallback without the working space: Lopsy's image
 *   adjustments (`recipe-to-adjustments.ts`), the 256-entry curves LUT,
 *   the old Color by hue and colour grading. It is the only thing that
 *   renders there, and it is kept apart so that it can be deleted in one
 *   cut when the fallback goes.
 *
 * Detail, local contrast, haze, the finish and the areas' built-in sliders
 * take the same calls on both paths.
 */

import type { Recipe } from '@lopsy/photos-core/library/recipe';
import { colorControlsKey, colorGradeValues, colorMixerValues, curvesLut } from './color-controls';
import { buildCurveTable, CURVE_TABLE_ENTRIES, isIdentityCurves, type Curves } from './curves';
import { recipeToAdjustments, type EngineAdjustments } from './recipe-to-adjustments';

export type DevelopPath = 'linear' | 'legacy';

/** The working space is on exactly where the engine renders to float targets. */
export function developPathFor(hasFloatTargets: boolean): DevelopPath {
  return hasFloatTargets ? 'linear' : 'legacy';
}

/** Floats in `setDevelopTone`. */
export const TONE_LEN = 8;
/** Floats of Color by hue (`setImageColorMixer`'s layout). */
export const MIXER_LEN = 24;
/** Floats of a colour grade (`setImageColorGrading`'s layout). */
export const GRADE_LEN = 18;
/** Floats in `setDevelopLook`: vibrance, saturation, Color by hue, the grade. */
export const LOOK_LEN = 2 + MIXER_LEN + GRADE_LEN;
/** Floats in `setDevelopAreaLook`: whites, blacks, vibrance, Color by hue, the grade. */
export const AREA_LOOK_LEN = 3 + MIXER_LEN + GRADE_LEN;
/** Floats in `setDevelopCurves`: master, red, green, blue. */
export const CURVES_LEN = 4 * CURVE_TABLE_ENTRIES;

/**
 * `setDevelopTone`'s 8 floats `[exposure, temperature, tint, contrast,
 * highlights, shadows, whites, blacks]`, recipe units. A RAW photo's
 * exposure and white balance are the RAW step's (`raw-develop.ts`), so they
 * are 0 here rather than applied twice.
 */
export function developToneValues(recipe: Recipe, isRaw: boolean): Float32Array {
  const { tone, whiteBalance } = recipe;
  return Float32Array.from([
    isRaw ? 0 : tone.exposure,
    isRaw ? 0 : whiteBalance.temperature,
    isRaw ? 0 : whiteBalance.tint,
    tone.contrast,
    tone.highlights,
    tone.shadows,
    tone.whites,
    tone.blacks,
  ]);
}

/**
 * `setDevelopLook`'s 44 floats. Monochrome on a photo that is not RAW is
 * saturation −100; a RAW photo's monochrome is its profile's, in the RAW
 * step. Color by hue and the grade are zeros where they are neutral, which
 * the engine reads as off.
 */
export function developLookValues(recipe: Recipe, isRaw: boolean): Float32Array {
  const saturation = !isRaw && recipe.profile.id === 'monochrome' ? -100 : recipe.color.saturation;
  const out = new Float32Array(LOOK_LEN);
  out[0] = recipe.color.vibrance;
  out[1] = saturation;
  out.set(colorMixerValues(recipe) ?? new Float32Array(MIXER_LEN), 2);
  out.set(colorGradeValues(recipe) ?? new Float32Array(GRADE_LEN), 2 + MIXER_LEN);
  return out;
}

function recipeCurves(recipe: Recipe): Curves {
  const c = recipe.curves;
  return { rgb: c.luminance, r: c.red, g: c.green, b: c.blue };
}

/** `setDevelopCurves`' 16384 floats (master, red, green, blue); null when every curve is the identity. */
export function developCurvesValues(recipe: Recipe): Float32Array | null {
  const curves = recipeCurves(recipe);
  if (isIdentityCurves(curves)) return null;
  const out = new Float32Array(CURVES_LEN);
  [curves.rgb, curves.r, curves.g, curves.b].forEach((points, k) => out.set(buildCurveTable(points), k * CURVE_TABLE_ENTRIES));
  return out;
}

/** Changes whenever the curves' tables do, without building them. */
export function curvesKey(recipe: Recipe): string {
  const c = recipe.curves;
  return [c.luminance, c.red, c.green, c.blue].map((points) => points.map((p) => `${p.x},${p.y}`).join(';')).join('|');
}

/**
 * An area's layer look, `setDevelopAreaLook`'s 45 floats `[whites, blacks,
 * vibrance, Color by hue × 24, grade × 18]`; null when all of it is neutral.
 */
export function developAreaLookValues(effects: Recipe): Float32Array | null {
  const mixer = colorMixerValues(effects);
  const grade = colorGradeValues(effects);
  const { whites, blacks } = effects.tone;
  const { vibrance } = effects.color;
  if (whites === 0 && blacks === 0 && vibrance === 0 && !mixer && !grade) return null;
  const out = new Float32Array(AREA_LOOK_LEN);
  out[0] = whites;
  out[1] = blacks;
  out[2] = vibrance;
  out.set(mixer ?? new Float32Array(MIXER_LEN), 3);
  out.set(grade ?? new Float32Array(GRADE_LEN), 3 + MIXER_LEN);
  return out;
}

/** What the linear path sends for the photo's own tone, look and curves. */
export interface LinearStages {
  readonly path: 'linear';
  /** All zeros when neutral. */
  readonly tone: Float32Array;
  /** All zeros when neutral. */
  readonly look: Float32Array;
  /** Built only when `curvesKey` changed; read it through `curves()`. */
  readonly curvesKey: string;
  readonly curves: () => Float32Array | null;
}

/** What the legacy path sends: Lopsy's image adjustments and the 8-bit LUT and colour passes. */
export interface LegacyStages {
  readonly path: 'legacy';
  readonly adjustments: EngineAdjustments;
  readonly colorKey: string;
  readonly curvesLut: () => Uint8Array | null;
  readonly mixer: () => Float32Array | null;
  readonly grade: () => Float32Array | null;
}

export type DevelopStages = LinearStages | LegacyStages;

/** The photo's own tone, colour and curves for `path`. */
export function developStages(recipe: Recipe, options: { readonly isRaw: boolean; readonly path: DevelopPath }): DevelopStages {
  const { isRaw, path } = options;
  if (path === 'linear') {
    return {
      path,
      tone: developToneValues(recipe, isRaw),
      look: developLookValues(recipe, isRaw),
      curvesKey: curvesKey(recipe),
      curves: () => developCurvesValues(recipe),
    };
  }
  return {
    path,
    adjustments: recipeToAdjustments(recipe, { isRaw }),
    colorKey: colorControlsKey(recipe),
    curvesLut: () => curvesLut(recipe),
    mixer: () => colorMixerValues(recipe),
    grade: () => colorGradeValues(recipe),
  };
}
