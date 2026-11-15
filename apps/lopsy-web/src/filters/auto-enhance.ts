/**
 * Auto-enhance algorithms: Auto Tone, Auto Contrast, Auto Color.
 *
 * Each function analyzes pixel data and returns adjustment parameters
 * that can be applied as non-destructive Levels or Curves nodes.
 */

import type { Levels, LevelsChannel } from './levels';
import { IDENTITY_CHANNEL } from './levels';
import type { Curves, CurvePoint } from './curves';
import { IDENTITY_POINTS } from './curves';

interface ChannelHistogram {
  readonly counts: Uint32Array; // 256 bins
  readonly cdf: Float64Array;  // normalized cumulative distribution [0..1]
  readonly totalPixels: number;
}

interface RgbHistograms {
  readonly r: ChannelHistogram;
  readonly g: ChannelHistogram;
  readonly b: ChannelHistogram;
  readonly lum: ChannelHistogram;
}

const CLIP_PERCENT = 0.1;

export function computeHistograms(data: Uint8ClampedArray): RgbHistograms {
  const rCounts = new Uint32Array(256);
  const gCounts = new Uint32Array(256);
  const bCounts = new Uint32Array(256);
  const lumCounts = new Uint32Array(256);
  let total = 0;

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] as number;
    if (a === 0) continue;

    const r = data[i] as number;
    const g = data[i + 1] as number;
    const b = data[i + 2] as number;
    rCounts[r] = (rCounts[r] ?? 0) + 1;
    gCounts[g] = (gCounts[g] ?? 0) + 1;
    bCounts[b] = (bCounts[b] ?? 0) + 1;

    const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    lumCounts[lum] = (lumCounts[lum] ?? 0) + 1;
    total++;
  }

  return {
    r: buildChannelHistogram(rCounts, total),
    g: buildChannelHistogram(gCounts, total),
    b: buildChannelHistogram(bCounts, total),
    lum: buildChannelHistogram(lumCounts, total),
  };
}

function buildChannelHistogram(counts: Uint32Array, totalPixels: number): ChannelHistogram {
  const cdf = new Float64Array(256);
  let cumulative = 0;
  const invTotal = totalPixels > 0 ? 1 / totalPixels : 0;
  for (let i = 0; i < 256; i++) {
    cumulative += counts[i]!;
    cdf[i] = cumulative * invTotal;
  }
  return { counts, cdf, totalPixels };
}

function findClipPoints(hist: ChannelHistogram, clipPercent: number): { black: number; white: number } {
  const clipFraction = clipPercent / 100;
  let black = 0;
  let white = 255;

  for (let i = 0; i < 256; i++) {
    if (hist.cdf[i]! >= clipFraction) {
      black = i;
      break;
    }
  }

  for (let i = 255; i >= 0; i--) {
    if (hist.cdf[i]! <= 1 - clipFraction) {
      white = i;
      break;
    }
  }

  if (black >= white) {
    black = 0;
    white = 255;
  }

  return { black, white };
}

function channelLevelsFromClip(black: number, white: number): LevelsChannel {
  return {
    inputBlack: black / 255,
    inputWhite: white / 255,
    gamma: 1,
    outputBlack: 0,
    outputWhite: 1,
  };
}

/**
 * Auto Tone: stretches each R/G/B channel independently to fill [0..255].
 * Clips the darkest and brightest 0.1% of pixels per channel.
 * Returns Levels with per-channel input black/white points.
 */
export function computeAutoTone(data: Uint8ClampedArray): Levels {
  const hist = computeHistograms(data);

  const rClip = findClipPoints(hist.r, CLIP_PERCENT);
  const gClip = findClipPoints(hist.g, CLIP_PERCENT);
  const bClip = findClipPoints(hist.b, CLIP_PERCENT);

  return {
    rgb: { ...IDENTITY_CHANNEL },
    r: channelLevelsFromClip(rClip.black, rClip.white),
    g: channelLevelsFromClip(gClip.black, gClip.white),
    b: channelLevelsFromClip(bClip.black, bClip.white),
  };
}

/**
 * Auto Contrast: stretches the luminance histogram uniformly across all channels.
 * Same clipping logic but applied to the master RGB channel only,
 * preserving relative color balance.
 */
export function computeAutoContrast(data: Uint8ClampedArray): Levels {
  const hist = computeHistograms(data);

  const lumClip = findClipPoints(hist.lum, CLIP_PERCENT);

  return {
    rgb: channelLevelsFromClip(lumClip.black, lumClip.white),
    r: { ...IDENTITY_CHANNEL },
    g: { ...IDENTITY_CHANNEL },
    b: { ...IDENTITY_CHANNEL },
  };
}

/**
 * Auto Color: neutralizes color casts by mapping each channel's mean
 * to a neutral gray target, then stretching the tonal range.
 * Returns per-channel Curves that shift the midpoint.
 */
export function computeAutoColor(data: Uint8ClampedArray): Curves {
  const hist = computeHistograms(data);

  const rMean = computeWeightedMean(hist.r);
  const gMean = computeWeightedMean(hist.g);
  const bMean = computeWeightedMean(hist.b);

  const targetMean = (rMean + gMean + bMean) / 3;

  const rClip = findClipPoints(hist.r, CLIP_PERCENT);
  const gClip = findClipPoints(hist.g, CLIP_PERCENT);
  const bClip = findClipPoints(hist.b, CLIP_PERCENT);

  return {
    rgb: [...IDENTITY_POINTS],
    r: buildColorCorrectionCurve(rClip.black, rClip.white, rMean, targetMean),
    g: buildColorCorrectionCurve(gClip.black, gClip.white, gMean, targetMean),
    b: buildColorCorrectionCurve(bClip.black, bClip.white, bMean, targetMean),
  };
}

function computeWeightedMean(hist: ChannelHistogram): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < 256; i++) {
    sum += i * hist.counts[i]!;
    count += hist.counts[i]!;
  }
  return count > 0 ? sum / count : 128;
}

function buildColorCorrectionCurve(
  black: number,
  white: number,
  channelMean: number,
  targetMean: number,
): CurvePoint[] {
  const inBlack = black / 255;
  const inWhite = white / 255;

  if (inWhite - inBlack < 0.01) {
    return [...IDENTITY_POINTS];
  }

  const normalizedMean = (channelMean / 255 - inBlack) / (inWhite - inBlack);
  const normalizedTarget = (targetMean / 255 - inBlack) / (inWhite - inBlack);

  const midX = clamp01(normalizedMean);
  const midY = clamp01(normalizedTarget);

  const points: CurvePoint[] = [
    { x: 0, y: 0 },
  ];

  if (Math.abs(midX - midY) > 0.005 && midX > 0.05 && midX < 0.95) {
    points.push({ x: midX, y: midY });
  }

  points.push({ x: 1, y: 1 });

  return points;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
