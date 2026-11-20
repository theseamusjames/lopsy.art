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

/** The grid sizes the Mesh Warp controls' Grid size select offers (points per side), and the one a session starts with. */
export const MESH_WARP_GRID_SIZES = [3, 4, 5, 6] as const;
export const DEFAULT_MESH_WARP_GRID_SIZE = 4;

function clampToDoc(rect: Rect, docW: number, docH: number): Rect {
  const x = Math.max(0, Math.min(docW, Math.round(rect.x)));
  const y = Math.max(0, Math.min(docH, Math.round(rect.y)));
  const right = Math.max(0, Math.min(docW, Math.round(rect.x + rect.width)));
  const bottom = Math.max(0, Math.min(docH, Math.round(rect.y + rect.height)));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

/** The document rect a session's grid covers: the selection's bounding box (clamped to the document) when there is one, else the document. */
export function meshWarpBounds(selectionActive: boolean, selectionBounds: Rect | null, docW: number, docH: number): Rect {
  return (selectionActive && selectionBounds && selectionBounds.width > 1 && selectionBounds.height > 1)
    ? clampToDoc(selectionBounds, docW, docH)
    : { x: 0, y: 0, width: docW, height: docH };
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
