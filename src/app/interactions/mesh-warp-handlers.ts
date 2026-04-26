import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { hitTestMeshHandle } from '../rendering/render-mesh-warp';
import { previewMeshWarp } from '../MenuBar/mesh-warp-actions';
import type { Point } from '../../types';
import type { MeshWarpGrid } from '../../filters/mesh-warp';

/**
 * Pre-tool dispatch — runs on mousedown when an inline mesh warp session
 * is active. Returns true if a handle was hit (so the regular tool dispatch
 * is skipped). Otherwise returns false and tool routing continues normally.
 */
export function handleMeshWarpDown(canvasPos: Point): boolean {
  const ui = useUIStore.getState();
  const session = ui.meshWarp;
  if (!session) return false;

  const zoom = useEditorStore.getState().viewport.zoom;
  const idx = hitTestMeshHandle(canvasPos.x, canvasPos.y, session, zoom);
  if (idx === null) return false;

  ui.setMeshWarpDragging(idx);
  return true;
}

/**
 * Returns true if a mesh-warp drag is in progress (so move/up shouldn't
 * dispatch to the regular tool).
 */
export function isMeshWarpDragging(): boolean {
  return useUIStore.getState().meshWarp?.dragging !== null
    && useUIStore.getState().meshWarp !== null;
}

export function handleMeshWarpMove(canvasPos: Point): void {
  const ui = useUIStore.getState();
  const session = ui.meshWarp;
  if (!session) return;

  if (session.dragging === null) {
    // Hover update
    const zoom = useEditorStore.getState().viewport.zoom;
    const idx = hitTestMeshHandle(canvasPos.x, canvasPos.y, session, zoom);
    if (idx !== session.hovered) {
      ui.setMeshWarpHovered(idx);
    }
    return;
  }

  // Drag update — convert canvas pos back to bounds-local 0..1 coords
  const { bounds } = session;
  const newX = bounds.width > 0
    ? Math.max(0, Math.min(1, (canvasPos.x - bounds.x) / bounds.width))
    : 0;
  const newY = bounds.height > 0
    ? Math.max(0, Math.min(1, (canvasPos.y - bounds.y) / bounds.height))
    : 0;

  const newPoints = [...session.grid.points];
  newPoints[session.dragging] = { x: newX, y: newY };
  const newGrid: MeshWarpGrid = { ...session.grid, points: newPoints };
  ui.updateMeshWarpGrid(newGrid);

  if (session.previewActive) {
    previewMeshWarp(newGrid, session.bounds);
  }

  useEditorStore.getState().notifyRender();
}

export function handleMeshWarpUp(): void {
  const ui = useUIStore.getState();
  const session = ui.meshWarp;
  if (!session) return;
  if (session.dragging !== null) {
    ui.setMeshWarpDragging(null);
  }
}

export function handleMeshWarpLeave(): void {
  const ui = useUIStore.getState();
  const session = ui.meshWarp;
  if (!session) return;
  if (session.hovered !== null) {
    ui.setMeshWarpHovered(null);
  }
}
