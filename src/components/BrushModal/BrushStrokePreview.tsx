import { useEffect, useRef, useState } from 'react';
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
  taper: number;
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

export function BrushStrokePreview({
  size, hardness, spacing, opacity, scatter, angle, tip,
  sizeJitter, hardnessJitter, angleJitter, opacityJitter,
  speedSize, speedSizeInvert, taper, texture, textureBlendMode, textureScale,
}: BrushStrokePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [debouncedProps, setDebouncedProps] = useState<BrushStrokePreviewProps>({
    size, hardness, spacing, opacity, scatter, angle, tip,
    sizeJitter, hardnessJitter, angleJitter, opacityJitter,
    speedSize, speedSizeInvert, taper, texture, textureBlendMode, textureScale,
  });

  useEffect(() => {
    const snapshot = {
      size, hardness, spacing, opacity, scatter, angle, tip,
      sizeJitter, hardnessJitter, angleJitter, opacityJitter,
      speedSize, speedSizeInvert, taper, texture, textureBlendMode, textureScale,
    };
    const id = setTimeout(() => setDebouncedProps(snapshot), 200);
    return () => clearTimeout(id);
  }, [size, hardness, spacing, opacity, scatter, angle, tip, sizeJitter, hardnessJitter, angleJitter, opacityJitter, speedSize, speedSizeInvert, taper, texture, textureBlendMode, textureScale]);

  useEffect(() => {
    const props = debouncedProps;
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

    const strokeCanvas = new OffscreenCanvas(Math.round(cssW * dpr), Math.round(cssH * dpr));
    const sCtx = strokeCanvas.getContext('2d')!;
    sCtx.scale(dpr, dpr);
    const sizeJ = props.sizeJitter / 100;
    const hardnessJ = props.hardnessJitter / 100;
    const angleJ = props.angleJitter / 100;
    const opacityJ = props.opacityJitter / 100;
    const speedAmt = props.speedSize / 100;
    const scatterAmt = props.scatter / 100;

    // Bake the tip into a single OffscreenCanvas once so the dab loop never
    // allocates or iterates pixels — just drawImage at different scales.
    let tipCanvas: OffscreenCanvas | null = null;
    let tipMaxDim = 1;
    if (props.tip) {
      const { width, height, data, kind } = props.tip;
      tipMaxDim = Math.max(width, height);
      tipCanvas = new OffscreenCanvas(width, height);
      const tipCtx = tipCanvas.getContext('2d');
      if (tipCtx) {
        const imgData = tipCtx.createImageData(width, height);
        if (kind === 'color') {
          imgData.data.set(data);
        } else {
          for (let j = 0; j < data.length; j++) {
            imgData.data[j * 4] = 255;
            imgData.data[j * 4 + 1] = 255;
            imgData.data[j * 4 + 2] = 255;
            imgData.data[j * 4 + 3] = data[j]!;
          }
        }
        tipCtx.putImageData(imgData, 0, 0);
      }
    }

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

        const speedT = Math.sin(t * Math.PI);
        const normalizedSpeed = speedT;

        let dabSize = previewSize;
        if (speedAmt > 0) {
          const scale = props.speedSizeInvert
            ? 1 + speedAmt * normalizedSpeed
            : 1 - speedAmt * normalizedSpeed;
          dabSize = Math.max(1, dabSize * scale);
        }

        if (props.taper > 0) {
          const taperFactor = Math.max(0, 1 - dist / props.taper);
          dabSize *= taperFactor;
          if (dabSize < 0.5) continue;
        }

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

        let dabOpacity = baseOpacity;
        if (opacityJ > 0) {
          dabOpacity = baseOpacity * (1 - opacityJ * (1 - rand()));
        }

        let dabAngle = (props.angle * Math.PI) / 180;
        if (angleJ > 0) {
          dabAngle += (rand() - 0.5) * 2 * angleJ * Math.PI;
        }

        if (scatterAmt > 0) {
          const perpX = -dy / (segLen || 1);
          const perpY = dx / (segLen || 1);
          const offset = (rand() - 0.5) * 2 * scatterAmt * previewSize * 2;
          dabX += perpX * offset;
          dabY += perpY * offset;
        }

        const dabAlpha = opacityJ > 0 ? dabOpacity / baseOpacity : 1.0;
        const half = Math.max(0.5, dabSize / 2);
        sCtx.save();
        sCtx.globalAlpha = dabAlpha;
        sCtx.translate(dabX, dabY);
        sCtx.rotate(dabAngle);

        if (tipCanvas && props.tip) {
          const sw = (props.tip.width / tipMaxDim) * dabSize;
          const sh = (props.tip.height / tipMaxDim) * dabSize;
          sCtx.drawImage(tipCanvas, -sw / 2, -sh / 2, sw, sh);
        } else {
          if (dabHardness >= 1) {
            sCtx.fillStyle = 'rgba(255,255,255,1)';
            sCtx.beginPath();
            sCtx.arc(0, 0, half, 0, Math.PI * 2);
            sCtx.fill();
          } else {
            const grad = sCtx.createRadialGradient(0, 0, 0, 0, 0, half);
            grad.addColorStop(0, 'rgba(255,255,255,1)');
            if (dabHardness > 0) {
              grad.addColorStop(Math.min(0.9999, dabHardness), 'rgba(255,255,255,1)');
            }
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            sCtx.fillStyle = grad;
            sCtx.beginPath();
            sCtx.arc(0, 0, half, 0, Math.PI * 2);
            sCtx.fill();
          }
        }

        sCtx.restore();
      }
      prevPt = pt;
    }

    if (props.texture) {
      const texData = props.texture;
      const texScale = props.textureScale / 100;
      sCtx.save();
      sCtx.globalCompositeOperation = 'destination-in';
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
            sCtx.drawImage(texCanvas, tx, ty, tileW, tileH);
          }
        }
      }
      sCtx.restore();
    }

    ctx.globalAlpha = baseOpacity;
    ctx.drawImage(strokeCanvas, 0, 0, cssW, cssH);
    ctx.globalAlpha = 1;
  }, [debouncedProps]);

  return (
    <canvas ref={canvasRef} className={styles.canvas} />
  );
}
