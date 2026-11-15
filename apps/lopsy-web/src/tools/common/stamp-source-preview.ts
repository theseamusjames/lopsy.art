import type { Point } from '../../types';

/** The Clone Stamp / Healing Brush source state the preview is drawn from. */
export interface StampSource {
  readonly source: Point | null;
  readonly offset: Point | null;
}

/**
 * The source preview disc the engine draws: inside `radius` document px of
 * `cursor`, the active layer as it is around `source`.
 */
export interface StampPreviewDisc {
  readonly layerId: string;
  readonly cursor: Point;
  readonly source: Point;
  readonly radius: number;
}

export interface StampPreviewInput {
  readonly isStampTool: boolean;
  readonly activeLayerId: string | null;
  readonly isCursorOnCanvas: boolean;
  readonly cursor: Point;
  readonly brushSize: number;
  readonly stamp: StampSource;
}

/**
 * Where the stamp samples for a dab at `cursor`: the fixed offset once a
 * stroke has set it, otherwise the Alt-clicked point itself. `null` while
 * no source is set.
 */
export function stampSourceCenter(stamp: StampSource, cursor: Point): Point | null {
  if (!stamp.source) return null;
  if (!stamp.offset) return stamp.source;
  return { x: cursor.x + stamp.offset.x, y: cursor.y + stamp.offset.y };
}

/**
 * The preview to show, or `null` when there is nothing to preview: another
 * tool, no active layer, the cursor off the canvas, or no source yet.
 */
export function stampPreviewDisc(input: StampPreviewInput): StampPreviewDisc | null {
  if (!input.isStampTool || input.activeLayerId === null || !input.isCursorOnCanvas) return null;
  const source = stampSourceCenter(input.stamp, input.cursor);
  if (!source) return null;
  return {
    layerId: input.activeLayerId,
    cursor: input.cursor,
    source,
    radius: input.brushSize / 2,
  };
}
