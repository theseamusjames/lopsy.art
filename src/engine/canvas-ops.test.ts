import { describe, it, expect } from 'vitest';
import { cropToContentBounds } from './canvas-ops';
import { createImageData } from './color-space';

function imageWith(width: number, height: number, pixels: Array<[number, number, number, number, number, number]>): ImageData {
  const data = createImageData(width, height);
  for (const [x, y, r, g, b, a] of pixels) {
    data.data.set([r, g, b, a], (y * width + x) * 4);
  }
  return data;
}

describe('cropToContentBounds', () => {
  it('returns null for a fully transparent image', () => {
    expect(cropToContentBounds(createImageData(4, 4))).toBeNull();
  });

  it('crops to the pixels with non-zero alpha', () => {
    const src = imageWith(10, 10, [
      [3, 2, 255, 0, 0, 255],
      [5, 6, 255, 0, 0, 1],
    ]);
    expect(cropToContentBounds(src)).toMatchObject({ x: 3, y: 2, data: { width: 3, height: 5 } });
  });

  it('ignores colour left in zero-alpha pixels', () => {
    const src = imageWith(10, 10, [
      [3, 2, 1, 0, 0, 0],
      [4, 3, 255, 0, 0, 255],
      [5, 4, 255, 0, 0, 255],
      [6, 5, 0, 0, 7, 0],
    ]);
    expect(cropToContentBounds(src)).toMatchObject({ x: 4, y: 3, data: { width: 2, height: 2 } });
  });

  it('treats a layer of zero-alpha colour as empty', () => {
    expect(cropToContentBounds(imageWith(4, 4, [[1, 1, 9, 9, 9, 0]]))).toBeNull();
  });
});
