import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  clearSelection: vi.fn(),
  compositeFloat: vi.fn(),
  floatSelection: vi.fn(),
  setSelectionMask: vi.fn(),
}));

const bridge = await import('../../engine-wasm/wasm-bridge');
const { floatLayerSelection } = await import('./float-layer-selection');
const { recordLayerAlphaSelection, forgetLayerAlphaSelection } = await import('./layer-alpha-selection');
const { transformSelectionOfLayer } = await import('./transform-lift-mask');
const { createTransformState } = await import('../../tools/transform/transform');

const engine = {} as unknown as Parameters<typeof floatLayerSelection>[0];

function selectionMask(): Uint8ClampedArray {
  return new Uint8ClampedArray(16);
}

function calls(): string[] {
  const order: Array<[number, string]> = [];
  for (const name of ['clearSelection', 'setSelectionMask', 'floatSelection', 'compositeFloat'] as const) {
    for (const n of vi.mocked(bridge[name]).mock.invocationCallOrder) order.push([n, name]);
  }
  return order.sort((a, b) => a[0] - b[0]).map(([, name]) => name);
}

describe('floatLayerSelection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lifts an ordinary selection through its mask', () => {
    const mask = selectionMask();
    floatLayerSelection(engine, 'a', { mask, maskWidth: 4, maskHeight: 4 });
    expect(calls()).toEqual(['setSelectionMask', 'floatSelection', 'compositeFloat']);
  });

  it('lifts a layer-alpha selection of the same layer unmasked, then reinstalls the mask (#1605)', () => {
    const mask = selectionMask();
    recordLayerAlphaSelection('a', mask);
    floatLayerSelection(engine, 'a', { mask, maskWidth: 4, maskHeight: 4 });
    expect(calls()).toEqual(['clearSelection', 'floatSelection', 'compositeFloat', 'setSelectionMask']);
  });

  it('masks a layer-alpha selection when it floats a different layer or the mask changed', () => {
    const mask = selectionMask();
    recordLayerAlphaSelection('a', mask);
    floatLayerSelection(engine, 'b', { mask, maskWidth: 4, maskHeight: 4 });
    floatLayerSelection(engine, 'a', { mask: selectionMask(), maskWidth: 4, maskHeight: 4 });
    expect(vi.mocked(bridge.clearSelection)).not.toHaveBeenCalled();
  });

  it('masks a layer-alpha selection once a pixel-writing tool has forgotten it', () => {
    const mask = selectionMask();
    recordLayerAlphaSelection('a', mask);
    forgetLayerAlphaSelection();
    floatLayerSelection(engine, 'a', { mask, maskWidth: 4, maskHeight: 4 });
    expect(calls()).toEqual(['setSelectionMask', 'floatSelection', 'compositeFloat']);
  });

  it('lifts a scaled selection through its lift mask, then reinstalls the selection (#1675)', () => {
    const original = new Uint8ClampedArray(64);
    for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) original[y * 8 + x] = 255;
    const transform = { ...createTransformState({ x: 2, y: 2, width: 4, height: 4 }), scaleX: 1.3, scaleY: 1.3 };
    const { mask } = transformSelectionOfLayer('a', original, 8, 8, transform);
    floatLayerSelection(engine, 'a', { mask, maskWidth: 8, maskHeight: 8 });
    expect(calls()).toEqual(['setSelectionMask', 'floatSelection', 'compositeFloat', 'setSelectionMask']);
    const [lifted, installed] = vi.mocked(bridge.setSelectionMask).mock.calls.map((c) => Array.from(c[1] as Uint8Array));
    expect(lifted).toEqual(Array.from(mask, (v) => (v > 0 ? 255 : 0)));
    expect(installed).toEqual(Array.from(mask));
    expect(lifted).not.toEqual(installed);
  });
});
