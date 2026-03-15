import type { Layer, Point, Rect } from '../../types';
import type { PathAnchor } from '../ui-store';

export function renderPathOverlay(
  ctx: CanvasRenderingContext2D,
  pathAnchors: PathAnchor[],
  layers: readonly Layer[],
  activeLayerId: string | null,
  zoom: number,
): void {
  if (pathAnchors.length === 0) return;

  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const offsetX = activeLayer?.x ?? 0;
  const offsetY = activeLayer?.y ?? 0;

  ctx.save();
  ctx.translate(offsetX, offsetY);

  // Draw path curve
  ctx.strokeStyle = '#00aaff';
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([]);
  ctx.beginPath();
  for (let i = 0; i < pathAnchors.length; i++) {
    const anchor = pathAnchors[i];
    if (!anchor) continue;
    if (i === 0) {
      ctx.moveTo(anchor.point.x, anchor.point.y);
    } else {
      const prev = pathAnchors[i - 1];
      if (!prev) continue;
      const cp1 = prev.handleOut ?? prev.point;
      const cp2 = anchor.handleIn ?? anchor.point;
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, anchor.point.x, anchor.point.y);
    }
  }
  ctx.stroke();

  // Draw control handles
  ctx.strokeStyle = '#888888';
  ctx.lineWidth = 1 / zoom;
  for (const anchor of pathAnchors) {
    if (anchor.handleIn) {
      ctx.beginPath();
      ctx.moveTo(anchor.point.x, anchor.point.y);
      ctx.lineTo(anchor.handleIn.x, anchor.handleIn.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(anchor.handleIn.x, anchor.handleIn.y, 3 / zoom, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.stroke();
    }
    if (anchor.handleOut) {
      ctx.beginPath();
      ctx.moveTo(anchor.point.x, anchor.point.y);
      ctx.lineTo(anchor.handleOut.x, anchor.handleOut.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(anchor.handleOut.x, anchor.handleOut.y, 3 / zoom, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.stroke();
    }
  }

  // Draw anchor points
  const anchorSize = 4 / zoom;
  for (let i = 0; i < pathAnchors.length; i++) {
    const anchor = pathAnchors[i];
    if (!anchor) continue;
    ctx.fillStyle = i === 0 ? '#00aaff' : '#ffffff';
    ctx.strokeStyle = '#00aaff';
    ctx.lineWidth = 1 / zoom;
    ctx.fillRect(anchor.point.x - anchorSize / 2, anchor.point.y - anchorSize / 2, anchorSize, anchorSize);
    ctx.strokeRect(anchor.point.x - anchorSize / 2, anchor.point.y - anchorSize / 2, anchorSize, anchorSize);
  }

  ctx.restore();
}

export function renderLassoPreview(
  ctx: CanvasRenderingContext2D,
  lassoPoints: Point[],
  zoom: number,
): void {
  if (lassoPoints.length <= 1) return;

  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([4 / zoom, 4 / zoom]);
  ctx.beginPath();
  const firstLasso = lassoPoints[0];
  if (firstLasso) {
    ctx.moveTo(firstLasso.x, firstLasso.y);
    for (let i = 1; i < lassoPoints.length; i++) {
      const lp = lassoPoints[i];
      if (lp) ctx.lineTo(lp.x, lp.y);
    }
  }
  ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = '#000000';
  ctx.lineDashOffset = 4 / zoom;
  ctx.stroke();
  ctx.restore();
}

export function renderCropPreview(
  ctx: CanvasRenderingContext2D,
  cropRect: Rect | null,
  docWidth: number,
  docHeight: number,
  zoom: number,
): void {
  if (!cropRect) return;

  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(0, 0, docWidth, cropRect.y);
  ctx.fillRect(0, cropRect.y, cropRect.x, cropRect.height);
  ctx.fillRect(cropRect.x + cropRect.width, cropRect.y, docWidth - cropRect.x - cropRect.width, cropRect.height);
  ctx.fillRect(0, cropRect.y + cropRect.height, docWidth, docHeight - cropRect.y - cropRect.height);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([]);
  ctx.strokeRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
  ctx.restore();
}

export function renderGradientPreview(
  ctx: CanvasRenderingContext2D,
  gradientPreview: { start: Point; end: Point } | null,
  zoom: number,
): void {
  if (!gradientPreview) return;

  ctx.save();
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([]);

  const { start, end } = gradientPreview;

  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 0.75 / zoom;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  const pointRadius = 4 / zoom;
  for (const pt of [start, end]) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pointRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1 / zoom;
    ctx.stroke();
  }

  ctx.restore();
}

export function renderBrushCursor(
  ctx: CanvasRenderingContext2D,
  position: Point,
  size: number,
  zoom: number,
  shape: 'circle' | 'square',
): void {
  const half = size / 2;

  ctx.save();

  // Draw a crosshair at center for very small brushes
  if (size * zoom < 4) {
    const crossSize = 5 / zoom;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5 / zoom;
    ctx.beginPath();
    ctx.moveTo(position.x - crossSize, position.y);
    ctx.lineTo(position.x + crossSize, position.y);
    ctx.moveTo(position.x, position.y - crossSize);
    ctx.lineTo(position.x, position.y + crossSize);
    ctx.stroke();

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 0.75 / zoom;
    ctx.beginPath();
    ctx.moveTo(position.x - crossSize, position.y);
    ctx.lineTo(position.x + crossSize, position.y);
    ctx.moveTo(position.x, position.y - crossSize);
    ctx.lineTo(position.x, position.y + crossSize);
    ctx.stroke();
  } else if (shape === 'square') {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 1.5 / zoom;
    ctx.strokeRect(position.x - half, position.y - half, size, size);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 0.75 / zoom;
    ctx.strokeRect(position.x - half, position.y - half, size, size);
  } else {
    // Outer dark ring
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 1.5 / zoom;
    ctx.beginPath();
    ctx.arc(position.x, position.y, half, 0, Math.PI * 2);
    ctx.stroke();

    // Inner light ring
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 0.75 / zoom;
    ctx.beginPath();
    ctx.arc(position.x, position.y, half, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}
