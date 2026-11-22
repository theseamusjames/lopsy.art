/**
 * The histogram above the controls: the engine's 4 × 256 bins
 * (`readDevelopHistogram`: red, green, blue, luminance of the displayed
 * result) turned into SVG paths and clipping figures. Only counts are
 * handled here, never pixels.
 */

export const BINS = 256;

export interface Histogram {
  readonly red: readonly number[];
  readonly green: readonly number[];
  readonly blue: readonly number[];
  readonly luminance: readonly number[];
  /** Pixels counted (per channel). */
  readonly total: number;
}

export interface Clipping {
  /** Largest share of any channel in the bottom bin, 0..1. */
  readonly shadows: number;
  /** Largest share of any channel in the top bin, 0..1. */
  readonly highlights: number;
}

/** Share of a channel's pixels at an end bin above which that end counts as clipping. */
export const CLIP_THRESHOLD = 0.002;

export function parseHistogram(bins: ArrayLike<number>): Histogram | null {
  if (bins.length !== BINS * 4) return null;
  const channel = (i: number) => Array.from({ length: BINS }, (_, k) => bins[i * BINS + k] ?? 0);
  const luminance = channel(3);
  const total = luminance.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  return { red: channel(0), green: channel(1), blue: channel(2), luminance, total };
}

/**
 * A closed area path for one channel in a `width`×`height` box. Heights are
 * square-rooted so faint tones still show, and scaled to the tallest inner
 * bin: a spike of clipped pixels at either end would flatten the rest.
 */
export function histogramPath(counts: readonly number[], width: number, height: number, scaleMax?: number): string {
  if (counts.length < 2) return '';
  const max = scaleMax ?? innerMax(counts);
  const scale = max > 0 ? 1 / Math.sqrt(max) : 0;
  const step = width / (counts.length - 1);
  const fmt = (v: number) => Number(v.toFixed(2)).toString();
  const points = counts.map((c, i) => {
    const y = height - Math.min(1, Math.sqrt(c) * scale) * height;
    return `L${fmt(i * step)},${fmt(y)}`;
  });
  return `M0,${fmt(height)}${points.join('')}L${fmt(width)},${fmt(height)}Z`;
}

/** The tallest bin, leaving out the two end bins. */
export function innerMax(counts: readonly number[]): number {
  let max = 0;
  for (let i = 1; i < counts.length - 1; i++) max = Math.max(max, counts[i] ?? 0);
  return max > 0 ? max : Math.max(0, ...counts);
}

/** One scale for all channels, so they can be compared. */
export function sharedMax(h: Histogram): number {
  return Math.max(innerMax(h.red), innerMax(h.green), innerMax(h.blue), innerMax(h.luminance));
}

export function clipping(h: Histogram): Clipping {
  const share = (c: readonly number[], i: number) => (c[i] ?? 0) / h.total;
  const channels = [h.red, h.green, h.blue];
  return {
    shadows: Math.max(...channels.map((c) => share(c, 0))),
    highlights: Math.max(...channels.map((c) => share(c, BINS - 1))),
  };
}

export function isClipped(share: number): boolean {
  return share > CLIP_THRESHOLD;
}

/** '0.4 %' for the indicator's title. */
export function formatShare(share: number): string {
  const pct = share * 100;
  return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)} %`;
}

/** The tooltip of a clipping toggle: how much of the photo clips at that end, and what a click shows. */
export function clippingTitle(side: keyof Clipping, share: number): string {
  return side === 'shadows'
    ? `Shadows at black: ${formatShare(share)}. Click to show them in blue (J).`
    : `Highlights at white: ${formatShare(share)}. Click to show them in red (J).`;
}

export interface ToneShares {
  /** Share of the luminance in the darkest third of the range, 0..1. */
  readonly dark: number;
  readonly middle: number;
  readonly bright: number;
}

export function toneShares(h: Histogram): ToneShares {
  const third = BINS / 3;
  let dark = 0;
  let middle = 0;
  let bright = 0;
  h.luminance.forEach((count, i) => {
    if (i < third) dark += count;
    else if (i < 2 * third) middle += count;
    else bright += count;
  });
  return { dark: dark / h.total, middle: middle / h.total, bright: bright / h.total };
}

/** The histogram in words, for its text alternative: where the tones lie and how much clips. */
export function describeHistogram(h: Histogram | null): string {
  if (!h) return 'Histogram, not read yet';
  const tones = toneShares(h);
  const clip = clipping(h);
  const pct = (share: number) => `${Math.round(share * 100)} %`;
  return (
    `Histogram: ${pct(tones.dark)} of the tones dark, ${pct(tones.middle)} in the middle, ${pct(tones.bright)} bright; ` +
    `${formatShare(clip.shadows)} at black, ${formatShare(clip.highlights)} at white.`
  );
}
