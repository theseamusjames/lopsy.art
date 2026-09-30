import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { clearJsPixelData } from '../../app/store/clear-js-pixel-data';
import { selectionBounds } from '../../selection/selection';
import { createTransformState } from '../../tools/transform/transform';
import { getEngine } from '../../engine-wasm/engine-state';
import { hasFloat, dropFloat } from '../../engine-wasm/wasm-bridge';
import { schedulePrefloat } from '../../app/interactions/prefloat';
import { getMaskDocOrigin } from '../../layers/mask-origin';

/**
 * The most recent selection built from a layer's alpha, identified by its
 * mask array (every later selection change installs a new array). A
 * document-sized mask cannot hold the part of a layer past the canvas edge,
 * so a transform of this selection lifts the whole layer instead (#994).
 */
let layerAlphaSelection: { layerId: string; mask: Uint8ClampedArray } | null = null;

/** Whether `mask` is still the alpha selection `selectLayerAlpha` made for `layerId`. */
export function isLayerAlphaSelection(layerId: string, mask: Uint8ClampedArray): boolean {
  return layerAlphaSelection !== null
    && layerAlphaSelection.layerId === layerId
    && layerAlphaSelection.mask === mask;
}

export function selectLayerAlpha(layerId: string): void {
  // Commit any active GPU float so the layer texture has the final pixels
  const engine = getEngine();
  if (engine && hasFloat(engine)) {
    dropFloat(engine);
  }

  clearJsPixelData(layerId);

  const editorState = useEditorStore.getState();
  const layer = editorState.document.layers.find((l) => l.id === layerId);
  if (!layer) return;
  const pixelData = editorState.resolvePixelData(layerId);
  if (!pixelData) return;

  const { width: docW, height: docH } = editorState.document;
  const selMask = new Uint8ClampedArray(docW * docH);
  for (let y = 0; y < pixelData.height; y++) {
    for (let x = 0; x < pixelData.width; x++) {
      const alpha = pixelData.data[(y * pixelData.width + x) * 4 + 3] ?? 0;
      if (alpha < 1) continue;
      const docX = x + layer.x;
      const docY = y + layer.y;
      if (docX >= 0 && docX < docW && docY >= 0 && docY < docH) {
        selMask[docY * docW + docX] = alpha;
      }
    }
  }
  const bounds = selectionBounds(selMask, docW, docH);
  if (bounds) {
    editorState.setSelection(bounds, selMask, docW, docH);
    layerAlphaSelection = { layerId, mask: selMask };
    useUIStore.getState().setTransform(createTransformState(bounds));
    // Prefloat runs ensure_layer_full_size on the engine, which re-origins
    // the layer to (0,0). For text layers that destroys the anchor
    // invariant in rerenderCommittedTextLayerAnchored — the next text-tool
    // click in empty space then edits the "moved" text at the top-left of
    // the canvas. Same broken invariant as #767 (Brush pre-warm); this is
    // the alpha-thumbnail-click entry point (#785).
    // Only the active layer can be moved, so a prefloat of another layer
    // is never used — and a live float on it made Delete clear the whole
    // active layer (#801, #1055).
    if (layer.type !== 'text' && layerId === editorState.document.activeLayerId) {
      schedulePrefloat(layerId, selMask, bounds);
    }
  }
}

export function convertMaskToMarquee(layerId: string): void {
  const editorState = useEditorStore.getState();
  const layer = editorState.document.layers.find((l) => l.id === layerId);
  if (!layer?.mask) return;
  const { mask } = layer;
  const { width: docW, height: docH } = editorState.document;
  const origin = getMaskDocOrigin(layer);
  const selMask = new Uint8ClampedArray(docW * docH);
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const docX = x + origin.x;
      const docY = y + origin.y;
      if (docX >= 0 && docX < docW && docY >= 0 && docY < docH) {
        selMask[docY * docW + docX] = 255 - (mask.data[y * mask.width + x] ?? 0);
      }
    }
  }
  const bounds = selectionBounds(selMask, docW, docH);
  if (bounds) {
    editorState.setSelection(bounds, selMask, docW, docH);
    useUIStore.getState().setTransform(createTransformState(bounds));
  }
  useUIStore.getState().setMaskEditMode(false);
}
