import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../engine-wasm/wasm-bridge', () => ({ filterTexture: vi.fn() }));

import { filterTexture, type Engine } from '../engine-wasm/wasm-bridge';
import { texture } from './texture';

function defaults(): Record<string, number> {
  return Object.fromEntries(texture.params.map((p) => [p.key, p.defaultValue]));
}

describe('texture filter definition', () => {
  beforeEach(() => vi.mocked(filterTexture).mockClear());

  it('is seeded by its Seed slider rather than randomized', () => {
    expect(texture.randomized).toBeFalsy();
  });

  it('passes the mapped arguments to the engine in order', () => {
    const engine = {} as Engine;
    texture.applyGpu(engine, 'layer-1', { ...defaults(), kind: 2, blend: 1, size: 12, stretch: 4, angle: 30, color: 1, seed: 7 });
    expect(filterTexture).toHaveBeenCalledWith(
      engine, 'layer-1', 2, 1, 0.3, 12, 4, 30, 0.4, 0, true, 7,
    );
  });
});
