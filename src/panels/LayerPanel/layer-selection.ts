import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { clearJsPixelData } from '../../app/store/clear-js-pixel-data';
import { selectionBounds } from '../../selection/selection';
import { createTransformState } from '../../tools/transform/transform';
import { getEngine } from '../../engine-wasm/engine-state';
import { hasFloat, dropFloat } from '../../engine-wasm/wasm-bridge';

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
    useUIStore.getState().setTransform(createTransformState(bounds));
  }
}

export function convertMaskToMarquee(layerId: string): void {
  const editorState = useEditorStore.getState();
  const layer = editorState.document.layers.find((l) => l.id === layerId);
  if (!layer?.mask) return;
  const { mask } = layer;
  const { width: docW, height: docH } = editorState.document;
  const selMask = new Uint8ClampedArray(docW * docH);
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const docX = x + layer.x;
      const docY = y + layer.y;
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
