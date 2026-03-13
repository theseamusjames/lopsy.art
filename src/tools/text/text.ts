import type { Point, PixelSurface } from '../../types';

export function renderText(
  buf: PixelSurface,
  pos: Point,
  text: string,
  fontSize: number,
  fontFamily: string,
  color: { r: number; g: number; b: number; a: number },
  fontWeight: number = 400,
  fontStyle: 'normal' | 'italic' = 'normal',
): void {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = buf.width;
  tempCanvas.height = buf.height;
  const ctx = tempCanvas.getContext('2d');
  if (!ctx) return;

  ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${color.a})`;
  ctx.textBaseline = 'top';
  ctx.fillText(text, pos.x, pos.y);

  const textData = ctx.getImageData(0, 0, buf.width, buf.height);
  for (let i = 0; i < textData.data.length; i += 4) {
    const sa = (textData.data[i + 3] ?? 0) / 255;
    if (sa <= 0) continue;
    const px = (i / 4) % buf.width;
    const py = Math.floor(i / 4 / buf.width);
    const existing = buf.getPixel(px, py);
    const outA = sa + existing.a * (1 - sa);
    if (outA > 0) {
      buf.setPixel(px, py, {
        r: Math.round(((textData.data[i] ?? 0) * sa + existing.r * existing.a * (1 - sa)) / outA),
        g: Math.round(((textData.data[i + 1] ?? 0) * sa + existing.g * existing.a * (1 - sa)) / outA),
        b: Math.round(((textData.data[i + 2] ?? 0) * sa + existing.b * existing.a * (1 - sa)) / outA),
        a: outA,
      });
    }
  }
}
