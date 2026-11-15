import { useState, useCallback } from 'react';
import type { ContextMenuItem } from '../components/ContextMenu/ContextMenu';
import { useEditorStore } from './editor-store';
import { useToolSettingsStore, abrBrushToPreset } from './tool-settings-store';
import { useUIStore } from './ui-store';
import { selectAll } from './MenuBar/menus/select-menu';
import { readSelectionBrushTip } from './MenuBar/brush-actions';

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
}

const HIDDEN: ContextMenuState = { visible: false, x: 0, y: 0, items: [] };

export function useContextMenu() {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(HIDDEN);

  const handleClose = useCallback(() => {
    setContextMenu(HIDDEN);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();

    if (window.matchMedia('(pointer: coarse)').matches) return;

    const editorState = useEditorStore.getState();
    const selection = editorState.selection;
    const hasSelection = selection.active && selection.bounds !== null && selection.mask !== null;

    const items: ContextMenuItem[] = [];

    if (hasSelection && selection.bounds && selection.mask) {
      items.push({
        label: 'Define Brush Preset',
        action: () => {
          void readSelectionBrushTip(false).then((tip) => {
            if (!tip) return;
            const preset = abrBrushToPreset('Custom Brush', tip);
            const toolStore = useToolSettingsStore.getState();
            toolStore.addPreset(preset);
            toolStore.setActivePreset(preset.id);
            useUIStore.getState().setShowBrushModal(true);
          });
        },
      });

      items.push({ label: '', action: () => {}, separator: true });
    }

    items.push({
      label: 'Deselect',
      disabled: !hasSelection,
      action: () => {
        useEditorStore.getState().clearSelection();
      },
    });

    items.push({
      label: 'Select All',
      action: () => {
        selectAll();
      },
    });

    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      items,
    });
  }, []);

  return { contextMenu, handleContextMenu, handleClose };
}
