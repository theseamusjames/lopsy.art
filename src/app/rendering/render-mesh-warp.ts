import type { MeshWarpSession } from '../ui-store';

/**
 * Convert a normalised grid point (0..1 within bounds) to document space.
 */
export function gridPointToDoc(
  pt: { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number },
): { x: number; y: number } {
  return {
    x: bounds.x + pt.x * bounds.width,
    y: bounds.y + pt.y * bounds.height,
  };
}

/**
 * Hit-test a document-space point against the grid handles.
 * Returns the index of the closest handle within the hit radius, or null.
 */
export function hitTestMeshHandle(
  docX: number,
  docY: number,
  session: MeshWarpSession,
  zoom: number,
): number | null {
  const hitR = 12 / zoom;
  const hitR2 = hitR * hitR;
  let closest = -1;
  let closestDist = hitR2;
  const { points } = session.grid;
  for (let i = 0; i < points.length; i++) {
    const docPt = gridPointToDoc(points[i]!, session.bounds);
    const dx = docX - docPt.x;
    const dy = docY - docPt.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < closestDist) {
      closestDist = d2;
      closest = i;
    }
  }
  return closest >= 0 ? closest : null;
}

export function renderMeshWarpOverlay(
  ctx: CanvasRenderingContext2D,
  session: MeshWarpSession,
  zoom: number,
): void {
  const { grid, bounds, dragging, hovered } = session;
  const { cols, rows, points } = grid;

  ctx.save();
  ctx.setLineDash([]);

  // Translucent fill over the warp region so users can see the active area.
  ctx.fillStyle = 'rgba(0, 170, 255, 0.05)';
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);

  ctx.strokeStyle = 'rgba(0, 170, 255, 0.85)';
  ctx.lineWidth = 1 / zoom;

  // Horizontal grid lines
  for (let r = 0; r < rows; r++) {
    ctx.beginPath();
    for (let c = 0; c < cols; c++) {
      const p = gridPointToDoc(points[r * cols + c]!, bounds);
      if (c === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }
  // Vertical grid lines
  for (let c = 0; c < cols; c++) {
    ctx.beginPath();
    for (let r = 0; r < rows; r++) {
      const p = gridPointToDoc(points[r * cols + c]!, bounds);
      if (r === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  // Bounds outline (slightly stronger, so the active region is visible
  // even when the grid is identity).
  ctx.strokeStyle = 'rgba(0, 170, 255, 1)';
  ctx.lineWidth = 1.5 / zoom;
  ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);

  // Handles
  const handleR = 5 / zoom;
  const activeHandleR = 7 / zoom;
  const lineW = 1.5 / zoom;
  for (let i = 0; i < points.length; i++) {
    const p = gridPointToDoc(points[i]!, bounds);
    const isActive = i === dragging;
    const isHovered = i === hovered && dragging === null;
    const r = isActive ? activeHandleR : handleR;

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isActive ? '#ffffff' : isHovered ? '#cce8ff' : '#66b4ff';
    ctx.fill();
    ctx.lineWidth = lineW;
    ctx.strokeStyle = isActive ? '#00aaff' : '#ffffff';
    ctx.stroke();
  }

  ctx.restore();
}
