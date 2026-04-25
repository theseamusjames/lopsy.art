import { useEditorStore } from '../editor-store';
import { getEngine } from '../../engine-wasm/engine-state';
import { saveFilterPreview, restoreFilterPreview, clearFilterPreview } from '../../engine-wasm/wasm-bridge';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { applyMeshWarpGpu } from '../../filters/mesh-warp';
import type { MeshWarpGrid } from '../../filters/mesh-warp';

export function applyMeshWarp(grid: MeshWarpGrid): void {
  const activeId = useEditorStore.getState().document.activeLayerId;
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory();
  applyMeshWarpGpu(engine, activeId, grid);
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

export function previewMeshWarp(grid: MeshWarpGrid): void {
  const activeId = useEditorStore.getState().document.activeLayerId;
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;

  restoreFilterPreview(engine);
  applyMeshWarpGpu(engine, activeId, grid);
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

export function applyMeshWarpWithPreview(grid: MeshWarpGrid): void {
  const activeId = useEditorStore.getState().document.activeLayerId;
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;

  restoreFilterPreview(engine);
  clearFilterPreview(engine);

  useEditorStore.getState().pushHistory();
  applyMeshWarpGpu(engine, activeId, grid);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}
