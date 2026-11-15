/// <reference lib="webworker" />

interface CropEntry {
  layerId: string;
  width: number;
  height: number;
  layerX: number;
  layerY: number;
  data: ArrayBuffer;
}

interface CropRequest {
  id: string;
  entries: CropEntry[];
}

interface CropResultEntry {
  layerId: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  data: ArrayBuffer;
  empty: boolean;
}

interface CropResponse {
  id: string;
  results: CropResultEntry[];
}

function getContentBounds(
  u32: Uint32Array,
  width: number,
  height: number,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let hasContent = false;
  for (let i = 0; i < u32.length; i++) {
    if (u32[i] !== 0) { hasContent = true; break; }
  }
  if (!hasContent) return null;

  let minY = 0;
  outer_minY:
  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    for (let x = 0; x < width; x++) {
      if (u32[rowStart + x] !== 0) { minY = y; break outer_minY; }
    }
  }

  let maxY = height - 1;
  outer_maxY:
  for (let y = height - 1; y >= minY; y--) {
    const rowStart = y * width;
    for (let x = 0; x < width; x++) {
      if (u32[rowStart + x] !== 0) { maxY = y; break outer_maxY; }
    }
  }

  let minX = width;
  let maxX = 0;
  for (let y = minY; y <= maxY; y++) {
    const rowStart = y * width;
    for (let x = 0; x < minX; x++) {
      if (u32[rowStart + x] !== 0) { minX = x; break; }
    }
    for (let x = width - 1; x > maxX; x--) {
      if (u32[rowStart + x] !== 0) { maxX = x; break; }
    }
  }

  return { minX, minY, maxX, maxY };
}

self.onmessage = (e: MessageEvent<CropRequest>) => {
  const { id, entries } = e.data;
  const results: CropResultEntry[] = [];
  const transfers: ArrayBuffer[] = [];

  for (const entry of entries) {
    const src = new Uint8ClampedArray(entry.data);
    const u32 = new Uint32Array(entry.data);
    const bounds = getContentBounds(u32, entry.width, entry.height);

    if (bounds) {
      const cropW = bounds.maxX - bounds.minX + 1;
      const cropH = bounds.maxY - bounds.minY + 1;
      const dst = new Uint8ClampedArray(cropW * cropH * 4);

      for (let y = 0; y < cropH; y++) {
        const srcOffset = ((bounds.minY + y) * entry.width + bounds.minX) * 4;
        const dstOffset = y * cropW * 4;
        dst.set(src.subarray(srcOffset, srcOffset + cropW * 4), dstOffset);
      }

      const buf = dst.buffer as ArrayBuffer;
      results.push({
        layerId: entry.layerId,
        width: cropW,
        height: cropH,
        offsetX: bounds.minX,
        offsetY: bounds.minY,
        data: buf,
        empty: false,
      });
      transfers.push(buf);
    } else {
      const buf = new ArrayBuffer(4);
      results.push({
        layerId: entry.layerId,
        width: 1,
        height: 1,
        offsetX: 0,
        offsetY: 0,
        data: buf,
        empty: true,
      });
      transfers.push(buf);
    }
  }

  const response: CropResponse = { id, results };
  self.postMessage(response, transfers);
};
