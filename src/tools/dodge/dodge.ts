import type { Point, PixelSurface } from '../../types';

export function applyDodgeBurn(
  buf: PixelSurface,
  pos: Point,
  size: number,
  mode: 'dodge' | 'burn',
  exposure: number,
): void {
  const radius = Math.floor(size / 2);
  const cx = Math.round(pos.x);
  const cy = Math.round(pos.y);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const px = cx + dx;
      const py = cy + dy;
      const pixel = buf.getPixel(px, py);
      if (pixel.a <= 0) continue;
      if (mode === 'dodge') {
        buf.setPixel(px, py, {
          r: Math.min(255, Math.round(pixel.r + (255 - pixel.r) * exposure)),
          g: Math.min(255, Math.round(pixel.g + (255 - pixel.g) * exposure)),
          b: Math.min(255, Math.round(pixel.b + (255 - pixel.b) * exposure)),
          a: pixel.a,
        });
      } else {
        buf.setPixel(px, py, {
          r: Math.max(0, Math.round(pixel.r * (1 - exposure))),
          g: Math.max(0, Math.round(pixel.g * (1 - exposure))),
          b: Math.max(0, Math.round(pixel.b * (1 - exposure))),
          a: pixel.a,
        });
      }
    }
  }
}
