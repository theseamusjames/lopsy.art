/**
 * Liquify tool actions — open/close the session and commit/cancel the warp.
 *
 * The original layer texture is saved on the GPU via saveFilterPreview.
 * A persistent displacement texture lives on the GPU for the session
 * lifetime. Each brush dab encodes only the dirty sub-rectangle and
 * uploads it via texSubImage2D, then the shader renders the warp.
 */

import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  saveFilterPreview,
  restoreFilterPreview,
  clearFilterPreview,
  liquifyInitDisplacement,
  liquifyUploadRegion,
  liquifyRender,
  liquifyRelease,
} from '../../engine-wasm/wasm-bridge';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import {
  createDisplacementMap,
  encodeDisplacementMap,
  MAX_DISP,
  defaultLiquifySettings,
} from '../../tools/liquify/liquify';
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

  const displacementMap = createDisplacementMap(width, height);
  const encodedDisplacement = new Uint8Array(width * height * 4);
  encodeDisplacementMap(displacementMap, encodedDisplacement);
  liquifyInitDisplacement(engine, encodedDisplacement, width, height);

  const session: LiquifySession = {
    layerId: activeId,
    layerWidth: width,
    layerHeight: height,
    displacementMap,
    encodedDisplacement,
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

  clearJsPixelData(session.layerId);
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

/**
 * Upload a dirty sub-rectangle to the GPU displacement texture and
 * re-render the warp. Called from the interaction handler after each dab.
 */
export function previewLiquifyRegion(
  subData: Uint8Array,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): void {
  const session = useUIStore.getState().liquify;
  if (!session) return;

  const engine = getEngine();
  if (!engine) return;

  liquifyUploadRegion(engine, subData, rx, ry, rw, rh);
  liquifyRender(engine, session.layerId, MAX_DISP);
  clearJsPixelData(session.layerId);
  useEditorStore.getState().notifyRender();
}
