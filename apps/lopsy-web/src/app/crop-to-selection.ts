import { useEditorStore } from './editor-store';

/** Edit > Crop: crops the canvas to the selection's bounds and drops the selection. */
export function cropToSelection(): void {
  const state = useEditorStore.getState();
  if (!state.selection.active || !state.selection.bounds) return;
  state.cropCanvas(state.selection.bounds);
  state.clearSelection();
}
