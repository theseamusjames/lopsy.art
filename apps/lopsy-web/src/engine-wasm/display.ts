/**
 * What the display the window is on can show, as the browser reports it:
 * its gamut (`(color-gamut: p3)`) and whether it has high dynamic range
 * (`(dynamic-range: high)`). Both are watched, so moving the window to
 * another display is noticed. This asks the display, not the canvas:
 * `color-space.ts` checks only that the browser accepts a P3 canvas.
 *
 * Photonamous uses it for its canvas and status bar; it has no DOM or
 * engine of its own, so either app can.
 */

export interface DisplayInfo {
  /** The display covers Display P3. */
  readonly isDisplayP3: boolean;
  /** The display reports high dynamic range. */
  readonly isHdr: boolean;
}

export const SRGB_DISPLAY: DisplayInfo = { isDisplayP3: false, isHdr: false };

export const P3_GAMUT_QUERY = '(color-gamut: p3)';
export const HDR_RANGE_QUERY = '(dynamic-range: high)';

/** The part of `MediaQueryList` this module uses. */
export interface MediaQuery {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}

export type MatchMedia = (query: string) => MediaQuery;

function browserMatchMedia(): MatchMedia | null {
  return typeof matchMedia === 'function' ? (query) => matchMedia(query) : null;
}

/** The display now; sRGB and not HDR where the browser cannot say. */
export function readDisplay(match: MatchMedia | null = browserMatchMedia()): DisplayInfo {
  if (!match) return SRGB_DISPLAY;
  return { isDisplayP3: match(P3_GAMUT_QUERY).matches, isHdr: match(HDR_RANGE_QUERY).matches };
}

export function sameDisplay(a: DisplayInfo, b: DisplayInfo): boolean {
  return a.isDisplayP3 === b.isDisplayP3 && a.isHdr === b.isHdr;
}

/**
 * Calls `listener` with the display each time either query's answer
 * changes (not at once). Returns the unsubscribe.
 */
export function watchDisplay(listener: (display: DisplayInfo) => void, match: MatchMedia | null = browserMatchMedia()): () => void {
  if (!match) return () => undefined;
  const queries = [match(P3_GAMUT_QUERY), match(HDR_RANGE_QUERY)];
  let last = readDisplay(match);
  const onChange = (): void => {
    const next = readDisplay(match);
    if (sameDisplay(next, last)) return;
    last = next;
    listener(next);
  };
  for (const query of queries) query.addEventListener('change', onChange);
  return () => {
    for (const query of queries) query.removeEventListener('change', onChange);
  };
}
