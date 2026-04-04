import { useEffect, useRef } from 'react';
import type { BrushPreset } from '../../types/brush';

interface BrushThumbnailProps {
  preset: BrushPreset;
  size?: number;
}

export function BrushThumbnail({ preset, size = 48 }: BrushThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = size;
    canvas.height = size;
    ctx.clearRect(0, 0, size, size);

    if (preset.tip) {
      const img = ctx.createImageData(size, size);
      const scaleX = preset.tip.width / size;
      const scaleY = preset.tip.height / size;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const sx = Math.min(preset.tip.width - 1, Math.floor(x * scaleX));
          const sy = Math.min(preset.tip.height - 1, Math.floor(y * scaleY));
          const alpha = preset.tip.data[sy * preset.tip.width + sx] ?? 0;
          const idx = (y * size + x) * 4;
          img.data[idx] = 255;
          img.data[idx + 1] = 255;
          img.data[idx + 2] = 255;
          img.data[idx + 3] = alpha;
        }
      }
      ctx.putImageData(img, 0, 0);
    } else {
      const center = size / 2;
      const radius = size * 0.4;
      const hardness = preset.hardness / 100;
      const img = ctx.createImageData(size, size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = x - center;
          const dy = y - center;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const normalizedDist = dist / radius;
          let alpha = 0;
          if (normalizedDist <= 1) {
            if (normalizedDist <= hardness) {
              alpha = 1;
            } else if (hardness < 1) {
              alpha = 1 - (normalizedDist - hardness) / (1 - hardness);
            }
          }
          const idx = (y * size + x) * 4;
          img.data[idx] = 255;
          img.data[idx + 1] = 255;
          img.data[idx + 2] = 255;
          img.data[idx + 3] = Math.round(Math.max(0, alpha) * 255);
        }
      }
      ctx.putImageData(img, 0, 0);
    }
  }, [preset, size]);

  return <canvas ref={canvasRef} width={size} height={size} />;
}
