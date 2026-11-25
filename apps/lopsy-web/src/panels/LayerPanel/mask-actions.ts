import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';

/** The Layers panel's Add Mask button. */
export function addMaskAndEdit(layerId: string): void {
  useEditorStore.getState().addLayerMask(layerId);
  // A new mask is added to be painted on; leaving the layer pixels as the
  // paint target made the next stroke land on the artwork.
  if (useEditorStore.getState().document.layers.find((l) => l.id === layerId)?.mask) {
    useUIStore.getState().setMaskEditMode(true);
  }
}

/** A row's Delete mask button (the row then turns mask edit mode off a second time). */
export function removeMaskAndLeaveEdit(layerId: string): void {
  useEditorStore.getState().removeLayerMask(layerId);
  useUIStore.getState().setMaskEditMode(false);
}
