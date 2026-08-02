/**
 * Render text-on-path using Canvas2D composition.
 *
 * The rasterization is sized to the placed glyphs' bounding box, not the
 * document, so a small text label on a 4K canvas costs ~kilobytes rather
 * than tens of megabytes per re-render. The returned `x` / `y` give the
 * top-left offset of the texture in document space — the caller must place
 * the layer there.
 *
 * A single canvas is reused across calls (grow-only) so anchor-drag frames
 * don't churn the GC with document-sized allocations.
 */

import type { PathAnchor } from '../path/path';
import type { TextLayer } from '../../types/layers';
import { buildFontString } from './text';
import { placeTextOnPath, type GlyphPlacement } from './text-on-path';
import { contextOptions } from '../../engine/color-space';

export interface PathTextRenderResult {
  /** RGBA pixel data, row-major top-down. */
  pixels: Uint8Array;
  /** Width of the rendered texture. */
  width: number;
  /** Height of the rendered texture. */
  height: number;
  /** Document-space x of the top-left of the texture. */
  x: number;
  /** Document-space y of the top-left of the texture. */
  y: number;
}

let scratchCanvas: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;

function getScratchContext(minWidth: number, minHeight: number): CanvasRenderingContext2D | null {
  if (scratchCanvas === null) {
    scratchCanvas = document.createElement('canvas');
  }
  // Grow-only so we don't reallocate on every frame during a drag. Small waste
  // in memory beats large allocation churn.
  const targetW = Math.max(scratchCanvas.width, minWidth);
  const targetH = Math.max(scratchCanvas.height, minHeight);
  if (scratchCanvas.width !== targetW || scratchCanvas.height !== targetH) {
    scratchCanvas.width = targetW;
    scratchCanvas.height = targetH;
    // Resizing invalidates the context state, so drop the cache.
    scratchCtx = null;
  }
  if (scratchCtx === null) {
    scratchCtx = scratchCanvas.getContext('2d', contextOptions);
  }
  return scratchCtx;
}

export function computeBounds(
  placements: readonly GlyphPlacement[],
  glyphWidths: readonly number[],
  fontSize: number,
  docWidth: number,
  docHeight: number,
): { x: number; y: number; w: number; h: number } | null {
  if (placements.length === 0) return null;

  // Per-glyph padding covers ascender + descender + advance regardless of
  // rotation. A glyph's tightest bounding radius from its centre is at most
  // sqrt((advance/2)^2 + fontSize^2); we use a looser fontSize + advance/2
  // per axis, which is cheap and always safe.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of placements) {
    const advance = glyphWidths[p.charIndex] ?? fontSize * 0.6;
    const pad = fontSize + advance / 2;
    if (p.x - pad < minX) minX = p.x - pad;
    if (p.y - pad < minY) minY = p.y - pad;
    if (p.x + pad > maxX) maxX = p.x + pad;
    if (p.y + pad > maxY) maxY = p.y + pad;
  }

  // Clip to document — anything outside is never composited anyway.
  const x0 = Math.max(0, Math.floor(minX));
  const y0 = Math.max(0, Math.floor(minY));
  const x1 = Math.min(docWidth, Math.ceil(maxX));
  const y1 = Math.min(docHeight, Math.ceil(maxY));

  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return null;

  return { x: x0, y: y0, w, h };
}

/**
 * Render `layer`'s text along the given Bezier path and return the pixel
 * data plus the document-space offset the caller should place the layer at.
 *
 * Returns null if the text is empty, the path has fewer than two anchors,
 * or the canvas context cannot be created.
 */
export function renderTextOnPath(
  layer: TextLayer,
  anchors: readonly PathAnchor[],
  pathClosed: boolean,
  docWidth: number,
  docHeight: number,
): PathTextRenderResult | null {
  const { text, fontSize, fontFamily, fontWeight, fontStyle, color, letterSpacing } = layer;

  if (!text.trim() || anchors.length < 2) return null;

  // Measure glyph widths using the shared scratch context. We haven't sized
  // it yet — a single-pixel canvas is enough for measureText.
  const measureCtx = getScratchContext(1, 1);
  if (!measureCtx) return null;

  const fontString = buildFontString({
    fontSize,
    fontFamily,
    fontWeight,
    fontStyle,
    color: { r: color.r, g: color.g, b: color.b, a: color.a },
    lineHeight: 1.4,
    letterSpacing,
    textAlign: 'left',
  });
  measureCtx.font = fontString;
  measureCtx.textBaseline = 'alphabetic';

  const glyphWidths: number[] = [];
  for (const char of text) {
    const metrics = measureCtx.measureText(char);
    glyphWidths.push(metrics.width + letterSpacing);
  }

  const placements = placeTextOnPath(text, glyphWidths, anchors, pathClosed, fontSize);
  if (placements.length === 0) return null;

  const bounds = computeBounds(placements, glyphWidths, fontSize, docWidth, docHeight);
  if (!bounds) return null;

  const ctx = getScratchContext(bounds.w, bounds.h);
  if (!ctx) return null;

  // Reapply state — either a fresh context or one whose transform/font may
  // have been left over from a previous call.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, bounds.w, bounds.h);
  ctx.font = fontString;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${color.a})`;

  for (const placement of placements) {
    ctx.save();
    ctx.translate(placement.x - bounds.x, placement.y - bounds.y);
    ctx.rotate(placement.rotation);
    const charWidth = glyphWidths[placement.charIndex] ?? fontSize * 0.6;
    ctx.fillText(placement.char, -(charWidth / 2), 0);
    ctx.restore();
  }

  const imageData = ctx.getImageData(0, 0, bounds.w, bounds.h);
  return {
    pixels: new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength),
    width: bounds.w,
    height: bounds.h,
    x: bounds.x,
    y: bounds.y,
  };
}

/**
 * Test-only: drop the cached scratch canvas so subsequent tests start clean.
 */
export function __resetScratchCanvasForTests(): void {
  scratchCanvas = null;
  scratchCtx = null;
}
