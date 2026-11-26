/**
 * White balance for RAW files (spec 5.4): the presets and the Kelvin
 * readout of the recipe's relative temperature, both from the RAW
 * description the engine gives once per file (`whiteBalance`). The recipe's
 * Temperature and Tint stay relative to as shot for every format; Kelvin
 * is only how a format with Kelvin shows and takes them (`KelvinReadout`).
 */

export interface WhiteBalancePresetValues {
  readonly id: string;
  readonly name: string;
  /** Recipe units, relative to as shot (−200..200). */
  readonly temperature: number;
  readonly tint: number;
}

/** `kelvin = 1e6 / (miredAtZero + miredPerUnit · temperature)`. */
export interface KelvinScale {
  readonly miredAtZero: number;
  readonly miredPerUnit: number;
  readonly asShotKelvin: number;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * The engine's preset list; malformed entries are left out, and so is a
 * preset whose slider values are those of one already listed. A preset is
 * stored as its two slider values and the menu names the first preset
 * that matches them, so the second of two equal ones could never be
 * shown as chosen. They do occur: on many bodies the camera's Underwater
 * multipliers are its Daylight ones.
 */
export function parsePresets(json: string): WhiteBalancePresetValues[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  return readPresets(raw);
}

/** `parsePresets` of a value already parsed (a RAW description's `whiteBalance.presets`). */
export function readPresets(raw: unknown): WhiteBalancePresetValues[] {
  if (!Array.isArray(raw)) return [];
  const out: WhiteBalancePresetValues[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { name, temperature, tint } = entry as Record<string, unknown>;
    if (typeof name !== 'string' || name === '' || !isFiniteNumber(temperature) || !isFiniteNumber(tint)) continue;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (out.some((p) => p.id === id)) continue;
    if (out.some((p) => Math.round(p.temperature) === Math.round(temperature) && Math.round(p.tint) === Math.round(tint))) continue;
    out.push({ id, name, temperature, tint });
  }
  return out;
}

export function parseKelvinScale(json: string): KelvinScale | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  return readKelvinScale(raw);
}

/** `parseKelvinScale` of a value already parsed (a fitted Kelvin model's fields). */
export function readKelvinScale(raw: unknown): KelvinScale | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { miredAtZero, miredPerUnit, asShotKelvin } = raw as Record<string, unknown>;
  if (!isFiniteNumber(miredAtZero) || !isFiniteNumber(miredPerUnit) || !isFiniteNumber(asShotKelvin)) return null;
  if (miredAtZero <= 0 || miredPerUnit === 0) return null;
  return { miredAtZero, miredPerUnit, asShotKelvin };
}

/** The Kelvin a recipe temperature means on this body; null when the scale gives none. */
export function kelvinFor(scale: KelvinScale, temperature: number): number | null {
  const mired = scale.miredAtZero + scale.miredPerUnit * temperature;
  return mired > 0 ? 1e6 / mired : null;
}

/** The recipe temperature for a Kelvin value on this body. */
export function temperatureForKelvin(scale: KelvinScale, kelvin: number): number {
  return (1e6 / kelvin - scale.miredAtZero) / scale.miredPerUnit;
}

/** Typed Kelvin outside this range is clamped to it (then to the slider's own range). */
export const KELVIN_RANGE = { min: 2000, max: 50000 } as const;

/**
 * How a format with Kelvin shows the recipe's relative Temperature and
 * takes typed Kelvin back. 'fitted': a line fitted to the body's presets,
 * which ignores Tint; 'measured': the colour temperature of the white the
 * file's calibration gives for both sliders.
 */
export interface KelvinReadout {
  readonly kind: 'fitted' | 'measured';
  readonly asShotKelvin: number;
  /** The Kelvin the recipe's Temperature and Tint mean; null when there is none. */
  kelvinFor(temperature: number, tint: number): number | null;
  /** The recipe Temperature (unrounded) whose white reads `kelvin` at the recipe's Tint. */
  temperatureFor(kelvin: number, tint: number): number;
}

/** The readout of a fitted Kelvin scale. */
export function fittedReadout(scale: KelvinScale): KelvinReadout {
  return {
    kind: 'fitted',
    asShotKelvin: scale.asShotKelvin,
    kelvinFor: (temperature) => kelvinFor(scale, temperature),
    temperatureFor: (kelvin) => temperatureForKelvin(scale, kelvin),
  };
}

/**
 * The Temperature readout in Kelvin, rounded to 50 K, at the recipe's
 * `tint`; typed Kelvin back to recipe units. Text that is not a positive
 * number gives null, and the field shows the current value again.
 */
export function kelvinDisplay(readout: KelvinReadout, tint: number): { format: (value: number) => string; parse: (text: string) => number | null } {
  return {
    format: (value) => {
      const k = readout.kelvinFor(value, tint);
      return k === null ? '—' : `${Math.round(k / 50) * 50} K`;
    },
    parse: (text) => {
      const cleaned = text.trim().replace(/\s*k$/i, '').replace(',', '.');
      if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
      const typed = Number(cleaned);
      if (!(typed > 0)) return null;
      const kelvin = Math.min(KELVIN_RANGE.max, Math.max(KELVIN_RANGE.min, typed));
      return Math.round(readout.temperatureFor(kelvin, tint));
    },
  };
}

/**
 * Whether White balance must wait before taking input: a RAF's Temperature
 * is typed in Kelvin, which means nothing until the photo is read and its
 * Kelvin scale known. Other photos' sliders are relative and never wait.
 */
export function isWhiteBalanceWaiting(format: string, isPhotoRead: boolean): boolean {
  return format === 'raf' && !isPhotoRead;
}
