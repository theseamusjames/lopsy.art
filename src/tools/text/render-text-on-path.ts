/**
 * Render text-on-path using Canvas2D composition.
 *
 * Strategy (Option B from spec): use an offscreen Canvas2D that is the same
 * size as the document. Each glyph is drawn at its path-derived position using
 * ctx.translate/rotate/fillText. The resulting ImageData is then uploaded to
 * the GPU as the text layer's texture.
 *
 * This bypasses the Rust text engine for path text but produces correct visual
 * output with no Rust/WASM changes required.
 */

import type { PathAnchor } from '../path/path';
import type { TextLayer } from '../../types/layers';
import { buildFontString } from './text';
import { placeTextOnPath } from './text-on-path';
import { contextOptions } from '../../engine/color-space';

export interface PathTextRenderResult {
  /** RGBA pixel data, row-major top-down. */
  pixels: Uint8Array;
  /** Width of the rendered texture (= docWidth). */
  width: number;
  /** Height of the rendered texture (= docHeight). */
  height: number;
  /** Document-space x of the top-left of the texture (always 0). */
  x: number;
  /** Document-space y of the top-left of the texture (always 0). */
  y: number;
}

/**
 * Render `layer`'s text along the given Bezier path into a canvas the size of
 * the document (docWidth × docHeight) and return the pixel data.
 *
 * Returns null if the text is empty, the path has fewer than two anchors, or
 * the canvas context cannot be created.
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

  const canvas = document.createElement('canvas');
  canvas.width = docWidth;
  canvas.height = docHeight;
  const ctx = canvas.getContext('2d', contextOptions);
  if (!ctx) return null;

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
  ctx.font = fontString;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${color.a})`;

  // Measure glyph widths for each character in the text.
  // We include letterSpacing as an additive per-glyph offset.
  const glyphWidths: number[] = [];
  for (const char of text) {
    const metrics = ctx.measureText(char);
    glyphWidths.push(metrics.width + letterSpacing);
  }

  const placements = placeTextOnPath(text, glyphWidths, anchors, pathClosed, fontSize);
  if (placements.length === 0) return null;

  for (const placement of placements) {
    ctx.save();
    ctx.translate(placement.x, placement.y);
    ctx.rotate(placement.rotation);
    // Draw glyph centred horizontally over the placement point.
    // Canvas2D fillText with textAlign 'left' draws from the left edge,
    // so offset by -width/2 to centre.
    const charWidth = glyphWidths[placement.charIndex] ?? fontSize * 0.6;
    ctx.fillText(placement.char, -(charWidth / 2), 0);
    ctx.restore();
  }

  const imageData = ctx.getImageData(0, 0, docWidth, docHeight);
  return {
    pixels: new Uint8Array(imageData.data.buffer),
    width: docWidth,
    height: docHeight,
    x: 0,
    y: 0,
  };
}
