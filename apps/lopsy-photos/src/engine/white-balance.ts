/**
 * White balance for RAW files (spec 5.4): the camera's presets and the
 * Kelvin scale of the recipe's relative temperature, both from the engine
 * (`rafWhiteBalancePresets`, `rafWhiteBalanceKelvin`), read once per file.
 */

export interface WhiteBalancePresetValues {
  readonly id: string;
  readonly name: string;
  /** Recipe units, relative to as shot (−100..100). */
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

/** The engine's preset list; malformed entries are left out. */
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

/** The Temperature readout in Kelvin, rounded to 50 K; typed Kelvin back to recipe units. */
export function kelvinDisplay(scale: KelvinScale): { format: (value: number) => string; parse: (text: string) => number | null } {
  return {
    format: (value) => {
      const k = kelvinFor(scale, value);
      return k === null ? '—' : `${Math.round(k / 50) * 50} K`;
    },
    parse: (text) => {
      const cleaned = text.trim().replace(/\s*k$/i, '').replace(',', '.');
      if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
      const kelvin = Number(cleaned);
      if (kelvin < 1000 || kelvin > 50000) return null;
      return Math.round(temperatureForKelvin(scale, kelvin));
    },
  };
}
