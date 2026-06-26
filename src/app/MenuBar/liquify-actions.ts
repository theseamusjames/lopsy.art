/**
 * Liquify tool actions — open/close the session and commit/cancel the warp.
 *
 * The displacement field lives entirely on the GPU as an RGBA8 texture.
 * Each brush dab is applied by a GPU shader (liquify_dab.glsl) — no CPU
 * Float32Array or per-pixel encoding needed.
 */

import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  saveFilterPreview,
  restoreFilterPreview,
  clearFilterPreview,
  liquifyInitDisplacement,
  liquifyRender,
  liquifyRelease,
} from '../../engine-wasm/wasm-bridge';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { syncLayerBoundsAfterFilter, syncAndClearLayerAfterFilter } from './filter-layer-sync';
import { MAX_DISP, defaultLiquifySettings } from '../../tools/liquify/liquify';
import type { LiquifySession } from '../ui-store';

export function openLiquify(): void {
  const editorStore = useEditorStore.getState();
  const activeId = editorStore.document.activeLayerId;
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  const layer = editorStore.document.layers.find((l) => l.id === activeId);
  if (!layer || layer.type !== 'raster') return;

  const { width, height } = layer;

  saveFilterPreview(engine, activeId);
  syncLayerBoundsAfterFilter(engine, activeId);

  const zeroed = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    zeroed[i * 4] = 128;
    zeroed[i * 4 + 1] = 0;
    zeroed[i * 4 + 2] = 128;
    zeroed[i * 4 + 3] = 0;
  }
  liquifyInitDisplacement(engine, zeroed, width, height);

  const session: LiquifySession = {
    layerId: activeId,
    layerWidth: width,
    layerHeight: height,
    settings: defaultLiquifySettings(),
  };

  useUIStore.getState().setLiquify(session);
}

export function applyLiquify(): void {
  const ui = useUIStore.getState();
  const session = ui.liquify;
  if (!session) return;

  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory('Liquify');

  liquifyRender(engine, session.layerId, MAX_DISP);

  syncAndClearLayerAfterFilter(engine, session.layerId);
  liquifyRelease(engine);
  clearFilterPreview(engine);
  ui.setLiquify(null);
  useEditorStore.getState().notifyRender();
}

export function cancelLiquify(): void {
  const ui = useUIStore.getState();
  const session = ui.liquify;
  if (!session) return;

  const engine = getEngine();

  if (engine) {
    restoreFilterPreview(engine);
    liquifyRelease(engine);
    clearFilterPreview(engine);
    clearJsPixelData(session.layerId);
  }

  ui.setLiquify(null);
  useEditorStore.getState().notifyRender();
}
