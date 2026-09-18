import type { Layer, ToolId } from '../types';
import { notifyInfo } from '../app/notifications-store';
import { toolRegistry } from '../tools/tool-registry';

/**
 * Tools whose down-handler or menu action writes into a raster layer's
 * texture. Group and text layers can't accept those writes: writing to a
 * group produces an invisible allocation + a wasted history row (the
 * compositor skips the group's own texture), and writing to a text layer
 * lands until the next text re-render rebuilds the texture and wipes it
 * (#768).
 *
 * Anything derived from the tool registry (isPaint) plus the non-paint
 * writers: bucket fill, gradient, shape, and smudge (which is registered
 * as isGpu but not isPaint yet still mutates the layer texture).
 */
const NON_PAINT_PIXEL_WRITERS: ReadonlySet<ToolId> = new Set<ToolId>([
  'fill',
  'gradient',
  'shape',
  'smudge',
]);

export function toolWritesRasterPixels(tool: ToolId): boolean {
  if (NON_PAINT_PIXEL_WRITERS.has(tool)) return true;
  return !!toolRegistry[tool]?.isPaint;
}

/**
 * True when the layer's type can accept a pixel write from a paint /
 * bucket / gradient / shape tool or a menu writer (fill, filter,
 * define-pattern).
 */
export function canReceiveRasterPaint(layer: Layer | null | undefined): boolean {
  if (!layer) return false;
  if (layer.type === 'group') return false;
  if (layer.type === 'text') return false;
  return true;
}

/**
 * Guard for pixel-writing entry points. Returns true when the write may
 * proceed. When it returns false, a user-visible toast has already been
 * shown explaining why the layer refused the write.
 */
export function guardPixelWrite(layer: Layer | null | undefined): boolean {
  if (!layer) return false;
  if (layer.type === 'group') {
    notifyInfo("Groups can't be painted on. Select a layer inside the group.");
    return false;
  }
  if (layer.type === 'text') {
    notifyInfo('Text layers must be rasterized before they can be painted on.');
    return false;
  }
  return true;
}
