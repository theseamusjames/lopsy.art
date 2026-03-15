import type { Color, GroupLayer, Layer, LayerEffects, RasterLayer, TextLayer } from '../types';

export const DEFAULT_EFFECTS: LayerEffects = {
  stroke: { enabled: false, color: { r: 0, g: 0, b: 0, a: 1 }, width: 2, position: 'outside' },
  dropShadow: { enabled: false, color: { r: 0, g: 0, b: 0, a: 0.75 }, offsetX: 4, offsetY: 4, blur: 8, spread: 0 },
  outerGlow: { enabled: false, color: { r: 255, g: 255, b: 100, a: 1 }, size: 10, spread: 0, opacity: 0.75 },
  innerGlow: { enabled: false, color: { r: 255, g: 255, b: 100, a: 1 }, size: 10, spread: 0, opacity: 0.75 },
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
  };
}

export function createGroupLayer(params: { name: string }): GroupLayer {
  return {
    id: crypto.randomUUID(),
    name: params.name,
    type: 'group',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    clipToBelow: false,
    effects: DEFAULT_EFFECTS,
    mask: null,
    children: [],
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
    effects.outerGlow.enabled || effects.innerGlow.enabled;
}

export function duplicateLayer(layer: Layer): Layer {
  return { ...layer, id: crypto.randomUUID(), name: `${layer.name} copy` } as Layer;
}

export function updateLayer<T extends Layer>(
  layer: T,
  updates: Partial<Omit<T, 'id' | 'type'>>,
): T {
  return { ...layer, ...updates } as T;
}
