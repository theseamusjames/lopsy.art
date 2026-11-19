import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { clearPersistentTransform } from './gesture-session';

/**
 * What the Layers panel does before anything else when a row, its mask
 * thumbnail or its effects button makes a layer active: a pending Move float
 * or multi-layer transform is committed to the layer it belongs to, then the
 * clicked layer becomes the active and only selected one.
 */
export function selectLayerFromPanel(id: string): void {
  clearPersistentTransform();
  useEditorStore.getState().setActiveLayer(id);
}

/** A plain click on a layer's row: the layer is activated and its pixels, not its mask, are edited. */
export function activateLayerFromPanel(id: string): void {
  selectLayerFromPanel(id);
  useUIStore.getState().setMaskEditMode(false);
}

/** A click on a layer's mask thumbnail: the layer is activated and its mask is edited. */
export function editLayerMaskFromPanel(id: string): void {
  selectLayerFromPanel(id);
  useUIStore.getState().setMaskEditMode(true);
}
