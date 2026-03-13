import { useEditorStore } from '../../editor-store';
import { useUIStore } from '../../ui-store';
import { PixelBuffer } from '../../../engine/pixel-data';
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
    for (let y = 0; y < buf.height; y++) {
      for (let x = 0; x < buf.width; x++) {
        if ((sel.mask[y * sel.maskWidth + x] ?? 0) > 0) {
          buf.setPixel(x, y, color);
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
    { label: 'Cut', shortcut: '\u2318X', disabled: true },
    { label: 'Copy', shortcut: '\u2318C', disabled: true },
    { label: 'Paste', shortcut: '\u2318V', disabled: true },
    { separator: true, label: '' },
    { label: 'Fill', shortcut: '\u21E7F5', action: () => fillSelection() },
  ],
};
