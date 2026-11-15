/**
 * Zoom stops used by Zoom In / Zoom Out, matching Photoshop's sequence. Landing
 * on exact ratios (50%, 200%, …) keeps every document pixel the same size on
 * screen, which fractional zooms from repeated multiplication never do.
 */
export const ZOOM_LEVELS: readonly number[] = [
  0.01, 0.02, 0.03, 0.04, 0.05, 0.0625, 0.0833, 0.125, 0.1667,
  0.25, 0.3333, 0.5, 0.6667, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 24, 32, 48, 64,
];

// Absorbs float noise so a zoom of 0.49999 counts as already being on 50%.
const EPSILON = 1e-3;

export function nextZoomLevel(zoom: number, direction: 'in' | 'out'): number {
  const minZoom = ZOOM_LEVELS[0] ?? zoom;
  const maxZoom = ZOOM_LEVELS[ZOOM_LEVELS.length - 1] ?? zoom;
  if (direction === 'in') {
    return ZOOM_LEVELS.find((level) => level > zoom * (1 + EPSILON)) ?? maxZoom;
  }
  return [...ZOOM_LEVELS].reverse().find((level) => level < zoom * (1 - EPSILON)) ?? minZoom;
}
