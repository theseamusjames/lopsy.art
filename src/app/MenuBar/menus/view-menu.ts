import { useEditorStore } from '../../editor-store';
import type { MenuDef } from './types';

export const viewMenu: MenuDef = {
  label: 'View',
  items: [
    {
      label: 'Zoom In', shortcut: '\u2318=',
      action: () => {
        const state = useEditorStore.getState();
        state.setZoom(Math.min(64, state.viewport.zoom * 1.5));
      },
    },
    {
      label: 'Zoom Out', shortcut: '\u2318-',
      action: () => {
        const state = useEditorStore.getState();
        state.setZoom(Math.max(0.01, state.viewport.zoom / 1.5));
      },
    },
    {
      label: 'Fit to Screen', shortcut: '\u23180',
      action: () => {
        const state = useEditorStore.getState();
        const { width, height } = state.document;
        const vp = state.viewport;
        if (vp.width > 0 && vp.height > 0) {
          state.setZoom(Math.min(vp.width / width, vp.height / height) * 0.9);
          state.setPan(0, 0);
        }
      },
    },
    {
      label: 'Actual Size', shortcut: '\u23181',
      action: () => {
        useEditorStore.getState().setZoom(1);
        useEditorStore.getState().setPan(0, 0);
      },
    },
  ],
};
