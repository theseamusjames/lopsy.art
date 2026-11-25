/**
 * White balance for RAW files (spec 5.4): the camera's presets and the
 * Kelvin scale of the recipe's relative temperature, both from the engine
 * (`rafWhiteBalancePresets`, `rafWhiteBalanceKelvin`), read once per file.
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
 * shown as chosen. They do occur: on many Fujifilm bodies the camera's
 * Underwater multipliers are its Daylight ones.
 */
export function parsePresets(json: string): WhiteBalancePresetValues[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
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
 * The Temperature readout in Kelvin, rounded to 50 K; typed Kelvin back to
 * recipe units. Text that is not a positive number gives null, and the
 * field shows the current value again.
 */
export function kelvinDisplay(scale: KelvinScale): { format: (value: number) => string; parse: (text: string) => number | null } {
  return {
    format: (value) => {
      const k = kelvinFor(scale, value);
      return k === null ? '—' : `${Math.round(k / 50) * 50} K`;
    },
    parse: (text) => {
      const cleaned = text.trim().replace(/\s*k$/i, '').replace(',', '.');
      if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
      const typed = Number(cleaned);
      if (!(typed > 0)) return null;
      const kelvin = Math.min(KELVIN_RANGE.max, Math.max(KELVIN_RANGE.min, typed));
      return Math.round(temperatureForKelvin(scale, kelvin));
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
