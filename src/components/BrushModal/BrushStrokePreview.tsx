import { useEffect, useRef, useState } from 'react';
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

interface TexturePlacement {
  scale: number;
  originX: number;
  originY: number;
}

function blankLike(src: OffscreenCanvas): [OffscreenCanvas, OffscreenCanvasRenderingContext2D] {
  const canvas = new OffscreenCanvas(src.width, src.height);
  return [canvas, canvas.getContext('2d')!];
}

function invertAlpha(src: OffscreenCanvas): OffscreenCanvas {
  const [canvas, ctx] = blankLike(src);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(src, 0, 0);
  return canvas;
}

// 'lighter' adds premultiplied values and clamps, so two draws give min(2a, 1).
function doubleAlpha(src: OffscreenCanvas): OffscreenCanvas {
  const [canvas, ctx] = blankLike(src);
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(src, 0, 0);
  ctx.drawImage(src, 0, 0);
  return canvas;
}

function maskedBy(src: OffscreenCanvas, mask: OffscreenCanvas): OffscreenCanvas {
  const [canvas, ctx] = blankLike(src);
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0);
  return canvas;
}

function whiteWithAlphaOf(src: OffscreenCanvas): OffscreenCanvas {
  const [canvas, ctx] = blankLike(src);
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

// The tiled mask is built on its own canvas and applied once: applying
// each tile with destination-in would erase everything outside that tile.
function tiledTextureMask(
  like: OffscreenCanvas,
  texture: BrushTextureData,
  placement: TexturePlacement,
): OffscreenCanvas {
  const texCanvas = new OffscreenCanvas(texture.width, texture.height);
  const texCtx = texCanvas.getContext('2d')!;
  const imgData = texCtx.createImageData(texture.width, texture.height);
  for (let j = 0; j < texture.data.length; j++) {
    imgData.data[j * 4] = 255;
    imgData.data[j * 4 + 1] = 255;
    imgData.data[j * 4 + 2] = 255;
    imgData.data[j * 4 + 3] = texture.data[j] ?? 0;
  }
  texCtx.putImageData(imgData, 0, 0);

  const [canvas, ctx] = blankLike(like);
  const pattern = ctx.createPattern(texCanvas, 'repeat');
  if (!pattern) return canvas;
  // Matches brush_dab_footer.glsl: texel (0, 0) sits half a tile before
  // the stroke origin (fract(rel / tile + 0.5)).
  const tileW = texture.width * placement.scale;
  const tileH = texture.height * placement.scale;
  pattern.setTransform(
    new DOMMatrix()
      .translate(placement.originX - tileW / 2, placement.originY - tileH / 2)
      .scale(placement.scale),
  );
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

// Mirrors the per-dab texture blend in brush_dab_footer.glsl. The engine
// MAX-blends dabs and every mode is monotonic in the dab alpha, so applying
// the texture to the accumulated stroke gives the same result.
function applyPreviewTexture(
  stroke: OffscreenCanvas,
  texture: BrushTextureData,
  blendMode: BrushTextureBlendMode,
  placement: TexturePlacement,
): OffscreenCanvas {
  const mask = tiledTextureMask(stroke, texture, placement);
  if (blendMode === 'multiply') return maskedBy(stroke, mask);
  if (blendMode === 'subtract') return maskedBy(stroke, invertAlpha(mask));

  // overlay(a, t) = a < 0.5 ? 2at : 1 - 2(1 - a)(1 - t)
  //              = min(2a, 1) * t + max(2a - 1, 0) * (1 - t)
  const alpha = whiteWithAlphaOf(stroke);
  const low = maskedBy(doubleAlpha(alpha), mask);
  const high = maskedBy(invertAlpha(doubleAlpha(invertAlpha(alpha))), invertAlpha(mask));
  const [result, ctx] = blankLike(stroke);
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(low, 0, 0);
  ctx.drawImage(high, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.drawImage(stroke, 0, 0);
  return result;
}

export function BrushStrokePreview(props: BrushStrokePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [debouncedProps, setDebouncedProps] = useState(props);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedProps(props), 200);
    return () => clearTimeout(id);
  }, [props]);

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

    // Render dabs to a stroke offscreen canvas (simulating MAX blending
    // by drawing at per-dab jitter intensity only), then composite the
    // whole stroke onto the preview at baseOpacity.
    const strokeCanvas = new OffscreenCanvas(Math.round(cssW * dpr), Math.round(cssH * dpr));
    const sCtx = strokeCanvas.getContext('2d')!;
    sCtx.scale(dpr, dpr);
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

        // Taper: shrink to zero over taper distance
        if (props.taper > 0) {
          const taperFactor = Math.max(0, 1 - dist / props.taper);
          dabSize *= taperFactor;
          if (dabSize < 0.5) continue;
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

        // Render dab onto the stroke canvas (no base opacity — applied later)
        const dabAlpha = opacityJ > 0 ? dabOpacity / baseOpacity : 1.0;
        const half = dabSize / 2;
        sCtx.save();
        sCtx.globalAlpha = dabAlpha;
        sCtx.translate(dabX, dabY);
        sCtx.rotate(dabAngle);

        if (props.tip) {
          const maxDim = Math.max(props.tip.width, props.tip.height);
          const sw = (props.tip.width / maxDim) * dabSize;
          const sh = (props.tip.height / maxDim) * dabSize;
          const offscreen = new OffscreenCanvas(props.tip.width, props.tip.height);
          const offCtx = offscreen.getContext('2d');
          if (offCtx) {
            const imgData = offCtx.createImageData(props.tip.width, props.tip.height);
            if (props.tip.kind === 'color') {
              const pixelCount = props.tip.width * props.tip.height;
              for (let j = 0; j < pixelCount; j++) {
                imgData.data[j * 4] = props.tip.data[j * 4] ?? 0;
                imgData.data[j * 4 + 1] = props.tip.data[j * 4 + 1] ?? 0;
                imgData.data[j * 4 + 2] = props.tip.data[j * 4 + 2] ?? 0;
                imgData.data[j * 4 + 3] = props.tip.data[j * 4 + 3] ?? 0;
              }
            } else {
              for (let j = 0; j < props.tip.data.length; j++) {
                imgData.data[j * 4] = 255;
                imgData.data[j * 4 + 1] = 255;
                imgData.data[j * 4 + 2] = 255;
                imgData.data[j * 4 + 3] = props.tip.data[j]!;
              }
            }
            offCtx.putImageData(imgData, 0, 0);
            sCtx.drawImage(offscreen, -sw / 2, -sh / 2, sw, sh);
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
            sCtx.drawImage(offscreen, -half, -half);
          }
        }

        sCtx.restore();
      }
      prevPt = pt;
    }

    const texturedStroke = props.texture
      ? applyPreviewTexture(strokeCanvas, props.texture, props.textureBlendMode, {
          scale: (props.textureScale / 100) * dpr,
          originX: p0.x * dpr,
          originY: p0.y * dpr,
        })
      : strokeCanvas;

    // Composite the stroke canvas onto the preview at base opacity
    ctx.globalAlpha = baseOpacity;
    ctx.drawImage(texturedStroke, 0, 0, cssW, cssH);
    ctx.globalAlpha = 1;
  }, [debouncedProps]);

  return (
    <canvas ref={canvasRef} className={styles.canvas} />
  );
}
