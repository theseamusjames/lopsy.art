/**
 * The most recent selection built from a layer's alpha (⌘-click on its
 * thumbnail), identified by its mask array: every later selection change
 * installs a new array. A document-sized mask cannot hold the part of a layer
 * past the canvas edge, so a move or transform of this selection lifts the
 * whole layer instead (#994, #1605).
 */
let layerAlphaSelection: { layerId: string; mask: Uint8ClampedArray } | null = null;

export function recordLayerAlphaSelection(layerId: string, mask: Uint8ClampedArray): void {
  layerAlphaSelection = { layerId, mask };
}

/** Whether `mask` is still the alpha selection made for `layerId`. */
export function isLayerAlphaSelection(layerId: string, mask: Uint8ClampedArray): boolean {
  return layerAlphaSelection !== null
    && layerAlphaSelection.layerId === layerId
    && layerAlphaSelection.mask === mask;
}

/**
 * Stop treating the recorded mask as "the whole layer". A tool that writes
 * pixels can put some outside the mask while the mask array stays the same;
 * lifting the whole layer afterwards would drag those unselected pixels
 * along with the selection.
 */
export function forgetLayerAlphaSelection(): void {
  layerAlphaSelection = null;
}
