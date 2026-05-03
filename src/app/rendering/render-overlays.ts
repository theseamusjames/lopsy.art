import type { Color, Layer, Point, Rect } from '../../types';
import type { Artboard } from '../../types/document';
import type { PathAnchor } from '../../tools/path/path';

interface PathOverlaySource {
  anchors: readonly PathAnchor[];
  closed: boolean;
  offsetX: number;
  offsetY: number;
}

export function renderPathOverlay(
  ctx: CanvasRenderingContext2D,
  pathAnchors: readonly PathAnchor[],
  pathClosed: boolean,
  layers: readonly Layer[],
  activeLayerId: string | null,
  zoom: number,
  storedPathAnchors?: readonly PathAnchor[],
  storedPathClosed?: boolean,
): void {
  let source: PathOverlaySource | null = null;

  if (pathAnchors.length > 0) {
    // Ephemeral path (being drawn) — in layer-local coords
    const activeLayer = layers.find((l) => l.id === activeLayerId);
    source = {
      anchors: pathAnchors,
      closed: pathClosed,
      offsetX: activeLayer?.x ?? 0,
      offsetY: activeLayer?.y ?? 0,
    };
  } else if (storedPathAnchors && storedPathAnchors.length > 0) {
    // Stored path — already in document coords
    source = {
      anchors: storedPathAnchors,
      closed: storedPathClosed ?? false,
      offsetX: 0,
      offsetY: 0,
    };
  }

  if (!source) return;

  ctx.save();
  ctx.translate(source.offsetX, source.offsetY);

  const anchorsToRender = source.anchors;

  // Draw path curve
  ctx.strokeStyle = '#00aaff';
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([]);
  ctx.beginPath();
  for (let i = 0; i < anchorsToRender.length; i++) {
    const anchor = anchorsToRender[i];
    if (!anchor) continue;
    if (i === 0) {
      ctx.moveTo(anchor.point.x, anchor.point.y);
    } else {
      const prev = anchorsToRender[i - 1];
      if (!prev) continue;
      const cp1 = prev.handleOut ?? prev.point;
      const cp2 = anchor.handleIn ?? anchor.point;
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, anchor.point.x, anchor.point.y);
    }
  }
  if (source.closed && anchorsToRender.length >= 2) {
    const last = anchorsToRender[anchorsToRender.length - 1];
    const first = anchorsToRender[0];
    if (last && first) {
      const cp1 = last.handleOut ?? last.point;
      const cp2 = first.handleIn ?? first.point;
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, first.point.x, first.point.y);
    }
  }
  ctx.stroke();

  // Draw control handles
  ctx.strokeStyle = '#888888';
  ctx.lineWidth = 1 / zoom;
  for (const anchor of anchorsToRender) {
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
  for (let i = 0; i < anchorsToRender.length; i++) {
    const anchor = anchorsToRender[i];
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
  tip?: { width: number; height: number; data: Uint8ClampedArray; kind?: 'alpha' | 'color' } | null,
  angle = 0,
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
  } else if (tip && tip.data.length > 0) {
    // Trace the outline of the custom brush tip shape with dark/light strokes.
    // Build a filled mask at cursor size, dilate it by ~1.5px, subtract the
    // original to get a ring, then draw it twice for contrast.
    const maxDim = Math.max(tip.width, tip.height);
    const drawW = (tip.width / maxDim) * size;
    const drawH = (tip.height / maxDim) * size;
    const pad = 4;
    const ow = Math.ceil(drawW) + pad * 2;
    const oh = Math.ceil(drawH) + pad * 2;

    // Render tip as opaque white shape
    const tipCanvas = new OffscreenCanvas(tip.width, tip.height);
    const tipCtx = tipCanvas.getContext('2d');
    if (tipCtx) {
      const imgData = tipCtx.createImageData(tip.width, tip.height);
      const pixelCount = tip.width * tip.height;
      if (tip.kind === 'color') {
        for (let i = 0; i < pixelCount; i++) {
          imgData.data[i * 4] = 255;
          imgData.data[i * 4 + 1] = 255;
          imgData.data[i * 4 + 2] = 255;
          imgData.data[i * 4 + 3] = tip.data[i * 4 + 3]! > 30 ? 255 : 0;
        }
      } else {
        for (let i = 0; i < pixelCount; i++) {
          imgData.data[i * 4] = 255;
          imgData.data[i * 4 + 1] = 255;
          imgData.data[i * 4 + 2] = 255;
          imgData.data[i * 4 + 3] = tip.data[i]! > 30 ? 255 : 0;
        }
      }
      tipCtx.putImageData(imgData, 0, 0);

      // Dark outer outline: dilated shape minus original
      const outerCanvas = new OffscreenCanvas(ow, oh);
      const outerCtx = outerCanvas.getContext('2d')!;
      const expand = 1.5 / zoom;
      outerCtx.drawImage(tipCanvas, pad - expand, pad - expand, drawW + expand * 2, drawH + expand * 2);
      outerCtx.globalCompositeOperation = 'destination-out';
      outerCtx.drawImage(tipCanvas, pad + expand * 0.5, pad + expand * 0.5, drawW - expand, drawH - expand);
      outerCtx.globalCompositeOperation = 'source-in';
      outerCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      outerCtx.fillRect(0, 0, ow, oh);

      // Light inner outline
      const innerCanvas = new OffscreenCanvas(ow, oh);
      const innerCtx = innerCanvas.getContext('2d')!;
      const shrink = 0.75 / zoom;
      innerCtx.drawImage(tipCanvas, pad, pad, drawW, drawH);
      innerCtx.globalCompositeOperation = 'destination-out';
      innerCtx.drawImage(tipCanvas, pad + shrink, pad + shrink, drawW - shrink * 2, drawH - shrink * 2);
      innerCtx.globalCompositeOperation = 'source-in';
      innerCtx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      innerCtx.fillRect(0, 0, ow, oh);

      // Draw both outlines rotated by the brush angle
      ctx.translate(position.x, position.y);
      ctx.rotate(angle);
      ctx.drawImage(outerCanvas, -drawW / 2 - pad, -drawH / 2 - pad);
      ctx.drawImage(innerCanvas, -drawW / 2 - pad, -drawH / 2 - pad);
    }
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

export function renderSymmetryCenter(
  ctx: CanvasRenderingContext2D,
  center: Point,
  zoom: number,
  guideColor: Color,
): void {
  const r = 8 / zoom;
  const cross = 5 / zoom;
  const lw = 1.5 / zoom;
  const color = `rgba(${guideColor.r}, ${guideColor.g}, ${guideColor.b}, 0.9)`;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(center.x - cross, center.y);
  ctx.lineTo(center.x + cross, center.y);
  ctx.moveTo(center.x, center.y - cross);
  ctx.lineTo(center.x, center.y + cross);
  ctx.stroke();

  ctx.restore();
}

const ARTBOARD_BORDER_COLOR = 'rgba(100, 160, 255, 0.9)';
const ARTBOARD_LABEL_BG = 'rgba(74, 158, 255, 0.15)';
const ARTBOARD_LABEL_COLOR = 'rgba(100, 160, 255, 1)';

export function renderArtboards(
  ctx: CanvasRenderingContext2D,
  artboards: readonly Artboard[],
  zoom: number,
): void {
  if (artboards.length === 0) return;

  ctx.save();

  for (const artboard of artboards) {
    const { x, y, width, height, name } = artboard;

    // Dashed border
    ctx.strokeStyle = ARTBOARD_BORDER_COLOR;
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([6 / zoom, 4 / zoom]);
    ctx.strokeRect(x, y, width, height);

    // Name label above the top-left corner
    const fontSize = Math.max(10 / zoom, 11);
    ctx.font = `600 ${fontSize}px Inter, -apple-system, sans-serif`;
    ctx.setLineDash([]);

    const labelPadX = 4 / zoom;
    const labelPadY = 3 / zoom;
    const labelOffsetY = fontSize + labelPadY * 2 + 2 / zoom;
    const labelText = name;
    const textMetrics = ctx.measureText(labelText);
    const labelWidth = textMetrics.width + labelPadX * 2;
    const labelHeight = fontSize + labelPadY * 2;

    // Background pill
    ctx.fillStyle = ARTBOARD_LABEL_BG;
    ctx.beginPath();
    ctx.roundRect(x, y - labelOffsetY, labelWidth, labelHeight, 2 / zoom);
    ctx.fill();

    // Label text
    ctx.fillStyle = ARTBOARD_LABEL_COLOR;
    ctx.fillText(labelText, x + labelPadX, y - labelOffsetY + fontSize);
  }

  ctx.restore();
}
