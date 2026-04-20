import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { getEngine } from '../../engine-wasm/engine-state';
import { applyBrushDab as gpuBrushDab } from '../../engine-wasm/wasm-bridge';
import { generateSprayDots } from './spray';
import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';

function emitSprayDabs(
  engine: NonNullable<ReturnType<typeof getEngine>>,
  layerId: string,
  centerX: number,
  centerY: number,
  brushRadius: number,
  density: number,
  hardness: number,
  r: number,
  g: number,
  b: number,
  a: number,
  baseOpacity: number,
): void {
  const dots = generateSprayDots(centerX, centerY, brushRadius, density, baseOpacity);
  for (const dot of dots) {
    gpuBrushDab(engine, layerId, dot.x, dot.y, dot.radius * 2, hardness, r, g, b, a, dot.opacity, 1);
  }
}

export function handleSprayDown(
  ctx: InteractionContext,
): InteractionState | undefined {
  const { layerPos, activeLayer, activeLayerId } = ctx;
  const toolSettings = useToolSettingsStore.getState();
  const editorState = useEditorStore.getState();

  editorState.pushHistory();

  const strokeColor = toolSettings.foregroundColor;
  const state: InteractionState = {
    drawing: true,
    lastPoint: layerPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: 'spray',
    startPoint: null,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
    strokeColor,
  };

  const engine = getEngine();
  if (!engine) return state;

  const size = toolSettings.spraySize;
  const density = toolSettings.sprayDensity;
  const opacity = toolSettings.sprayOpacity / 100;
  const hardness = toolSettings.sprayHardness / 100;
  const color = strokeColor;
  toolSettings.addRecentColor(color);
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;

  emitSprayDabs(engine, activeLayerId, layerPos.x, layerPos.y, size / 2, density, hardness, r, g, b, color.a, opacity);
  editorState.notifyRender();

  return state;
}

export function handleSprayMove(
  ctx: InteractionContext,
  state: InteractionState,
): void {
  if (!state.lastPoint || !state.layerId) return;

  const toolSettings = useToolSettingsStore.getState();
  const engine = getEngine();
  if (!engine) return;

  const layerLocalPos = ctx.layerPos;
  const size = toolSettings.spraySize;
  const density = toolSettings.sprayDensity;
  const opacity = toolSettings.sprayOpacity / 100;
  const hardness = toolSettings.sprayHardness / 100;
  const color = state.strokeColor ?? toolSettings.foregroundColor;
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const brushRadius = size / 2;
  const spacing = Math.max(1, size * 0.3);

  const dx = layerLocalPos.x - state.lastPoint.x;
  const dy = layerLocalPos.y - state.lastPoint.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < spacing) return;

  const steps = Math.max(1, Math.floor(dist / spacing));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = state.lastPoint.x + dx * t;
    const y = state.lastPoint.y + dy * t;
    emitSprayDabs(engine, state.layerId, x, y, brushRadius, density, hardness, r, g, b, color.a, opacity);
  }

  state.lastPoint = layerLocalPos;
  useEditorStore.getState().notifyRender();
}
