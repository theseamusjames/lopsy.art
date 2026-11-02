import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { useUIStore } from '../../app/ui-store';
import { toDocumentColor } from '../../app/document-color';
import { markMaskDataStale } from '../../app/mask-data-sync';
import { getQuickMaskPaintMode } from '../../app/interactions/quick-mask-paint';
import { getEngine } from '../../engine-wasm/engine-state';
import { uploadLayerMaskIfChanged } from '../../engine-wasm/engine-sync';
import {
  applyBrushDab as gpuBrushDab,
  paintMaskDab as gpuMaskDab,
  paintQuickMaskDab as gpuQuickMaskDab,
} from '../../engine-wasm/wasm-bridge';
import type { Layer } from '../../types';
import { generateSprayDots, sprayDabHardness } from './spray';
import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';

const SPRAY_INTERVAL_MS = 166;

/**
 * Where a spray stroke lands. In a mask mode the canvas skips the shared
 * paint setup (history push, beginStroke), so painting the layer there left
 * dots with no undo entry, offset by any layer move (#1342). Mask strokes
 * paint the mask in document space instead, as the Brush does.
 */
type SprayTarget =
  | { kind: 'layer' }
  | { kind: 'layerMask'; mode: number }
  | { kind: 'quickMask'; mode: number };

const LAYER_TARGET: SprayTarget = { kind: 'layer' };

let sprayTimer: ReturnType<typeof setInterval> | null = null;
// #793 — the airbrush timer used to read `state.lastPoint`, but the
// interaction dispatcher hands each move handler a shallow COPY of the
// state (see `withMoveGesture`/`withToolGesture`), so subsequent
// mutations never reach the closure the timer captured — the timer kept
// spraying at the pointer-DOWN position forever. Track the live cursor
// at module scope instead, and let the timer read from there.
let sprayCursor: {
  layerId: string;
  target: SprayTarget;
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
  target: SprayTarget,
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
    if (target.kind === 'layerMask') {
      gpuMaskDab(engine, layerId, dot.x, dot.y, dot.radius * 2, hardness, dot.opacity, target.mode);
    } else if (target.kind === 'quickMask') {
      gpuQuickMaskDab(engine, dot.x, dot.y, dot.radius * 2, hardness, dot.opacity, target.mode);
    } else {
      gpuBrushDab(engine, layerId, dot.x, dot.y, dot.radius * 2, hardness, r, g, b, a, dot.opacity, 1, 0, 0, 0);
    }
  }
}

/** The spray target for the current mask mode, or null when there is nothing to paint. */
function resolveSprayTarget(activeLayer: Layer): SprayTarget | null {
  const maskMode = useUIStore.getState().maskMode;
  if (maskMode === 'quickMask') {
    return { kind: 'quickMask', mode: getQuickMaskPaintMode('brush', useToolSettingsStore.getState().foregroundColor) };
  }
  if (maskMode === 'layerMask') {
    // Brush semantics on a layer mask: painting hides.
    return activeLayer.mask ? { kind: 'layerMask', mode: 1 } : null;
  }
  return LAYER_TARGET;
}

/** History and mask upload that the shared paint setup does for layer strokes. */
function beginMaskSpray(engine: NonNullable<ReturnType<typeof getEngine>> | null, target: SprayTarget, activeLayer: Layer): void {
  const editorState = useEditorStore.getState();
  if (target.kind === 'quickMask') {
    editorState.pushHistory('Quick Mask Paint');
    return;
  }
  if (target.kind !== 'layerMask' || !activeLayer.mask) return;
  editorState.pushHistory('Mask Paint');
  markMaskDataStale(activeLayer.id);
  if (engine) {
    uploadLayerMaskIfChanged(engine, activeLayer.id, activeLayer.mask.data, activeLayer.mask.width, activeLayer.mask.height);
  }
}

function sprayAtCurrentPosition(): void {
  const cursor = sprayCursor;
  if (!cursor) return;

  const engine = getEngine();
  if (!engine) return;

  const toolSettings = useToolSettingsStore.getState();
  const { size, density, opacity: opacityPct, softness } = toolSettings.settings.spray;
  const opacity = opacityPct / 100;
  const hardness = sprayDabHardness(softness);
  const color = toDocumentColor(cursor.strokeColor ?? toolSettings.foregroundColor);
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;

  emitSprayDabs(engine, cursor.target, cursor.layerId, cursor.point.x, cursor.point.y, size / 2, density, hardness, r, g, b, color.a, opacity);
  useEditorStore.getState().notifyRender();
}

export function handleSprayDown(
  ctx: InteractionContext,
): InteractionState | undefined {
  const { activeLayer, activeLayerId } = ctx;
  const toolSettings = useToolSettingsStore.getState();
  const editorState = useEditorStore.getState();
  const target = resolveSprayTarget(activeLayer);
  if (!target) return undefined;
  const isMaskTarget = target.kind !== 'layer';
  // Masks are painted in document space, the layer in layer space.
  const pos = isMaskTarget ? ctx.canvasPos : ctx.layerPos;

  // NOTE: for layer strokes, history + beginStroke are already handled by
  // the shared paint dispatch in useCanvasInteraction for isPaint tools. A pushHistory
  // here would run endStroke first and drop the stroke texture, which is
  // exactly how spray ended up MAX-blending premultiplied dabs straight
  // onto the layer and rendering grey speckles on a transparent layer
  // (#787). Emit dabs into the shared stroke texture instead.

  const strokeColor = toDocumentColor(toolSettings.foregroundColor);
  const state: InteractionState = {
    drawing: true,
    lastPoint: pos,
    layerId: activeLayerId,
    tool: 'spray',
    startPoint: null,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
    strokeColor,
    maskMode: isMaskTarget,
  };

  const engine = getEngine();
  beginMaskSpray(engine, target, activeLayer);
  if (!engine) return state;

  const { size, density, opacity: opacityPct, softness } = toolSettings.settings.spray;
  const opacity = opacityPct / 100;
  const hardness = sprayDabHardness(softness);
  const color = strokeColor;
  toolSettings.addRecentColor(color);
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;

  emitSprayDabs(engine, target, activeLayerId, pos.x, pos.y, size / 2, density, hardness, r, g, b, color.a, opacity);
  editorState.notifyRender();

  clearSprayTimer();
  sprayCursor = {
    layerId: activeLayerId,
    target,
    point: { x: pos.x, y: pos.y },
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

  const target = sprayCursor?.layerId === state.layerId ? sprayCursor.target : LAYER_TARGET;
  const pos = target.kind === 'layer' ? ctx.layerPos : ctx.canvasPos;
  const { size, density, opacity: opacityPct, softness } = toolSettings.settings.spray;
  const opacity = opacityPct / 100;
  const hardness = sprayDabHardness(softness);
  const color = toDocumentColor(state.strokeColor ?? toolSettings.foregroundColor);
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const brushRadius = size / 2;
  const spacing = Math.max(1, size * 0.3);

  const dx = pos.x - state.lastPoint.x;
  const dy = pos.y - state.lastPoint.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // #793 — keep the airbrush timer aimed at the LIVE cursor position,
  // regardless of whether the step-spacing loop below emits this frame.
  // Without this the timer stayed pinned at pointer-down forever
  // because the interaction dispatcher shallow-copies state and the
  // timer closed over the pre-copy `lastPoint`.
  if (sprayCursor && sprayCursor.layerId === state.layerId) {
    sprayCursor.point = { x: pos.x, y: pos.y };
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
    emitSprayDabs(engine, target, state.layerId, x, y, brushRadius, density, hardness, r, g, b, color.a, opacity);
  }

  state.lastPoint = pos;
  useEditorStore.getState().notifyRender();
}

export function handleSprayUp(): void {
  clearSprayTimer();
}
