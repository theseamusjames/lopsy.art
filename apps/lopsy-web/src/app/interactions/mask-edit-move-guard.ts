import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { notifyInfo } from '../notifications-store';

export const MASK_EDIT_MOVE_HINT = 'Leave mask edit mode to move or transform a selection.';

/**
 * True when the Move tool would lift a selection while a layer mask is being
 * edited. The float lifts the layer's pixels, not its mask, and committing it
 * baked the mask-edit overlay into the layer (#1407).
 */
export function isMaskEditSelectionMove(): boolean {
  const ui = useUIStore.getState();
  if (ui.activeTool !== 'move' || ui.maskMode !== 'layerMask') return false;
  return useEditorStore.getState().selection.active;
}

/** Refuse a mask-edit selection move ({@link isMaskEditSelectionMove}) with a hint. */
export function refuseMaskEditSelectionMove(): boolean {
  if (!isMaskEditSelectionMove()) return false;
  notifyInfo(MASK_EDIT_MOVE_HINT);
  return true;
}
