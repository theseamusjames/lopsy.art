import { useEffect, useRef, useState } from 'react';
import { generateBrushStamp } from '../../tools/brush/brush';
import type { BrushTipData } from '../../types/brush';
import styles from './BrushDabPreview.module.css';

function blurGrayClamp(src: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius < 1) return new Uint8Array(src);
  const n = width * height;
  const sigma = radius / 3;
  const kSize = radius * 2 + 1;
  const kernel = new Float32Array(kSize);
  let sum = 0;
  for (let i = 0; i < kSize; i++) {
    const x = i - radius;
    kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    sum += kernel[i]!;
  }
  for (let i = 0; i < kSize; i++) kernel[i]! /= sum;

  const temp = new Float32Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 0;
      for (let k = -radius; k <= radius; k++) {
        const sx = Math.max(0, Math.min(width - 1, x + k));
        v += (src[y * width + sx] ?? 0) * kernel[k + radius]!;
      }
      temp[y * width + x] = v;
    }
  }
  const result = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 0;
      for (let k = -radius; k <= radius; k++) {
        const sy = Math.max(0, Math.min(height - 1, y + k));
        v += temp[sy * width + x]! * kernel[k + radius]!;
      }
      result[y * width + x] = Math.round(Math.max(0, Math.min(255, v)));
    }
  }
  return result;
}

function applyInnerGlowHardness(alpha: Uint8ClampedArray | Uint8Array, width: number, height: number, hardness01: number): Uint8Array {
  const n = width * height;
  const inverted = new Uint8Array(n);
  for (let i = 0; i < n; i++) inverted[i] = 255 - (alpha[i] ?? 0);
  const blurRadius = Math.max(1, Math.round(Math.min(width, height) / 2));
  const glow = blurGrayClamp(inverted, width, height, blurRadius);
  let minVal = 255;
  let maxVal = 0;
  for (let i = 0; i < n; i++) {
    if ((alpha[i] ?? 0) > 5) {
      minVal = Math.min(minVal, glow[i]!);
      maxVal = Math.max(maxVal, glow[i]!);
    }
  }
  if (maxVal > minVal) {
    for (let i = 0; i < n; i++) {
      if ((alpha[i] ?? 0) > 5) {
        const t = (glow[i]! - minVal) / (maxVal - minVal);
        glow[i] = Math.round(Math.sqrt(t) * 255);
      } else {
        glow[i] = 255;
      }
    }
  }
  const result = new Uint8Array(n);
  const softness = (1 - hardness01) * 1.5;
  for (let i = 0; i < n; i++) {
    const a = alpha[i] ?? 0;
    const g = (glow[i] ?? 0) / 255;
    result[i] = Math.round(a * Math.max(1 - g * softness, 0));
  }
  return result;
}

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

      // Downsample to at most 80×80 before running the CPU blur so the
      // Gaussian radius stays ≤ 40 (≈2M iters) instead of min(w,h)/2 which
      // blows up to 268M iters for a 512×512 tip.
      const MAX_DIM = 80;
      const dsScale = Math.min(1, MAX_DIM / Math.max(tip.width, tip.height));
      const dsW = Math.max(1, Math.round(tip.width * dsScale));
      const dsH = Math.max(1, Math.round(tip.height * dsScale));

      const offscreen = new OffscreenCanvas(dsW, dsH);
      const offCtx = offscreen.getContext('2d');
      if (offCtx) {
        const imgData = offCtx.createImageData(dsW, dsH);
        if (tip.kind === 'color') {
          const pixelCount = dsW * dsH;
          const alphaChannel = new Uint8Array(pixelCount);
          for (let y = 0; y < dsH; y++) {
            for (let x = 0; x < dsW; x++) {
              const sx = Math.min(tip.width - 1, Math.round(x * tip.width / dsW));
              const sy = Math.min(tip.height - 1, Math.round(y * tip.height / dsH));
              alphaChannel[y * dsW + x] = tip.data[(sy * tip.width + sx) * 4 + 3] ?? 0;
            }
          }
          const modAlpha = applyInnerGlowHardness(alphaChannel, dsW, dsH, hardness / 100);
          for (let y = 0; y < dsH; y++) {
            for (let x = 0; x < dsW; x++) {
              const sx = Math.min(tip.width - 1, Math.round(x * tip.width / dsW));
              const sy = Math.min(tip.height - 1, Math.round(y * tip.height / dsH));
              const si = (sy * tip.width + sx) * 4;
              const di = (y * dsW + x) * 4;
              const srcA = tip.data[si + 3] ?? 0;
              const alphaScale = srcA > 0 ? (modAlpha[y * dsW + x] ?? 0) / srcA : 0;
              imgData.data[di] = Math.round((tip.data[si] ?? 0) * alphaScale);
              imgData.data[di + 1] = Math.round((tip.data[si + 1] ?? 0) * alphaScale);
              imgData.data[di + 2] = Math.round((tip.data[si + 2] ?? 0) * alphaScale);
              imgData.data[di + 3] = modAlpha[y * dsW + x] ?? 0;
            }
          }
        } else {
          const dsData = new Uint8ClampedArray(dsW * dsH);
          for (let y = 0; y < dsH; y++) {
            for (let x = 0; x < dsW; x++) {
              const sx = Math.min(tip.width - 1, Math.round(x * tip.width / dsW));
              const sy = Math.min(tip.height - 1, Math.round(y * tip.height / dsH));
              dsData[y * dsW + x] = tip.data[sy * tip.width + sx] ?? 0;
            }
          }
          const modAlpha = applyInnerGlowHardness(dsData, dsW, dsH, hardness / 100);
          for (let i = 0; i < dsW * dsH; i++) {
            imgData.data[i * 4] = 255;
            imgData.data[i * 4 + 1] = 255;
            imgData.data[i * 4 + 2] = 255;
            imgData.data[i * 4 + 3] = modAlpha[i] ?? 0;
          }
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
