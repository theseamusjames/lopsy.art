import type { InteractionState, InteractionContext } from '../../app/interactions/interaction-types';
import type { SelectionToolStrategy, SelectionToolId } from '../../app/interactions/selection-strategy';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { getEngine } from '../../engine-wasm/engine-state';
import { flushLayerSync } from '../../engine-wasm/engine-sync';
import {
  floodFill as wasmFloodFill,
  floodFillGraduated as wasmFloodFillGraduated,
  readLayerPixelsForFill as wasmReadLayerPixelsForFill,
} from '../../engine-wasm/wasm-bridge';
import { selectionBounds, commitFeatheredSelection } from '../../app/interactions/selection-handlers';

export const wandStrategy: SelectionToolStrategy = {
  onDown(ctx: InteractionContext, _tool: SelectionToolId): InteractionState | undefined {
    const engine = getEngine();
    if (!engine) return undefined;
    const toolSettings = useToolSettingsStore.getState();
    const wandTolerance = toolSettings.wandTolerance;
    const wandContiguous = toolSettings.wandContiguous;
    const wandGraduated = toolSettings.wandGraduated;
    const editorState = useEditorStore.getState();
    flushLayerSync(editorState);
    const { width: docW, height: docH } = editorState.document;
    const pixelData = wasmReadLayerPixelsForFill(engine, ctx.activeLayerId);
    const cx = Math.round(ctx.canvasPos.x);
    const cy = Math.round(ctx.canvasPos.y);
    const wandMaskRaw = wandGraduated
      ? wasmFloodFillGraduated(pixelData, docW, docH, cx, cy, wandTolerance, wandContiguous)
      : wasmFloodFill(pixelData, docW, docH, cx, cy, 0, 0, 0, 0, wandTolerance, wandContiguous);
    const wandMask = new Uint8ClampedArray(wandMaskRaw.buffer, wandMaskRaw.byteOffset, wandMaskRaw.byteLength);
    const wandBounds = selectionBounds(wandMask, docW, docH);
    if (wandBounds) {
      commitFeatheredSelection(wandBounds, wandMask, docW, docH);
    }
    return undefined;
  },
};
