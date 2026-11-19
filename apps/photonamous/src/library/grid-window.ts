/**
 * Windowing maths for the photo grid. The grid is a list of rows of equal
 * height; only the rows inside the viewport (plus some overscan) are
 * rendered, so the cost stays the same for 50 photos or 50,000.
 */

export interface GridGeometryInput {
  /** Inner width available for tiles, in px. */
  readonly width: number;
  /** The size the user asked for with the slider, in px. */
  readonly targetSize: number;
  readonly gap: number;
  readonly itemCount: number;
}

export interface GridGeometry {
  readonly columns: number;
  /** Actual tile edge after stretching to fill the width. */
  readonly tileSize: number;
  /** Tile plus gap. */
  readonly rowHeight: number;
  readonly rowCount: number;
  readonly totalHeight: number;
}

export function gridGeometry({ width, targetSize, gap, itemCount }: GridGeometryInput): GridGeometry {
  const usable = Math.max(0, width);
  const size = Math.max(1, targetSize);
  const columns = Math.max(1, Math.floor((usable + gap) / (size + gap)));
  const tileSize = Math.max(1, (usable - gap * (columns - 1)) / columns);
  const rowHeight = tileSize + gap;
  const rowCount = Math.ceil(Math.max(0, itemCount) / columns);
  const totalHeight = rowCount === 0 ? 0 : rowCount * rowHeight - gap;
  return { columns, tileSize, rowHeight, rowCount, totalHeight };
}

export interface VisibleRange {
  /** First and last row to render, inclusive; lastRow < firstRow when empty. */
  readonly firstRow: number;
  readonly lastRow: number;
  /** Item indices covered, end exclusive. */
  readonly startIndex: number;
  readonly endIndex: number;
}

export function visibleRange(
  geometry: GridGeometry,
  itemCount: number,
  scrollTop: number,
  viewportHeight: number,
  overscanRows = 2,
): VisibleRange {
  if (geometry.rowCount === 0 || viewportHeight <= 0) {
    return { firstRow: 0, lastRow: -1, startIndex: 0, endIndex: 0 };
  }
  const top = Math.max(0, scrollTop);
  const first = Math.floor(top / geometry.rowHeight);
  const last = Math.floor((top + viewportHeight) / geometry.rowHeight);
  const firstRow = Math.max(0, Math.min(geometry.rowCount - 1, first - overscanRows));
  const lastRow = Math.max(firstRow, Math.min(geometry.rowCount - 1, last + overscanRows));
  return {
    firstRow,
    lastRow,
    startIndex: firstRow * geometry.columns,
    endIndex: Math.min(itemCount, (lastRow + 1) * geometry.columns),
  };
}

/**
 * The scroll position that brings `index` into view, or null when it is
 * already fully visible.
 */
export function scrollToReveal(
  geometry: GridGeometry,
  index: number,
  scrollTop: number,
  viewportHeight: number,
): number | null {
  if (index < 0) return null;
  const row = Math.floor(index / geometry.columns);
  const rowTop = row * geometry.rowHeight;
  const rowBottom = rowTop + geometry.tileSize;
  if (rowTop < scrollTop) return rowTop;
  if (rowBottom > scrollTop + viewportHeight) return Math.max(0, rowBottom - viewportHeight);
  return null;
}

/** Keeps the same item at the top of the viewport when the tile size changes. */
export function anchorScroll(before: GridGeometry, after: GridGeometry, scrollTop: number): number {
  const firstIndex = Math.floor(scrollTop / before.rowHeight) * before.columns;
  return Math.floor(firstIndex / after.columns) * after.rowHeight;
}
