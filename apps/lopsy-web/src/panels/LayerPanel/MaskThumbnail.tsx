import { useEffect, useRef } from 'react';
import { contextOptions } from '../../engine/color-space';
import { useEditorStore } from '../../app/editor-store';

export interface MaskThumbnailProps {
  layerId: string;
}

export function MaskThumbnail({ layerId }: MaskThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Read from the store, not a prop: see the note on `LayerRowProps`.
  const mask = useEditorStore(
    (s) => s.document.layers.find((l) => l.id === layerId)?.mask ?? null,
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mask) return;
    const ctx = canvas.getContext('2d', contextOptions);
    if (!ctx) return;

    canvas.width = 20;
    canvas.height = 20;

    const imgData = ctx.createImageData(20, 20);
    const scaleX = mask.width / 20;
    const scaleY = mask.height / 20;
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const srcX = Math.floor(x * scaleX);
        const srcY = Math.floor(y * scaleY);
        const val = mask.data[srcY * mask.width + srcX] ?? 0;
        const idx = (y * 20 + x) * 4;
        imgData.data[idx] = val;
        imgData.data[idx + 1] = val;
        imgData.data[idx + 2] = val;
        imgData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }, [mask]);

  if (!mask) return null;

  return <canvas ref={canvasRef} />;
}
