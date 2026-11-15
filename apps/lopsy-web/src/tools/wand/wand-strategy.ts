import type { InteractionState, InteractionContext } from '../../app/interactions/interaction-types';
import { seedPixel } from '../../app/interactions/interaction-types';
import type { SelectionToolStrategy, SelectionToolId } from '../../app/interactions/selection-strategy';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  floodFill as wasmFloodFill,
  floodFillGraduated as wasmFloodFillGraduated,
  readLayerPixelsForFill as wasmReadLayerPixelsForFill,
} from '../../engine-wasm/wasm-bridge';
import { selectionBounds, commitSelectionShape, hasCombinableSelection } from '../../app/interactions/selection-handlers';
import { selectionCombineMode } from '../../selection/selection';

export const wandStrategy: SelectionToolStrategy = {
  onDown(ctx: InteractionContext, _tool: SelectionToolId): InteractionState | undefined {
    const engine = getEngine();
    if (!engine) return undefined;
    const { tolerance: wandTolerance, contiguous: wandContiguous, graduated: wandGraduated }
      = useToolSettingsStore.getState().settings.wand;
    const editorState = useEditorStore.getState();
    const { width: docW, height: docH } = editorState.document;
    const { x: cx, y: cy } = seedPixel(ctx);
    // The modifiers held at the click decide the mode, not those held
    // when the pixels arrive.
    const mode = selectionCombineMode(ctx, hasCombinableSelection());
    wasmReadLayerPixelsForFill(engine, ctx.activeLayerId)
      .then((pixelData) => {
        const { document } = useEditorStore.getState();
        if (getEngine() !== engine || document.width !== docW || document.height !== docH) return;
        const wandMaskRaw = wandGraduated
          ? wasmFloodFillGraduated(pixelData, docW, docH, cx, cy, wandTolerance, wandContiguous)
          : wasmFloodFill(pixelData, docW, docH, cx, cy, 0, 0, 0, 0, wandTolerance, wandContiguous);
        const wandMask = new Uint8ClampedArray(wandMaskRaw.buffer, wandMaskRaw.byteOffset, wandMaskRaw.byteLength);

        const wandBounds = selectionBounds(wandMask, docW, docH);
        if (wandBounds) {
          commitSelectionShape(wandBounds, wandMask, docW, docH, mode);
        } else if (mode === 'replace') {
          useEditorStore.getState().clearSelection();
        }
      })
      .catch(() => {});
    return undefined;
  },
};
