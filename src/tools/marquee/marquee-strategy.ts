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
import { getMarqueePreview, setMarqueePreview } from './marquee-preview';

export const marqueeStrategy: SelectionToolStrategy = {
  onDown(ctx: InteractionContext, tool: SelectionToolId): InteractionState | undefined {
    const { canvasPos, activeLayerId } = ctx;
    const editorState = useEditorStore.getState();
    const sel = editorState.selection;
    const cx = Math.round(canvasPos.x);
    const cy = Math.round(canvasPos.y);
    setMarqueePreview(null);
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
      layerId: activeLayerId,
      tool,
      startPoint: canvasPos,
      layerStartX: 0,
      layerStartY: 0,
      ...DEFAULT_TRANSFORM_FIELDS,
    };
  },

  // While dragging, only a tiny analytic preview is updated — no mask is built
  // and nothing crosses the WASM bridge. The full mask is materialised once on
  // pointer up. This keeps the marquee fast on large canvases, where building
  // and uploading a multi-MB mask per pointer event collapsed to <1fps.
  onMove(state: InteractionState, canvasPos: Point, metaKey: boolean): void {
    if (!state.startPoint) return;

    if (state.moveOriginalMask && state.moveOriginalBounds) {
      const dx = Math.round(canvasPos.x - state.startPoint.x);
      const dy = Math.round(canvasPos.y - state.startPoint.y);
      setMarqueePreview({ kind: 'move', dx, dy });
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
      setMarqueePreview({
        kind: state.tool === 'marquee-rect' ? 'rect' : 'ellipse',
        rect: { x, y, width: w, height: h },
      });
    } else {
      setMarqueePreview(null);
    }
  },

  onUp(state: InteractionState, _canvasPos: Point, upCtx: SelectionUpContext): void {
    if (state.gesture.kind === 'transform' && state.gesture.selectionOnly) {
      useUIStore.getState().setActiveTransformHandle(null);
      return;
    }

    const preview = getMarqueePreview();
    setMarqueePreview(null);
    const editorState = useEditorStore.getState();
    const { width: docW, height: docH } = editorState.document;

    // Commit a moved selection: translate the original mask by the final
    // delta. Only the original bounding box holds content, so the copy walks
    // that region rather than the whole document.
    if (state.moveOriginalMask && state.moveOriginalBounds) {
      if (!preview || preview.kind !== 'move' || (preview.dx === 0 && preview.dy === 0)) {
        return;
      }
      const { dx, dy } = preview;
      const orig = state.moveOriginalBounds;
      const srcMask = state.moveOriginalMask;
      const newMask = new Uint8ClampedArray(srcMask.length);
      const rx0 = Math.max(0, Math.floor(orig.x));
      const ry0 = Math.max(0, Math.floor(orig.y));
      const rx1 = Math.min(docW, Math.ceil(orig.x + orig.width));
      const ry1 = Math.min(docH, Math.ceil(orig.y + orig.height));
      for (let sy = ry0; sy < ry1; sy++) {
        const ty = sy + dy;
        if (ty < 0 || ty >= docH) continue;
        const srcRow = sy * docW;
        const dstRow = ty * docW;
        for (let sx = rx0; sx < rx1; sx++) {
          const v = srcMask[srcRow + sx]!;
          if (v === 0) continue;
          const tx = sx + dx;
          if (tx < 0 || tx >= docW) continue;
          newMask[dstRow + tx] = v;
        }
      }
      const newBounds = { x: orig.x + dx, y: orig.y + dy, width: orig.width, height: orig.height };
      editorState.setSelection(newBounds, newMask, docW, docH);
      useUIStore.getState().setTransform(createTransformState(newBounds));
      return;
    }

    // Commit a freshly drawn marquee.
    if (!state.startPoint) return;
    const rect = upCtx.containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const screenX = upCtx.event.clientX - rect.left;
    const screenY = upCtx.event.clientY - rect.top;
    const upPos = upCtx.screenToCanvas(screenX, screenY);
    const dx = Math.abs(upPos.x - state.startPoint.x);
    const dy = Math.abs(upPos.y - state.startPoint.y);

    if ((dx < 2 && dy < 2) || !preview || preview.kind === 'move') {
      editorState.clearSelection();
      useUIStore.getState().setTransform(null);
      return;
    }

    const selRect = preview.rect;
    const mask = preview.kind === 'ellipse'
      ? createEllipseSelection(selRect, docW, docH)
      : createRectSelection(selRect, docW, docH);
    commitFeatheredSelection(selRect, mask, docW, docH);
  },
};
