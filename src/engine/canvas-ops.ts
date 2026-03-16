import { createImageData, contextOptions } from './color-space';

export function cloneImageData(data: ImageData): ImageData {
  const copy = createImageData(data.width, data.height);
  copy.data.set(data.data);
  return copy;
}

export function cropLayerPixelData(
  oldData: ImageData,
  layerX: number,
  layerY: number,
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number,
): ImageData {
  const newData = createImageData(cropW, cropH);
  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      const srcX = x + cropX - layerX;
      const srcY = y + cropY - layerY;
      if (srcX < 0 || srcX >= oldData.width || srcY < 0 || srcY >= oldData.height) continue;
      const si = (srcY * oldData.width + srcX) * 4;
      const di = (y * cropW + x) * 4;
      newData.data[di] = oldData.data[si] ?? 0;
      newData.data[di + 1] = oldData.data[si + 1] ?? 0;
      newData.data[di + 2] = oldData.data[si + 2] ?? 0;
      newData.data[di + 3] = oldData.data[si + 3] ?? 0;
    }
  }
  return newData;
}

export interface ContentCrop {
  data: ImageData;
  x: number;
  y: number;
}

/**
 * Scan content bounds and crop ImageData to the smallest rectangle
 * containing all non-zero pixels (any channel). Returns null if fully empty.
 */
export function cropToContentBounds(src: ImageData): ContentCrop | null {
  const { width, height, data } = src;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  // Use Uint32Array view for fast 4-channel zero check
  const u32 = new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (u32[y * width + x] !== 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null;

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;

  // Not worth cropping if content fills most of the image
  if (cw * ch > width * height * 0.8) {
    const copy = createImageData(width, height);
    copy.data.set(data);
    return { data: copy, x: 0, y: 0 };
  }

  const cropped = createImageData(cw, ch);
  for (let y = 0; y < ch; y++) {
    const srcOffset = ((minY + y) * width + minX) * 4;
    const dstOffset = y * cw * 4;
    cropped.data.set(data.subarray(srcOffset, srcOffset + cw * 4), dstOffset);
  }

  return { data: cropped, x: minX, y: minY };
}

/**
 * Expand a cropped ImageData back to full canvas size, placing pixels
 * at (offsetX, offsetY).
 */
export function expandFromCrop(
  cropped: ImageData,
  offsetX: number,
  offsetY: number,
  fullWidth: number,
  fullHeight: number,
): ImageData {
  if (cropped.width === fullWidth && cropped.height === fullHeight && offsetX === 0 && offsetY === 0) {
    const copy = createImageData(fullWidth, fullHeight);
    copy.data.set(cropped.data);
    return copy;
  }
  const full = createImageData(fullWidth, fullHeight);
  const cw = cropped.width;
  const ch = cropped.height;
  for (let y = 0; y < ch; y++) {
    const srcOffset = y * cw * 4;
    const dstOffset = ((offsetY + y) * fullWidth + offsetX) * 4;
    full.data.set(cropped.data.subarray(srcOffset, srcOffset + cw * 4), dstOffset);
  }
  return full;
}

// ---------------------------------------------------------------------------
// Sparse pixel storage — only stores pixels with alpha > 0
// ---------------------------------------------------------------------------

export interface SparsePixelData {
  readonly width: number;
  readonly height: number;
  readonly count: number;
  readonly indices: Uint32Array;   // flat pixel indices (y * width + x)
  readonly rgba: Uint8ClampedArray; // 4 bytes per pixel, length = count * 4
}

/**
 * Convert ImageData to sparse format, dropping pixels with alpha === 0.
 * Returns null if less than 50% of pixels are transparent (not worth it).
 */
export function toSparsePixelData(src: ImageData): SparsePixelData | null {
  const { width, height, data } = src;
  const totalPixels = width * height;

  // First pass: count non-zero-alpha pixels
  let count = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) count++;
  }

  // Not worth sparsifying if more than half the pixels have content
  if (count > totalPixels * 0.5) return null;

  const indices = new Uint32Array(count);
  const rgba = new Uint8ClampedArray(count * 4);
  let writeIdx = 0;

  for (let px = 0; px < totalPixels; px++) {
    const si = px * 4;
    if (data[si + 3] !== 0) {
      indices[writeIdx] = px;
      const di = writeIdx * 4;
      rgba[di] = data[si]!;
      rgba[di + 1] = data[si + 1]!;
      rgba[di + 2] = data[si + 2]!;
      rgba[di + 3] = data[si + 3]!;
      writeIdx++;
    }
  }

  return { width, height, count, indices, rgba };
}

/**
 * Expand sparse data back into a full ImageData.
 */
export function fromSparsePixelData(
  sparse: SparsePixelData,
  fullWidth: number,
  fullHeight: number,
  offsetX: number,
  offsetY: number,
): ImageData {
  const full = createImageData(fullWidth, fullHeight);
  const { width, count, indices, rgba } = sparse;

  for (let i = 0; i < count; i++) {
    const px = indices[i]!;
    const sx = px % width;
    const sy = (px - sx) / width;
    const dx = sx + offsetX;
    const dy = sy + offsetY;
    if (dx < 0 || dx >= fullWidth || dy < 0 || dy >= fullHeight) continue;
    const di = (dy * fullWidth + dx) * 4;
    const si = i * 4;
    full.data[di] = rgba[si]!;
    full.data[di + 1] = rgba[si + 1]!;
    full.data[di + 2] = rgba[si + 2]!;
    full.data[di + 3] = rgba[si + 3]!;
  }

  return full;
}

/**
 * Expand sparse data into an ImageData at its own dimensions (no offset).
 * Used for bitmap cache rebuilds.
 */
export function sparseToImageData(sparse: SparsePixelData): ImageData {
  const result = createImageData(sparse.width, sparse.height);
  const { count, indices, rgba } = sparse;

  for (let i = 0; i < count; i++) {
    const di = indices[i]! * 4;
    const si = i * 4;
    result.data[di] = rgba[si]!;
    result.data[di + 1] = rgba[si + 1]!;
    result.data[di + 2] = rgba[si + 2]!;
    result.data[di + 3] = rgba[si + 3]!;
  }

  return result;
}

export function resizeCanvasPixelData(
  oldData: ImageData,
  layerX: number,
  layerY: number,
  newW: number,
  newH: number,
  offsetX: number,
  offsetY: number,
): ImageData {
  const newData = createImageData(newW, newH);
  const lx = layerX + offsetX;
  const ly = layerY + offsetY;
  for (let y = 0; y < oldData.height; y++) {
    for (let x = 0; x < oldData.width; x++) {
      const dx = x + lx;
      const dy = y + ly;
      if (dx < 0 || dx >= newW || dy < 0 || dy >= newH) continue;
      const si = (y * oldData.width + x) * 4;
      const di = (dy * newW + dx) * 4;
      newData.data[di] = oldData.data[si] ?? 0;
      newData.data[di + 1] = oldData.data[si + 1] ?? 0;
      newData.data[di + 2] = oldData.data[si + 2] ?? 0;
      newData.data[di + 3] = oldData.data[si + 3] ?? 0;
    }
  }
  return newData;
}

export function scalePixelData(
  oldData: ImageData,
  newW: number,
  newH: number,
): ImageData | null {
  const tmpCanvas = document.createElement('canvas');
  const tmpCtx = tmpCanvas.getContext('2d', contextOptions);
  if (!tmpCtx) return null;

  tmpCanvas.width = oldData.width;
  tmpCanvas.height = oldData.height;
  tmpCtx.putImageData(oldData, 0, 0);

  const scaledCanvas = document.createElement('canvas');
  scaledCanvas.width = newW;
  scaledCanvas.height = newH;
  const scaledCtx = scaledCanvas.getContext('2d', contextOptions);
  if (!scaledCtx) return null;

  scaledCtx.imageSmoothingEnabled = true;
  scaledCtx.imageSmoothingQuality = 'high';
  scaledCtx.drawImage(tmpCanvas, 0, 0, oldData.width, oldData.height, 0, 0, newW, newH);
  return scaledCtx.getImageData(0, 0, newW, newH);
}
