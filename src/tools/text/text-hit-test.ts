import type { TextLayer, Layer, Point } from '../../types';

/**
 * Find a text layer at the given canvas position.
 * Searches layers from top (last) to bottom (first).
 * Returns the text layer if found, or null.
 */
export function hitTestTextLayer(
  layers: readonly Layer[],
  canvasPos: Point,
): TextLayer | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]!;
    if (layer.type !== 'text' || !layer.visible || layer.locked) continue;
    const textLayer = layer as TextLayer;
    const layerX = textLayer.x;
    const layerY = textLayer.y;
    // For vertical text, columns stack horizontally (one per hard line) and
    // each column is font_size × lineHeight wide; the tallest column drives
    // the height. For area text, use the defined width; for point text,
    // estimate from text length.
    const lines = textLayer.text.split('\n');
    const isVertical = textLayer.vertical ?? false;
    // Point text has no explicit width, so estimate from character count — but
    // a multi-line layer's LONGEST line drives the on-screen width, not the
    // total character count across every line (#845; a 3-line layer with
    // short lines was hit-testing as wide as all three lines end-to-end).
    const longestLineLength = Math.max(1, ...lines.map((l) => l.length));
    const estimatedWidth = isVertical
      ? Math.max(1, lines.length) * textLayer.fontSize * textLayer.lineHeight
      : textLayer.width ?? longestLineLength * textLayer.fontSize * 0.6;
    // paragraphSpacing widens the gap between hard lines (see text_gpu.rs's
    // `para_y = para * run.line_i`), so it contributes once per gap between
    // lines, not once per line.
    const estimatedHeight = isVertical
      ? Math.max(1, ...lines.map((l) => Array.from(l).length)) *
          (textLayer.fontSize + textLayer.letterSpacing)
      : textLayer.fontSize * textLayer.lineHeight * (lines.length || 1) +
          textLayer.paragraphSpacing * Math.max(0, lines.length - 1);
    if (
      canvasPos.x >= layerX &&
      canvasPos.x <= layerX + estimatedWidth &&
      canvasPos.y >= layerY &&
      canvasPos.y <= layerY + estimatedHeight
    ) {
      return textLayer;
    }
  }
  return null;
}
