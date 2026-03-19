import { useEditorStore } from '../../editor-store';
import { PixelBuffer } from '../../../engine/pixel-data';
import { invalidateBitmapCache } from '../../../engine/bitmap-cache';
import { getEngine } from '../../../engine-wasm/engine-state';
import { uploadLayerPixels } from '../../../engine-wasm/wasm-bridge';
import type { Layer } from '../../../types';
import type { MenuDef } from './types';

export function flipActiveLayer(axis: 'horizontal' | 'vertical'): void {
  const state = useEditorStore.getState();
  const activeId = state.document.activeLayerId;
  if (!activeId) return;
  state.pushHistory();
  const imageData = state.getOrCreateLayerPixelData(activeId);
  const buf = PixelBuffer.fromImageData(imageData);
  const result = new PixelBuffer(buf.width, buf.height);
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      const sx = axis === 'horizontal' ? buf.width - 1 - x : x;
      const sy = axis === 'vertical' ? buf.height - 1 - y : y;
      result.setPixel(x, y, buf.getPixel(sx, sy));
    }
  }
  state.updateLayerPixelData(activeId, result.toImageData());
}

function rotatePixelBuffer(buf: PixelBuffer, direction: 'cw' | 'ccw'): PixelBuffer {
  const result = new PixelBuffer(buf.height, buf.width);
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      if (direction === 'cw') {
        result.setPixel(buf.height - 1 - y, x, buf.getPixel(x, y));
      } else {
        result.setPixel(y, buf.width - 1 - x, buf.getPixel(x, y));
      }
    }
  }
  return result;
}

export function rotateImage(direction: 'cw' | 'ccw'): void {
  const state = useEditorStore.getState();
  const doc = state.document;
  state.pushHistory();

  const newWidth = doc.height;
  const newHeight = doc.width;
  const newLayers: Layer[] = [];
  const pixelData = new Map<string, ImageData>();

  for (const layer of doc.layers) {
    if (layer.type !== 'raster') {
      newLayers.push(layer);
      continue;
    }
    const imageData = state.getOrCreateLayerPixelData(layer.id);
    const buf = PixelBuffer.fromImageData(imageData);
    const rotated = rotatePixelBuffer(buf, direction);
    pixelData.set(layer.id, rotated.toImageData());

    // Rotate layer position around document center
    let newX: number;
    let newY: number;
    if (direction === 'cw') {
      newX = doc.height - layer.y - buf.height;
      newY = layer.x;
    } else {
      newX = layer.y;
      newY = doc.width - layer.x - buf.width;
    }

    newLayers.push({
      ...layer,
      x: newX,
      y: newY,
      width: rotated.width,
      height: rotated.height,
    } as Layer);
  }

  useEditorStore.setState({
    document: {
      ...doc,
      width: newWidth,
      height: newHeight,
      layers: newLayers,
    },
    layerPixelData: pixelData,
    sparseLayerData: new Map(),
    renderVersion: state.renderVersion + 1,
  });

  // Upload rotated pixel data to GPU
  const engine = getEngine();
  if (engine) {
    for (const [layerId, data] of pixelData) {
      const layer = newLayers.find((l) => l.id === layerId);
      invalidateBitmapCache(layerId);
      const rawBytes = new Uint8Array(data.data.buffer, data.data.byteOffset, data.data.byteLength);
      uploadLayerPixels(engine, layerId, rawBytes, data.width, data.height, layer?.x ?? 0, layer?.y ?? 0);
    }
  }
}

export type ImageDialogId = 'canvas-size' | 'image-size';

export function createImageMenu(showDialog: (id: ImageDialogId) => void): MenuDef {
  return {
  label: 'Image',
  items: [
    { label: 'Canvas Size...', action: () => showDialog('canvas-size') },
    { label: 'Image Size...', action: () => showDialog('image-size') },
    { separator: true, label: '' },
    { label: 'Rotate 90\u00B0 CW', action: () => rotateImage('cw') },
    { label: 'Rotate 90\u00B0 CCW', action: () => rotateImage('ccw') },
    { label: 'Flip Horizontal', action: () => flipActiveLayer('horizontal') },
    { label: 'Flip Vertical', action: () => flipActiveLayer('vertical') },
  ],
  };
}
