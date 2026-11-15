import type { InteractionState, InteractionContext } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { SelectionToolStrategy, SelectionToolId } from '../../app/interactions/selection-strategy';
import type { Point } from '../../types';
import { useUIStore } from '../../app/ui-store';
import { useEditorStore } from '../../app/editor-store';
import { createPolygonMask, selectionBounds, commitSelectionShape, hasCombinableSelection } from '../../app/interactions/selection-handlers';
import { selectionCombineMode } from '../../selection/selection';

export const lassoStrategy: SelectionToolStrategy = {
  onDown(ctx: InteractionContext, _tool: SelectionToolId): InteractionState | undefined {
    useUIStore.getState().setLassoPoints([ctx.canvasPos]);
    return {
      drawing: true,
      lastPoint: ctx.canvasPos,
      layerId: ctx.activeLayerId,
      tool: 'lasso',
      startPoint: ctx.canvasPos,
      layerStartX: 0,
      layerStartY: 0,
      selectionCombineMode: selectionCombineMode(ctx, hasCombinableSelection()),
      ...DEFAULT_TRANSFORM_FIELDS,
    };
  },

  onMove(_state: InteractionState, canvasPos: Point): void {
    const lassoPoints = useUIStore.getState().lassoPoints;
    useUIStore.getState().setLassoPoints([...lassoPoints, canvasPos]);
    useEditorStore.getState().notifyRender();
  },

  onUp(state: InteractionState): void {
    const lassoPoints = useUIStore.getState().lassoPoints;
    if (lassoPoints.length >= 3) {
      const editorState = useEditorStore.getState();
      const { width: docW, height: docH } = editorState.document;
      const lassoMask = createPolygonMask(lassoPoints, docW, docH);
      const lassoBounds = selectionBounds(lassoMask, docW, docH);
      if (lassoBounds) {
        commitSelectionShape(lassoBounds, lassoMask, docW, docH, state.selectionCombineMode ?? 'replace');
      }
    }
    useUIStore.getState().clearLassoPoints();
  },
};
