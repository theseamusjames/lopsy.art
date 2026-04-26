import { useEditorStore } from '../editor-store';
import { getEngine } from '../../engine-wasm/engine-state';
import { saveFilterPreview, restoreFilterPreview, clearFilterPreview } from '../../engine-wasm/wasm-bridge';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { applyMeshWarpGpu } from '../../filters/mesh-warp';
import type { MeshWarpGrid } from '../../filters/mesh-warp';
import type { Rect } from '../../types';

function getDocSize(): { w: number; h: number } {
  const doc = useEditorStore.getState().document;
  return { w: doc.width, h: doc.height };
}

export function applyMeshWarp(grid: MeshWarpGrid, bounds: Rect): void {
  const activeId = useEditorStore.getState().document.activeLayerId;
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;
  const { w, h } = getDocSize();

  useEditorStore.getState().pushHistory('Mesh Warp');
  applyMeshWarpGpu(engine, activeId, grid, bounds, w, h);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

export function beginMeshWarpPreview(): void {
  const activeId = useEditorStore.getState().document.activeLayerId;
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;
  saveFilterPreview(engine, activeId);
}

export function previewMeshWarp(grid: MeshWarpGrid, bounds: Rect): void {
  const activeId = useEditorStore.getState().document.activeLayerId;
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
  const activeId = useEditorStore.getState().document.activeLayerId;
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;
  const { w, h } = getDocSize();

  restoreFilterPreview(engine);
  clearFilterPreview(engine);

  useEditorStore.getState().pushHistory('Mesh Warp');
  applyMeshWarpGpu(engine, activeId, grid, bounds, w, h);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}
