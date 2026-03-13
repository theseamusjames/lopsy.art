import type { Point, PixelSurface } from '../../types';

export interface PathAnchor {
  point: Point;
  handleIn: Point | null;
  handleOut: Point | null;
}

export function rasterizePath(
  buf: PixelSurface,
  anchors: PathAnchor[],
  closed: boolean,
  color: { r: number; g: number; b: number; a: number },
  strokeWidth: number,
): void {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = buf.width;
  tempCanvas.height = buf.height;
  const ctx = tempCanvas.getContext('2d');
  if (!ctx) return;

  ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},${color.a})`;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    if (!anchor) continue;
    if (i === 0) {
      ctx.moveTo(anchor.point.x, anchor.point.y);
    } else {
      const prev = anchors[i - 1];
      if (!prev) continue;
      const cp1 = prev.handleOut ?? prev.point;
      const cp2 = anchor.handleIn ?? anchor.point;
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, anchor.point.x, anchor.point.y);
    }
  }
  if (closed && anchors.length >= 2) {
    const last = anchors[anchors.length - 1];
    const first = anchors[0];
    if (last && first) {
      const cp1 = last.handleOut ?? last.point;
      const cp2 = first.handleIn ?? first.point;
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, first.point.x, first.point.y);
    }
  }
  ctx.stroke();

  // Composite the stroked path onto the pixel buffer
  const pathData = ctx.getImageData(0, 0, buf.width, buf.height);
  for (let i = 0; i < pathData.data.length; i += 4) {
    const sa = (pathData.data[i + 3] ?? 0) / 255;
    if (sa <= 0) continue;
    const px = (i / 4) % buf.width;
    const py = Math.floor(i / 4 / buf.width);
    const existing = buf.getPixel(px, py);
    const outA = sa + existing.a * (1 - sa);
    if (outA > 0) {
      buf.setPixel(px, py, {
        r: Math.round(((pathData.data[i] ?? 0) * sa + existing.r * existing.a * (1 - sa)) / outA),
        g: Math.round(((pathData.data[i + 1] ?? 0) * sa + existing.g * existing.a * (1 - sa)) / outA),
        b: Math.round(((pathData.data[i + 2] ?? 0) * sa + existing.b * existing.a * (1 - sa)) / outA),
        a: outA,
      });
    }
  }
}
