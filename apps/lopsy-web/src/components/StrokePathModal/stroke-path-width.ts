/** The Stroke Path dialog's width limits, in pixels. */
export const MIN_STROKE_PATH_WIDTH = 1;
export const MAX_STROKE_PATH_WIDTH = 50;

/** The width the dialog strokes with: rounded, then clamped to its limits. */
export function clampStrokePathWidth(width: number): number {
  return Math.max(MIN_STROKE_PATH_WIDTH, Math.min(MAX_STROKE_PATH_WIDTH, Math.round(width)));
}
