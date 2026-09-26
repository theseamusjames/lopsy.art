import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { toDocumentColor } from '../../app/document-color';
import { getEngine } from '../../engine-wasm/engine-state';
import { applyBrushDab as gpuBrushDab } from '../../engine-wasm/wasm-bridge';
import { generateSprayDots } from './spray';
import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';

const SPRAY_INTERVAL_MS = 166;

let sprayTimer: ReturnType<typeof setInterval> | null = null;
// #793 — the airbrush timer used to read `state.lastPoint`, but the
// interaction dispatcher hands each move handler a shallow COPY of the
// state (see `withMoveGesture`/`withToolGesture`), so subsequent
// mutations never reach the closure the timer captured — the timer kept
// spraying at the pointer-DOWN position forever. Track the live cursor
// at module scope instead, and let the timer read from there.
let sprayCursor: {
  layerId: string;
  point: { x: number; y: number };
  strokeColor: { r: number; g: number; b: number; a: number } | null;
} | null = null;

function clearSprayTimer(): void {
  if (sprayTimer !== null) {
    clearInterval(sprayTimer);
    sprayTimer = null;
  }
  sprayCursor = null;
}

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
    gpuBrushDab(engine, layerId, dot.x, dot.y, dot.radius * 2, hardness, r, g, b, a, dot.opacity, 1, 0, 0, 0);
  }
}

function sprayAtCurrentPosition(): void {
  const cursor = sprayCursor;
  if (!cursor) return;

  const engine = getEngine();
  if (!engine) return;

  const toolSettings = useToolSettingsStore.getState();
  const { size, density, opacity: opacityPct, hardness: hardnessPct } = toolSettings.settings.spray;
  const opacity = opacityPct / 100;
  const hardness = hardnessPct / 100;
  const color = toDocumentColor(cursor.strokeColor ?? toolSettings.foregroundColor);
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;

  emitSprayDabs(engine, cursor.layerId, cursor.point.x, cursor.point.y, size / 2, density, hardness, r, g, b, color.a, opacity);
  useEditorStore.getState().notifyRender();
}

export function handleSprayDown(
  ctx: InteractionContext,
): InteractionState | undefined {
  const { layerPos, activeLayer, activeLayerId } = ctx;
  const toolSettings = useToolSettingsStore.getState();
  const editorState = useEditorStore.getState();

  // NOTE: history + beginStroke are already handled by the shared paint
  // dispatch in useCanvasInteraction for isPaint tools. A pushHistory
  // here would run endStroke first and drop the stroke texture, which is
  // exactly how spray ended up MAX-blending premultiplied dabs straight
  // onto the layer and rendering grey speckles on a transparent layer
  // (#787). Emit dabs into the shared stroke texture instead.

  const strokeColor = toDocumentColor(toolSettings.foregroundColor);
  const state: InteractionState = {
    drawing: true,
    lastPoint: layerPos,
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

  const { size, density, opacity: opacityPct, hardness: hardnessPct } = toolSettings.settings.spray;
  const opacity = opacityPct / 100;
  const hardness = hardnessPct / 100;
  const color = strokeColor;
  toolSettings.addRecentColor(color);
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;

  emitSprayDabs(engine, activeLayerId, layerPos.x, layerPos.y, size / 2, density, hardness, r, g, b, color.a, opacity);
  editorState.notifyRender();

  clearSprayTimer();
  sprayCursor = {
    layerId: activeLayerId,
    point: { x: layerPos.x, y: layerPos.y },
    strokeColor,
  };
  sprayTimer = setInterval(sprayAtCurrentPosition, SPRAY_INTERVAL_MS);

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
  const { size, density, opacity: opacityPct, hardness: hardnessPct } = toolSettings.settings.spray;
  const opacity = opacityPct / 100;
  const hardness = hardnessPct / 100;
  const color = toDocumentColor(state.strokeColor ?? toolSettings.foregroundColor);
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const brushRadius = size / 2;
  const spacing = Math.max(1, size * 0.3);

  const dx = layerLocalPos.x - state.lastPoint.x;
  const dy = layerLocalPos.y - state.lastPoint.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // #793 — keep the airbrush timer aimed at the LIVE cursor position,
  // regardless of whether the step-spacing loop below emits this frame.
  // Without this the timer stayed pinned at pointer-down forever
  // because the interaction dispatcher shallow-copies state and the
  // timer closed over the pre-copy `lastPoint`.
  if (sprayCursor && sprayCursor.layerId === state.layerId) {
    sprayCursor.point = { x: layerLocalPos.x, y: layerLocalPos.y };
  }

  if (dist < spacing) {
    // #793 — DO NOT advance state.lastPoint here. The old code moved
    // the anchor without emitting, so sub-spacing move events discarded
    // their accumulated distance and a slow hand-speed drag emitted
    // only the pointer-down cloud. Keep the anchor pinned; the next
    // move event that finally exceeds `spacing` still triggers dabs.
    return;
  }

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

export function handleSprayUp(): void {
  clearSprayTimer();
}
