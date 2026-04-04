/**
 * Pure functions for flip/rotate pixel transforms on selected regions.
 */

export function flipHorizontal(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  selectionMask: Uint8ClampedArray | null,
  maskWidth: number,
  maskHeight: number,
  bounds: { x: number; y: number; width: number; height: number },
  layerX: number,
  layerY: number,
): void {
  const bx = bounds.x - layerX;
  const by = bounds.y - layerY;
  const bw = bounds.width;
  const bh = bounds.height;

  for (let row = by; row < by + bh; row++) {
    if (row < 0 || row >= height) continue;
    for (let col = 0; col < Math.floor(bw / 2); col++) {
      const leftCol = bx + col;
      const rightCol = bx + bw - 1 - col;
      if (leftCol < 0 || leftCol >= width || rightCol < 0 || rightCol >= width) continue;

      const leftDocX = leftCol + layerX;
      const leftDocY = row + layerY;
      const rightDocX = rightCol + layerX;
      const rightDocY = row + layerY;

      if (selectionMask) {
        const leftMask = getMaskValue(selectionMask, maskWidth, maskHeight, leftDocX, leftDocY);
        const rightMask = getMaskValue(selectionMask, maskWidth, maskHeight, rightDocX, rightDocY);
        if (leftMask === 0 && rightMask === 0) continue;
      }

      const leftIdx = (row * width + leftCol) * 4;
      const rightIdx = (row * width + rightCol) * 4;
      swapPixels(data, leftIdx, rightIdx);
    }
  }
}

export function flipVertical(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  selectionMask: Uint8ClampedArray | null,
  maskWidth: number,
  maskHeight: number,
  bounds: { x: number; y: number; width: number; height: number },
  layerX: number,
  layerY: number,
): void {
  const bx = bounds.x - layerX;
  const by = bounds.y - layerY;
  const bw = bounds.width;
  const bh = bounds.height;

  for (let row = 0; row < Math.floor(bh / 2); row++) {
    const topRow = by + row;
    const bottomRow = by + bh - 1 - row;
    if (topRow < 0 || topRow >= height || bottomRow < 0 || bottomRow >= height) continue;

    for (let col = bx; col < bx + bw; col++) {
      if (col < 0 || col >= width) continue;

      const docX = col + layerX;
      const topDocY = topRow + layerY;
      const bottomDocY = bottomRow + layerY;

      if (selectionMask) {
        const topMask = getMaskValue(selectionMask, maskWidth, maskHeight, docX, topDocY);
        const bottomMask = getMaskValue(selectionMask, maskWidth, maskHeight, docX, bottomDocY);
        if (topMask === 0 && bottomMask === 0) continue;
      }

      const topIdx = (topRow * width + col) * 4;
      const bottomIdx = (bottomRow * width + col) * 4;
      swapPixels(data, topIdx, bottomIdx);
    }
  }
}

export function rotate90CW(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bounds: { x: number; y: number; width: number; height: number },
  layerX: number,
  layerY: number,
): void {
  const bx = bounds.x - layerX;
  const by = bounds.y - layerY;
  const bw = bounds.width;
  const bh = bounds.height;
  const size = Math.max(bw, bh);

  // Extract the bounding area into a temp buffer
  const temp = new Uint8ClampedArray(size * size * 4);
  for (let row = 0; row < bh; row++) {
    for (let col = 0; col < bw; col++) {
      const srcRow = by + row;
      const srcCol = bx + col;
      if (srcRow < 0 || srcRow >= height || srcCol < 0 || srcCol >= width) continue;
      const srcIdx = (srcRow * width + srcCol) * 4;
      const dstIdx = (row * size + col) * 4;
      temp[dstIdx] = data[srcIdx]!;
      temp[dstIdx + 1] = data[srcIdx + 1]!;
      temp[dstIdx + 2] = data[srcIdx + 2]!;
      temp[dstIdx + 3] = data[srcIdx + 3]!;
    }
  }

  // Clear original region
  for (let row = by; row < by + size && row < height; row++) {
    for (let col = bx; col < bx + size && col < width; col++) {
      if (row < 0 || col < 0) continue;
      const idx = (row * width + col) * 4;
      data[idx] = 0;
      data[idx + 1] = 0;
      data[idx + 2] = 0;
      data[idx + 3] = 0;
    }
  }

  // Write rotated: (x, y) -> (bh - 1 - y, x)
  for (let row = 0; row < bh; row++) {
    for (let col = 0; col < bw; col++) {
      const newCol = bh - 1 - row;
      const newRow = col;
      const dstRow = by + newRow;
      const dstCol = bx + newCol;
      if (dstRow < 0 || dstRow >= height || dstCol < 0 || dstCol >= width) continue;
      const srcIdx = (row * size + col) * 4;
      const dstIdx = (dstRow * width + dstCol) * 4;
      data[dstIdx] = temp[srcIdx]!;
      data[dstIdx + 1] = temp[srcIdx + 1]!;
      data[dstIdx + 2] = temp[srcIdx + 2]!;
      data[dstIdx + 3] = temp[srcIdx + 3]!;
    }
  }
}

export function rotate90CCW(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bounds: { x: number; y: number; width: number; height: number },
  layerX: number,
  layerY: number,
): void {
  const bx = bounds.x - layerX;
  const by = bounds.y - layerY;
  const bw = bounds.width;
  const bh = bounds.height;
  const size = Math.max(bw, bh);

  // Extract the bounding area
  const temp = new Uint8ClampedArray(size * size * 4);
  for (let row = 0; row < bh; row++) {
    for (let col = 0; col < bw; col++) {
      const srcRow = by + row;
      const srcCol = bx + col;
      if (srcRow < 0 || srcRow >= height || srcCol < 0 || srcCol >= width) continue;
      const srcIdx = (srcRow * width + srcCol) * 4;
      const dstIdx = (row * size + col) * 4;
      temp[dstIdx] = data[srcIdx]!;
      temp[dstIdx + 1] = data[srcIdx + 1]!;
      temp[dstIdx + 2] = data[srcIdx + 2]!;
      temp[dstIdx + 3] = data[srcIdx + 3]!;
    }
  }

  // Clear original region
  for (let row = by; row < by + size && row < height; row++) {
    for (let col = bx; col < bx + size && col < width; col++) {
      if (row < 0 || col < 0) continue;
      const idx = (row * width + col) * 4;
      data[idx] = 0;
      data[idx + 1] = 0;
      data[idx + 2] = 0;
      data[idx + 3] = 0;
    }
  }

  // Write rotated: (x, y) -> (y, bw - 1 - x)
  for (let row = 0; row < bh; row++) {
    for (let col = 0; col < bw; col++) {
      const newCol = row;
      const newRow = bw - 1 - col;
      const dstRow = by + newRow;
      const dstCol = bx + newCol;
      if (dstRow < 0 || dstRow >= height || dstCol < 0 || dstCol >= width) continue;
      const srcIdx = (row * size + col) * 4;
      const dstIdx = (dstRow * width + dstCol) * 4;
      data[dstIdx] = temp[srcIdx]!;
      data[dstIdx + 1] = temp[srcIdx + 1]!;
      data[dstIdx + 2] = temp[srcIdx + 2]!;
      data[dstIdx + 3] = temp[srcIdx + 3]!;
    }
  }
}

function getMaskValue(
  mask: Uint8ClampedArray,
  maskWidth: number,
  maskHeight: number,
  x: number,
  y: number,
): number {
  if (x < 0 || x >= maskWidth || y < 0 || y >= maskHeight) return 0;
  return mask[y * maskWidth + x] ?? 0;
}

function swapPixels(data: Uint8ClampedArray, a: number, b: number): void {
  const t0 = data[a]!;
  const t1 = data[a + 1]!;
  const t2 = data[a + 2]!;
  const t3 = data[a + 3]!;
  data[a] = data[b]!;
  data[a + 1] = data[b + 1]!;
  data[a + 2] = data[b + 2]!;
  data[a + 3] = data[b + 3]!;
  data[b] = t0;
  data[b + 1] = t1;
  data[b + 2] = t2;
  data[b + 3] = t3;
}
