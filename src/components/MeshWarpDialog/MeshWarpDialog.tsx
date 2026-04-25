import { useState, useCallback, useEffect, useRef } from 'react';
import { useDraggablePanel } from '../../app/hooks/useDraggablePanel';
import { createIdentityGrid } from '../../filters/mesh-warp';
import type { MeshWarpGrid } from '../../filters/mesh-warp';
import styles from './MeshWarpDialog.module.css';

interface MeshWarpDialogProps {
  onApply: (grid: MeshWarpGrid) => void;
  onCancel: () => void;
  onPreviewChange?: (grid: MeshWarpGrid) => void;
  onPreviewStart?: () => void;
  onPreviewStop?: () => void;
}

export type { MeshWarpDialogProps };

const CANVAS_SIZE = 360;
const HANDLE_RADIUS = 6;
const HIT_RADIUS = 12;

function drawGrid(ctx: CanvasRenderingContext2D, grid: MeshWarpGrid, activeIdx: number | null) {
  const { cols, rows, points } = grid;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const pad = 20;
  const drawW = w - pad * 2;
  const drawH = h - pad * 2;

  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(30, 30, 30, 0.9)';
  ctx.fillRect(0, 0, w, h);

  const toScreen = (pt: { x: number; y: number }) => ({
    sx: pad + pt.x * drawW,
    sy: pad + pt.y * drawH,
  });

  ctx.strokeStyle = 'rgba(100, 180, 255, 0.5)';
  ctx.lineWidth = 1;

  for (let r = 0; r < rows; r++) {
    ctx.beginPath();
    for (let c = 0; c < cols; c++) {
      const { sx, sy } = toScreen(points[r * cols + c]!);
      if (c === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
  }

  for (let c = 0; c < cols; c++) {
    ctx.beginPath();
    for (let r = 0; r < rows; r++) {
      const { sx, sy } = toScreen(points[r * cols + c]!);
      if (r === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
  }

  for (let i = 0; i < points.length; i++) {
    const { sx, sy } = toScreen(points[i]!);
    const isActive = i === activeIdx;
    ctx.beginPath();
    ctx.arc(sx, sy, isActive ? HANDLE_RADIUS + 2 : HANDLE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = isActive ? '#ffffff' : '#66b4ff';
    ctx.fill();
    ctx.strokeStyle = isActive ? '#66b4ff' : '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

export function MeshWarpDialog({ onApply, onCancel, onPreviewChange, onPreviewStart, onPreviewStop }: MeshWarpDialogProps) {
  const [gridSize, setGridSize] = useState(4);
  const [grid, setGrid] = useState<MeshWarpGrid>(() => createIdentityGrid(gridSize, gridSize));
  const [dragging, setDragging] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [preview, setPreview] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewActiveRef = useRef(false);

  useEffect(() => {
    const newGrid = createIdentityGrid(gridSize, gridSize);
    setGrid(newGrid);
    setDragging(null);
    setHovered(null);
  }, [gridSize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawGrid(ctx, grid, hovered ?? dragging);
  }, [grid, hovered, dragging]);

  useEffect(() => {
    if (!preview || !onPreviewChange) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onPreviewChange(grid);
    }, 100);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [grid, preview, onPreviewChange]);

  const getCanvasPoint = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const hitTest = useCallback((px: number, py: number): number | null => {
    const pad = 20;
    const drawW = CANVAS_SIZE - pad * 2;
    const drawH = CANVAS_SIZE - pad * 2;
    let closest = -1;
    let closestDist = HIT_RADIUS * HIT_RADIUS;
    for (let i = 0; i < grid.points.length; i++) {
      const pt = grid.points[i]!;
      const sx = pad + pt.x * drawW;
      const sy = pad + pt.y * drawH;
      const dx = px - sx;
      const dy = py - sy;
      const d2 = dx * dx + dy * dy;
      if (d2 < closestDist) {
        closestDist = d2;
        closest = i;
      }
    }
    return closest >= 0 ? closest : null;
  }, [grid.points]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const pt = getCanvasPoint(e);
    if (!pt) return;
    const idx = hitTest(pt.x, pt.y);
    if (idx !== null) {
      setDragging(idx);
    }
  }, [getCanvasPoint, hitTest]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const pt = getCanvasPoint(e);
    if (!pt) return;

    if (dragging !== null) {
      const pad = 20;
      const drawW = CANVAS_SIZE - pad * 2;
      const drawH = CANVAS_SIZE - pad * 2;
      const newX = Math.max(0, Math.min(1, (pt.x - pad) / drawW));
      const newY = Math.max(0, Math.min(1, (pt.y - pad) / drawH));
      setGrid((prev) => {
        const newPoints = [...prev.points];
        newPoints[dragging] = { x: newX, y: newY };
        return { ...prev, points: newPoints };
      });
    } else {
      setHovered(hitTest(pt.x, pt.y));
    }
  }, [dragging, getCanvasPoint, hitTest]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setDragging(null);
    setHovered(null);
  }, []);

  const handleGridSizeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setGridSize(parseInt(e.target.value, 10));
  }, []);

  const handleReset = useCallback(() => {
    setGrid(createIdentityGrid(gridSize, gridSize));
  }, [gridSize]);

  const handlePreviewToggle = useCallback(() => {
    setPreview((prev) => {
      const next = !prev;
      if (next) {
        previewActiveRef.current = true;
        onPreviewStart?.();
        if (onPreviewChange) {
          setTimeout(() => onPreviewChange(grid), 0);
        }
      } else {
        previewActiveRef.current = false;
        onPreviewStop?.();
      }
      return next;
    });
  }, [onPreviewStart, onPreviewStop, onPreviewChange, grid]);

  const handleApply = useCallback(() => {
    onApply(grid);
  }, [onApply, grid]);

  const handleCancel = useCallback(() => {
    if (previewActiveRef.current) {
      onPreviewStop?.();
    }
    onCancel();
  }, [onCancel, onPreviewStop]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  }, [handleApply, handleCancel]);

  const { offset, dragProps } = useDraggablePanel();

  return (
    <div className={styles.overlay} role="presentation">
      <div
        className={styles.modal}
        role="dialog"
        aria-label="Mesh Warp"
        onKeyDown={handleKeyDown}
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        {...dragProps}
      >
        <div className={styles.header}>
          <h2>Mesh Warp</h2>
        </div>
        <div className={styles.body}>
          <div
            className={styles.canvasWrapper}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
          >
            <canvas
              ref={canvasRef}
              className={styles.gridCanvas}
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
            />
          </div>
          <div className={styles.controls}>
            <span className={styles.gridSizeLabel}>Grid</span>
            <select
              className={styles.gridSizeSelect}
              value={gridSize}
              onChange={handleGridSizeChange}
            >
              <option value={3}>3 × 3</option>
              <option value={4}>4 × 4</option>
              <option value={5}>5 × 5</option>
              <option value={6}>6 × 6</option>
            </select>
            <button className={styles.resetButton} onClick={handleReset} type="button">
              Reset
            </button>
          </div>
        </div>
        <div className={styles.footer}>
          <label className={styles.previewLabel}>
            <input
              type="checkbox"
              checked={preview}
              onChange={handlePreviewToggle}
              className={styles.previewCheckbox}
            />
            Preview
          </label>
          <div className={styles.footerButtons}>
            <button className={styles.cancelButton} onClick={handleCancel} type="button">
              Cancel
            </button>
            <button className={styles.applyButton} onClick={handleApply} type="button">
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
