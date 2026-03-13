import { useEditorStore } from '../../editor-store';
import { PixelBuffer } from '../../../engine/pixel-data';
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

export function rotateActiveLayer(direction: 'cw' | 'ccw'): void {
  const state = useEditorStore.getState();
  const activeId = state.document.activeLayerId;
  if (!activeId) return;
  state.pushHistory();
  const imageData = state.getOrCreateLayerPixelData(activeId);
  const buf = PixelBuffer.fromImageData(imageData);
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
  state.updateLayerPixelData(activeId, result.toImageData());
}

export const imageMenu: MenuDef = {
  label: 'Image',
  items: [
    { label: 'Canvas Size...', disabled: true },
    { label: 'Image Size...', disabled: true },
    { separator: true, label: '' },
    { label: 'Rotate 90\u00B0 CW', action: () => rotateActiveLayer('cw') },
    { label: 'Rotate 90\u00B0 CCW', action: () => rotateActiveLayer('ccw') },
    { label: 'Flip Horizontal', action: () => flipActiveLayer('horizontal') },
    { label: 'Flip Vertical', action: () => flipActiveLayer('vertical') },
  ],
};
