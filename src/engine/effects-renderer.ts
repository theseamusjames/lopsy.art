import { canvasPool } from './canvas-pool';
import type { PooledCanvas } from './canvas-pool';
import type { Layer } from '../types';
import { contextOptions } from './color-space';

export class CanvasAllocator {
  private handles: PooledCanvas[] = [];

  acquire(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    const pooled = canvasPool.acquire(w, h);
    this.handles.push(pooled);
    return { canvas: pooled.canvas, ctx: pooled.ctx };
  }

  releaseAll(): void {
    for (const h of this.handles) h.release();
    this.handles.length = 0;
  }
}

export function renderOuterGlow(
  ctx: CanvasRenderingContext2D,
  tempCanvas: HTMLCanvasElement,
  layer: Layer,
  data: ImageData,
  alloc: CanvasAllocator,
): void {
  if (!layer.effects.outerGlow.enabled) return;
  const glow = layer.effects.outerGlow;
  const glowBlur = glow.size + glow.spread;
  const pad = glowBlur * 2;
  const { canvas: glowCanvas, ctx: glowCtx } = alloc.acquire(data.width + pad * 2, data.height + pad * 2);
  glowCtx.filter = `blur(${glowBlur}px)`;
  glowCtx.drawImage(tempCanvas, pad, pad);
  glowCtx.globalCompositeOperation = 'source-in';
  glowCtx.filter = 'none';
  glowCtx.fillStyle = `rgba(${glow.color.r},${glow.color.g},${glow.color.b},${glow.opacity})`;
  glowCtx.fillRect(0, 0, glowCanvas.width, glowCanvas.height);
  ctx.drawImage(glowCanvas, layer.x - pad, layer.y - pad);
}

export function renderDropShadow(
  ctx: CanvasRenderingContext2D,
  tempCanvas: HTMLCanvasElement,
  layer: Layer,
  data: ImageData,
  alloc: CanvasAllocator,
): void {
  if (!layer.effects.dropShadow.enabled) return;
  const shadow = layer.effects.dropShadow;
  const pad = shadow.blur * 2;
  const { canvas: shadowCanvas, ctx: shadowCtx } = alloc.acquire(data.width + pad * 2, data.height + pad * 2);
  if (shadow.spread > 0) {
    const spreadScale = 1 + (shadow.spread / Math.max(data.width, data.height)) * 2;
    const spreadOffsetX = pad + (data.width * (1 - spreadScale)) / 2;
    const spreadOffsetY = pad + (data.height * (1 - spreadScale)) / 2;
    shadowCtx.filter = `blur(${shadow.blur}px)`;
    shadowCtx.drawImage(tempCanvas, spreadOffsetX, spreadOffsetY, data.width * spreadScale, data.height * spreadScale);
  } else {
    shadowCtx.filter = `blur(${shadow.blur}px)`;
    shadowCtx.drawImage(tempCanvas, pad, pad);
  }
  shadowCtx.globalCompositeOperation = 'source-in';
  shadowCtx.filter = 'none';
  shadowCtx.fillStyle = `rgba(${shadow.color.r},${shadow.color.g},${shadow.color.b},${shadow.color.a})`;
  shadowCtx.fillRect(0, 0, shadowCanvas.width, shadowCanvas.height);
  ctx.drawImage(shadowCanvas, layer.x + shadow.offsetX - pad, layer.y + shadow.offsetY - pad);
}

export function renderInnerGlow(
  ctx: CanvasRenderingContext2D,
  tempCanvas: HTMLCanvasElement,
  layer: Layer,
  data: ImageData,
  alloc: CanvasAllocator,
): void {
  if (!layer.effects.innerGlow.enabled) return;
  const glow = layer.effects.innerGlow;
  const glowBlur = glow.size + glow.spread;
  const pad = glowBlur * 2;
  const cw = data.width + pad * 2;
  const ch = data.height + pad * 2;

  const { canvas: erodeCanvas, ctx: erodeCtx } = alloc.acquire(cw, ch);
  erodeCtx.filter = `blur(${glowBlur}px)`;
  erodeCtx.drawImage(tempCanvas, pad, pad);
  erodeCtx.filter = 'none';
  erodeCtx.globalCompositeOperation = 'destination-in';
  erodeCtx.filter = `blur(${glowBlur}px)`;
  erodeCtx.drawImage(tempCanvas, pad, pad);
  erodeCtx.filter = 'none';

  const { canvas: glowCanvas, ctx: glowCtx } = alloc.acquire(cw, ch);
  glowCtx.drawImage(tempCanvas, pad, pad);
  glowCtx.globalCompositeOperation = 'destination-out';
  glowCtx.drawImage(erodeCanvas, 0, 0);

  glowCtx.globalCompositeOperation = 'source-in';
  glowCtx.fillStyle = `rgba(${glow.color.r},${glow.color.g},${glow.color.b},${glow.opacity})`;
  glowCtx.fillRect(0, 0, cw, ch);

  ctx.drawImage(glowCanvas, layer.x - pad, layer.y - pad);
}

export function renderStroke(
  ctx: CanvasRenderingContext2D,
  _tempCanvas: HTMLCanvasElement,
  layer: Layer,
  data: ImageData,
  alloc: CanvasAllocator,
): void {
  if (!layer.effects.stroke.enabled) return;
  const stroke = layer.effects.stroke;
  const sw = stroke.width;
  const pad = sw + 1;

  const srcData = data.data;
  const w = data.width;
  const h = data.height;

  // Compute EDT on a padded grid so content touching the crop boundary
  // still has transparent pixels around it for proper edge detection.
  // Without this, cropped layers produce straight-line clipping at edges
  // where the content fills to the boundary.
  const pw = w + pad * 2;
  const ph = h + pad * 2;
  const alpha = new Uint8Array(pw * ph); // zero-initialized = transparent padding
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcIdx = (y * w + x) * 4;
      alpha[(y + pad) * pw + (x + pad)] = (srcData[srcIdx + 3] ?? 0) >= 128 ? 1 : 0;
    }
  }

  const gridSize = pw * ph;
  const distSqInside = new Float64Array(gridSize);
  const distSqOutside = new Float64Array(gridSize);
  const EDT_INF = 1e20;

  for (let i = 0; i < gridSize; i++) {
    distSqInside[i] = alpha[i] ? EDT_INF : 0;
    distSqOutside[i] = alpha[i] ? 0 : EDT_INF;
  }

  edt2d(distSqInside, pw, ph);
  edt2d(distSqOutside, pw, ph);

  const swSq = sw * sw;

  // Output canvas matches the padded grid size
  const outW = pw;
  const outH = ph;
  const { canvas: strokeCanvas, ctx: strokeCtx } = alloc.acquire(outW, outH);
  const strokeImg = strokeCtx.createImageData(outW, outH);
  const sd = strokeImg.data;
  const cr = stroke.color.r;
  const cg = stroke.color.g;
  const cb = stroke.color.b;
  const ca = Math.round(stroke.color.a * 255);

  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const idx = y * pw + x;
      let isStroke = false;

      if (stroke.position === 'outside') {
        isStroke = !alpha[idx] && distSqOutside[idx]! <= swSq;
      } else if (stroke.position === 'inside') {
        isStroke = !!alpha[idx] && distSqInside[idx]! <= swSq;
      } else {
        const halfSq = (sw / 2) * (sw / 2);
        isStroke =
          (!!alpha[idx] && distSqInside[idx]! <= halfSq) ||
          (!alpha[idx] && distSqOutside[idx]! <= halfSq);
      }

      if (isStroke) {
        const oi = (y * outW + x) * 4;
        sd[oi] = cr;
        sd[oi + 1] = cg;
        sd[oi + 2] = cb;
        sd[oi + 3] = ca;
      }
    }
  }

  strokeCtx.putImageData(strokeImg, 0, 0);
  ctx.drawImage(strokeCanvas, layer.x - pad, layer.y - pad);
}

export function applyColorOverlay(
  data: ImageData,
  layer: Layer,
): void {
  if (!layer.effects.colorOverlay.enabled) return;
  const { r, g, b } = layer.effects.colorOverlay.color;
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
}

export function rasterizeEffectsToImageData(
  layer: Layer,
  data: ImageData,
): { imageData: ImageData; offsetX: number; offsetY: number } {
  const effects = layer.effects;

  let pad = 0;
  if (effects.outerGlow.enabled) {
    pad = Math.max(pad, (effects.outerGlow.size + effects.outerGlow.spread) * 2);
  }
  if (effects.dropShadow.enabled) {
    const s = effects.dropShadow;
    pad = Math.max(pad, s.blur * 2 + Math.max(Math.abs(s.offsetX), Math.abs(s.offsetY)) + s.spread);
  }
  if (effects.innerGlow.enabled) {
    pad = Math.max(pad, (effects.innerGlow.size + effects.innerGlow.spread) * 2);
  }
  if (effects.stroke.enabled) {
    pad = Math.max(pad, effects.stroke.width + 1);
  }
  pad = Math.ceil(pad);

  const outW = data.width + pad * 2;
  const outH = data.height + pad * 2;

  const destCanvas = document.createElement('canvas');
  destCanvas.width = outW;
  destCanvas.height = outH;
  const destCtx = destCanvas.getContext('2d', contextOptions)!;

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = data.width;
  tempCanvas.height = data.height;
  const tempCtx = tempCanvas.getContext('2d', contextOptions)!;
  tempCtx.putImageData(data, 0, 0);

  const fakeLayer = { ...layer, x: pad, y: pad } as Layer;
  const alloc = new CanvasAllocator();

  applyColorOverlay(data, layer);
  if (layer.effects.colorOverlay.enabled) {
    tempCtx.putImageData(data, 0, 0);
  }

  destCtx.globalAlpha = 1;
  renderOuterGlow(destCtx, tempCanvas, fakeLayer, data, alloc);
  renderDropShadow(destCtx, tempCanvas, fakeLayer, data, alloc);
  destCtx.drawImage(tempCanvas, pad, pad);
  renderInnerGlow(destCtx, tempCanvas, fakeLayer, data, alloc);
  renderStroke(destCtx, tempCanvas, fakeLayer, data, alloc);

  alloc.releaseAll();

  return {
    imageData: destCtx.getImageData(0, 0, outW, outH),
    offsetX: -pad,
    offsetY: -pad,
  };
}

function edt2d(grid: Float64Array, w: number, h: number): void {
  const maxDim = Math.max(w, h);
  const f = new Float64Array(maxDim);
  const d = new Float64Array(maxDim);
  const v = new Int32Array(maxDim);
  const z = new Float64Array(maxDim + 1);

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x]!;
    edt1d(f, d, v, z, h);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y]!;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x]!;
    edt1d(f, d, v, z, w);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x]!;
  }
}

function edt1d(
  f: Float64Array,
  d: Float64Array,
  v: Int32Array,
  z: Float64Array,
  n: number,
): void {
  let k = 0;
  v[0] = 0;
  z[0] = -1e20;
  z[1] = 1e20;

  for (let q = 1; q < n; q++) {
    const fq = f[q]! + q * q;
    let s = (fq - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (fq - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = 1e20;
  }

  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    d[q] = (q - v[k]!) * (q - v[k]!) + f[v[k]!]!;
  }
}
