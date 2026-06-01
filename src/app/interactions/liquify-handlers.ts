/**
 * Liquify canvas interaction handlers.
 *
 * Dab application runs entirely on the GPU via `liquifyApplyDabGpu`.
 * The displacement texture stays in GPU memory — no CPU Float32Array
 * or RGBA encoding roundtrip.
 */

import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { getEngine } from '../../engine-wasm/engine-state';
import { liquifyApplyDabGpu, liquifyRender } from '../../engine-wasm/wasm-bridge';
import type { Point } from '../../types';
import { INITIAL_INTERACTION_STATE, type InteractionState } from './interaction-types';

const LIQUIFY_MODE_MAP: Record<string, number> = {
  push: 0,
  'twirl-cw': 1,
  'twirl-ccw': 2,
  bloat: 3,
  pinch: 4,
};

let stroke: { lastPoint: Point } | null = null;

/**
 * Pre-tool down guard for the liquify gesture. When a liquify session
 * is active, all pointer-downs are claimed by liquify regardless of
 * position (the entire canvas is the liquify surface). Returns a fully-
 * populated InteractionState with the `liquify` gesture variant, or
 * null if no session is active so the dispatcher falls through to the
 * next guard.
 */
export function handleLiquifyDown(
  canvasPos: Point,
  activeLayerId: string,
): InteractionState | null {
  const session = useUIStore.getState().liquify;
  if (!session) return null;

  const layer = useEditorStore.getState().document.layers.find((l) => l.id === activeLayerId);
  const layerPos = layer
    ? { x: canvasPos.x - layer.x, y: canvasPos.y - layer.y }
    : canvasPos;
  stroke = { lastPoint: layerPos };

  return {
    ...INITIAL_INTERACTION_STATE,
    drawing: true,
    gesture: { kind: 'liquify' },
    layerId: activeLayerId,
  };
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
