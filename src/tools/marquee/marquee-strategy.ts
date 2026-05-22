import type { InteractionState, InteractionContext } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { SelectionToolStrategy, SelectionToolId, SelectionUpContext } from '../../app/interactions/selection-strategy';
import type { Point } from '../../types';
import { useUIStore } from '../../app/ui-store';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { getSelectionMaskValue } from '../../selection/selection';
import { getEngine } from '../../engine-wasm/engine-state';
import { hasFloat, dropFloat } from '../../engine-wasm/wasm-bridge';
import { createTransformState } from '../transform/transform';
import { snapPositionToGrid } from '../move/move';
import {
  constrainMarqueeSize,
  createRectSelection,
  createEllipseSelection,
  commitFeatheredSelection,
} from '../../app/interactions/selection-handlers';

export const marqueeStrategy: SelectionToolStrategy = {
  onDown(ctx: InteractionContext, tool: SelectionToolId): InteractionState | undefined {
    const { canvasPos, activeLayerId } = ctx;
    const editorState = useEditorStore.getState();
    const sel = editorState.selection;
    const cx = Math.round(canvasPos.x);
    const cy = Math.round(canvasPos.y);
    if (sel.active && sel.mask && getSelectionMaskValue(sel, cx, cy) > 0) {
      const engine = getEngine();
      if (engine && hasFloat(engine)) {
        dropFloat(engine);
      }
      ctx.floatingSelectionRef.current = null;
      ctx.persistentTransformRef.current = null;
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
        moveOriginalMask: new Uint8ClampedArray(sel.mask),
        moveOriginalBounds: sel.bounds ? { ...sel.bounds } : null,
      };
    }
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
  },

  onMove(state: InteractionState, canvasPos: Point, metaKey: boolean): void {
    if (!state.startPoint) return;

    if (state.moveOriginalMask && state.moveOriginalBounds) {
      const dx = Math.round(canvasPos.x - state.startPoint.x);
      const dy = Math.round(canvasPos.y - state.startPoint.y);
      const orig = state.moveOriginalBounds;
      const editorState = useEditorStore.getState();
      const { width: docW, height: docH } = editorState.document;
      const srcMask = state.moveOriginalMask;
      const newMask = new Uint8ClampedArray(srcMask.length);
      for (let y = 0; y < docH; y++) {
        for (let x = 0; x < docW; x++) {
          const sx = x - dx;
          const sy = y - dy;
          if (sx >= 0 && sx < docW && sy >= 0 && sy < docH) {
            newMask[y * docW + x] = srcMask[sy * docW + sx]!;
          }
        }
      }
      const newBounds = { x: orig.x + dx, y: orig.y + dy, width: orig.width, height: orig.height };
      editorState.setSelection(newBounds, newMask, docW, docH);
      useUIStore.getState().setTransform(createTransformState(newBounds));
      return;
    }

    const editorState = useEditorStore.getState();
    let mStart = state.startPoint;
    let mEnd = canvasPos;
    const uiMarquee = useUIStore.getState();
    if (uiMarquee.showGrid && uiMarquee.snapToGrid) {
      const { width: dw, height: dh } = editorState.document;
      mStart = snapPositionToGrid(mStart.x, mStart.y, uiMarquee.gridSize, dw, dh);
      mEnd = snapPositionToGrid(mEnd.x, mEnd.y, uiMarquee.gridSize, dw, dh);
    }
    const toolSettings = useToolSettingsStore.getState();
    const { w, h } = constrainMarqueeSize(
      mEnd.x - mStart.x,
      mEnd.y - mStart.y,
      {
        metaPressed: metaKey,
        aspectRatioLocked: toolSettings.aspectRatioLocked,
        aspectRatioW: toolSettings.aspectRatioW,
        aspectRatioH: toolSettings.aspectRatioH,
      },
    );
    const x = mEnd.x >= mStart.x ? mStart.x : mStart.x - w;
    const y = mEnd.y >= mStart.y ? mStart.y : mStart.y - h;

    if (w > 0 && h > 0) {
      const selRect = { x, y, width: w, height: h };
      const mask = state.tool === 'marquee-rect'
        ? createRectSelection(selRect, editorState.document.width, editorState.document.height)
        : createEllipseSelection(selRect, editorState.document.width, editorState.document.height);
      editorState.setSelection(selRect, mask, editorState.document.width, editorState.document.height);
      useUIStore.getState().setTransform(createTransformState(selRect));
    }
  },

  onUp(state: InteractionState, _canvasPos: Point, upCtx: SelectionUpContext): void {
    if (state.moveOriginalMask) return;
    if (state.startPoint) {
      const rect = upCtx.containerRef.current?.getBoundingClientRect();
      if (rect) {
        const screenX = upCtx.event.clientX - rect.left;
        const screenY = upCtx.event.clientY - rect.top;
        const upPos = upCtx.screenToCanvas(screenX, screenY);
        const dx = Math.abs(upPos.x - state.startPoint.x);
        const dy = Math.abs(upPos.y - state.startPoint.y);
        if (dx < 2 && dy < 2) {
          useEditorStore.getState().clearSelection();
          useUIStore.getState().setTransform(null);
        } else {
          const sel = useEditorStore.getState().selection;
          if (sel.active && sel.mask) {
            const { width: docW, height: docH } = useEditorStore.getState().document;
            commitFeatheredSelection(sel.bounds!, sel.mask, docW, docH);
          }
        }
      }
    }
  },
};
