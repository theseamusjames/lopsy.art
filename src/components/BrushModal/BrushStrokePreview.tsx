import { useEffect, useRef } from 'react';
import { generateBrushStamp } from '../../tools/brush/brush';
import type { BrushTipData, BrushTextureData, BrushTextureBlendMode } from '../../types/brush';
import styles from './BrushStrokePreview.module.css';

interface BrushStrokePreviewProps {
  size: number;
  hardness: number;
  spacing: number;
  opacity: number;
  scatter: number;
  angle: number;
  tip: BrushTipData | null;
  sizeJitter: number;
  hardnessJitter: number;
  angleJitter: number;
  opacityJitter: number;
  speedSize: number;
  speedSizeInvert: boolean;
  texture: BrushTextureData | null;
  textureBlendMode: BrushTextureBlendMode;
  textureScale: number;
}

function cubicBezier(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

export function BrushStrokePreview(props: BrushStrokePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);

    const w = cssW;
    const h = cssH;
    const margin = 30;
    const previewSize = Math.max(2, Math.min(props.size, h * 0.6));
    const baseSpacing = Math.max(1, (previewSize * props.spacing) / 100);
    const baseHardness = props.hardness / 100;
    const baseOpacity = props.opacity / 100;
    const sizeJ = props.sizeJitter / 100;
    const hardnessJ = props.hardnessJitter / 100;
    const angleJ = props.angleJitter / 100;
    const opacityJ = props.opacityJitter / 100;
    const speedAmt = props.speedSize / 100;
    const scatterAmt = props.scatter / 100;

    const p0 = { x: margin, y: h / 2 };
    const p1 = { x: w * 0.3, y: h * 0.25 };
    const p2 = { x: w * 0.7, y: h * 0.75 };
    const p3 = { x: w - margin, y: h / 2 };

    const steps = 200;
    const points: Array<{ x: number; y: number; t: number }> = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const pt = cubicBezier(p0, p1, p2, p3, t);
      points.push({ ...pt, t });
    }

    const rand = seededRandom(42);

    let sizeWalkCurrent = 1;
    let sizeWalkTarget = rand();
    let sizeWalkPrev = 1;
    let sizeWalkDist = 0;
    let sizeWalkTransDist = 30 + rand() * 90;

    let hardnessWalkCurrent = 1;
    let hardnessWalkTarget = rand();
    let hardnessWalkPrev = 1;
    let hardnessWalkDist = 0;
    let hardnessWalkTransDist = 80 + rand() * 200;

    let dist = 0;
    let prevPt = points[0]!;
    let spacingAccum = 0;

    for (let i = 1; i < points.length; i++) {
      const pt = points[i]!;
      const dx = pt.x - prevPt.x;
      const dy = pt.y - prevPt.y;
      const segLen = Math.sqrt(dx * dx + dy * dy);
      dist += segLen;
      spacingAccum += segLen;

      while (spacingAccum >= baseSpacing) {
        spacingAccum -= baseSpacing;
        const frac = 1 - spacingAccum / segLen;
        let dabX = prevPt.x + dx * frac;
        let dabY = prevPt.y + dy * frac;
        const t = prevPt.t + (pt.t - prevPt.t) * frac;

        // Speed simulation: slow at edges, fast in the middle
        const speedT = Math.sin(t * Math.PI);
        const normalizedSpeed = speedT;

        // Speed-based size
        let dabSize = previewSize;
        if (speedAmt > 0) {
          const scale = props.speedSizeInvert
            ? 1 + speedAmt * normalizedSpeed
            : 1 - speedAmt * normalizedSpeed;
          dabSize = Math.max(1, dabSize * scale);
        }

        // Size jitter walk
        if (sizeJ > 0) {
          sizeWalkDist += baseSpacing;
          if (sizeWalkDist >= sizeWalkTransDist) {
            sizeWalkPrev = sizeWalkCurrent;
            sizeWalkTarget = rand();
            sizeWalkTransDist = 30 + rand() * 90;
            sizeWalkDist = 0;
          }
          const st = Math.min(sizeWalkDist / sizeWalkTransDist, 1);
          const smooth = st * st * (3 - 2 * st);
          sizeWalkCurrent = sizeWalkPrev + (sizeWalkTarget - sizeWalkPrev) * smooth;
          dabSize = Math.max(1, dabSize * (1 - sizeJ * (1 - sizeWalkCurrent)));
        }

        // Hardness jitter walk
        let dabHardness = baseHardness;
        if (hardnessJ > 0) {
          hardnessWalkDist += baseSpacing;
          if (hardnessWalkDist >= hardnessWalkTransDist) {
            hardnessWalkPrev = hardnessWalkCurrent;
            hardnessWalkTarget = rand();
            hardnessWalkTransDist = 80 + rand() * 200;
            hardnessWalkDist = 0;
          }
          const ht = Math.min(hardnessWalkDist / hardnessWalkTransDist, 1);
          const smooth = ht * ht * (3 - 2 * ht);
          hardnessWalkCurrent = hardnessWalkPrev + (hardnessWalkTarget - hardnessWalkPrev) * smooth;
          dabHardness = Math.max(0, baseHardness * (1 - hardnessJ * (1 - hardnessWalkCurrent)));
        }

        // Opacity jitter
        let dabOpacity = baseOpacity;
        if (opacityJ > 0) {
          dabOpacity = baseOpacity * (1 - opacityJ * (1 - rand()));
        }

        // Angle jitter
        let dabAngle = (props.angle * Math.PI) / 180;
        if (angleJ > 0) {
          dabAngle += (rand() - 0.5) * 2 * angleJ * Math.PI;
        }

        // Scatter
        if (scatterAmt > 0) {
          const perpX = -dy / (segLen || 1);
          const perpY = dx / (segLen || 1);
          const offset = (rand() - 0.5) * 2 * scatterAmt * previewSize * 2;
          dabX += perpX * offset;
          dabY += perpY * offset;
        }

        // Render the dab
        const half = dabSize / 2;
        ctx.save();
        ctx.globalAlpha = dabOpacity * 0.8;
        ctx.translate(dabX, dabY);
        ctx.rotate(dabAngle);

        if (props.tip) {
          const maxDim = Math.max(props.tip.width, props.tip.height);
          const sw = (props.tip.width / maxDim) * dabSize;
          const sh = (props.tip.height / maxDim) * dabSize;
          const offscreen = new OffscreenCanvas(props.tip.width, props.tip.height);
          const offCtx = offscreen.getContext('2d');
          if (offCtx) {
            const imgData = offCtx.createImageData(props.tip.width, props.tip.height);
            for (let j = 0; j < props.tip.data.length; j++) {
              imgData.data[j * 4] = 255;
              imgData.data[j * 4 + 1] = 255;
              imgData.data[j * 4 + 2] = 255;
              imgData.data[j * 4 + 3] = props.tip.data[j]!;
            }
            offCtx.putImageData(imgData, 0, 0);
            ctx.drawImage(offscreen, -sw / 2, -sh / 2, sw, sh);
          }
        } else {
          const stamp = generateBrushStamp(Math.max(2, Math.round(dabSize)), dabHardness);
          const stampSize = Math.max(2, Math.round(dabSize));
          const offscreen = new OffscreenCanvas(stampSize, stampSize);
          const offCtx = offscreen.getContext('2d');
          if (offCtx) {
            const imgData = offCtx.createImageData(stampSize, stampSize);
            for (let j = 0; j < stampSize * stampSize; j++) {
              imgData.data[j * 4] = 255;
              imgData.data[j * 4 + 1] = 255;
              imgData.data[j * 4 + 2] = 255;
              imgData.data[j * 4 + 3] = Math.round((stamp[j] ?? 0) * 255);
            }
            offCtx.putImageData(imgData, 0, 0);
            ctx.drawImage(offscreen, -half, -half);
          }
        }

        ctx.restore();
      }
      prevPt = pt;
    }

    // Texture overlay (simulated)
    if (props.texture) {
      const texData = props.texture;
      const texScale = props.textureScale / 100;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-in';
      const texCanvas = new OffscreenCanvas(texData.width, texData.height);
      const texCtx = texCanvas.getContext('2d');
      if (texCtx) {
        const imgData = texCtx.createImageData(texData.width, texData.height);
        for (let j = 0; j < texData.data.length; j++) {
          let v = texData.data[j]!;
          if (props.textureBlendMode === 'subtract') v = 255 - v;
          imgData.data[j * 4] = 255;
          imgData.data[j * 4 + 1] = 255;
          imgData.data[j * 4 + 2] = 255;
          imgData.data[j * 4 + 3] = v;
        }
        texCtx.putImageData(imgData, 0, 0);
        const tileW = texData.width * texScale;
        const tileH = texData.height * texScale;
        for (let ty = 0; ty < cssH; ty += tileH) {
          for (let tx = 0; tx < cssW; tx += tileW) {
            ctx.drawImage(texCanvas, tx, ty, tileW, tileH);
          }
        }
      }
      ctx.restore();
    }
  }, [props]);

  return (
    <canvas ref={canvasRef} className={styles.canvas} />
  );
}
