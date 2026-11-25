import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { clearJsPixelData } from '../../app/store/clear-js-pixel-data';
import {
  selectionBounds,
  SELECTION_COMBINE_LABELS,
  type SelectionCombineMode,
  type SelectionCombineOp,
} from '../../selection/selection';
import { combineSelectionMasks } from '../../app/interactions/selection-handlers';
import { createTransformState } from '../../tools/transform/transform';
import { getEngine } from '../../engine-wasm/engine-state';
import { hasFloat, dropFloat } from '../../engine-wasm/wasm-bridge';
import { readLayerAsImageData } from '../../engine-wasm/gpu-pixel-access';
import { schedulePrefloat } from '../../app/interactions/prefloat';
import { recordLayerAlphaSelection, type LayerAlphaContent } from '../../app/interactions/layer-alpha-selection';
import { getMaskDocOrigin } from '../../layers/mask-origin';

export interface SelectLayerAlphaOptions {
  /** Float the selection ahead of the first drag (default true). */
  prefloat?: boolean;
  /** How the layer's alpha combines with the current selection (default replace). */
  combine?: SelectionCombineMode;
}

let latestAlphaSelect = 0;

/**
 * Select a layer's opaque pixels. The layer is read from the GPU, so the
 * selection is in place when the returned promise resolves, not when the
 * call returns. A newer call, or any selection made while the read was
 * out, wins: this one then leaves the selection alone.
 */
export async function selectLayerAlpha(layerId: string, options: SelectLayerAlphaOptions = {}): Promise<void> {
  const { prefloat = true, combine = 'replace' } = options;
  // Commit any active GPU float so the layer texture has the final pixels
  const engine = getEngine();
  if (engine && hasFloat(engine)) {
    dropFloat(engine);
  }

  // The GPU texture is now the only copy, so the read below sees it.
  clearJsPixelData(layerId);

  const request = ++latestAlphaSelect;
  const selectionAtRequest = useEditorStore.getState().selection.mask;
  const pixelData = await readLayerAsImageData(layerId).catch(() => null);
  if (!pixelData || request !== latestAlphaSelect) return;

  const editorState = useEditorStore.getState();
  if (editorState.selection.mask !== selectionAtRequest) return;
  const layer = editorState.document.layers.find((l) => l.id === layerId);
  if (!layer) return;

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
  const sel = editorState.selection;
  if (combine !== 'replace' && sel.active && sel.mask && sel.maskWidth === docW && sel.maskHeight === docH) {
    combineWithSelection(sel.mask, selMask, docW, docH, combine);
    return;
  }
  const bounds = selectionBounds(selMask, docW, docH);
  if (bounds) {
    editorState.setSelection(bounds, selMask, docW, docH);
    recordLayerAlphaSelection(layerId, selMask, layerAlphaOf(pixelData, layer.x, layer.y));
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
    if (prefloat && layer.type !== 'text' && layerId === editorState.document.activeLayerId) {
      schedulePrefloat(layerId, selMask, bounds);
    }
  }
}

/** The layer's alpha cropped to its opaque pixels, at the layer's document position. */
function layerAlphaOf(pixels: ImageData, layerX: number, layerY: number): LayerAlphaContent | null {
  const { width, height, data } = pixels;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) < 1) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const alpha = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      alpha[y * w + x] = data[((y + minY) * width + x + minX) * 4 + 3] ?? 0;
    }
  }
  return { alpha, rect: { x: layerX + minX, y: layerY + minY, width: w, height: h } };
}

function combineWithSelection(
  existing: Uint8ClampedArray,
  layerMask: Uint8ClampedArray,
  docW: number,
  docH: number,
  op: SelectionCombineOp,
): void {
  const editorState = useEditorStore.getState();
  editorState.pushHistoryMetadata(SELECTION_COMBINE_LABELS[op]);
  const combined = combineSelectionMasks(existing, layerMask, op);
  const bounds = selectionBounds(combined, docW, docH);
  if (!bounds) {
    editorState.clearSelection();
    useUIStore.getState().setTransform(null);
    return;
  }
  editorState.setSelection(bounds, combined, docW, docH);
  useUIStore.getState().setTransform(createTransformState(bounds));
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
