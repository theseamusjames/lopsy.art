import { describe, expect, it } from 'vitest';
import { finishKey, finishValues, grainSeed } from './finish-controls';

describe('finish controls', () => {
  it('seeds grain from the asset ID, the same every time and exact in a float32', () => {
    const seed = grainSeed('01a1ee8b-f58f-78f8-8e8c-95d8e879fbcb');
    expect(grainSeed('01a1ee8b-f58f-78f8-8e8c-95d8e879fbcb')).toBe(seed);
    expect(grainSeed('another-photo')).not.toBe(seed);
    expect(seed).toBeLessThanOrEqual(0xffffff);
    expect(Float32Array.from([seed])[0]).toBe(seed);
  });

  it('clears the pass with no vignette and no grain', () => {
    expect(finishValues({ vignette: 0 }, 7, 1)).toBeNull();
    expect(finishValues({ vignette: 0, grain: { amount: 0, size: 40, roughness: 10 } }, 7, 1)).toBeNull();
    expect(finishKey({ vignette: 0 }, 7, 1)).toBe('none');
  });

  it('packs the nine floats, with defaults for recipes saved before the shape controls', () => {
    expect(Array.from(finishValues({ vignette: -30 }, 7, 0.5) ?? [])).toEqual([-30, 50, 0, 50, 0, 25, 50, 7, 0.5]);
    expect(
      Array.from(
        finishValues(
          { vignette: 20, vignetteSize: 70, vignetteRoundness: -40, vignetteFeather: 10, grain: { amount: 35, size: 60, roughness: 80 } },
          123,
          1,
        ) ?? [],
      ),
    ).toEqual([20, 70, -40, 10, 35, 60, 80, 123, 1]);
  });

  it('changes key with the working size', () => {
    expect(finishKey({ vignette: 10 }, 1, 0.5)).not.toBe(finishKey({ vignette: 10 }, 1, 1));
  });
});
