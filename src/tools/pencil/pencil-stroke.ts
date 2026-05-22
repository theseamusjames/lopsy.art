import type { InteractionState } from '../../app/interactions/interaction-types';
import type { Engine } from '../../engine-wasm/wasm-bridge';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { useEditorStore } from '../../app/editor-store';
import { drawPencilLine as gpuDrawPencilLine } from '../../engine-wasm/wasm-bridge';
import type { SymmetryConfig } from '../symmetry';
import { isSymmetryActive, getMirroredPoints } from '../symmetry';

export function handlePencilStroke(
  engine: Engine,
  state: InteractionState,
  layerLocalPos: { x: number; y: number },
  sym: SymmetryConfig,
): void {
  if (!state.lastPoint || !state.layerId) return;

  const toolSettings = useToolSettingsStore.getState();
  const color = state.strokeColor ?? toolSettings.foregroundColor;
  const size = toolSettings.pencilSize;
  gpuDrawPencilLine(engine, state.layerId,
    state.lastPoint.x, state.lastPoint.y, layerLocalPos.x, layerLocalPos.y,
    color.r / 255, color.g / 255, color.b / 255, color.a, size);
  if (isSymmetryActive(sym)) {
    const mFrom = getMirroredPoints(state.lastPoint.x, state.lastPoint.y, sym);
    const mTo = getMirroredPoints(layerLocalPos.x, layerLocalPos.y, sym);
    for (let i = 0; i < mFrom.length; i++) {
      gpuDrawPencilLine(engine, state.layerId,
        mFrom[i]!.x, mFrom[i]!.y, mTo[i]!.x, mTo[i]!.y,
        color.r / 255, color.g / 255, color.b / 255, color.a, size);
    }
  }
  state.lastPoint = layerLocalPos;
  useEditorStore.getState().notifyRender();
}
