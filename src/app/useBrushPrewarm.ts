import { useEffect } from 'react';
import { useUIStore } from './ui-store';
import { useEditorStore } from './editor-store';
import { getEngine } from '../engine-wasm/engine-state';
import { prewarmStroke, type Engine } from '../engine-wasm/wasm-bridge';
import { syncLayerAfterFullSize } from './sync-layer-after-full-size';
import type { ToolId, Layer } from '../types';

/** Paint tools that share the brush/eraser/pencil GPU stroke pipeline. */
export const PREWARM_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['brush', 'pencil', 'eraser']);

/** Decide whether the current tool + layer combination should trigger a
 *  GPU stroke prewarm. Pulled out so it can be unit-tested without React. */
export function shouldPrewarmStroke(activeTool: ToolId, layer: Layer | null | undefined): boolean {
  if (!PREWARM_TOOLS.has(activeTool)) return false;
  if (!layer) return false;
  if (layer.locked) return false;
  if (layer.type === 'group') return false;
  return true;
}

/** Run a prewarm: call the WASM-side `prewarmStroke` and sync any layer
 *  dimension change back to the Zustand store. Swallows engine errors so a
 *  transient failure doesn't crash the UI. */
export function runBrushPrewarm(engine: Engine, layerId: string): void {
  try {
    prewarmStroke(engine, layerId);
  } catch {
    return;
  }
  syncLayerAfterFullSize(engine, layerId);
}

/**
 * Pre-allocate the GPU stroke FBO and a stroke-sized texture as soon as the
 * user selects a brush/pencil/eraser on a non-locked raster layer. Without
 * this, the first stroke on a large canvas pays a visible texture-allocation
 * hesitation (issue #380). With this, those allocations happen during idle
 * time after tool/layer activation.
 *
 * The warmup is deferred to a macrotask so the tool-switch UI update lands
 * before the GPU work runs.
 */
export function useBrushPrewarm(): void {
  const activeTool = useUIStore((s) => s.activeTool);
  const activeLayerId = useEditorStore((s) => s.document.activeLayerId);

  useEffect(() => {
    if (!activeLayerId) return;
    const layer = useEditorStore.getState().document.layers.find((l) => l.id === activeLayerId);
    if (!shouldPrewarmStroke(activeTool, layer)) return;

    const handle = window.setTimeout(() => {
      const engine = getEngine();
      if (!engine) return;
      runBrushPrewarm(engine, activeLayerId);
    }, 0);

    return () => window.clearTimeout(handle);
  }, [activeTool, activeLayerId]);
}
