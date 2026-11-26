/**
 * The RAW step's white balance for a prepared file, from its description's
 * model. The recipe's Temperature and Tint stay relative to as shot for
 * every format; what the model decides is the matrix sent with the gains,
 * how Kelvin reads, and which presets the menu offers.
 */

import { wbRatioFor } from '../raw-develop';
import { fittedReadout, type KelvinReadout, type WhiteBalancePresetValues } from '../white-balance';
import type { RawDescription } from './raw-format';

/** What `setRawDevelop` takes for a white balance. */
export interface RawWhiteSettings {
  readonly wbRatio: readonly [number, number, number];
  /** The matrix to send with `wbRatio`; null keeps the profile's (the matrix is fixed). */
  readonly camToRgb: readonly number[] | null;
}

export interface RawWhiteBalance {
  settingsFor(temperature: number, tint: number): RawWhiteSettings;
  /** How Temperature reads in Kelvin; null where the format has no Kelvin (it shows relative numbers). */
  readonly kelvin: KelvinReadout | null;
  readonly presets: readonly WhiteBalancePresetValues[];
}

/**
 * The white balance of a described file. A fixed matrix takes the gains
 * `wbRatioFor` gives and keeps the profile's matrix. A matrix that follows
 * the white, and measured Kelvin, need the engine's `rawWhiteBalance` and
 * `rawTemperatureForKelvin`, which no format on the RAW path uses yet: a
 * description that asks for them is refused here.
 */
export function rawWhiteBalanceFor(description: RawDescription): RawWhiteBalance {
  const { matrix, kelvin, presets } = description.whiteBalance;
  const format = description.format.toUpperCase();
  if (matrix !== 'fixed') throw new Error(`${format}: a white balance whose matrix follows the white is not developed here yet`);
  if (kelvin.kind === 'measured') throw new Error(`${format}: measured Kelvin is not developed here yet`);
  return {
    settingsFor: (temperature, tint) => ({ wbRatio: wbRatioFor(temperature, tint), camToRgb: null }),
    kelvin: kelvin.kind === 'fitted' ? fittedReadout(kelvin) : null,
    presets,
  };
}
