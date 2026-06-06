import type { InteractionState, InteractionContext } from '../../app/interactions/interaction-types';
import type { SelectionToolStrategy, SelectionToolId } from '../../app/interactions/selection-strategy';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  floodFill as wasmFloodFill,
  floodFillGraduated as wasmFloodFillGraduated,
  readLayerPixelsForFill as wasmReadLayerPixelsForFill,
} from '../../engine-wasm/wasm-bridge';
import { selectionBounds, commitFeatheredSelection } from '../../app/interactions/selection-handlers';
import { combineSelections } from '../../selection/selection';

export const wandStrategy: SelectionToolStrategy = {
  onDown(ctx: InteractionContext, _tool: SelectionToolId): InteractionState | undefined {
    const engine = getEngine();
    if (!engine) return undefined;
    const { tolerance: wandTolerance, contiguous: wandContiguous, graduated: wandGraduated }
      = useToolSettingsStore.getState().settings.wand;
    const editorState = useEditorStore.getState();
    const { width: docW, height: docH } = editorState.document;
    const pixelData = wasmReadLayerPixelsForFill(engine, ctx.activeLayerId);
    const cx = Math.round(ctx.canvasPos.x);
    const cy = Math.round(ctx.canvasPos.y);
    const wandMaskRaw = wandGraduated
      ? wasmFloodFillGraduated(pixelData, docW, docH, cx, cy, wandTolerance, wandContiguous)
      : wasmFloodFill(pixelData, docW, docH, cx, cy, 0, 0, 0, 0, wandTolerance, wandContiguous);
    const wandMask = new Uint8ClampedArray(wandMaskRaw.buffer, wandMaskRaw.byteOffset, wandMaskRaw.byteLength);

    // Shift adds to the existing selection, Alt subtracts from it. Without a
    // modifier (or a matching existing selection) the wand replaces it.
    const existing = editorState.selection;
    const existingMask =
      existing.active &&
      existing.mask !== null &&
      existing.maskWidth === docW &&
      existing.maskHeight === docH
        ? existing.mask
        : null;
    let finalMask = wandMask;
    if (existingMask && (ctx.shiftKey || ctx.altKey)) {
      finalMask = combineSelections(existingMask, wandMask, ctx.shiftKey ? 'add' : 'subtract');
    }

    const finalBounds = selectionBounds(finalMask, docW, docH);
    if (finalBounds) {
      commitFeatheredSelection(finalBounds, finalMask, docW, docH);
    } else {
      editorState.clearSelection();
    }
    return undefined;
  },
};
