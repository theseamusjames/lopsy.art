import { useEditorStore } from '../../editor-store';
import type { MenuDef } from './types';

export const layerMenu: MenuDef = {
  label: 'Layer',
  items: [
    { label: 'New Layer', shortcut: '\u21E7\u2318N', action: () => useEditorStore.getState().addLayer() },
    { label: 'Duplicate Layer', shortcut: '\u2318J', action: () => useEditorStore.getState().duplicateLayer() },
    { separator: true, label: '' },
    { label: 'Merge Down', shortcut: '\u2318E', action: () => useEditorStore.getState().mergeDown() },
    { label: 'Flatten Image', action: () => useEditorStore.getState().flattenImage() },
  ],
};
