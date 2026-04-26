import { useCallback } from 'react';
import { Grid3x3 } from 'lucide-react';
import { useEditorStore } from '../../editor-store';
import { useUIStore } from '../../ui-store';
import { createIdentityGrid } from '../../../filters/mesh-warp';
import {
  applyMeshWarp,
  applyMeshWarpWithPreview,
  beginMeshWarpPreview,
  cancelMeshWarpPreview,
  previewMeshWarp,
} from '../../MenuBar/mesh-warp-actions';
import type { Rect } from '../../../types';
import styles from './MeshWarpControls.module.css';

const DEFAULT_GRID_SIZE = 4;

function clampToDoc(rect: Rect, docW: number, docH: number): Rect {
  const x = Math.max(0, Math.min(docW, Math.round(rect.x)));
  const y = Math.max(0, Math.min(docH, Math.round(rect.y)));
  const right = Math.max(0, Math.min(docW, Math.round(rect.x + rect.width)));
  const bottom = Math.max(0, Math.min(docH, Math.round(rect.y + rect.height)));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

export function MeshWarpControls() {
  const meshWarp = useUIStore((s) => s.meshWarp);
  const setMeshWarp = useUIStore((s) => s.setMeshWarp);
  const updateMeshWarpGrid = useUIStore((s) => s.updateMeshWarpGrid);
  const setMeshWarpPreview = useUIStore((s) => s.setMeshWarpPreview);
  const selectionActive = useEditorStore((s) => s.selection.active);
  const selectionBounds = useEditorStore((s) => s.selection.bounds);

  const handleActivate = useCallback(() => {
    const editor = useEditorStore.getState();
    const docW = editor.document.width;
    const docH = editor.document.height;

    const bounds: Rect = (selectionActive && selectionBounds && selectionBounds.width > 1 && selectionBounds.height > 1)
      ? clampToDoc(selectionBounds, docW, docH)
      : { x: 0, y: 0, width: docW, height: docH };

    setMeshWarp({
      grid: createIdentityGrid(DEFAULT_GRID_SIZE, DEFAULT_GRID_SIZE),
      gridSize: DEFAULT_GRID_SIZE,
      bounds,
      dragging: null,
      hovered: null,
      previewActive: false,
    });
  }, [setMeshWarp, selectionActive, selectionBounds]);

  const handleGridSizeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const size = parseInt(e.target.value, 10);
    const session = useUIStore.getState().meshWarp;
    if (!session) return;
    const newGrid = createIdentityGrid(size, size);
    setMeshWarp({ ...session, grid: newGrid, gridSize: size, dragging: null, hovered: null });
    if (session.previewActive) {
      previewMeshWarp(newGrid, session.bounds);
    }
  }, [setMeshWarp]);

  const handleReset = useCallback(() => {
    const session = useUIStore.getState().meshWarp;
    if (!session) return;
    const newGrid = createIdentityGrid(session.gridSize, session.gridSize);
    updateMeshWarpGrid(newGrid);
    if (session.previewActive) {
      previewMeshWarp(newGrid, session.bounds);
    }
  }, [updateMeshWarpGrid]);

  const handlePreviewToggle = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const session = useUIStore.getState().meshWarp;
    if (!session) return;
    const next = e.target.checked;
    if (next) {
      beginMeshWarpPreview();
      setMeshWarpPreview(true);
      previewMeshWarp(session.grid, session.bounds);
    } else {
      cancelMeshWarpPreview();
      setMeshWarpPreview(false);
    }
  }, [setMeshWarpPreview]);

  const handleCancel = useCallback(() => {
    const session = useUIStore.getState().meshWarp;
    if (!session) return;
    if (session.previewActive) {
      cancelMeshWarpPreview();
    }
    setMeshWarp(null);
  }, [setMeshWarp]);

  const handleApply = useCallback(() => {
    const session = useUIStore.getState().meshWarp;
    if (!session) return;
    if (session.previewActive) {
      applyMeshWarpWithPreview(session.grid, session.bounds);
    } else {
      applyMeshWarp(session.grid, session.bounds);
    }
    setMeshWarp(null);
  }, [setMeshWarp]);

  if (!meshWarp) {
    return (
      <button
        type="button"
        className={styles.toggleButton}
        onClick={handleActivate}
        aria-label="Activate mesh warp"
        title={selectionActive ? 'Mesh Warp (within selection)' : 'Mesh Warp (whole layer)'}
      >
        <Grid3x3 size={14} />
        <span>Mesh Warp</span>
      </button>
    );
  }

  return (
    <div className={styles.activeRow} role="group" aria-label="Mesh warp controls">
      <span className={styles.activeIndicator}>
        <Grid3x3 size={12} aria-hidden="true" />
        Warp
      </span>
      <select
        className={styles.gridSelect}
        value={meshWarp.gridSize}
        onChange={handleGridSizeChange}
        aria-label="Grid size"
      >
        <option value={3}>3 × 3</option>
        <option value={4}>4 × 4</option>
        <option value={5}>5 × 5</option>
        <option value={6}>6 × 6</option>
      </select>
      <button type="button" className={styles.secondaryButton} onClick={handleReset}>
        Reset
      </button>
      <label className={styles.previewLabel}>
        <input
          type="checkbox"
          checked={meshWarp.previewActive}
          onChange={handlePreviewToggle}
        />
        Preview
      </label>
      <button type="button" className={styles.secondaryButton} onClick={handleCancel}>
        Cancel
      </button>
      <button type="button" className={styles.primaryButton} onClick={handleApply}>
        Apply
      </button>
    </div>
  );
}
