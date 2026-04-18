import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { Point } from '../../types';
import { useUIStore } from '../../app/ui-store';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { clearJsPixelData } from '../../app/store/clear-js-pixel-data';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  renderLinearGradient as gpuRenderLinearGradient,
  renderRadialGradient as gpuRenderRadialGradient,
} from '../../engine-wasm/wasm-bridge';

export function handleGradientDown(ctx: InteractionContext): InteractionState {
  const { layerPos, activeLayerId, activeLayer } = ctx;
  const editorState = useEditorStore.getState();
  editorState.pushHistory();
  const ts = useToolSettingsStore.getState();
  ts.addRecentColor(ts.foregroundColor);
  ts.addRecentColor(ts.backgroundColor);

  return {
    drawing: true,
    lastPoint: layerPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: 'gradient',
    startPoint: layerPos,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleGradientMove(state: InteractionState, layerLocalPos: Point): void {
  if (!state.startPoint || !state.layerId) return;

  const toolSettings = useToolSettingsStore.getState();
  const gradType = toolSettings.gradientType;
  const reverse = toolSettings.gradientReverse;

  const engine = getEngine();
  if (!engine) return;

  const stops = toolSettings.gradientStops.map((s) => ({
    position: reverse ? 1 - s.position : s.position,
    r: s.color.r / 255,
    g: s.color.g / 255,
    b: s.color.b / 255,
    a: s.color.a,
  }));
  if (reverse) stops.reverse();
  const stopsJson = JSON.stringify(stops);

  const startX = state.startPoint.x + state.layerStartX;
  const startY = state.startPoint.y + state.layerStartY;
  const endX = layerLocalPos.x + state.layerStartX;
  const endY = layerLocalPos.y + state.layerStartY;

  if (gradType === 'linear') {
    gpuRenderLinearGradient(engine, state.layerId, startX, startY, endX, endY, stopsJson);
  } else {
    const dx = endX - startX;
    const dy = endY - startY;
    const radius = Math.sqrt(dx * dx + dy * dy);
    gpuRenderRadialGradient(engine, state.layerId, startX, startY, radius, stopsJson);
  }

  clearJsPixelData(state.layerId);
  useEditorStore.getState().notifyRender();

  useUIStore.getState().setGradientPreview({
    start: { x: startX, y: startY },
    end: { x: endX, y: endY },
  });
}
