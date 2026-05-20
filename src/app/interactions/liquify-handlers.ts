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

/**
 * Single grouped state object instead of independent let-bindings.
 * `null` means no active liquify stroke; non-null carries the
 * last-painted point. The audit flagged the previous
 * `let isPainting = false; let lastPaintPoint = null;` as exactly
 * the "module-level mutable globals" smell the discriminated-union
 * pattern (pointer-mode.ts) was designed to retire.
 */
let stroke: { lastPoint: Point } | null = null;

export function isLiquifyActive(): boolean {
  return useUIStore.getState().liquify !== null;
}

export function handleLiquifyDown(layerPos: Point): boolean {
  const session = useUIStore.getState().liquify;
  if (!session) return false;

  stroke = { lastPoint: layerPos };
  return true;
}

export function handleLiquifyMove(layerPos: Point): boolean {
  const session = useUIStore.getState().liquify;
  if (!session) return false;
  if (!stroke) return true;

  const dragDx = layerPos.x - stroke.lastPoint.x;
  const dragDy = layerPos.y - stroke.lastPoint.y;

  const dirty = applyDab(session.displacementMap, layerPos.x, layerPos.y, dragDx, dragDy, session.settings);
  stroke = { lastPoint: layerPos };

  const sub = encodeDisplacementRegion(session.displacementMap, session.encodedDisplacement, dirty);
  previewLiquifyRegion(sub, dirty.x, dirty.y, dirty.w, dirty.h);
  return true;
}

export function handleLiquifyUp(): boolean {
  const session = useUIStore.getState().liquify;
  if (!session) return false;

  stroke = null;
  return true;
}
