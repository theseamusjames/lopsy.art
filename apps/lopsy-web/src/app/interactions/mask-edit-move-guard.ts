import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { announceRefusal, type Refusal } from '../../commands/refusal';

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

export function maskEditSelectionMoveRefusal(): Refusal | null {
  if (!isMaskEditSelectionMove()) return null;
  return { reason: MASK_EDIT_MOVE_HINT, notice: 'info' };
}

/** Refuse a mask-edit selection move ({@link isMaskEditSelectionMove}) with a hint. */
export function refuseMaskEditSelectionMove(): boolean {
  const refusal = maskEditSelectionMoveRefusal();
  if (!refusal) return false;
  announceRefusal(refusal);
  return true;
}
