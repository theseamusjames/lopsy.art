import { useEditorStore } from '../../editor-store';
import { useUIStore } from '../../ui-store';
import { getEngine } from '../../../engine-wasm/engine-state';
import { fillWithColor } from '../../../engine-wasm/wasm-bridge';
import type { MenuDef } from './types';

export function fillSelection(): void {
  const state = useEditorStore.getState();
  const activeId = state.document.activeLayerId;
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  state.pushHistory();
  const color = useUIStore.getState().foregroundColor;

  // GPU fill: uses the engine's selection mask if active
  fillWithColor(engine, activeId, color.r / 255, color.g / 255, color.b / 255, color.a);

  // Clear stale JS pixel data
  const pixelDataMap = new Map(state.layerPixelData);
  pixelDataMap.delete(activeId);
  const sparseMap = new Map(state.sparseLayerData);
  sparseMap.delete(activeId);
  const dirtyIds = new Set(state.dirtyLayerIds);
  dirtyIds.add(activeId);
  useEditorStore.setState({
    layerPixelData: pixelDataMap,
    sparseLayerData: sparseMap,
    dirtyLayerIds: dirtyIds,
  });
  state.notifyRender();
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
    { separator: true, label: '' },
    { label: 'Clear Guides', action: () => useUIStore.getState().clearGuides() },
  ],
};
