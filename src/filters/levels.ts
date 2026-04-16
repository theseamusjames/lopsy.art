/**
 * Levels adjustment — classic input/output tonal remap with gamma.
 *
 * For a channel value `x ∈ [0, 1]`, the Levels function is:
 *
 *   y = mix(outLow, outHigh, pow(clamp((x - inLow) / (inHigh - inLow), 0, 1), 1 / gamma))
 *
 * The master channel (`rgb`) applies to every RGB channel first, then the
 * per-channel curve (`r` / `g` / `b`) remaps each channel independently —
 * matching the pipeline used by the GPU adjustments shader for Curves.
 *
 * All six values per channel are stored in a serialisable form so the
 * document round-trips through history and save. Identity is detected via
 * the six canonical defaults so we can skip GPU uploads.
 */
import type { CurveChannel } from './curves';

export interface LevelsChannel {
  /** Input black point, 0..255. */
  readonly inBlack: number;
  /** Input white point, 0..255. inWhite must be > inBlack. */
  readonly inWhite: number;
  /** Midtone gamma, 0.1..10. 1 = linear. */
  readonly gamma: number;
  /** Output black point, 0..255. */
  readonly outBlack: number;
  /** Output white point, 0..255. */
  readonly outWhite: number;
}

export interface Levels {
  readonly rgb: LevelsChannel;
  readonly r: LevelsChannel;
  readonly g: LevelsChannel;
  readonly b: LevelsChannel;
}

export const IDENTITY_LEVELS_CHANNEL: LevelsChannel = {
  inBlack: 0,
  inWhite: 255,
  gamma: 1,
  outBlack: 0,
  outWhite: 255,
};

export const IDENTITY_LEVELS: Levels = {
  rgb: IDENTITY_LEVELS_CHANNEL,
  r: IDENTITY_LEVELS_CHANNEL,
  g: IDENTITY_LEVELS_CHANNEL,
  b: IDENTITY_LEVELS_CHANNEL,
};

export function isIdentityLevelsChannel(ch: LevelsChannel | undefined | null): boolean {
  if (!ch) return true;
  return (
    ch.inBlack === 0
    && ch.inWhite === 255
    && ch.gamma === 1
    && ch.outBlack === 0
    && ch.outWhite === 255
  );
}

export function isIdentityLevels(levels: Levels | undefined | null): boolean {
  if (!levels) return true;
  return (
    isIdentityLevelsChannel(levels.rgb)
    && isIdentityLevelsChannel(levels.r)
    && isIdentityLevelsChannel(levels.g)
    && isIdentityLevelsChannel(levels.b)
  );
}

/**
 * Evaluate the Levels function at a single 0..255 input. Pure — used by the
 * LUT builder and the unit tests.
 */
export function evaluateLevels(channel: LevelsChannel, input: number): number {
  const inBlack = clamp(channel.inBlack, 0, 254);
  // inWhite must stay strictly greater than inBlack to avoid divide-by-zero.
  const inWhite = Math.max(inBlack + 1, clamp(channel.inWhite, 1, 255));
  const outBlack = clamp(channel.outBlack, 0, 255);
  const outWhite = clamp(channel.outWhite, 0, 255);
  const gamma = clamp(channel.gamma, 0.1, 10);

  const x = clamp(input, 0, 255);
  const norm = (x - inBlack) / (inWhite - inBlack);
  const clamped = norm < 0 ? 0 : norm > 1 ? 1 : norm;
  const gammaed = Math.pow(clamped, 1 / gamma);
  const y = outBlack + gammaed * (outWhite - outBlack);
  return Math.round(clamp(y, 0, 255));
}

/** Build a 256-entry [0,255] LUT for one Levels channel. */
export function buildLevelsLUT(channel: LevelsChannel): Uint8Array {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = evaluateLevels(channel, i);
  }
  return lut;
}

/**
 * Pack the four per-channel LUTs into the 256×1 RGBA texture the GPU
 * shader samples. Layout mirrors the Curves LUT: R=red, G=green, B=blue,
 * A=master. The shader applies master first to every channel, then
 * per-channel.
 */
export function buildLevelsLutRgba(levels: Levels): Uint8Array {
  const r = buildLevelsLUT(levels.r);
  const g = buildLevelsLUT(levels.g);
  const b = buildLevelsLUT(levels.b);
  const rgb = buildLevelsLUT(levels.rgb);
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    out[i * 4] = r[i]!;
    out[i * 4 + 1] = g[i]!;
    out[i * 4 + 2] = b[i]!;
    out[i * 4 + 3] = rgb[i]!;
  }
  return out;
}

/**
 * Apply Levels to RGBA pixel data in place. Mirrors the shader so the
 * JS-based export path produces the same result as the GPU composite.
 */
export function applyLevelsToImageData(data: Uint8ClampedArray, levels: Levels): void {
  if (isIdentityLevels(levels)) return;
  const lutR = buildLevelsLUT(levels.r);
  const lutG = buildLevelsLUT(levels.g);
  const lutB = buildLevelsLUT(levels.b);
  const lutMaster = buildLevelsLUT(levels.rgb);
  for (let i = 0; i < data.length; i += 4) {
    const r = lutMaster[data[i]!]!;
    const g = lutMaster[data[i + 1]!]!;
    const b = lutMaster[data[i + 2]!]!;
    data[i] = lutR[r]!;
    data[i + 1] = lutG[g]!;
    data[i + 2] = lutB[b]!;
  }
}

/** Re-export the curve channel type so callers don't import from two files. */
export type LevelsChannelKey = CurveChannel;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
