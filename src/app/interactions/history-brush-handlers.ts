import type { InteractionState, InteractionContext } from './interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from './interaction-types';
import type { Point } from '../../types';
import { useEditorStore } from '../editor-store';
import { useToolSettingsStore } from '../tool-settings-store';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  historyBrushBegin,
  historyBrushEnd,
  applyHistoryBrushDabBatch,
} from '../../engine-wasm/wasm-bridge';
import { resolveHistorySource } from '../../tools/history-brush/history-brush';

function interpolateFlat(from: Point, to: Point, spacing: number): Float64Array {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < spacing) return new Float64Array([to.x, to.y]);
  const steps = Math.floor(dist / spacing);
  const arr = new Float64Array(steps * 2);
  for (let i = 0; i < steps; i++) {
    const t = ((i + 1) * spacing) / dist;
    arr[i * 2] = from.x + dx * t;
    arr[i * 2 + 1] = from.y + dy * t;
  }
  return arr;
}

export function handleHistoryBrushDown(ctx: InteractionContext): InteractionState | undefined {
  const { layerPos, activeLayerId, activeLayer } = ctx;
  const editorState = useEditorStore.getState();
  const toolSettings = useToolSettingsStore.getState();

  const resolution = resolveHistorySource(
    toolSettings.historyBrushSourceId,
    activeLayerId,
    editorState.undoStack,
    editorState.originSnapshotId,
  );

  if (resolution.kind !== 'ok') {
    // Auto-clear stale sources so the History panel gutter reflects reality.
    if (resolution.kind === 'snapshot-gone' && toolSettings.historyBrushSourceId !== null) {
      toolSettings.setHistoryBrushSourceId(null);
    }
    return undefined;
  }

  const engine = getEngine();
  if (!engine) return undefined;

  editorState.pushHistory();

  const blob = resolution.blob ?? new Uint8Array(0);
  try {
    historyBrushBegin(engine, activeLayerId, blob);
  } catch {
    return undefined;
  }

  const size = toolSettings.historyBrushSize;
  const hardness = toolSettings.historyBrushHardness / 100;
  const opacity = toolSettings.historyBrushOpacity / 100;

  applyHistoryBrushDabBatch(
    engine,
    activeLayerId,
    new Float64Array([layerPos.x, layerPos.y]),
    size,
    hardness,
    opacity,
  );
  editorState.notifyRender();

  return {
    drawing: true,
    lastPoint: layerPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: 'history-brush',
    startPoint: null,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleHistoryBrushMove(state: InteractionState, layerLocalPos: Point): void {
  if (!state.lastPoint || !state.layerId) return;
  const engine = getEngine();
  if (!engine) return;

  const toolSettings = useToolSettingsStore.getState();
  const size = toolSettings.historyBrushSize;
  const hardness = toolSettings.historyBrushHardness / 100;
  const opacity = toolSettings.historyBrushOpacity / 100;
  const spacing = Math.max(1, size * 0.25);

  const pts = interpolateFlat(state.lastPoint, layerLocalPos, spacing);
  applyHistoryBrushDabBatch(engine, state.layerId, pts, size, hardness, opacity);
  state.lastPoint = layerLocalPos;
  useEditorStore.getState().notifyRender();
}

export function handleHistoryBrushUp(): void {
  const engine = getEngine();
  if (engine) historyBrushEnd(engine);
}
