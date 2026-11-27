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

/** The engine's white-balance calls (`rawWhiteBalance`, `rawTemperatureForKelvin`), pure and on the main thread. */
export interface RawWhiteEngine {
  whiteBalance(format: string, paramsJson: string, temperature: number, tint: number): string;
  temperatureForKelvin(format: string, paramsJson: string, kelvin: number, tint: number): number;
}

/** `rawWhiteBalance`'s answer. */
interface RawWhite {
  readonly wbRatio: readonly [number, number, number];
  readonly camToRgb: readonly number[] | null;
  readonly kelvin: number | null;
}

function isNumbers(v: unknown, length: number): v is number[] {
  return Array.isArray(v) && v.length === length && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function parseWhite(json: string): RawWhite {
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== 'object' || raw === null) throw new Error('The RAW white balance is not an object');
  const v = raw as Record<string, unknown>;
  if (!isNumbers(v.wbRatio, 3)) throw new Error('The RAW white balance has no gains');
  return {
    wbRatio: [v.wbRatio[0] ?? 1, v.wbRatio[1] ?? 1, v.wbRatio[2] ?? 1],
    camToRgb: isNumbers(v.camToRgb, 9) ? v.camToRgb : null,
    kelvin: typeof v.kelvin === 'number' && Number.isFinite(v.kelvin) && v.kelvin > 0 ? v.kelvin : null,
  };
}

/** Whites asked for in one file before the memo starts again: far more than a session of slider moves. */
const MEMO_LIMIT = 2048;

/**
 * The white balance of a described file.
 *
 * A fixed matrix takes the gains `wbRatioFor` gives and keeps the
 * profile's matrix. A matrix that follows the white asks the engine
 * (`rawWhiteBalance`) for the gains and the matrix of each white, at the
 * recipe's values rounded to whole slider steps, remembered per file.
 *
 * Kelvin: a fitted scale reads as a line (`fittedReadout`); measured Kelvin
 * is the colour temperature of the white the engine gives for both
 * sliders, exactly the description's as-shot Kelvin at (0, 0), and typed
 * Kelvin goes back through `rawTemperatureForKelvin` at the recipe's Tint,
 * which keeps within the sliders' reach (the readout then shows the Kelvin
 * reached). No Kelvin: Temperature shows its relative numbers.
 */
export function rawWhiteBalanceFor(description: RawDescription, paramsJson: string, engine: RawWhiteEngine): RawWhiteBalance {
  const { format } = description;
  const { matrix, kelvin, presets } = description.whiteBalance;
  const memo = new Map<string, RawWhite>();
  const whiteFor = (temperature: number, tint: number): RawWhite => {
    const t = Math.round(temperature);
    const m = Math.round(tint);
    const key = `${t},${m}`;
    const known = memo.get(key);
    if (known) return known;
    const white = parseWhite(engine.whiteBalance(format, paramsJson, t, m));
    if (memo.size >= MEMO_LIMIT) memo.clear();
    memo.set(key, white);
    return white;
  };

  const settingsFor =
    matrix === 'perWhite'
      ? (temperature: number, tint: number): RawWhiteSettings => {
          const white = whiteFor(temperature, tint);
          return { wbRatio: white.wbRatio, camToRgb: white.camToRgb };
        }
      : (temperature: number, tint: number): RawWhiteSettings => ({ wbRatio: wbRatioFor(temperature, tint), camToRgb: null });

  let readout: KelvinReadout | null = null;
  if (kelvin.kind === 'fitted') readout = fittedReadout(kelvin);
  else if (kelvin.kind === 'measured') {
    readout = {
      kind: 'measured',
      asShotKelvin: kelvin.asShotKelvin,
      kelvinFor: (temperature, tint) =>
        Math.round(temperature) === 0 && Math.round(tint) === 0 ? kelvin.asShotKelvin : whiteFor(temperature, tint).kelvin,
      temperatureFor: (k, tint) => engine.temperatureForKelvin(format, paramsJson, k, Math.round(tint)),
    };
  }
  return { settingsFor, kelvin: readout, presets };
}
