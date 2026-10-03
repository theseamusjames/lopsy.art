import type { TextLayer, Layer, Point } from '../../types';
import { frameContains, type TextFrame } from './text-transform';
import { glyphBoxContains, type PlacedGlyphBox } from './path-text-geometry';

export interface RenderedSize {
  width: number;
  height: number;
}

/**
 * Returns the size of a layer's rendered texture, or null when it is unknown.
 * A committed text layer's texture is its glyph ink bounds plus a few pixels of
 * padding, positioned at the layer's `x`/`y`.
 */
export type RenderedSizeLookup = (layerId: string) => RenderedSize | null;

/** Looks up a text layer's layout frame (anchor, matrix, layout box), or null. */
export type TextFrameLookup = (layer: TextLayer) => TextFrame | null;

/**
 * Looks up a path-bound text layer's glyph boxes, relative to the layer's
 * `x` / `y`, or null when it has not been rendered.
 */
export type PathGlyphBoxesLookup = (layerId: string) => readonly PlacedGlyphBox[] | null;

/** Slack around the rendered ink box so clicks on antialiased edges still hit. */
const RENDERED_HIT_SLOP = 4;

interface HitRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function renderedHitRect(layer: TextLayer, size: RenderedSize): HitRect {
  // Area text keeps its whole box width clickable, even beside short lines.
  const width = Math.max(size.width, layer.width ?? 0);
  return {
    left: layer.x - RENDERED_HIT_SLOP,
    top: layer.y - RENDERED_HIT_SLOP,
    right: layer.x + width + RENDERED_HIT_SLOP,
    bottom: layer.y + size.height + RENDERED_HIT_SLOP,
  };
}

function estimatedHitRect(layer: TextLayer): HitRect {
  // For vertical text, columns stack horizontally (one per hard line) and
  // each column is font_size × lineHeight wide; the tallest column drives
  // the height. For area text, use the defined width; for point text,
  // estimate from text length.
  const lines = layer.text.split('\n');
  const isVertical = layer.vertical ?? false;
  // Point text has no explicit width, so estimate from character count — but
  // a multi-line layer's LONGEST line drives the on-screen width, not the
  // total character count across every line (#845).
  const longestLineLength = Math.max(1, ...lines.map((l) => l.length));
  const width = isVertical
    ? Math.max(1, lines.length) * layer.fontSize * layer.lineHeight
    : layer.width ?? longestLineLength * layer.fontSize * 0.6;
  // paragraphSpacing widens the gap between hard lines (see text_gpu.rs's
  // `para_y = para * run.line_i`), so it contributes once per gap.
  const height = isVertical
    ? Math.max(1, ...lines.map((l) => Array.from(l).length)) * (layer.fontSize + layer.letterSpacing)
    : layer.fontSize * layer.lineHeight * (lines.length || 1) +
        layer.paragraphSpacing * Math.max(0, lines.length - 1);
  return { left: layer.x, top: layer.y, right: layer.x + width, bottom: layer.y + height };
}

function pathGlyphsContain(
  layer: TextLayer,
  boxes: readonly PlacedGlyphBox[],
  canvasPos: Point,
): boolean {
  const local = { x: canvasPos.x - layer.x, y: canvasPos.y - layer.y };
  return boxes.some((box) => glyphBoxContains(box, local, RENDERED_HIT_SLOP));
}

function hasUsableSize(size: RenderedSize | null): size is RenderedSize {
  return !!size && size.width > 1 && size.height > 1;
}

/**
 * Find a text layer at the given canvas position.
 * Searches layers from top (last) to bottom (first).
 * Returns the text layer if found, or null.
 *
 * When `getRenderedSize` supplies the layer's texture size, the hit box is the
 * rendered glyph bounds. The line-box estimate used otherwise reaches roughly
 * 0.7em below capitals, which swallowed clicks meant to start new text (#989).
 *
 * Path-bound text with known glyph boxes is hit only on (or within the slop
 * of) a glyph, so the empty space inside an arch or a circle of text stays
 * free for new text (#1174).
 */
export function hitTestTextLayer(
  layers: readonly Layer[],
  canvasPos: Point,
  getRenderedSize?: RenderedSizeLookup,
  getFrame?: TextFrameLookup,
  getPathGlyphBoxes?: PathGlyphBoxesLookup,
): TextLayer | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]!;
    if (layer.type !== 'text' || !layer.visible || layer.locked) continue;
    // A transformed layer's texture is the axis-aligned box around rotated
    // glyphs; test its own layout box so empty corners don't capture clicks.
    const frame = layer.transform ? getFrame?.(layer) ?? null : null;
    if (frame) {
      if (frameContains(frame, canvasPos, RENDERED_HIT_SLOP)) return layer;
      continue;
    }
    const glyphBoxes = layer.pathId ? getPathGlyphBoxes?.(layer.id) ?? null : null;
    if (glyphBoxes) {
      if (pathGlyphsContain(layer, glyphBoxes, canvasPos)) return layer;
      continue;
    }
    const size = getRenderedSize?.(layer.id) ?? null;
    const rect = hasUsableSize(size) ? renderedHitRect(layer, size) : estimatedHitRect(layer);
    if (
      canvasPos.x >= rect.left &&
      canvasPos.x <= rect.right &&
      canvasPos.y >= rect.top &&
      canvasPos.y <= rect.bottom
    ) {
      return layer;
    }
  }
  return null;
}
