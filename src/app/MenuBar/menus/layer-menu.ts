import { useEditorStore } from '../../editor-store';
import type { MenuDef } from './types';

export type FillLayerDialogId = 'solid-color' | 'gradient';

export function createLayerMenu(showFillLayerDialog: (id: FillLayerDialogId) => void): MenuDef {
  return {
    label: 'Layer',
    items: [
      { label: 'New Layer', shortcut: '⇧⌘N', action: () => useEditorStore.getState().addLayer() },
      { label: 'Duplicate Layer', shortcut: '⌘J', action: () => useEditorStore.getState().duplicateLayer() },
      { separator: true, label: '' },
      { label: 'New Solid Color Fill...', action: () => showFillLayerDialog('solid-color') },
      { label: 'New Gradient Fill...', action: () => showFillLayerDialog('gradient') },
      { separator: true, label: '' },
      { label: 'Merge Down', shortcut: '⌘E', action: () => useEditorStore.getState().mergeDown() },
      { label: 'Flatten Image', action: () => useEditorStore.getState().flattenImage() },
    ],
  };
}
