import { useEditorStore } from '../../editor-store';
import { getEngine } from '../../../engine-wasm/engine-state';
import {
  flipLayer,
  rotateLayer90,
  setDocumentSize,
} from '../../../engine-wasm/wasm-bridge';
import { pixelDataManager } from '../../../engine/pixel-data-manager';
import type { Layer } from '../../../types';
import type { MenuDef } from './types';

export function flipActiveLayer(axis: 'horizontal' | 'vertical'): void {
  const state = useEditorStore.getState();
  const activeId = state.document.activeLayerId;
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  state.pushHistory();
  flipLayer(engine, activeId, axis === 'horizontal');

  // GPU is now source of truth — clear stale JS pixel data.
  pixelDataManager.remove(activeId);
  const dirtyIds = new Set(state.dirtyLayerIds);
  dirtyIds.add(activeId);
  useEditorStore.setState({ dirtyLayerIds: dirtyIds });
  state.notifyRender();
}

export function rotateImage(direction: 'cw' | 'ccw'): void {
  const state = useEditorStore.getState();
  const doc = state.document;

  const engine = getEngine();
  if (!engine) return;

  state.pushHistory();

  const newWidth = doc.height;
  const newHeight = doc.width;
  const newLayers: Layer[] = [];

  for (const layer of doc.layers) {
    if (layer.type !== 'raster') {
      newLayers.push(layer);
      continue;
    }

    // GPU-side rotate
    rotateLayer90(engine, layer.id, direction === 'cw');

    // Rotate layer position around document center
    let newX: number;
    let newY: number;
    if (direction === 'cw') {
      newX = doc.height - layer.y - layer.height;
      newY = layer.x;
    } else {
      newX = layer.y;
      newY = doc.width - layer.x - layer.width;
    }

    newLayers.push({
      ...layer,
      x: newX,
      y: newY,
      width: layer.height,
      height: layer.width,
    } as Layer);
  }

  // Update document size on the engine
  setDocumentSize(engine, newWidth, newHeight);

  // GPU-side rotate invalidates every layer's JS cache.
  pixelDataManager.clearAll();
  useEditorStore.setState({
    document: {
      ...doc,
      width: newWidth,
      height: newHeight,
      layers: newLayers,
    },
    renderVersion: state.renderVersion + 1,
  });
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
