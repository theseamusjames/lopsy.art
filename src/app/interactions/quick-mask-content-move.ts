import { getEngine } from '../../engine-wasm/engine-state';
import { syncSelection } from '../../engine-wasm/engine-sync';
import { beginQuickMaskMove, endQuickMaskMove, translateQuickMask } from '../../engine-wasm/wasm-bridge';
import type { SelectionData } from '../store/types';

/**
 * Moving a marquee in Quick Mask mode carries the painted quick-mask content
 * under it (#315). The engine keeps GPU copies of the quick mask and the
 * marquee from the start of the move and redraws the quick mask from them
 * each frame. Reading the quick mask back and re-uploading it per frame cost
 * hundreds of milliseconds per frame on a 4K canvas (#1481, #1482).
 */

let isMoving = false;

/** Start a move of the quick-mask content under `selection`. False when there is nothing to move. */
export function beginQuickMaskContentMove(selection: SelectionData): boolean {
  endQuickMaskContentMove();
  const engine = getEngine();
  if (!engine || !selection.active || !selection.mask) return false;
  // The engine copies the marquee from the GPU selection mask, which
  // engine-sync may not have pushed yet for a selection made this frame.
  syncSelection(engine, selection);
  isMoving = beginQuickMaskMove(engine);
  return isMoving;
}

/** Redraw the quick mask with the marquee content at (dx, dy) from where the move began. */
export function moveQuickMaskContent(dx: number, dy: number): void {
  if (!isMoving) return;
  const engine = getEngine();
  if (!engine) return;
  translateQuickMask(engine, Math.round(dx), Math.round(dy));
}

/** Release the engine's copies. Safe to call when no move is active. */
export function endQuickMaskContentMove(): void {
  if (!isMoving) return;
  isMoving = false;
  const engine = getEngine();
  if (engine) endQuickMaskMove(engine);
}
