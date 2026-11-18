/**
 * Lightroom and Camera Raw edits (the `crs:` namespace) mapped onto our
 * recipe, both ways (spec Phase 5, for people moving from other software).
 *
 * Every mapping is approximate. Our controls are not Adobe's maths, so
 * the same number gives the same direction and a similar strength, not
 * the same picture. Where the ranges differ the value is scaled or
 * clamped, as each row says.
 *
 * | Camera Raw (crs:)                    | Their range     | Recipe path                    | Mapping |
 * |--------------------------------------|-----------------|--------------------------------|---------|
 * | Exposure2012                         | -5..+5 EV       | tone.exposure                  | x1 |
 * | Contrast2012, Highlights2012,        | -100..100       | tone.contrast, .highlights,    | x1 |
 * |   Shadows2012, Whites2012, Blacks2012|                 |   .shadows, .whites, .blacks   |    |
 * | Vibrance, Saturation                 | -100..100       | color.vibrance, .saturation    | x1 |
 * | Clarity2012                          | -100..100       | localContrast.large            | x1 |
 * | Texture                              | -100..100       | localContrast.small            | x1 |
 * | Dehaze                               | -100..100       | localContrast.haze             | x1 |
 * | Sharpness                            | 0..150          | sharpness.amount               | x1 |
 * | SharpenRadius                        | 0.5..3          | sharpness.radius               | x1 |
 * | SharpenEdgeMasking                   | 0..100          | sharpness.edges                | x1 |
 * | LuminanceSmoothing                   | 0..100          | noise.luminance                | x1 |
 * | ColorNoiseReduction                  | 0..100          | noise.color                    | x1 |
 * | LuminanceNoiseReductionDetail        | 0..100          | noise.detail                   | x1 |
 * | Hue/Saturation/LuminanceAdjustment   | -100..100       | colorByHue.<band>.hue, etc.    | x1, the same eight bands (Aqua included) |
 * |   Red … Magenta                      |                 |                                |    |
 * | ColorGrade{Shadow,Midtone,Highlight, | hue 0..359,     | colorGrading.<range>.hue,      | x1 |
 * |   Global}{Hue,Sat,Lum}               | sat 0..100,     |   .saturation, .luminance      |    |
 * |                                      | lum -100..100   |                                |    |
 * | ColorGradeBlending                   | 0..100          | colorGrading.blending          | x1 |
 * | ColorGradeBalance                    | -100..100       | colorGrading.balance           | x1 |
 * | PostCropVignetteAmount               | -100..100       | finish.vignette                | negated: theirs darkens below 0, ours above |
 * | PostCropVignetteMidpoint             | 0..100 (50)     | finish.vignetteSize            | x1, approximate; read and written only with a vignette |
 * | PostCropVignetteRoundness            | -100..100       | finish.vignetteRoundness       | x1, approximate; the same |
 * | PostCropVignetteFeather              | 0..100 (50)     | finish.vignetteFeather         | x1, approximate; the same |
 * | GrainAmount                          | 0..100          | finish.grain.amount            | x1 |
 * | GrainSize                            | 0..100 (25)     | finish.grain.size              | x1; read and written only with grain |
 * | GrainFrequency                       | 0..100 (50)     | finish.grain.roughness         | x1, approximate (theirs is how fine the pattern is); the same |
 * | ToneCurvePV2012[Red,Green,Blue]      | "x, y" 0..255   | curves.luminance, .red, …      | /255; endpoints added when missing; more than 16 points, or x not increasing, is skipped |
 * | WhiteBalance                         | As Shot, Custom…| whiteBalance.mode              | As Shot -> asShot (Temperature and Tint ignored); anything else -> custom |
 * | Temperature (RAW)                    | 2000..50000 K   | whiteBalance.temperature       | see `kelvinToTemperature`: a mired shift from 5500 K, clamped |
 * | Temperature (JPEG, TIFF)             | -100..100       | whiteBalance.temperature       | x1 |
 * | Tint (RAW)                           | -150..150       | whiteBalance.tint              | /1.5 |
 * | Tint (JPEG, TIFF)                    | -100..100       | whiteBalance.tint              | x1 |
 * | CropAngle                            | -45..45 deg     | framing.angle                  | x1; see read.ts for the crop itself |
 *
 * Unmapped: PostCropVignetteStyle and PostCropVignetteHighlightContrast,
 * lens and transform corrections, calibration, the older split toning
 * and PV2010 controls, masks and local adjustments, spot removal, and
 * camera profiles (crs:CameraProfile, crs:Look).
 */

import { CURVE_CHANNELS, DEFAULT_RECIPE, GRADE_RANGES, HUE_BANDS, MAX_CURVE_POINTS, recipeToPaths } from '../library/recipe';
import type { CurveChannel, CurvePoint, GradeRange, HueBand, Recipe, RecipeLeaf } from '../library/recipe';

/** A crs: number read as the recipe path's value, times `scale`. */
export interface CrsScalar {
  readonly crs: string;
  readonly path: string;
  /** Recipe value = crs value × scale. Default 1. */
  readonly scale?: number;
}

const BAND_NAMES: Readonly<Record<HueBand, string>> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  aqua: 'Aqua',
  blue: 'Blue',
  purple: 'Purple',
  magenta: 'Magenta',
};

const GRADE_NAMES: Readonly<Record<GradeRange, string>> = {
  shadows: 'Shadow',
  midtones: 'Midtone',
  highlights: 'Highlight',
  global: 'Global',
};

/** Every crs: property that maps to one recipe number (the table above, less white balance, curves and crop). */
export const CRS_SCALARS: readonly CrsScalar[] = [
  { crs: 'Exposure2012', path: 'tone.exposure' },
  { crs: 'Contrast2012', path: 'tone.contrast' },
  { crs: 'Highlights2012', path: 'tone.highlights' },
  { crs: 'Shadows2012', path: 'tone.shadows' },
  { crs: 'Whites2012', path: 'tone.whites' },
  { crs: 'Blacks2012', path: 'tone.blacks' },
  { crs: 'Vibrance', path: 'color.vibrance' },
  { crs: 'Saturation', path: 'color.saturation' },
  { crs: 'Clarity2012', path: 'localContrast.large' },
  { crs: 'Texture', path: 'localContrast.small' },
  { crs: 'Dehaze', path: 'localContrast.haze' },
  { crs: 'Sharpness', path: 'sharpness.amount' },
  { crs: 'SharpenRadius', path: 'sharpness.radius' },
  { crs: 'SharpenEdgeMasking', path: 'sharpness.edges' },
  { crs: 'LuminanceSmoothing', path: 'noise.luminance' },
  { crs: 'ColorNoiseReduction', path: 'noise.color' },
  { crs: 'LuminanceNoiseReductionDetail', path: 'noise.detail' },
  ...HUE_BANDS.flatMap((band): CrsScalar[] => [
    { crs: `HueAdjustment${BAND_NAMES[band]}`, path: `colorByHue.${band}.hue` },
    { crs: `SaturationAdjustment${BAND_NAMES[band]}`, path: `colorByHue.${band}.saturation` },
    { crs: `LuminanceAdjustment${BAND_NAMES[band]}`, path: `colorByHue.${band}.luminance` },
  ]),
  ...GRADE_RANGES.flatMap((range): CrsScalar[] => [
    { crs: `ColorGrade${GRADE_NAMES[range]}Hue`, path: `colorGrading.${range}.hue` },
    { crs: `ColorGrade${GRADE_NAMES[range]}Sat`, path: `colorGrading.${range}.saturation` },
    { crs: `ColorGrade${GRADE_NAMES[range]}Lum`, path: `colorGrading.${range}.luminance` },
  ]),
  { crs: 'ColorGradeBlending', path: 'colorGrading.blending' },
  { crs: 'ColorGradeBalance', path: 'colorGrading.balance' },
  { crs: 'PostCropVignetteAmount', path: 'finish.vignette', scale: -1 },
  { crs: 'GrainAmount', path: 'finish.grain.amount' },
];

/**
 * Shape controls that mean something only while their effect is on, so
 * they are read and written only then: Lightroom writes its defaults
 * (midpoint 50, grain size 25) even with no vignette, and ours differ.
 */
const CRS_DEPENDENT: readonly { readonly when: string; readonly scalars: readonly CrsScalar[] }[] = [
  {
    when: 'finish.vignette',
    scalars: [
      { crs: 'PostCropVignetteMidpoint', path: 'finish.vignetteSize' },
      { crs: 'PostCropVignetteRoundness', path: 'finish.vignetteRoundness' },
      { crs: 'PostCropVignetteFeather', path: 'finish.vignetteFeather' },
    ],
  },
  {
    when: 'finish.grain.amount',
    scalars: [
      { crs: 'GrainSize', path: 'finish.grain.size' },
      { crs: 'GrainFrequency', path: 'finish.grain.roughness' },
    ],
  },
];

/** The tone-curve properties by channel. */
export const CRS_CURVES: Readonly<Record<CurveChannel, string>> = {
  luminance: 'ToneCurvePV2012',
  red: 'ToneCurvePV2012Red',
  green: 'ToneCurvePV2012Green',
  blue: 'ToneCurvePV2012Blue',
};

/** The as-shot colour temperature Lightroom's Kelvin values are measured against; a guess, as the sidecar does not say. */
export const REFERENCE_KELVIN = 5500;
/** Temperatures above this are Kelvin (RAW); at or below it, Lightroom's relative -100..100 (JPEG, TIFF). */
const KELVIN_FLOOR = 1000;

/**
 * Lightroom's white balance Kelvin as our relative temperature.
 *
 * Ours is a shift from the camera's as-shot white balance, -100..100.
 * Lightroom stores the absolute Kelvin it balances for, and the sidecar
 * does not say what the camera chose, so the shift is taken from
 * REFERENCE_KELVIN (daylight), in mireds (1e6 / K), one unit per mired:
 * 10000 K is about +82, 4000 K about -68, clamped to ±100. A photo shot
 * under tungsten and corrected in Lightroom therefore comes in too cool;
 * the result is a starting point, not a match.
 */
export function kelvinToTemperature(kelvin: number): number {
  const shift = 1e6 / REFERENCE_KELVIN - 1e6 / kelvin;
  return Math.max(-100, Math.min(100, Math.round(shift)));
}

/** The inverse of `kelvinToTemperature`, for writing; within ±100 it round-trips to the mired. */
export function temperatureToKelvin(temperature: number): number {
  return Math.round(1e6 / (1e6 / REFERENCE_KELVIN - temperature));
}

export type CrsValue = string | readonly string[];

/** A tone curve from Lightroom's "x, y" points (0..255); null when it cannot be read. */
export function curveFromCrs(value: CrsValue | undefined): CurvePoint[] | null {
  if (value === undefined) return null;
  const items = typeof value === 'string' ? [value] : value;
  const points: CurvePoint[] = [];
  for (const item of items) {
    const parts = item.split(',').map((p) => Number(p.trim()));
    const [x, y] = parts;
    if (parts.length !== 2 || x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < 0 || x > 255 || y < 0 || y > 255) return null;
    const prev = points[points.length - 1];
    if (prev && x / 255 <= prev.x) return null;
    points.push({ x: x / 255, y: y / 255 });
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  // Lightroom's curves run from 0 to 255; one that stops short is held flat to the ends.
  if (first.x > 0) points.unshift({ x: 0, y: first.y });
  if (last.x < 1) points.push({ x: 1, y: last.y });
  if (points.length < 2 || points.length > MAX_CURVE_POINTS) return null;
  return points;
}

/** Read access to a sidecar's crs: properties. */
export interface CrsSource {
  number(local: string): number | null;
  text(local: string): string | null;
  value(local: string): CrsValue | undefined;
}

/** The recipe values a sidecar's Camera Raw settings ask for, by path (unclamped: `recipeFromPaths` clamps). */
export function crsToRecipePaths(src: CrsSource): Record<string, RecipeLeaf> {
  const out: Record<string, RecipeLeaf> = {};
  for (const { crs, path, scale } of CRS_SCALARS) {
    const v = src.number(crs);
    if (v !== null) out[path] = v * (scale ?? 1) + 0; // + 0 turns -0 into 0
  }
  for (const { when, scalars } of CRS_DEPENDENT) {
    const on = out[when];
    if (typeof on !== 'number' || on === 0) continue;
    for (const { crs, path } of scalars) {
      const v = src.number(crs);
      if (v !== null) out[path] = v;
    }
  }
  for (const channel of CURVE_CHANNELS) {
    const curve = curveFromCrs(src.value(CRS_CURVES[channel]));
    if (curve) out[`curves.${channel}`] = curve;
  }
  const wb = src.text('WhiteBalance')?.trim().toLowerCase();
  if (wb !== undefined && wb !== '' && wb !== 'as shot') {
    out['whiteBalance.mode'] = 'custom';
    const temperature = src.number('Temperature');
    const tint = src.number('Tint');
    const kelvin = temperature !== null && temperature > KELVIN_FLOOR;
    if (temperature !== null) out['whiteBalance.temperature'] = kelvin ? kelvinToTemperature(temperature) : temperature;
    // RAW tint runs -150..150, the relative kind -100..100.
    if (tint !== null) out['whiteBalance.tint'] = Math.round((kelvin ? tint / 1.5 : tint) * 100) / 100;
  }
  if (src.text('HasCrop')?.toLowerCase() === 'true') {
    const angle = src.number('CropAngle');
    if (angle !== null && angle !== 0) out['framing.angle'] = angle;
  }
  return out;
}

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value}`;
}

/**
 * The recipe as Camera Raw settings: attributes for everything that maps,
 * and `rdf:Seq` elements for curves. Values at our defaults are left out.
 * White balance is written as Custom with a relative Temperature and Tint
 * (Lightroom reads those for JPEGs; for RAW files it expects Kelvin, see
 * `temperatureToKelvin`, so a RAW sidecar is written in Kelvin).
 */
export function recipeToCrs(recipe: Recipe, isRaw: boolean): { attributes: string[]; elements: string[] } {
  const paths = recipeToPaths(recipe);
  const defaults = recipeToPaths(DEFAULT_RECIPE);
  const attributes: string[] = [];
  for (const { crs, path, scale } of CRS_SCALARS) {
    const value = paths[path];
    if (typeof value !== 'number' || value === defaults[path]) continue;
    attributes.push(`crs:${crs}="${signed(value / (scale ?? 1) + 0)}"`);
  }
  for (const { when, scalars } of CRS_DEPENDENT) {
    if (paths[when] === 0) continue;
    // All of them, defaults included: Lightroom's defaults are not ours.
    for (const { crs, path } of scalars) {
      const value = paths[path];
      if (typeof value === 'number') attributes.push(`crs:${crs}="${signed(Math.round(value))}"`);
    }
  }
  const wb = recipe.whiteBalance;
  if (wb.mode === 'custom') {
    attributes.push(`crs:WhiteBalance="Custom"`);
    attributes.push(`crs:Temperature="${isRaw ? temperatureToKelvin(wb.temperature) : signed(wb.temperature)}"`);
    attributes.push(`crs:Tint="${signed(isRaw ? Math.round(wb.tint * 1.5) : wb.tint)}"`);
  }
  const elements: string[] = [];
  for (const channel of CURVE_CHANNELS) {
    const curve = recipe.curves[channel];
    if (JSON.stringify(curve) === JSON.stringify(DEFAULT_RECIPE.curves[channel])) continue;
    elements.push(
      `   <crs:${CRS_CURVES[channel]}><rdf:Seq>`,
      ...curve.map((p) => `     <rdf:li>${Math.round(p.x * 255)}, ${Math.round(p.y * 255)}</rdf:li>`),
      `   </rdf:Seq></crs:${CRS_CURVES[channel]}>`,
    );
  }
  return { attributes, elements };
}
