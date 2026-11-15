/**
 * Levels adjustment — per-channel input/output black/white + gamma remapping.
 *
 * Standard Levels:
 *   1. Clip: values <= inputBlack -> 0, values >= inputWhite -> 1
 *   2. Gamma: v = ((v - inputBlack) / (inputWhite - inputBlack)) ^ (1/gamma)
 *   3. Output scale: v = v * (outputWhite - outputBlack) + outputBlack
 *   4. Clamp to [0, 1]
 */

export interface LevelsChannel {
  inputBlack: number;   // 0..1
  inputWhite: number;   // 0..1
  gamma: number;        // 0.01..10
  outputBlack: number;  // 0..1
  outputWhite: number;  // 0..1
}

export interface Levels {
  rgb: LevelsChannel;
  r: LevelsChannel;
  g: LevelsChannel;
  b: LevelsChannel;
}

export const IDENTITY_CHANNEL: LevelsChannel = {
  inputBlack: 0,
  inputWhite: 1,
  gamma: 1,
  outputBlack: 0,
  outputWhite: 1,
};

export const IDENTITY_LEVELS: Levels = {
  rgb: IDENTITY_CHANNEL,
  r: IDENTITY_CHANNEL,
  g: IDENTITY_CHANNEL,
  b: IDENTITY_CHANNEL,
};

export function isIdentityChannel(ch: LevelsChannel): boolean {
  return ch.inputBlack === 0 && ch.inputWhite === 1 && ch.gamma === 1 && ch.outputBlack === 0 && ch.outputWhite === 1;
}

export function isIdentityLevels(levels: Levels | undefined | null): boolean {
  if (!levels) return true;
  return isIdentityChannel(levels.rgb)
    && isIdentityChannel(levels.r)
    && isIdentityChannel(levels.g)
    && isIdentityChannel(levels.b);
}

/** Build a 256-entry [0,255] LUT for a single LevelsChannel. */
export function buildLevelsLut(ch: LevelsChannel): Uint8Array {
  const lut = new Uint8Array(256);
  const { inputBlack, inputWhite, gamma, outputBlack, outputWhite } = ch;
  const range = inputWhite - inputBlack;

  // Early exit for identity (fast path for the common case).
  if (isIdentityChannel(ch)) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }

  for (let i = 0; i < 256; i++) {
    let v = i / 255;

    // Clip darks
    if (v <= inputBlack) {
      v = 0;
    } else if (v >= inputWhite) {
      v = 1;
    } else {
      // Normalize to [0,1], apply gamma
      v = ((v - inputBlack) / range) ** (1 / gamma);
      // Output scale
      v = v * (outputWhite - outputBlack) + outputBlack;
    }

    lut[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }

  return lut;
}

/**
 * Pack the four per-channel LUTs into the 256x1 RGBA texture the GPU
 * shader samples. Layout: R=red curve, G=green curve, B=blue curve,
 * A=master RGB curve.
 */
export function buildLevelsLutRgba(levels: Levels): Uint8Array {
  const r = buildLevelsLut(levels.r);
  const g = buildLevelsLut(levels.g);
  const b = buildLevelsLut(levels.b);
  const rgb = buildLevelsLut(levels.rgb);
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
 * Apply the four LUTs to RGBA data in place. Mirrors the shader so the
 * export path matches the live preview. Master runs first on every channel,
 * then per-channel curves remap their own value.
 */
export function applyLevelsToImageData(data: Uint8ClampedArray, levels: Levels): void {
  if (isIdentityLevels(levels)) return;
  const lutR = buildLevelsLut(levels.r);
  const lutG = buildLevelsLut(levels.g);
  const lutB = buildLevelsLut(levels.b);
  const lutMaster = buildLevelsLut(levels.rgb);
  for (let i = 0; i < data.length; i += 4) {
    const r = lutMaster[data[i]!]!;
    const g = lutMaster[data[i + 1]!]!;
    const b = lutMaster[data[i + 2]!]!;
    data[i] = lutR[r]!;
    data[i + 1] = lutG[g]!;
    data[i + 2] = lutB[b]!;
  }
}
