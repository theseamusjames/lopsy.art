import { describe, it, expect } from 'vitest';
import { computeUnbindPathText } from './unbind-path-text';
import { createRasterLayer, createTextLayer } from '../../../layers/layer-model';
import type { Layer, TextLayer } from '../../../types';

function boundText(pathId: string): TextLayer {
  return {
    ...createTextLayer({ name: 'Arc Text', text: 'HELLO' }),
    x: 126,
    y: 281,
    pathId,
    prePathX: 200,
    prePathY: 480,
    pathAnchorX: 120,
    pathAnchorY: 275,
  };
}

describe('computeUnbindPathText', () => {
  it('unbinds text on the removed path and restores its pre-bind anchor', () => {
    const text = boundText('path-1');
    const result = computeUnbindPathText([text], 'path-1');
    expect(result?.unboundIds).toEqual([text.id]);
    const unbound = result?.layers[0] as TextLayer;
    expect(unbound.pathId).toBeUndefined();
    expect(unbound.prePathX).toBeUndefined();
    expect(unbound.prePathY).toBeUndefined();
    expect(unbound.pathAnchorX).toBeUndefined();
    expect(unbound.pathAnchorY).toBeUndefined();
    expect(unbound.x).toBe(200);
    expect(unbound.y).toBe(480);
  });

  it('leaves text bound to other paths and non-text layers untouched', () => {
    const other = boundText('path-2');
    const raster = createRasterLayer({ name: 'Layer 1', width: 4, height: 4 });
    const target = boundText('path-1');
    const layers: Layer[] = [raster, other, target];
    const result = computeUnbindPathText(layers, 'path-1');
    expect(result?.unboundIds).toEqual([target.id]);
    expect(result?.layers[0]).toBe(raster);
    expect(result?.layers[1]).toBe(other);
  });

  it('returns null when nothing is bound to the path', () => {
    expect(computeUnbindPathText([boundText('path-2')], 'path-1')).toBeNull();
  });

  it('keeps x/y when the layer has no stored pre-bind position', () => {
    const text: TextLayer = { ...boundText('path-1'), prePathX: undefined, prePathY: undefined };
    const unbound = computeUnbindPathText([text], 'path-1')?.layers[0] as TextLayer;
    expect(unbound.x).toBe(126);
    expect(unbound.y).toBe(281);
  });
});
