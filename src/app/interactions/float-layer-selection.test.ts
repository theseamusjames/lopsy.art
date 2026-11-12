import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  clearSelection: vi.fn(),
  compositeFloat: vi.fn(),
  floatSelection: vi.fn(),
  setSelectionMask: vi.fn(),
}));

const bridge = await import('../../engine-wasm/wasm-bridge');
const { floatLayerSelection } = await import('./float-layer-selection');
const { recordLayerAlphaSelection } = await import('./layer-alpha-selection');

const engine = {} as unknown as Parameters<typeof floatLayerSelection>[0];

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
    const mask = new Uint8ClampedArray(16);
    floatLayerSelection(engine, 'a', { mask, maskWidth: 4, maskHeight: 4 });
    expect(calls()).toEqual(['setSelectionMask', 'floatSelection', 'compositeFloat']);
  });

  it('lifts a layer-alpha selection of the same layer unmasked, then reinstalls the mask (#1605)', () => {
    const mask = new Uint8ClampedArray(16);
    recordLayerAlphaSelection('a', mask);
    floatLayerSelection(engine, 'a', { mask, maskWidth: 4, maskHeight: 4 });
    expect(calls()).toEqual(['clearSelection', 'floatSelection', 'compositeFloat', 'setSelectionMask']);
  });

  it('masks a layer-alpha selection when it floats a different layer or the mask changed', () => {
    const mask = new Uint8ClampedArray(16);
    recordLayerAlphaSelection('a', mask);
    floatLayerSelection(engine, 'b', { mask, maskWidth: 4, maskHeight: 4 });
    floatLayerSelection(engine, 'a', { mask: new Uint8ClampedArray(16), maskWidth: 4, maskHeight: 4 });
    expect(vi.mocked(bridge.clearSelection)).not.toHaveBeenCalled();
  });
});
