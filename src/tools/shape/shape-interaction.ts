import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { Point, Layer } from '../../types';
import { useUIStore, type ShapeSizeClick } from '../../app/ui-store';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { clearJsPixelData } from '../../app/store/clear-js-pixel-data';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  renderShape as gpuRenderShape,
  renderShapeExpanded as gpuRenderShapeExpanded,
  saveShapePreview as gpuSaveShapePreview,
  endShapePreview as gpuEndShapePreview,
  getLayerEngineBounds,
} from '../../engine-wasm/wasm-bridge';
import { ellipseToPathAnchors, polygonToPathAnchors } from './shape';
import type { ShapeMode } from './shape';
import type { PathAnchor } from '../path/path';
import { pixelDataManager } from '../../engine/pixel-data-manager';

const CLICK_THRESHOLD = 4;

function shapeModeToU32(mode: ShapeMode): number {
  return mode === 'ellipse' ? 0 : 1;
}

/** Snap an edge point so the bounding rectangle preserves the locked aspect. */
function constrainToAspectRatio(center: Point, edge: Point, metaKey = false): Point {
  const ts = useToolSettingsStore.getState();
  const locked = metaKey || (ts.aspectRatioLocked && ts.aspectRatioW > 0 && ts.aspectRatioH > 0);
  if (!locked) return edge;
  const ratio = metaKey ? 1 : ts.aspectRatioW / ts.aspectRatioH;
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

function syncLayerBoundsFromEngine(engine: NonNullable<ReturnType<typeof getEngine>>, layerId: string): void {
  const bounds = getLayerEngineBounds(engine, layerId);
  if (!bounds || bounds.length < 4) return;
  const newX = bounds[0]!;
  const newY = bounds[1]!;
  const texW = bounds[2]!;
  const texH = bounds[3]!;

  const docState = useEditorStore.getState().document;
  const layer = docState.layers.find((l) => l.id === layerId);
  if (!layer) return;

  const samePos = newX === layer.x && newY === layer.y;
  const sameSize = layer.type !== 'raster' || (layer.width === texW && layer.height === texH);
  if (samePos && sameSize) return;

  const updatedLayers = docState.layers.map((l) => {
    if (l.id !== layerId) return l;
    if (l.type === 'raster') {
      return { ...l, x: newX, y: newY, width: texW, height: texH } as Layer;
    }
    return { ...l, x: newX, y: newY } as Layer;
  });
  pixelDataManager.remove(layerId);
  const dirtyIds = new Set(useEditorStore.getState().dirtyLayerIds);
  dirtyIds.add(layerId);
  useEditorStore.setState({
    document: { ...docState, layers: updatedLayers },
    dirtyLayerIds: dirtyIds,
  });
}

export function handleShapeDown(ctx: InteractionContext): InteractionState {
  const { layerPos, activeLayerId, activeLayer } = ctx;
  const editorState = useEditorStore.getState();
  editorState.pushHistory('Shape');

  const ts = useToolSettingsStore.getState();
  if (ts.shapeFillColor) ts.addRecentColor(ts.shapeFillColor);
  if (ts.shapeStrokeColor) ts.addRecentColor(ts.shapeStrokeColor);
  const engine = getEngine();
  if (engine) gpuSaveShapePreview(engine, activeLayerId);

  return {
    drawing: true,
    lastPoint: layerPos,
    layerId: activeLayerId,
    tool: 'shape',
    startPoint: layerPos,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleShapeMove(state: InteractionState, layerLocalPos: Point, metaKey = false): void {
  if (!state.startPoint || !state.layerId) return;

  const toolSettings = useToolSettingsStore.getState();
  const constrainedEdge = constrainToAspectRatio(state.startPoint, layerLocalPos, metaKey);
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

/**
 * Apply a shape whose dimensions came from the ShapeSize modal (user clicked
 * instead of dragged — we asked them for the size). Uses the GPU rendering
 * path so shapes that extend beyond the artboard are preserved.
 */
export function confirmShapeSize(width: number, height: number, click: ShapeSizeClick): void {
  const editorState = useEditorStore.getState();
  const ts = useToolSettingsStore.getState();

  editorState.pushHistory('Shape');
  if (ts.shapeFillColor) ts.addRecentColor(ts.shapeFillColor);
  if (ts.shapeStrokeColor) ts.addRecentColor(ts.shapeStrokeColor);

  const engine = getEngine();
  if (!engine) return;

  const cx = click.center.x + click.layerX;
  const cy = click.center.y + click.layerY;

  const fillColor = ts.shapeFillColor;
  const strokeColor = ts.shapeStrokeColor;
  gpuRenderShapeExpanded(
    engine, click.layerId,
    shapeModeToU32(ts.shapeMode),
    cx, cy, width, height,
    fillColor ? fillColor.r / 255 : 0, fillColor ? fillColor.g / 255 : 0,
    fillColor ? fillColor.b / 255 : 0, fillColor ? fillColor.a : 0,
    strokeColor ? strokeColor.r / 255 : 0, strokeColor ? strokeColor.g / 255 : 0,
    strokeColor ? strokeColor.b / 255 : 0, strokeColor ? strokeColor.a : 0,
    ts.shapeStrokeWidth, ts.shapePolygonSides,
    Math.min(ts.shapeCornerRadius, Math.min(width, height) / 2),
  );
  syncLayerBoundsFromEngine(engine, click.layerId);
  clearJsPixelData(click.layerId);
  editorState.notifyRender();
}

export function handleShapeUp(state: InteractionState, layerLocalPos: Point, metaKey = false): void {
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

  if (engine && state.layerId && toolSettings.shapeOutput !== 'path') {
    const constrainedEdge = constrainToAspectRatio(state.startPoint, layerLocalPos, metaKey);
    const rx = Math.abs(constrainedEdge.x - state.startPoint.x);
    const ry = Math.abs(constrainedEdge.y - state.startPoint.y);
    const docCx = state.startPoint.x + state.layerStartX;
    const docCy = state.startPoint.y + state.layerStartY;
    const sw = toolSettings.shapeStrokeWidth;
    const { width: docW, height: docH } = useEditorStore.getState().document;
    if (docCx - rx - sw < 0 || docCy - ry - sw < 0
        || docCx + rx + sw > docW || docCy + ry + sw > docH) {
      const fillColor = toolSettings.shapeFillColor;
      const strokeColor = toolSettings.shapeStrokeColor;
      gpuRenderShapeExpanded(
        engine, state.layerId,
        shapeModeToU32(toolSettings.shapeMode),
        docCx, docCy, rx * 2, ry * 2,
        fillColor ? fillColor.r / 255 : 0, fillColor ? fillColor.g / 255 : 0,
        fillColor ? fillColor.b / 255 : 0, fillColor ? fillColor.a : 0,
        strokeColor ? strokeColor.r / 255 : 0, strokeColor ? strokeColor.g / 255 : 0,
        strokeColor ? strokeColor.b / 255 : 0, strokeColor ? strokeColor.a : 0,
        sw, toolSettings.shapePolygonSides,
        Math.min(toolSettings.shapeCornerRadius, Math.min(rx * 2, ry * 2) / 2),
      );
    }
    syncLayerBoundsFromEngine(engine, state.layerId);
  }

  if (toolSettings.shapeOutput === 'path') {
    // Undo the raster preview that was rendered during drag.
    useEditorStore.getState().undo();

    const constrainedEdge = constrainToAspectRatio(state.startPoint, layerLocalPos, metaKey);
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
