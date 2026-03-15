import { useEditorStore } from '../../editor-store';
import { useUIStore } from '../../ui-store';
import { PixelBuffer } from '../../../engine/pixel-data';
import { getSelectionMaskValue } from '../../../selection/selection';
import type { Layer } from '../../../types/layers';
import type { MenuDef } from './types';

export function fillSelection(): void {
  const state = useEditorStore.getState();
  const activeId = state.document.activeLayerId;
  if (!activeId) return;
  const layer = state.document.layers.find((l) => l.id === activeId);
  if (!layer) return;

  state.pushHistory();
  const imageData = state.getOrCreateLayerPixelData(activeId);
  let buf = PixelBuffer.fromImageData(imageData);
  const color = useUIStore.getState().foregroundColor;
  const sel = state.selection;

  if (sel.active && sel.mask) {
    const { width: docW, height: docH } = state.document;
    const needsExpand =
      layer.x !== 0 || layer.y !== 0 ||
      buf.width < docW || buf.height < docH;

    if (needsExpand) {
      buf = expandLayerToCanvas(buf, layer.x, layer.y, docW, docH);
      useEditorStore.setState({
        document: {
          ...state.document,
          layers: state.document.layers.map((l) =>
            l.id === activeId
              ? { ...l, x: 0, y: 0, width: docW, height: docH } as Layer
              : l,
          ),
        },
        renderVersion: state.renderVersion + 1,
      });
    }

    for (let y = 0; y < sel.maskHeight; y++) {
      for (let x = 0; x < sel.maskWidth; x++) {
        if (getSelectionMaskValue(sel, x, y) > 0) {
          buf.setPixel(x, y, color);
        }
      }
    }
  } else {
    buf.fill(color);
  }
  state.updateLayerPixelData(activeId, buf.toImageData());
}

function expandLayerToCanvas(
  buf: PixelBuffer,
  layerX: number,
  layerY: number,
  canvasWidth: number,
  canvasHeight: number,
): PixelBuffer {
  const expanded = new PixelBuffer(canvasWidth, canvasHeight);
  const src = buf.rawData;
  const dst = expanded.rawData;
  for (let y = 0; y < buf.height; y++) {
    const dy = y + layerY;
    if (dy < 0 || dy >= canvasHeight) continue;
    const srcRow = y * buf.width * 4;
    const dstStart = (dy * canvasWidth + Math.max(0, layerX)) * 4;
    const srcStart = srcRow + Math.max(0, -layerX) * 4;
    const copyWidth = Math.min(buf.width, canvasWidth - layerX) - Math.max(0, -layerX);
    if (copyWidth > 0) {
      dst.set(src.subarray(srcStart, srcStart + copyWidth * 4), dstStart);
    }
  }
  return expanded;
}

export const editMenu: MenuDef = {
  label: 'Edit',
  items: [
    { label: 'Undo', shortcut: '\u2318Z', action: () => useEditorStore.getState().undo() },
    { label: 'Redo', shortcut: '\u21E7\u2318Z', action: () => useEditorStore.getState().redo() },
    { separator: true, label: '' },
    { label: 'Cut', shortcut: '\u2318X', action: () => useEditorStore.getState().cut() },
    { label: 'Copy', shortcut: '\u2318C', action: () => useEditorStore.getState().copy() },
    { label: 'Paste', shortcut: '\u2318V', action: () => useEditorStore.getState().paste() },
    { separator: true, label: '' },
    { label: 'Fill', shortcut: '\u21E7F5', action: () => fillSelection() },
  ],
};
