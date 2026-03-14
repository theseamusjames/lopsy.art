import { useEditorStore } from '../../editor-store';
import { useUIStore } from '../../ui-store';
import { PixelBuffer } from '../../../engine/pixel-data';
import { getSelectionMaskValue } from '../../../selection/selection';
import type { MenuDef } from './types';

export function fillSelection(): void {
  const state = useEditorStore.getState();
  const activeId = state.document.activeLayerId;
  if (!activeId) return;
  state.pushHistory();
  const imageData = state.getOrCreateLayerPixelData(activeId);
  const buf = PixelBuffer.fromImageData(imageData);
  const color = useUIStore.getState().foregroundColor;
  const sel = state.selection;

  if (sel.active && sel.mask) {
    const layer = state.document.layers.find((l) => l.id === activeId);
    if (!layer) return;
    for (let y = 0; y < sel.maskHeight; y++) {
      for (let x = 0; x < sel.maskWidth; x++) {
        if (getSelectionMaskValue(sel, x, y) > 0) {
          const lx = x - layer.x;
          const ly = y - layer.y;
          if (lx < 0 || lx >= buf.width || ly < 0 || ly >= buf.height) continue;
          buf.setPixel(lx, ly, color);
        }
      }
    }
  } else {
    buf.fill(color);
  }
  state.updateLayerPixelData(activeId, buf.toImageData());
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
