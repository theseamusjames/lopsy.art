import type { Color, GroupLayer, Layer, LayerEffects, RasterLayer, TextLayer } from '../types';

export const DEFAULT_EFFECTS: LayerEffects = {
  stroke: { enabled: false, color: { r: 0, g: 0, b: 0, a: 1 }, width: 2, position: 'outside' },
  dropShadow: { enabled: false, color: { r: 0, g: 0, b: 0, a: 0.75 }, offsetX: 4, offsetY: 4, blur: 8, spread: 0, opacity: 0.75 },
  outerGlow: { enabled: false, color: { r: 255, g: 255, b: 100, a: 1 }, size: 10, spread: 0, opacity: 0.75 },
  innerGlow: { enabled: false, color: { r: 255, g: 255, b: 100, a: 1 }, size: 10, spread: 0, opacity: 0.75 },
  colorOverlay: { enabled: false, color: { r: 255, g: 0, b: 0, a: 1 } },
};

export function createRasterLayer(params: {
  name: string;
  width: number;
  height: number;
}): RasterLayer {
  return {
    id: crypto.randomUUID(),
    name: params.name,
    type: 'raster',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    clipToBelow: false,
    effects: DEFAULT_EFFECTS,
    mask: null,
    width: params.width,
    height: params.height,
  };
}

export function createTextLayer(params: {
  name: string;
  text: string;
  fontFamily?: string;
  fontSize?: number;
  color?: Color;
}): TextLayer {
  return {
    id: crypto.randomUUID(),
    name: params.name,
    type: 'text',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    clipToBelow: false,
    effects: DEFAULT_EFFECTS,
    mask: null,
    text: params.text,
    fontFamily: params.fontFamily ?? 'Inter',
    fontSize: params.fontSize ?? 24,
    fontWeight: 400,
    fontStyle: 'normal',
    color: params.color ?? { r: 0, g: 0, b: 0, a: 1 },
    lineHeight: 1.4,
    letterSpacing: 0,
    textAlign: 'left',
    width: null,
    underline: false,
    strikethrough: false,
    baselineShift: 0,
  };
}

export function createGroupLayer(params: { name: string; children?: string[] }): GroupLayer {
  return {
    id: crypto.randomUUID(),
    name: params.name,
    type: 'group',
    visible: true,
    locked: false,
    opacity: 1,
    // Pass-through is the Photoshop default: children blend directly onto the
    // parent composite without pre-compositing into a group FBO.
    blendMode: 'pass-through',
    x: 0,
    y: 0,
    clipToBelow: false,
    effects: DEFAULT_EFFECTS,
    mask: null,
    children: params.children ?? [],
    collapsed: false,
    adjustments: [],
    adjustmentsEnabled: true,
  };
}

export function reorderLayers(
  layers: readonly Layer[],
  fromIndex: number,
  toIndex: number,
): Layer[] {
  const result = [...layers];
  const [moved] = result.splice(fromIndex, 1);
  if (moved === undefined) return result;
  result.splice(toIndex, 0, moved);
  return result;
}

export function hasEnabledEffects(effects: LayerEffects): boolean {
  return effects.dropShadow.enabled || effects.stroke.enabled ||
    effects.outerGlow.enabled || effects.innerGlow.enabled ||
    effects.colorOverlay.enabled;
}

export function duplicateLayer(layer: Layer): Layer {
  return { ...layer, id: crypto.randomUUID(), name: `${layer.name} copy` } as Layer;
}

/**
 * Compute the (dx, dy) offset to apply when duplicating a layer onto a
 * canvas of the given size. Returns a small positional shift so the duplicate
 * is visually distinguishable from the original, but never one that pushes
 * the duplicate further off the canvas than the original was.
 *
 * - Layers wider/taller than the canvas: no shift on that axis (any shift
 *   would move visible content off the canvas).
 * - Layers that fit: shift toward (+10, +10), clamped so the duplicate's
 *   far edge does not pass the canvas edge.
 */
export function duplicateOffsetForLayer(
  layer: Layer,
  canvasWidth: number,
  canvasHeight: number,
): { dx: number; dy: number } {
  const SHIFT = 10;
  const w = layerSpanWidth(layer);
  const h = layerSpanHeight(layer);

  let dx = SHIFT;
  let dy = SHIFT;

  if (w !== null) {
    if (w >= canvasWidth) {
      dx = 0;
    } else {
      const maxX = canvasWidth - w;
      const remaining = maxX - layer.x;
      dx = Math.max(0, Math.min(dx, remaining));
    }
  }

  if (h !== null) {
    if (h >= canvasHeight) {
      dy = 0;
    } else {
      const maxY = canvasHeight - h;
      const remaining = maxY - layer.y;
      dy = Math.max(0, Math.min(dy, remaining));
    }
  }

  return { dx, dy };
}

function layerSpanWidth(layer: Layer): number | null {
  if (layer.type === 'raster' || layer.type === 'shape') return layer.width;
  if (layer.type === 'text') return layer.width;
  return null;
}

function layerSpanHeight(layer: Layer): number | null {
  if (layer.type === 'raster' || layer.type === 'shape') return layer.height;
  return null;
}

export function updateLayer<T extends Layer>(
  layer: T,
  updates: Partial<Omit<T, 'id' | 'type'>>,
): T {
  return { ...layer, ...updates } as T;
}
