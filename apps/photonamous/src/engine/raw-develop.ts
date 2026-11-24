/**
 * The recipe mapped onto the engine's RAW develop stage (engine/src/develop,
 * the proof of concept of spec E2/E3). A RAF's layer holds linear camera
 * RGB at the as-shot white balance; the stage applies white balance in
 * camera space, the camera matrix, exposure, saturation, highlight
 * desaturation and the film-simulation base curve, all in linear light,
 * before the document's image adjustments run on top.
 *
 * White balance is a POC mapping until Temperature and Tint read in kelvin
 * (spec E9): Temperature t ∈ [-100, 100] scales red by 2^(0.6·t/100) and
 * blue by 2^(−0.6·t/100); Tint m scales green by 2^(−0.4·m/100). The three
 * gains are then divided by their weighted sum (¼ R, ½ G, ¼ B, a camera's
 * green-heavy luminance) so the image's brightness stays put and only its
 * colour moves.
 */

import type { Recipe } from '@lopsy/photos-core/library/recipe';
import type { DevelopProfile, ProfileSettings } from './profiles';

/** The JSON `setRawDevelop` takes and `rafDevelopDefaults` returns. */
export interface RawDevelopSettings {
  /** Camera-space multipliers relative to as shot; [1, 1, 1] is as shot. */
  readonly wbRatio: readonly [number, number, number];
  /** Camera RGB → linear sRGB, row-major. */
  readonly camToRgb: readonly number[];
  /** Total exposure: the camera's baseline plus the user's. */
  readonly exposureEv: number;
  readonly saturation: number;
  readonly highlightDesaturation: boolean;
  /** Tone curve on linear luminance over 0..1; null for none. */
  readonly baseCurve: readonly number[] | null;
  /**
   * Each channel's clip level `[r, g, b]` in linear camera RGB at the
   * as-shot balance; absent when the decode did not say. The engine's white
   * balance picker leaves out pixels at or near it.
   */
  readonly clipLevels?: readonly [number, number, number];
}

/** Stops of red and blue at Temperature ±100. */
export const RAW_TEMPERATURE_STOPS = 0.6;
/** Stops of green at Tint ±100. */
export const RAW_TINT_STOPS = 0.4;
/** Weights that keep brightness when white balance changes. */
export const WB_LUMA_WEIGHTS: readonly [number, number, number] = [0.25, 0.5, 0.25];

export function wbRatioFor(temperature: number, tint: number): [number, number, number] {
  const t = temperature / 100;
  const m = tint / 100;
  const r = 2 ** (RAW_TEMPERATURE_STOPS * t);
  const g = 2 ** (-RAW_TINT_STOPS * m);
  const b = 2 ** (-RAW_TEMPERATURE_STOPS * t);
  const [wr, wg, wb] = WB_LUMA_WEIGHTS;
  const luma = wr * r + wg * g + wb * b;
  return [r / luma, g / luma, b / luma];
}

/**
 * The inverse of `wbRatioFor`: Temperature and Tint whose ratios match
 * `ratio` up to scale (the luminance normalisation drops out), rounded and
 * clamped to the sliders' −100..100. Used for Auto white balance, whose
 * engine answer is camera-space multipliers.
 */
export function temperatureTintFor(ratio: readonly [number, number, number]): { temperature: number; tint: number } {
  const [r, g, b] = ratio;
  if (!(r > 0 && g > 0 && b > 0)) return { temperature: 0, tint: 0 };
  const t = Math.log2(r / b) / (2 * RAW_TEMPERATURE_STOPS);
  const m = -Math.log2(g / Math.sqrt(r * b)) / RAW_TINT_STOPS;
  const toSlider = (v: number) => {
    const rounded = Math.round(Math.min(100, Math.max(-100, v * 100)));
    return rounded === 0 ? 0 : rounded;
  };
  return { temperature: toSlider(t), tint: toSlider(m) };
}

function isNumberArray(value: unknown, length?: number): value is number[] {
  return (
    Array.isArray(value) &&
    (length === undefined || value.length === length) &&
    value.every((v) => typeof v === 'number' && Number.isFinite(v))
  );
}

/** Reads `rafDevelopDefaults`' JSON; throws when it is not the expected shape. */
export function parseRawDevelopSettings(json: string): RawDevelopSettings {
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== 'object' || raw === null) throw new Error('RAW develop settings are not an object');
  const v = raw as Record<string, unknown>;
  if (!isNumberArray(v.wbRatio, 3)) throw new Error('RAW develop settings have no wbRatio');
  if (!isNumberArray(v.camToRgb, 9)) throw new Error('RAW develop settings have no camToRgb');
  if (typeof v.exposureEv !== 'number' || typeof v.saturation !== 'number') {
    throw new Error('RAW develop settings have no exposure or saturation');
  }
  const curve = v.baseCurve;
  const clip = v.clipLevels;
  return {
    wbRatio: [v.wbRatio[0] ?? 1, v.wbRatio[1] ?? 1, v.wbRatio[2] ?? 1],
    camToRgb: v.camToRgb,
    exposureEv: v.exposureEv,
    saturation: v.saturation,
    highlightDesaturation: v.highlightDesaturation === true,
    baseCurve: isNumberArray(curve) && curve.length >= 2 ? curve : null,
    ...(isNumberArray(clip, 3) ? { clipLevels: [clip[0] ?? 0, clip[1] ?? 0, clip[2] ?? 0] as const } : {}),
  };
}

/**
 * The develop settings for `recipe` on a photo whose defaults (its camera's
 * look) are `defaults`. Profile 'neutral' drops the film-simulation curve
 * and saturation for a flat start; every other profile, 'standard'
 * included, is the camera's own film mode.
 */
export function rawSettingsFor(
  defaults: RawDevelopSettings,
  recipe: Recipe,
  profiles: readonly DevelopProfile[] = [],
): RawDevelopSettings {
  const look = { ...defaults, ...profileLook(defaults, recipe.profile.id, profiles) };
  return {
    ...look,
    wbRatio: wbRatioFor(recipe.whiteBalance.temperature, recipe.whiteBalance.tint),
    exposureEv: look.exposureEv + recipe.tone.exposure,
  };
}

/**
 * A profile's settings. The engine's own profiles (`rafDevelopProfiles`)
 * win; without them 'neutral' is flat, 'monochrome' is the camera's curve
 * with no colour, and anything else is the camera's own film mode.
 */
function profileLook(defaults: RawDevelopSettings, id: string, profiles: readonly DevelopProfile[]): ProfileSettings {
  const engineProfile = profiles.find((p) => p.id === id);
  if (engineProfile?.settings) return engineProfile.settings;
  if (id === 'neutral') return { saturation: 1, baseCurve: null };
  if (id === 'monochrome') return { saturation: 0, baseCurve: defaults.baseCurve };
  return {};
}

export function rawSettingsJson(settings: RawDevelopSettings): string {
  return JSON.stringify(settings);
}
