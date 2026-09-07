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
    const estimatedWidth = isVertical
      ? Math.max(1, lines.length) * textLayer.fontSize * textLayer.lineHeight
      : textLayer.width ?? textLayer.text.length * textLayer.fontSize * 0.6;
    const estimatedHeight = isVertical
      ? Math.max(1, ...lines.map((l) => Array.from(l).length)) *
          (textLayer.fontSize + textLayer.letterSpacing)
      : textLayer.fontSize * textLayer.lineHeight * (lines.length || 1);
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
