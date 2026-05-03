/**
 * Liquify canvas interaction handlers.
 *
 * These run before the regular tool router when a Liquify session is active.
 * Pointer events are captured entirely — the active tool is not invoked.
 */

import { useUIStore } from '../ui-store';
import { applyDab } from '../../tools/liquify/liquify';
import { previewLiquify } from '../MenuBar/liquify-actions';
import type { Point } from '../../types';

/**
 * Returns true if a Liquify session is active.
 * Used by the canvas interaction hook to decide whether to intercept events.
 */
export function isLiquifyActive(): boolean {
  return useUIStore.getState().liquify !== null;
}

/**
 * Handle pointer down on the canvas while Liquify is open.
 * Records the paint point and begins a stroke.
 */
export function handleLiquifyDown(layerPos: Point): boolean {
  const session = useUIStore.getState().liquify;
  if (!session) return false;

  useUIStore.getState().setLiquifyPainting(true, layerPos);
  return true;
}

/**
 * Handle pointer move on the canvas while Liquify is open.
 * Applies a brush dab if the user is currently painting.
 */
export function handleLiquifyMove(layerPos: Point): boolean {
  const ui = useUIStore.getState();
  const session = ui.liquify;
  if (!session) return false;
  if (!session.isPainting) return true;

  const last = session.lastPaintPoint;
  const dragDx = last ? layerPos.x - last.x : 0;
  const dragDy = last ? layerPos.y - last.y : 0;

  const map = session.displacementMap;
  applyDab(map, layerPos.x, layerPos.y, dragDx, dragDy, session.settings);

  // Update displacement map and last paint point in store
  ui.updateLiquifyDisplacementMap(map);
  ui.setLiquifyPainting(true, layerPos);

  previewLiquify();
  return true;
}

/**
 * Handle pointer up on the canvas while Liquify is open.
 */
export function handleLiquifyUp(): boolean {
  const session = useUIStore.getState().liquify;
  if (!session) return false;

  useUIStore.getState().setLiquifyPainting(false, null);
  return true;
}
