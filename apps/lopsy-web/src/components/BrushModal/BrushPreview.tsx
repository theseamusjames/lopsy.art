import { useEffect, useRef } from 'react';
import { generateBrushStamp } from '../../tools/brush/brush';
import type { BrushTipData } from '../../types/brush';
import styles from './BrushPreview.module.css';

interface BrushPreviewProps {
  size: number;
  hardness: number;
  spacing: number;
  opacity: number;
  tip: BrushTipData | null;
}

function cubicBezier(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const u = 1 - t;
  const u2 = u * u;
  const u3 = u2 * u;
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: u3 * p0.x + 3 * u2 * t * p1.x + 3 * u * t2 * p2.x + t3 * p3.x,
    y: u3 * p0.y + 3 * u2 * t * p1.y + 3 * u * t2 * p2.y + t3 * p3.y,
  };
}

export function BrushPreview({ size, hardness, spacing, opacity, tip }: BrushPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = 240;
    canvas.height = 80;
    ctx.clearRect(0, 0, 240, 80);

    const previewSize = Math.max(2, Math.min(size, 40));
    const spacingPx = Math.max(1, (previewSize * spacing) / 100);

    const p0 = { x: 20, y: 40 };
    const p1 = { x: 80, y: 15 };
    const p2 = { x: 160, y: 50 };
    const p3 = { x: 220, y: 35 };

    let totalLen = 0;
    let prev = p0;
    const steps = 100;
    for (let i = 1; i <= steps; i++) {
      const pt = cubicBezier(p0, p1, p2, p3, i / steps);
      const dx = pt.x - prev.x;
      const dy = pt.y - prev.y;
      totalLen += Math.sqrt(dx * dx + dy * dy);
      prev = pt;
    }

    const dabAlpha = (opacity / 100) * 0.8;

    if (tip) {
      const dabCanvas = document.createElement('canvas');
      dabCanvas.width = previewSize;
      dabCanvas.height = previewSize;
      const dabCtx = dabCanvas.getContext('2d');
      if (!dabCtx) return;
      const dabImg = dabCtx.createImageData(previewSize, previewSize);
      const scaleX = tip.width / previewSize;
      const scaleY = tip.height / previewSize;
      for (let y = 0; y < previewSize; y++) {
        for (let x = 0; x < previewSize; x++) {
          const sx = Math.min(tip.width - 1, Math.floor(x * scaleX));
          const sy = Math.min(tip.height - 1, Math.floor(y * scaleY));
          const alpha = tip.data[sy * tip.width + sx];
          const idx = (y * previewSize + x) * 4;
          dabImg.data[idx] = 255;
          dabImg.data[idx + 1] = 255;
          dabImg.data[idx + 2] = 255;
          dabImg.data[idx + 3] = Math.round((alpha ?? 0) * dabAlpha);
        }
      }
      dabCtx.putImageData(dabImg, 0, 0);

      let dist = 0;
      prev = p0;
      for (let i = 1; i <= steps; i++) {
        const pt = cubicBezier(p0, p1, p2, p3, i / steps);
        const dx = pt.x - prev.x;
        const dy = pt.y - prev.y;
        const segLen = Math.sqrt(dx * dx + dy * dy);
        dist += segLen;
        while (dist >= spacingPx) {
          dist -= spacingPx;
          const frac = 1 - dist / segLen;
          const dabX = prev.x + dx * frac - previewSize / 2;
          const dabY = prev.y + dy * frac - previewSize / 2;
          ctx.drawImage(dabCanvas, dabX, dabY);
        }
        prev = pt;
      }
    } else {
      const stamp = generateBrushStamp(previewSize, hardness / 100);
      const dabCanvas = document.createElement('canvas');
      dabCanvas.width = previewSize;
      dabCanvas.height = previewSize;
      const dabCtx = dabCanvas.getContext('2d');
      if (!dabCtx) return;
      const dabImg = dabCtx.createImageData(previewSize, previewSize);
      for (let i = 0; i < previewSize * previewSize; i++) {
        const idx = i * 4;
        dabImg.data[idx] = 255;
        dabImg.data[idx + 1] = 255;
        dabImg.data[idx + 2] = 255;
        dabImg.data[idx + 3] = Math.round((stamp[i] ?? 0) * 255 * dabAlpha);
      }
      dabCtx.putImageData(dabImg, 0, 0);

      let dist = 0;
      prev = p0;
      for (let i = 1; i <= steps; i++) {
        const pt = cubicBezier(p0, p1, p2, p3, i / steps);
        const dx = pt.x - prev.x;
        const dy = pt.y - prev.y;
        const segLen = Math.sqrt(dx * dx + dy * dy);
        dist += segLen;
        while (dist >= spacingPx) {
          dist -= spacingPx;
          const frac = 1 - dist / segLen;
          const dabX = prev.x + dx * frac - previewSize / 2;
          const dabY = prev.y + dy * frac - previewSize / 2;
          ctx.drawImage(dabCanvas, dabX, dabY);
        }
        prev = pt;
      }
    }
  }, [size, hardness, spacing, opacity, tip]);

  return (
    <div className={styles.container}>
      <span className={styles.label}>Preview</span>
      <canvas ref={canvasRef} className={styles.canvas} width={240} height={80} />
    </div>
  );
}
