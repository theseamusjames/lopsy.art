import type { InteractionState } from '../../app/interactions/interaction-types';
import type { Engine } from '../../engine-wasm/wasm-bridge';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { useEditorStore } from '../../app/editor-store';
import { applyEraserDabBatch as gpuEraserDabBatch } from '../../engine-wasm/wasm-bridge';
import type { SymmetryConfig } from '../symmetry';
import { mirrorBatchPoints } from '../symmetry';

export function handleEraserStroke(
  engine: Engine,
  state: InteractionState,
  layerLocalPos: { x: number; y: number },
  sym: SymmetryConfig,
  interpolateWithSpacing: (from: { x: number; y: number }, to: { x: number; y: number }, spacing: number, remainder: number) => { points: Float64Array; remainder: number },
): void {
  if (!state.lastPoint || !state.layerId) return;

  const toolSettings = useToolSettingsStore.getState();
  const size = toolSettings.eraserSize;
  const hardness = 0.8;
  const opacity = toolSettings.eraserOpacity / 100;
  const spacing = Math.max(1, size * 0.25);
  const { points: pts, remainder: spacingRem } = interpolateWithSpacing(state.lastPoint, layerLocalPos, spacing, state.spacingRemainder ?? 0);
  state.spacingRemainder = spacingRem;
  gpuEraserDabBatch(engine, state.layerId, pts, size, hardness, opacity);
  for (const m of mirrorBatchPoints(pts, sym)) {
    gpuEraserDabBatch(engine, state.layerId, m, size, hardness, opacity);
  }
  state.lastPoint = layerLocalPos;
  useEditorStore.getState().notifyRender();
}
