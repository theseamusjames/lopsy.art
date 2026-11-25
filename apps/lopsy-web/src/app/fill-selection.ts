import { useEditorStore } from './editor-store';
import { useToolSettingsStore } from './tool-settings-store';
import { clearJsPixelData } from './store/clear-js-pixel-data';
import { getEngine } from '../engine-wasm/engine-state';
import { fillWithColor } from '../engine-wasm/wasm-bridge';
import { syncLayerAfterFullSize } from './sync-layer-after-full-size';
import { guardPixelWrite } from '../layers/paint-target';
import { fillActiveLayerMask } from './fill-layer-mask';

/** Edit > Fill: the selection (or the whole layer) with the foreground colour, or the mask in mask edit mode. */
export function fillSelection(): void {
  const state = useEditorStore.getState();
  const activeId = state.document.activeLayerId;
  if (!activeId) return;

  // #768: refuse the fill on a group or text layer — writing there is
  // either invisible (group) or wiped by the next text re-render.
  const activeLayer = state.document.layers.find((l) => l.id === activeId);
  if (activeLayer?.locked) return;
  if (fillActiveLayerMask(useToolSettingsStore.getState().foregroundColor, 'Mask Fill')) return;
  if (!guardPixelWrite(activeLayer)) return;

  const engine = getEngine();
  if (!engine) return;

  state.pushHistory('Fill');
  const color = useToolSettingsStore.getState().foregroundColor;

  // GPU fill: uses the engine's selection mask if active. `fillWithColor`
  // internally calls `ensure_layer_full_size`, so an untouched 1x1
  // placeholder texture is expanded to doc size before the fill runs
  // (#765). We reconcile the Zustand bounds after so the next syncLayers
  // doesn't push the stale JS values back.
  fillWithColor(engine, activeId, color.r / 255, color.g / 255, color.b / 255, color.a);
  syncLayerAfterFullSize(engine, activeId);

  clearJsPixelData(activeId);
  state.notifyRender();
}
