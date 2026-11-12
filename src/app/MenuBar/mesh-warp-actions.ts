import { useEditorStore } from '../editor-store';
import { getEngine } from '../../engine-wasm/engine-state';
import { saveFilterPreview, restoreFilterPreview, clearFilterPreview } from '../../engine-wasm/wasm-bridge';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { applyMeshWarpGpu } from '../../filters/mesh-warp';
import { syncLayerAfterFullSize } from '../sync-layer-after-full-size';
import type { MeshWarpGrid } from '../../filters/mesh-warp';
import type { Rect } from '../../types';
import { canReceiveRasterPaint, guardPixelWrite } from '../../layers/paint-target';

/**
 * The active layer id when it can take the warp. Mesh Warp expands the layer
 * to the document, which would re-origin a text layer (#1395).
 */
function warpTargetId(): string | null {
  const doc = useEditorStore.getState().document;
  const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
  return layer && canReceiveRasterPaint(layer) ? layer.id : null;
}

/** True when a Mesh Warp session may start; otherwise the layer-type toast is shown. */
export function canStartMeshWarp(): boolean {
  const doc = useEditorStore.getState().document;
  return guardPixelWrite(doc.layers.find((l) => l.id === doc.activeLayerId));
}

function getDocSize(): { w: number; h: number } {
  const doc = useEditorStore.getState().document;
  return { w: doc.width, h: doc.height };
}

export function applyMeshWarp(grid: MeshWarpGrid, bounds: Rect): void {
  const activeId = warpTargetId();
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;
  const { w, h } = getDocSize();

  useEditorStore.getState().pushHistory('Mesh Warp');
  applyMeshWarpGpu(engine, activeId, grid, bounds, w, h);
  syncLayerAfterFullSize(engine, activeId);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

export function beginMeshWarpPreview(): void {
  const activeId = warpTargetId();
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;
  saveFilterPreview(engine, activeId);
  // saveFilterPreview expands the layer texture to doc size — reconcile
  // JS bounds so the next syncLayers push does not clobber it (#771).
  syncLayerAfterFullSize(engine, activeId);
}

export function previewMeshWarp(grid: MeshWarpGrid, bounds: Rect): void {
  const activeId = warpTargetId();
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;
  const { w, h } = getDocSize();

  restoreFilterPreview(engine);
  applyMeshWarpGpu(engine, activeId, grid, bounds, w, h);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

export function cancelMeshWarpPreview(): void {
  const engine = getEngine();
  if (!engine) return;
  restoreFilterPreview(engine);
  clearFilterPreview(engine);
  const activeId = useEditorStore.getState().document.activeLayerId;
  if (activeId) {
    clearJsPixelData(activeId);
  }
  useEditorStore.getState().notifyRender();
}

export function applyMeshWarpWithPreview(grid: MeshWarpGrid, bounds: Rect): void {
  const activeId = warpTargetId();
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;
  const { w, h } = getDocSize();

  restoreFilterPreview(engine);
  clearFilterPreview(engine);

  useEditorStore.getState().pushHistory('Mesh Warp');
  applyMeshWarpGpu(engine, activeId, grid, bounds, w, h);
  syncLayerAfterFullSize(engine, activeId);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}
