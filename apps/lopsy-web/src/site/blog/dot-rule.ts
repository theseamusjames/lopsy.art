/** Gaps in the dense run, which fills about the first quarter of the rule. */
const DENSE_GAPS = 85;
/**
 * The dense run's first gap as a fraction of its last. Small enough that the
 * first dots overlap into a solid line before they break apart.
 */
const DENSE_START = 0.125;
/** Gaps after it, each this much wider than the last, ending ~11× the dense run's widest. */
const SPREAD_GAPS = 24;
const SPREAD_RATIO = 1.106;

/** Gaps between neighbouring dots, left to right, in arbitrary units. */
function dotGaps(): number[] {
  // Quadratic, so the line stays solid for a while before the gaps open up.
  const dense = Array.from(
    { length: DENSE_GAPS },
    (_, i) => 2 * (DENSE_START + (1 - DENSE_START) * (i / (DENSE_GAPS - 1)) ** 2),
  );
  const spread = Array.from({ length: SPREAD_GAPS }, (_, i) => 2 * SPREAD_RATIO ** (i + 1));
  return [...dense, ...spread];
}

/**
 * A rule of dots that starts as a solid line, breaks apart across the first
 * quarter, then spreads further apart toward the right. Positions are percentages so the dots stay round
 * at any width.
 */
export function renderDotRule(): string {
  const gaps = dotGaps();
  const total = gaps.reduce((sum, gap) => sum + gap, 0);
  let x = 0;
  const positions = [0, ...gaps.map((gap) => (x += gap) / total * 100)];
  const dots = positions.map((pct) => `<circle cx="${pct.toFixed(3)}%" cy="3" r="1.5"/>`);
  return `<svg class="dot-rule" width="100%" height="6" aria-hidden="true" focusable="false">${dots.join('')}</svg>`;
}
