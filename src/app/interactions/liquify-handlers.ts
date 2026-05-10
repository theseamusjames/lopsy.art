/**
 * Liquify canvas interaction handlers.
 *
 * Paint state is kept in module scope to avoid Zustand writes on every
 * mouse move. After each dab, only the dirty sub-rectangle is encoded
 * and uploaded to the GPU.
 */

import { useUIStore } from '../ui-store';
import { applyDab, encodeDisplacementRegion } from '../../tools/liquify/liquify';
import { previewLiquifyRegion } from '../MenuBar/liquify-actions';
import type { Point } from '../../types';

let isPainting = false;
let lastPaintPoint: Point | null = null;

export function isLiquifyActive(): boolean {
  return useUIStore.getState().liquify !== null;
}

export function handleLiquifyDown(layerPos: Point): boolean {
  const session = useUIStore.getState().liquify;
  if (!session) return false;

  isPainting = true;
  lastPaintPoint = layerPos;
  return true;
}

export function handleLiquifyMove(layerPos: Point): boolean {
  const session = useUIStore.getState().liquify;
  if (!session) return false;
  if (!isPainting) return true;

  const dragDx = lastPaintPoint ? layerPos.x - lastPaintPoint.x : 0;
  const dragDy = lastPaintPoint ? layerPos.y - lastPaintPoint.y : 0;

  const dirty = applyDab(session.displacementMap, layerPos.x, layerPos.y, dragDx, dragDy, session.settings);
  lastPaintPoint = layerPos;

  const sub = encodeDisplacementRegion(session.displacementMap, session.encodedDisplacement, dirty);
  previewLiquifyRegion(sub, dirty.x, dirty.y, dirty.w, dirty.h);
  return true;
}

export function handleLiquifyUp(): boolean {
  const session = useUIStore.getState().liquify;
  if (!session) return false;

  isPainting = false;
  lastPaintPoint = null;
  return true;
}
