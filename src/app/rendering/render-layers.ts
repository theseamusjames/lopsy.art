import { getActiveMaskEditBuffer } from '../useCanvasInteraction';
import type { CanvasAllocator } from '../../engine/effects-renderer';
import type { Layer } from '../../types';
import { createImageData } from '../../engine/color-space';

export function renderLayerContent(
  ctx: CanvasRenderingContext2D,
  tempCanvas: HTMLCanvasElement,
  layer: Layer,
  data: ImageData,
  maskEditMode: boolean,
  activeLayerId: string | null,
  alloc: CanvasAllocator,
): void {
  if (layer.mask && layer.mask.enabled && !maskEditMode) {
    const { canvas: maskedCanvas, ctx: maskedCtx } = alloc.acquire(data.width, data.height);
    maskedCtx.drawImage(tempCanvas, 0, 0);
    const maskImageData = createImageData(layer.mask.width, layer.mask.height);
    for (let i = 0; i < layer.mask.data.length; i++) {
      const idx = i * 4;
      const val = layer.mask.data[i] ?? 0;
      maskImageData.data[idx] = val;
      maskImageData.data[idx + 1] = val;
      maskImageData.data[idx + 2] = val;
      maskImageData.data[idx + 3] = 255;
    }
    const { canvas: maskCanvas, ctx: maskCtx } = alloc.acquire(layer.mask.width, layer.mask.height);
    maskCtx.putImageData(maskImageData, 0, 0);
    maskedCtx.globalCompositeOperation = 'destination-in';
    maskedCtx.drawImage(maskCanvas, 0, 0);
    ctx.drawImage(maskedCanvas, layer.x, layer.y);
  } else {
    ctx.drawImage(tempCanvas, layer.x, layer.y);
  }

  // Mask edit mode overlay
  if (maskEditMode && layer.mask && layer.id === activeLayerId) {
    const activeBuf = getActiveMaskEditBuffer();
    const maskWidth = layer.mask.width;
    const maskHeight = layer.mask.height;
    const pixelCount = maskWidth * maskHeight;
    const { ctx: overlayCtx, canvas: overlayCanvas } = alloc.acquire(maskWidth, maskHeight);
    const overlayData = overlayCtx.createImageData(maskWidth, maskHeight);
    // Read from the active drawing buffer if available, otherwise from stored mask data
    const useBuffer = activeBuf && activeBuf.layerId === layer.id;
    const bufRaw = useBuffer ? activeBuf.buf.rawData : null;
    for (let i = 0; i < pixelCount; i++) {
      const val = bufRaw ? (bufRaw[i * 4] ?? 0) : (layer.mask.data[i] ?? 0);
      const overlayAlpha = Math.round((1 - val / 255) * 128);
      const idx = i * 4;
      overlayData.data[idx] = 0;
      overlayData.data[idx + 1] = 100;
      overlayData.data[idx + 2] = 255;
      overlayData.data[idx + 3] = overlayAlpha;
    }
    overlayCtx.putImageData(overlayData, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(overlayCanvas, layer.x, layer.y);
    ctx.globalAlpha = layer.opacity;
  }
}
