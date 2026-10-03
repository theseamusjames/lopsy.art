import { useEditorStore } from './editor-store';
import { useUIStore } from './ui-store';
import type { Layer } from '../types';

/** True when layer-mask edit mode has no mask to edit on the active layer. */
export function isLayerMaskModeOrphaned(
  maskMode: string,
  layers: readonly Layer[],
  activeLayerId: string | null,
): boolean {
  if (maskMode !== 'layerMask') return false;
  const layer = layers.find((l) => l.id === activeLayerId);
  return !layer?.mask;
}

/**
 * Leave layer-mask edit mode whenever the active layer stops having a mask
 * — an undo of Add Mask, a redo of Delete Mask — so mask-only commands
 * (Fill, Delete, Filter) never aim at a mask that isn't there (#1150).
 * Returns an unsubscribe.
 */
export function installMaskModeSync(): () => void {
  let prevLayers: readonly Layer[] | null = null;
  let prevActiveId: string | null = null;
  return useEditorStore.subscribe((state) => {
    const { layers, activeLayerId } = state.document;
    if (layers === prevLayers && activeLayerId === prevActiveId) return;
    prevLayers = layers;
    prevActiveId = activeLayerId;
    const ui = useUIStore.getState();
    if (isLayerMaskModeOrphaned(ui.maskMode, layers, activeLayerId)) ui.setMaskEditMode(false);
  });
}
