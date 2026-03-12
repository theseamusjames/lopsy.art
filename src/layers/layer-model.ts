import type { Color, GroupLayer, Layer, RasterLayer, TextLayer } from '../types';

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
    maskId: null,
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
    maskId: null,
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
    maskId: null,
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

export function duplicateLayer(layer: Layer): Layer {
  return { ...layer, id: crypto.randomUUID(), name: `${layer.name} copy` } as Layer;
}

export function updateLayer<T extends Layer>(
  layer: T,
  updates: Partial<Omit<T, 'id' | 'type'>>,
): T {
  return { ...layer, ...updates } as T;
}
