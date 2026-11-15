import type { PlacedGlyphBox } from './path-text-geometry';

/**
 * Glyph boxes of each path-bound text layer's last render, relative to its
 * texture's top-left (which sits at the layer's `x` / `y`), so a moved layer
 * keeps its hit area without re-rendering.
 */
const boxesByLayer = new Map<string, readonly PlacedGlyphBox[]>();

export function setPathTextGlyphBoxes(layerId: string, boxes: readonly PlacedGlyphBox[]): void {
  boxesByLayer.set(layerId, boxes);
}

export function clearPathTextGlyphBoxes(layerId: string): void {
  boxesByLayer.delete(layerId);
}

export function getPathTextGlyphBoxes(layerId: string): readonly PlacedGlyphBox[] | null {
  return boxesByLayer.get(layerId) ?? null;
}
