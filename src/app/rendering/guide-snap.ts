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

function gcd(a: number, b: number): number {
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

function buildFractions(): readonly number[] {
  const set = new Set<number>();
  set.add(0);
  set.add(1);
  for (const d of RATIONAL_DENOMINATORS) {
    for (let n = 1; n < d; n++) {
      if (gcd(n, d) === 1) {
        set.add(n / d);
      }
    }
  }
  return [...set].sort((a, b) => a - b);
}

const FRACTIONS = buildFractions();

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

export const _GUIDE_SNAP_FRACTIONS_FOR_TEST = FRACTIONS;
