import { useEffect, useRef, useState } from 'react';
import { generateBrushStamp } from '../../tools/brush/brush';
import type { BrushTipData } from '../../types/brush';
import styles from './BrushDabPreview.module.css';

interface BrushDabPreviewProps {
  size: number;
  hardness: number;
  opacity: number;
  angle: number;
  tip: BrushTipData | null;
}

export function BrushDabPreview(props: BrushDabPreviewProps) {
  const { size, hardness, opacity, angle, tip } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(true);

  useEffect(() => {
    setReady(false);
    const id = setTimeout(() => setReady(true), 200);
    return () => clearTimeout(id);
  }, [size, hardness, opacity, angle, tip]);

  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dim = 80;
    canvas.width = dim;
    canvas.height = dim;
    ctx.clearRect(0, 0, dim, dim);

    const previewSize = Math.max(2, Math.min(size, dim - 8));
    const rad = (angle * Math.PI) / 180;
    const alpha = (opacity / 100) * 0.9;

    ctx.save();
    ctx.translate(dim / 2, dim / 2);
    ctx.rotate(rad);
    ctx.globalAlpha = alpha;

    if (tip) {
      const maxDim = Math.max(tip.width, tip.height);
      const w = (tip.width / maxDim) * previewSize;
      const h = (tip.height / maxDim) * previewSize;
      const offscreen = new OffscreenCanvas(tip.width, tip.height);
      const offCtx = offscreen.getContext('2d');
      if (offCtx) {
        const imgData = offCtx.createImageData(tip.width, tip.height);
        for (let i = 0; i < tip.data.length; i++) {
          imgData.data[i * 4] = 255;
          imgData.data[i * 4 + 1] = 255;
          imgData.data[i * 4 + 2] = 255;
          imgData.data[i * 4 + 3] = tip.data[i]!;
        }
        offCtx.putImageData(imgData, 0, 0);
        ctx.drawImage(offscreen, -w / 2, -h / 2, w, h);
      }
    } else {
      const stampSize = Math.max(2, Math.round(previewSize));
      const stamp = generateBrushStamp(stampSize, hardness / 100);
      const offscreen = new OffscreenCanvas(stampSize, stampSize);
      const offCtx = offscreen.getContext('2d');
      if (offCtx) {
        const imgData = offCtx.createImageData(stampSize, stampSize);
        for (let i = 0; i < stampSize * stampSize; i++) {
          imgData.data[i * 4] = 255;
          imgData.data[i * 4 + 1] = 255;
          imgData.data[i * 4 + 2] = 255;
          imgData.data[i * 4 + 3] = Math.round((stamp[i] ?? 0) * 255);
        }
        offCtx.putImageData(imgData, 0, 0);
        ctx.drawImage(offscreen, -stampSize / 2, -stampSize / 2);
      }
    }

    ctx.restore();
  }, [size, hardness, opacity, angle, tip, ready]);

  return <canvas ref={canvasRef} className={styles.canvas} width={80} height={80} />;
}
