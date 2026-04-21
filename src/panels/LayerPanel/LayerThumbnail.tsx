import { useEffect, useRef } from 'react';
import { contextOptions } from '../../engine/color-space';
import { usePixelDataVersion } from '../../engine/usePixelDataVersion';
import { readLayerThumbnail } from '../../engine-wasm/gpu-pixel-access';
import type { Layer } from '../../types';
import styles from './LayerPanel.module.css';

const THUMB_SIZE = 24;

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

    const rafId = requestAnimationFrame(() => {
      const ctx = canvas.getContext('2d', contextOptions);
      if (!ctx) return;

      canvas.width = THUMB_SIZE;
      canvas.height = THUMB_SIZE;

      // GPU-downscaled readback — returns a small ImageData (at most
      // THUMB_SIZE on the longest edge) instead of the full layer texture.
      const thumb = readLayerThumbnail(layer.id, THUMB_SIZE);
      if (!thumb) {
        ctx.clearRect(0, 0, THUMB_SIZE, THUMB_SIZE);
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
    });

    return () => cancelAnimationFrame(rafId);
  }, [layer.id, pixelVersion]);

  return <canvas ref={canvasRef} className={styles.thumbnailCanvas} />;
}
