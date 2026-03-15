/**
 * Web Worker for document canvas rendering.
 *
 * Owns an OffscreenCanvas and renders the document at 30fps:
 * checkerboard, composited layers, adjustments, and border.
 * Runs entirely off the main thread so overlay interactions
 * (selection, handles, cursor) stay instant.
 */

import { applyAdjustmentsToImageData, hasActiveAdjustments } from '../filters/image-adjustments';
import type { ImageAdjustments } from '../filters/image-adjustments';

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

// State received from main thread
let composite: ImageBitmap | null = null;
let vp = { panX: 0, panY: 0, zoom: 1 };
let docW = 0;
let docH = 0;
let cW = 0;
let cH = 0;
let adj: ImageAdjustments | null = null;
let adjEnabled = false;
let dirty = true;

// Pre-rendered checkerboard pattern (much faster than individual fillRect calls)
let checkerPattern: CanvasPattern | null = null;

function rebuildCheckerPattern(): void {
  if (!ctx) return;
  const tile = new OffscreenCanvas(16, 16);
  const tc = tile.getContext('2d')!;
  tc.fillStyle = '#ffffff';
  tc.fillRect(0, 0, 16, 16);
  tc.fillStyle = '#cccccc';
  tc.fillRect(8, 0, 8, 8);
  tc.fillRect(0, 8, 8, 8);
  checkerPattern = ctx.createPattern(tile, 'repeat');
}

function render(): void {
  if (!canvas || !ctx || !dirty) return;
  dirty = false;

  // Background
  ctx.fillStyle = '#3c3c3c';
  ctx.fillRect(0, 0, cW, cH);

  if (docW === 0 || docH === 0) return;

  // Viewport transform
  ctx.save();
  ctx.translate(vp.panX + cW / 2, vp.panY + cH / 2);
  ctx.scale(vp.zoom, vp.zoom);
  ctx.translate(-docW / 2, -docH / 2);

  // Checkerboard
  if (checkerPattern) {
    ctx.fillStyle = checkerPattern;
    ctx.fillRect(0, 0, docW, docH);
  }

  // Composite
  if (composite) {
    ctx.drawImage(composite, 0, 0);
  }

  // Document border
  ctx.strokeStyle = '#666666';
  ctx.lineWidth = 1 / vp.zoom;
  ctx.strokeRect(0, 0, docW, docH);

  ctx.restore();

  // Post-composite adjustments (runs off main thread)
  if (adjEnabled && adj && hasActiveAdjustments(adj)) {
    const dx = vp.panX + cW / 2 - (docW / 2) * vp.zoom;
    const dy = vp.panY + cH / 2 - (docH / 2) * vp.zoom;
    const sx = Math.max(0, Math.floor(dx));
    const sy = Math.max(0, Math.floor(dy));
    const ex = Math.min(cW, Math.ceil(dx + docW * vp.zoom));
    const ey = Math.min(cH, Math.ceil(dy + docH * vp.zoom));
    const sw = ex - sx;
    const sh = ey - sy;
    if (sw > 0 && sh > 0) {
      const imgData = ctx.getImageData(sx, sy, sw, sh);
      applyAdjustmentsToImageData(imgData, adj);
      ctx.putImageData(imgData, sx, sy);
    }
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init':
      canvas = msg.canvas as OffscreenCanvas;
      ctx = canvas.getContext('2d', msg.contextOptions || {}) as OffscreenCanvasRenderingContext2D;
      rebuildCheckerPattern();
      intervalId = setInterval(render, 1000 / 30);
      break;

    case 'state':
      if (msg.composite) {
        if (composite) composite.close();
        composite = msg.composite as ImageBitmap;
      }
      if (msg.viewport) vp = msg.viewport;
      if (msg.docWidth !== undefined) docW = msg.docWidth;
      if (msg.docHeight !== undefined) docH = msg.docHeight;
      if (msg.canvasWidth !== undefined) cW = msg.canvasWidth;
      if (msg.canvasHeight !== undefined) cH = msg.canvasHeight;
      if (msg.adjustments !== undefined) adj = msg.adjustments;
      if (msg.adjustmentsEnabled !== undefined) adjEnabled = msg.adjustmentsEnabled;
      dirty = true;
      break;

    case 'resize':
      if (canvas) {
        canvas.width = msg.width;
        canvas.height = msg.height;
        cW = msg.width;
        cH = msg.height;
        rebuildCheckerPattern();
        dirty = true;
      }
      break;

    case 'dispose':
      if (intervalId !== null) clearInterval(intervalId);
      if (composite) composite.close();
      break;
  }
};
