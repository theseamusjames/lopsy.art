import { useEffect, useRef } from 'react';
import { contextOptions } from '../../engine/color-space';
import { usePixelDataVersion } from '../../engine/usePixelDataVersion';
import { readLayerThumbnail } from '../../engine-wasm/gpu-pixel-access';
import { requestThumbnailRead, cancelThumbnailRead } from './thumbnail-read-queue';
import type { Layer } from '../../types';
import styles from './LayerPanel.module.css';

const THUMB_SIZE = 24;
const MAX_RETRIES = 10;

export function LayerThumbnail({ layer }: { layer: Layer }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Subscribe only to this layer's pixel version — bumps on actual pixel
  // mutation (including stroke-end when clearJsPixelData() removes the
  // JS cache). Subscribing to store-wide renderVersion here used to fire
  // on every brush dab, triggering a full-layer glReadPixels per dab.
  const pixelVersion = usePixelDataVersion(layer.id);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let retries = 0;

    const paint = (thumb: ImageData | null): void => {
      if (cancelled) return;
      const ctx = canvas.getContext('2d', contextOptions);
      if (!ctx) return;
      canvas.width = THUMB_SIZE;
      canvas.height = THUMB_SIZE;
      if (!thumb) {
        ctx.clearRect(0, 0, THUMB_SIZE, THUMB_SIZE);
        if (retries < MAX_RETRIES) {
          retries++;
          requestThumbnailRead(layer.id, () => readLayerThumbnail(layer.id, THUMB_SIZE), paint);
        }
        return;
      }
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = thumb.width;
      tempCanvas.height = thumb.height;
      const tempCtx = tempCanvas.getContext('2d', contextOptions);
      if (!tempCtx) return;
      tempCtx.putImageData(thumb, 0, 0);
      ctx.clearRect(0, 0, THUMB_SIZE, THUMB_SIZE);
      const scale = Math.min(THUMB_SIZE / thumb.width, THUMB_SIZE / thumb.height);
      const w = thumb.width * scale;
      const h = thumb.height * scale;
      ctx.drawImage(tempCanvas, (THUMB_SIZE - w) / 2, (THUMB_SIZE - h) / 2, w, h);
    };

    // The readback is expensive — a synchronous glReadPixels forces a
    // pipeline flush, waiting on every draw call the compositor still has
    // in flight (#741). Route through the coalescing idle-time queue so a
    // burst of layer pixel-version bumps (stroke end, layer switch, undo)
    // pays one stall per tick, off the interactive frame.
    requestThumbnailRead(layer.id, () => readLayerThumbnail(layer.id, THUMB_SIZE), paint);

    return () => {
      cancelled = true;
      cancelThumbnailRead(layer.id);
    };
  }, [layer.id, pixelVersion]);

  return <canvas ref={canvasRef} className={styles.thumbnailCanvas} />;
}
