/**
 * Fractional snap positions for guides. When the user holds Cmd while
 * dragging a guide out of the ruler, the guide's position is quantized
 * to reasonable layout fractions of the document dimension — the ones a
 * designer would actually use to line things up (halves, quarters,
 * eighths, sixteenths) plus thirds and sixths. Deliberately does NOT
 * include fifths, sevenths, ninths, elevenths, thirteenths — those never
 * come up in real layout and would compete with the useful fractions.
 */

const RATIONAL_DENOMINATORS = [2, 3, 4, 6, 8, 16] as const;

export interface Fraction {
  readonly num: number;
  readonly den: number;
  readonly value: number;
}

function gcd(a: number, b: number): number {
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

function buildFractions(): readonly Fraction[] {
  const seen = new Set<number>();
  const list: Fraction[] = [];
  const push = (num: number, den: number): void => {
    const v = num / den;
    if (seen.has(v)) return;
    seen.add(v);
    list.push({ num, den, value: v });
  };
  push(0, 1);
  push(1, 1);
  for (const d of RATIONAL_DENOMINATORS) {
    for (let n = 1; n < d; n++) {
      if (gcd(n, d) === 1) push(n, d);
    }
  }
  return list.sort((a, b) => a.value - b.value);
}

const FRACTIONS_TABLE = buildFractions();
const FRACTIONS = FRACTIONS_TABLE.map((f) => f.value);

/**
 * Snap `position` to the nearest fractional multiple of `docSize`. Uses
 * reduced fractions up to 1/16 plus thirds — i.e. the same set every
 * layout guide reaches for. Returns the snapped integer position.
 */
export function snapGuideToFraction(position: number, docSize: number): number {
  if (docSize <= 0) return Math.round(position);
  const t = position / docSize;
  let best = FRACTIONS[0]!;
  let bestDist = Math.abs(t - best);
  for (const f of FRACTIONS) {
    const d = Math.abs(t - f);
    if (d < bestDist) {
      bestDist = d;
      best = f;
    }
  }
  return Math.round(best * docSize);
}

/**
 * Format a ruler-position label as a nice fraction of the document
 * dimension (e.g. "1/2", "1/3", "3/8") when the position aligns with
 * one of the snap fractions. Falls back to `null` if no fraction is
 * close enough, so callers can render the pixel value instead.
 *
 * The 0.5-pixel tolerance covers rounding from `snapGuideToFraction`.
 * Uses `1/1` for the far edge to match the `0/1` label at the origin.
 */
export function formatFractionLabel(position: number, docSize: number): string | null {
  if (docSize <= 0) return null;
  for (const f of FRACTIONS_TABLE) {
    if (Math.abs(position - f.value * docSize) <= 0.5) {
      return `${f.num}/${f.den}`;
    }
  }
  return null;
}

export const _GUIDE_SNAP_FRACTIONS_FOR_TEST = FRACTIONS;
