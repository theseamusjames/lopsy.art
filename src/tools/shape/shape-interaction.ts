import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { Point } from '../../types';
import { useUIStore } from '../../app/ui-store';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { clearJsPixelData } from '../../app/store/clear-js-pixel-data';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  renderShape as gpuRenderShape,
  saveShapePreview as gpuSaveShapePreview,
  endShapePreview as gpuEndShapePreview,
} from '../../engine-wasm/wasm-bridge';
import { ellipseToPathAnchors, polygonToPathAnchors } from './shape';
import type { PathAnchor } from '../path/path';

const CLICK_THRESHOLD = 4;

/** Map shape mode string to the GPU enum (0 = ellipse, 1 = polygon). */
function shapeModeToU32(mode: 'ellipse' | 'polygon'): number {
  return mode === 'ellipse' ? 0 : 1;
}

/** Snap an edge point so the bounding rectangle preserves the locked aspect. */
function constrainToAspectRatio(center: Point, edge: Point): Point {
  const ts = useToolSettingsStore.getState();
  if (!ts.aspectRatioLocked || ts.aspectRatioW <= 0 || ts.aspectRatioH <= 0) return edge;
  const ratio = ts.aspectRatioW / ts.aspectRatioH;
  let rx = Math.abs(edge.x - center.x);
  let ry = Math.abs(edge.y - center.y);
  if (rx / (ry || 1) > ratio) {
    rx = ry * ratio;
  } else {
    ry = rx / ratio;
  }
  return {
    x: center.x + rx * Math.sign(edge.x - center.x || 1),
    y: center.y + ry * Math.sign(edge.y - center.y || 1),
  };
}

export function handleShapeDown(ctx: InteractionContext): InteractionState {
  const { layerPos, activeLayerId, activeLayer } = ctx;
  const editorState = useEditorStore.getState();
  editorState.pushHistory();

  const ts = useToolSettingsStore.getState();
  if (ts.shapeFillColor) useUIStore.getState().addRecentColor(ts.shapeFillColor);
  if (ts.shapeStrokeColor) useUIStore.getState().addRecentColor(ts.shapeStrokeColor);
  const engine = getEngine();
  if (engine) gpuSaveShapePreview(engine, activeLayerId);

  return {
    drawing: true,
    lastPoint: layerPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: 'shape',
    startPoint: layerPos,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleShapeMove(state: InteractionState, layerLocalPos: Point): void {
  if (!state.startPoint || !state.layerId) return;

  const toolSettings = useToolSettingsStore.getState();
  const constrainedEdge = constrainToAspectRatio(state.startPoint, layerLocalPos);
  const rx = Math.abs(constrainedEdge.x - state.startPoint.x);
  const ry = Math.abs(constrainedEdge.y - state.startPoint.y);
  if (rx < 1 || ry < 1) return;

  const engine = getEngine();
  if (!engine) return;

  const fillColor = toolSettings.shapeFillColor;
  const strokeColor = toolSettings.shapeStrokeColor;
  gpuRenderShape(
    engine, state.layerId,
    shapeModeToU32(toolSettings.shapeMode),
    state.startPoint.x + state.layerStartX,
    state.startPoint.y + state.layerStartY,
    rx * 2, ry * 2,
    fillColor ? fillColor.r / 255 : 0, fillColor ? fillColor.g / 255 : 0,
    fillColor ? fillColor.b / 255 : 0, fillColor ? fillColor.a : 0,
    strokeColor ? strokeColor.r / 255 : 0, strokeColor ? strokeColor.g / 255 : 0,
    strokeColor ? strokeColor.b / 255 : 0, strokeColor ? strokeColor.a : 0,
    toolSettings.shapeStrokeWidth, toolSettings.shapePolygonSides,
    Math.min(toolSettings.shapeCornerRadius, Math.min(rx * 2, ry * 2) / 2),
  );
  clearJsPixelData(state.layerId);
  useEditorStore.getState().notifyRender();
}

export function handleShapeUp(state: InteractionState, layerLocalPos: Point): void {
  if (!state.startPoint) return;

  const engine = getEngine();
  if (engine) gpuEndShapePreview(engine);

  const dx = layerLocalPos.x - state.startPoint.x;
  const dy = layerLocalPos.y - state.startPoint.y;
  const toolSettings = useToolSettingsStore.getState();

  if (Math.sqrt(dx * dx + dy * dy) < CLICK_THRESHOLD) {
    useEditorStore.getState().undo();
    if (toolSettings.shapeOutput === 'path') return;
    useUIStore.getState().setPendingShapeClick({
      center: state.startPoint,
      layerId: state.layerId!,
      layerX: state.layerStartX,
      layerY: state.layerStartY,
    });
    return;
  }

  if (toolSettings.shapeOutput === 'path') {
    // Undo the raster preview that was rendered during drag.
    useEditorStore.getState().undo();

    const constrainedEdge = constrainToAspectRatio(state.startPoint, layerLocalPos);
    const rx = Math.abs(constrainedEdge.x - state.startPoint.x);
    const ry = Math.abs(constrainedEdge.y - state.startPoint.y);
    if (rx < 1 && ry < 1) return;

    const cx = state.startPoint.x + state.layerStartX;
    const cy = state.startPoint.y + state.layerStartY;

    const editorState = useEditorStore.getState();
    let anchors: PathAnchor[];
    if (toolSettings.shapeMode === 'ellipse') {
      anchors = ellipseToPathAnchors(cx, cy, rx, ry);
    } else {
      anchors = polygonToPathAnchors(cx, cy, rx, ry, toolSettings.shapePolygonSides);
    }
    editorState.addPath(anchors, true);
    editorState.notifyRender();
  }
}
