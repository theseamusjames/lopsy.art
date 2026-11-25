/**
 * Curves, Color by hue and Color Grading mapped onto the engine's image
 * adjustments, which run after the RAW develop stage. Each answers null
 * when the recipe leaves that control neutral, so the engine can clear it
 * rather than run a pass that changes nothing.
 *
 * Curves: the engine's 256 × RGBA LUT (`setImageCurvesLut`), red, green
 * and blue in R, G and B and the Luminance curve in A, which the shader
 * applies to every channel first, as Lopsy's Curves does.
 */

import { CURVE_CHANNELS, GRADE_RANGES, HUE_BANDS, type Recipe } from '@lopsy/photos-core/library/recipe';
import { buildCurvesLutRgba, isIdentityCurves } from './curves';
import { compileColorGrade, isIdentityColorGrade } from './color-grading';

export function curvesLut(recipe: Recipe): Uint8Array | null {
  const c = recipe.curves;
  const curves = { rgb: c.luminance, r: c.red, g: c.green, b: c.blue };
  return isIdentityCurves(curves) ? null : buildCurvesLutRgba(curves);
}

/** 24 floats, (hue, saturation, luminance) per band in HUE_BANDS order: hue and luminance ±150, saturation −100..150 (±100 on the legacy path). */
export function colorMixerValues(recipe: Recipe): Float32Array | null {
  const values = HUE_BANDS.flatMap((band) => {
    const h = recipe.colorByHue[band];
    return [h.hue, h.saturation, h.luminance];
  });
  return values.every((v) => v === 0) ? null : Float32Array.from(values);
}

/** The 18-float block `setImageColorGrading` takes. */
export function colorGradeValues(recipe: Recipe): Float32Array | null {
  const g = recipe.colorGrading;
  return isIdentityColorGrade(g) ? null : compileColorGrade(g);
}

/** A cheap key of what the three controls send, to skip unchanged updates. */
export function colorControlsKey(recipe: Recipe): string {
  const curves = CURVE_CHANNELS.map((ch) => recipe.curves[ch].map((p) => `${p.x},${p.y}`).join(';')).join('|');
  const hue = HUE_BANDS.map((b) => {
    const h = recipe.colorByHue[b];
    return `${h.hue},${h.saturation},${h.luminance}`;
  }).join('|');
  const grade = GRADE_RANGES.map((r) => {
    const w = recipe.colorGrading[r];
    return `${w.hue},${w.saturation},${w.luminance}`;
  }).join('|');
  return `${curves}#${hue}#${grade}#${recipe.colorGrading.blending},${recipe.colorGrading.balance}`;
}
