/**
 * Liquify canvas interaction handlers.
 *
 * Dab application runs entirely on the GPU via `liquifyApplyDabGpu`.
 * The displacement texture stays in GPU memory — no CPU Float32Array
 * or RGBA encoding roundtrip.
 */

import { useUIStore } from '../ui-store';
import { getEngine } from '../../engine-wasm/engine-state';
import { liquifyApplyDabGpu, liquifyRender } from '../../engine-wasm/wasm-bridge';
import type { Point } from '../../types';

const LIQUIFY_MODE_MAP: Record<string, number> = {
  push: 0,
  'twirl-cw': 1,
  'twirl-ccw': 2,
  bloat: 3,
  pinch: 4,
};

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

  const engine = getEngine();
  if (!engine) return true;

  const dragDx = layerPos.x - stroke.lastPoint.x;
  const dragDy = layerPos.y - stroke.lastPoint.y;
  const mode = LIQUIFY_MODE_MAP[session.settings.mode] ?? 0;

  liquifyApplyDabGpu(
    engine,
    layerPos.x,
    layerPos.y,
    session.settings.brushSize,
    session.settings.pressure,
    dragDx,
    dragDy,
    mode,
  );

  liquifyRender(engine, session.layerId, 2048);

  stroke = { lastPoint: layerPos };
  return true;
}

export function handleLiquifyUp(): boolean {
  const session = useUIStore.getState().liquify;
  if (!session) return false;

  stroke = null;
  return true;
}
