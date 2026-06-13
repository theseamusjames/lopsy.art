import type { InteractionState, InteractionContext } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { SelectionToolStrategy, SelectionToolId } from '../../app/interactions/selection-strategy';
import type { Point } from '../../types';
import { useUIStore } from '../../app/ui-store';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  magneticLassoBegin as wasmMagneticLassoBegin,
  magneticLassoSnap as wasmMagneticLassoSnap,
  magneticLassoSnapPoint as wasmMagneticLassoSnapPoint,
  magneticLassoEnd as wasmMagneticLassoEnd,
} from '../../engine-wasm/wasm-bridge';
import {
  beginLasso,
  updateCursor as magneticUpdateCursor,
  addAnchor as magneticAddAnchor,
  closeLasso as magneticCloseLasso,
  flattenPolyline as magneticFlatten,
  pointsFromFloat32,
  shouldAutoAnchor,
  type MagneticLassoState,
  type SnapFn,
} from './magnetic-lasso';
import { createPolygonMask, selectionBounds, commitFeatheredSelection } from '../../app/interactions/selection-handlers';

let magneticLassoTrace: MagneticLassoState | null = null;

function makeMagneticSnapFn(): SnapFn {
  const engine = getEngine();
  const { magneticLasso } = useToolSettingsStore.getState().settings;
  const radius = magneticLasso.width;
  const threshold = Math.max(1, Math.min(255, Math.round(magneticLasso.contrast * 2.55)));
  return (from, to) => {
    if (!engine) return [from, to];
    const flat = wasmMagneticLassoSnap(engine, from.x, from.y, to.x, to.y, radius, threshold);
    return pointsFromFloat32(flat);
  };
}

function snapCursorToEdge(p: Point): Point {
  const engine = getEngine();
  if (!engine) return p;
  const { magneticLasso } = useToolSettingsStore.getState().settings;
  const radius = magneticLasso.width;
  const threshold = Math.max(1, Math.min(255, Math.round(magneticLasso.contrast * 2.55)));
  const snapped = wasmMagneticLassoSnapPoint(engine, p.x, p.y, radius, threshold);
  return snapped.length >= 2 ? { x: snapped[0]!, y: snapped[1]! } : p;
}

function updateMagneticLassoPreview(state: MagneticLassoState): void {
  const points = magneticFlatten(state);
  useUIStore.getState().setLassoPoints(points);
  useEditorStore.getState().notifyRender();
}

export const magneticLassoStrategy: SelectionToolStrategy = {
  onDown(ctx: InteractionContext, _tool: SelectionToolId): InteractionState | undefined {
    const engine = getEngine();
    if (!engine) return undefined;
    try {
      wasmMagneticLassoBegin(engine, ctx.activeLayerId);
    } catch {
      return undefined;
    }
    const { magneticLasso } = useToolSettingsStore.getState().settings;
    const radius = magneticLasso.width;
    const threshold = Math.max(1, Math.min(255, Math.round(magneticLasso.contrast * 2.55)));
    const snapped = wasmMagneticLassoSnapPoint(engine, ctx.canvasPos.x, ctx.canvasPos.y, radius, threshold);
    const startPoint = snapped.length >= 2
      ? { x: snapped[0]!, y: snapped[1]! }
      : ctx.canvasPos;
    magneticLassoTrace = beginLasso(startPoint);
    updateMagneticLassoPreview(magneticLassoTrace);
    return {
      drawing: true,
      lastPoint: ctx.canvasPos,
      layerId: ctx.activeLayerId,
      tool: 'lasso-magnetic',
      startPoint: ctx.canvasPos,
      layerStartX: 0,
      layerStartY: 0,
      ...DEFAULT_TRANSFORM_FIELDS,
    };
  },

  onMove(_state: InteractionState, canvasPos: Point): void {
    if (!magneticLassoTrace) return;
    const snap = makeMagneticSnapFn();
    let trace = magneticUpdateCursor(magneticLassoTrace, canvasPos, snap);
    const frequency = useToolSettingsStore.getState().settings.magneticLasso.frequency;
    if (shouldAutoAnchor(trace, frequency)) {
      trace = magneticAddAnchor(trace, snapCursorToEdge(canvasPos), snap);
    }
    magneticLassoTrace = trace;
    updateMagneticLassoPreview(trace);
  },

  onUp(): void {
    const engine = getEngine();
    if (magneticLassoTrace && engine) {
      const snap = makeMagneticSnapFn();
      const endPoint = magneticLassoTrace.liveSegment[magneticLassoTrace.liveSegment.length - 1];
      const final = endPoint
        ? magneticAddAnchor(magneticLassoTrace, snapCursorToEdge(endPoint), snap)
        : magneticLassoTrace;
      const polyline = magneticCloseLasso(final, snap);
      if (polyline.length >= 3) {
        const editorState = useEditorStore.getState();
        const { width: docW, height: docH } = editorState.document;
        const mask = createPolygonMask(polyline, docW, docH);
        const bounds = selectionBounds(mask, docW, docH);
        if (bounds) {
          commitFeatheredSelection(bounds, mask, docW, docH);
        }
      }
    }
    if (engine) wasmMagneticLassoEnd(engine);
    magneticLassoTrace = null;
    useUIStore.getState().clearLassoPoints();
  },
};
