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
