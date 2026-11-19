/**
 * How much GPU work the Edit view asks for, counted for tests and for
 * measuring: engine renders by what they were for, histogram reads, and
 * the JPEGs encoded for stored previews. In development builds the counts
 * sit on `window.__lopsyRenderCounts`, where e2e tests read and reset them.
 */
export interface RenderCounts {
  /** Renders of the live view (one per animation frame at most). */
  screen: number;
  /** Renders made only to read the histogram. */
  histogram: number;
  /** Renders into a resized canvas for an export or a preview. */
  offscreen: number;
  /** Renders of the live view straight after an offscreen one. */
  restore: number;
  /** Renders before a 16-bit readback (PNG, TIFF). */
  readback: number;
  histogramReads: number;
  previewEncodes: number;
}

export type RenderKind = 'screen' | 'histogram' | 'offscreen' | 'restore' | 'readback';

export function emptyCounts(): RenderCounts {
  return { screen: 0, histogram: 0, offscreen: 0, restore: 0, readback: 0, histogramReads: 0, previewEncodes: 0 };
}

export const renderCounts: RenderCounts = emptyCounts();

/** Zeroes every count in place (the window's reference stays valid). */
export function resetRenderCounts(counts: RenderCounts = renderCounts): void {
  Object.assign(counts, emptyCounts());
}

declare global {
  interface Window {
    __lopsyRenderCounts?: RenderCounts;
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') window.__lopsyRenderCounts = renderCounts;
