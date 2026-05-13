import { useEditorStore } from '../editor-store';
import { useToolSettingsStore } from '../tool-settings-store';
import { getEngine } from '../../engine-wasm/engine-state';
import { readLayerPixels, getLayerTextureDimensions } from '../../engine-wasm/wasm-bridge';
import { createBrushTipFromSelection, createColorBrushTipFromSelection } from '../../tools/brush/brush-from-selection';
import type { BrushTipData, BrushPreset } from '../../types/brush';

let brushCounter = 0;

export function defineBrush(asColor: boolean = false): void {
  const state = useEditorStore.getState();
  const activeId = state.document.activeLayerId;
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  const { selection } = state;
  if (!selection.active || !selection.bounds || !selection.mask) return;

  const activeLayer = state.document.layers.find((l) => l.id === activeId);
  if (!activeLayer) return;
  const layerX = activeLayer.x ?? 0;
  const layerY = activeLayer.y ?? 0;

  let dims: Uint32Array;
  try {
    dims = getLayerTextureDimensions(engine, activeId);
  } catch {
    return;
  }
  const layerW = dims[0] ?? 0;
  const layerH = dims[1] ?? 0;
  if (layerW === 0 || layerH === 0) return;

  const pixels = readLayerPixels(engine, activeId);
  if (!pixels || pixels.length === 0) return;

  const pixelData = new Uint8ClampedArray(pixels.length);
  pixelData.set(pixels);
  const imageData = new ImageData(pixelData, layerW, layerH);

  // Selection bounds and mask are in document space, but readLayerPixels
  // returns layer-local pixels. Offset the bounds into layer-local coords
  // for pixel sampling, and pass the layer offset so the mask can still
  // be sampled in document space.
  const selectionInfo = {
    bounds: {
      x: selection.bounds.x - layerX,
      y: selection.bounds.y - layerY,
      width: selection.bounds.width,
      height: selection.bounds.height,
    },
    mask: selection.mask,
    maskWidth: selection.maskWidth,
    maskHeight: selection.maskHeight,
    maskOffsetX: layerX,
    maskOffsetY: layerY,
  };

  let tip: BrushTipData;
  if (asColor) {
    tip = createColorBrushTipFromSelection(imageData, selectionInfo);
  } else {
    tip = createBrushTipFromSelection(imageData, selectionInfo);
  }

  const name = prompt('Brush name:');
  if (!name) return;

  brushCounter++;
  const preset: BrushPreset = {
    id: `defined-brush-${Date.now()}-${brushCounter}`,
    name,
    tip,
    size: Math.max(tip.width, tip.height),
    hardness: 100,
    spacing: 25,
    scatter: 0,
    angle: 0,
    opacity: 100,
    flow: 100,
    isCustom: true,
  };

  const store = useToolSettingsStore.getState();
  store.addPreset(preset);
  store.setActivePreset(preset.id);
}
