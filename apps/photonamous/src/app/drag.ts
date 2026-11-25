/** Dragging photos from the grid onto an album. */

/** The drag type tiles use to carry grid item ids (`assetId` or `assetId#versionId`). */
export const ASSET_DRAG_TYPE = 'application/x-lopsy-assets';

export function writeDraggedIds(data: DataTransfer, ids: readonly string[]): void {
  data.setData(ASSET_DRAG_TYPE, JSON.stringify(ids));
  data.effectAllowed = 'copy';
}

export function readDraggedIds(data: DataTransfer): string[] {
  const raw = data.getData(ASSET_DRAG_TYPE);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
