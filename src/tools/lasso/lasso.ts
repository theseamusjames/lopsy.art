import type { Point } from '../../types';

export function createPolygonMask(
  points: Point[],
  width: number,
  height: number,
): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(width * height);
  if (points.length < 3) return mask;

  // Scanline polygon fill
  for (let y = 0; y < height; y++) {
    const intersections: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      if (!p1 || !p2) continue;
      if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y)) {
        const t = (y - p1.y) / (p2.y - p1.y);
        intersections.push(p1.x + t * (p2.x - p1.x));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i < intersections.length - 1; i += 2) {
      const x0 = Math.max(0, Math.ceil(intersections[i] ?? 0));
      const x1 = Math.min(width, Math.floor(intersections[i + 1] ?? 0));
      for (let x = x0; x <= x1; x++) {
        mask[y * width + x] = 255;
      }
    }
  }
  return mask;
}
