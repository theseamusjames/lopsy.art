import { useEffect, useRef } from 'react';
import { useEditorStore } from '../../app/editor-store';
import { contextOptions } from '../../engine/color-space';
import { usePixelDataVersion } from '../../engine/usePixelDataVersion';
import type { Layer } from '../../types';
import styles from './LayerPanel.module.css';

export function LayerThumbnail({ layer }: { layer: Layer }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Re-render the thumbnail whenever this layer's pixel data changes.
  // pixelVersion bumps on every dense/sparse write; dirtyLayerIds bumps
  // on GPU-only changes (stroke end, undo) where JS data was cleared but
  // the GPU texture has new content worth re-reading.
  const pixelVersion = usePixelDataVersion(layer.id);
  const isDirty = useEditorStore((s) => s.dirtyLayerIds.has(layer.id));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', contextOptions);
    if (!ctx) return;

    const thumbSize = 24;
    canvas.width = thumbSize;
    canvas.height = thumbSize;

    const pixelData = useEditorStore.getState().resolvePixelData(layer.id);
    if (!pixelData) {
      ctx.clearRect(0, 0, thumbSize, thumbSize);
      return;
    }

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = pixelData.width;
    tempCanvas.height = pixelData.height;
    const tempCtx = tempCanvas.getContext('2d', contextOptions);
    if (!tempCtx) return;
    tempCtx.putImageData(pixelData, 0, 0);

    ctx.clearRect(0, 0, thumbSize, thumbSize);
    const scale = Math.min(thumbSize / pixelData.width, thumbSize / pixelData.height);
    const w = pixelData.width * scale;
    const h = pixelData.height * scale;
    ctx.drawImage(tempCanvas, (thumbSize - w) / 2, (thumbSize - h) / 2, w, h);
  }, [layer.id, pixelVersion, isDirty]);

  return <canvas ref={canvasRef} className={styles.thumbnailCanvas} />;
}
