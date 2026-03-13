import type { Point, PixelSurface } from '../../types';

export function applyStampDab(
  dest: PixelSurface,
  source: PixelSurface,
  pos: Point,
  offset: Point,
  size: number,
): void {
  const radius = Math.floor(size / 2);
  const cx = Math.round(pos.x);
  const cy = Math.round(pos.y);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const destX = cx + dx;
      const destY = cy + dy;
      const srcX = destX + Math.round(offset.x);
      const srcY = destY + Math.round(offset.y);
      const pixel = source.getPixel(srcX, srcY);
      if (pixel.a > 0) {
        dest.setPixel(destX, destY, pixel);
      }
    }
  }
}
