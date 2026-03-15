import type { InteractionState, InteractionContext } from './interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from './interaction-types';
import type { Point } from '../../types';
import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { useToolSettingsStore } from '../tool-settings-store';
import { createRectSelection, createEllipseSelection, selectionBounds } from '../../selection/selection';
import { floodFill } from '../../tools/fill/fill';
import { OffsetSurface } from '../../engine/pixel-data';
import { createPolygonMask } from '../../tools/lasso/lasso';
import { createTransformState } from '../../tools/transform/transform';
import { snapPositionToGrid } from '../../tools/move/move';

export function handleSelectionDown(
  ctx: InteractionContext,
  tool: 'marquee-rect' | 'marquee-ellipse' | 'wand' | 'lasso',
): InteractionState | undefined {
  const { canvasPos, activeLayerId, activeLayer, pixelBuffer } = ctx;

  if (tool === 'marquee-rect' || tool === 'marquee-ellipse') {
    useUIStore.getState().setTransform(null);
    ctx.persistentTransformRef.current = null;
    ctx.floatingSelectionRef.current = null;
    return {
      drawing: true,
      lastPoint: canvasPos,
      pixelBuffer: null,
      originalPixelBuffer: null,
      layerId: activeLayerId,
      tool,
      startPoint: canvasPos,
      layerStartX: 0,
      layerStartY: 0,
      ...DEFAULT_TRANSFORM_FIELDS,
    };
  }

  if (tool === 'wand') {
    const toolSettings = useToolSettingsStore.getState();
    const wandTolerance = toolSettings.wandTolerance;
    const wandContiguous = toolSettings.wandContiguous;
    const editorState = useEditorStore.getState();
    const { width: docW, height: docH } = editorState.document;
    const canvasSurface = new OffsetSurface(pixelBuffer, docW, docH, activeLayer.x, activeLayer.y);
    const wandPixels = floodFill(canvasSurface, canvasPos.x, canvasPos.y, { r: 0, g: 0, b: 0, a: 0 }, wandTolerance, wandContiguous);
    const wandMask = new Uint8ClampedArray(docW * docH);
    for (const pt of wandPixels) {
      if (pt.x >= 0 && pt.x < docW && pt.y >= 0 && pt.y < docH) {
        wandMask[pt.y * docW + pt.x] = 255;
      }
    }
    const wandBounds = selectionBounds(wandMask, docW, docH);
    if (wandBounds) {
      editorState.setSelection(wandBounds, wandMask, docW, docH);
      useUIStore.getState().setTransform(createTransformState(wandBounds));
    }
    return undefined;
  }

  // lasso
  useUIStore.getState().setLassoPoints([canvasPos]);
  return {
    drawing: true,
    lastPoint: canvasPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: 'lasso',
    startPoint: canvasPos,
    layerStartX: 0,
    layerStartY: 0,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleSelectionMove(
  state: InteractionState,
  canvasPos: Point,
): void {
  if (state.tool === 'marquee-rect' || state.tool === 'marquee-ellipse') {
    if (!state.startPoint) return;
    const editorState = useEditorStore.getState();
    let mStart = state.startPoint;
    let mEnd = canvasPos;
    const uiMarquee = useUIStore.getState();
    if (uiMarquee.showGrid && uiMarquee.snapToGrid) {
      mStart = snapPositionToGrid(mStart.x, mStart.y, uiMarquee.gridSize);
      mEnd = snapPositionToGrid(mEnd.x, mEnd.y, uiMarquee.gridSize);
    }
    const x = Math.min(mStart.x, mEnd.x);
    const y = Math.min(mStart.y, mEnd.y);
    const w = Math.abs(mEnd.x - mStart.x);
    const h = Math.abs(mEnd.y - mStart.y);

    if (w > 0 && h > 0) {
      const selRect = { x, y, width: w, height: h };
      const mask = state.tool === 'marquee-rect'
        ? createRectSelection(selRect, editorState.document.width, editorState.document.height)
        : createEllipseSelection(selRect, editorState.document.width, editorState.document.height);
      editorState.setSelection(selRect, mask, editorState.document.width, editorState.document.height);
      useUIStore.getState().setTransform(createTransformState(selRect));
    }
    return;
  }

  if (state.tool === 'lasso') {
    const lassoPoints = useUIStore.getState().lassoPoints;
    useUIStore.getState().setLassoPoints([...lassoPoints, canvasPos]);
    useEditorStore.getState().notifyRender();
  }
}

export function handleSelectionUp(
  state: InteractionState,
  _canvasPos: Point,
  screenToCanvas: (sx: number, sy: number) => Point,
  containerRef: React.RefObject<HTMLDivElement | null>,
  e: { clientX: number; clientY: number },
): void {
  if (state.tool === 'marquee-rect' || state.tool === 'marquee-ellipse') {
    if (state.startPoint) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const upPos = screenToCanvas(screenX, screenY);
        const dx = Math.abs(upPos.x - state.startPoint.x);
        const dy = Math.abs(upPos.y - state.startPoint.y);
        if (dx < 2 && dy < 2) {
          useEditorStore.getState().clearSelection();
          useUIStore.getState().setTransform(null);
        }
      }
    }
    return;
  }

  if (state.tool === 'lasso') {
    const lassoPoints = useUIStore.getState().lassoPoints;
    if (lassoPoints.length >= 3) {
      const editorState = useEditorStore.getState();
      const { width: docW, height: docH } = editorState.document;
      const lassoMask = createPolygonMask(lassoPoints, docW, docH);
      const lassoBounds = selectionBounds(lassoMask, docW, docH);
      if (lassoBounds) {
        editorState.setSelection(lassoBounds, lassoMask, docW, docH);
        useUIStore.getState().setTransform(createTransformState(lassoBounds));
      }
    }
    useUIStore.getState().clearLassoPoints();
  }
}
