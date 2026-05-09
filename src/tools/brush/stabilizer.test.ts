import { describe, it, expect } from 'vitest';
import { createStabilizerState, stabilize, flushStabilizer } from './stabilizer';

describe('stabilizer', () => {
  it('passes through raw points when strength is 0', () => {
    const state = createStabilizerState({ x: 0, y: 0 });
    const out = stabilize(state, { x: 100, y: 50 }, 0);
    expect(out.x).toBe(100);
    expect(out.y).toBe(50);
  });

  it('produces smoothed output that trails behind the raw input', () => {
    const state = createStabilizerState({ x: 0, y: 0 });
    const out = stabilize(state, { x: 100, y: 0 }, 50);
    expect(out.x).toBeGreaterThan(0);
    expect(out.x).toBeLessThan(100);
  });

  it('higher strength produces more trailing (further from raw input)', () => {
    const stateA = createStabilizerState({ x: 0, y: 0 });
    const stateB = createStabilizerState({ x: 0, y: 0 });

    const lowSmooth = stabilize(stateA, { x: 100, y: 0 }, 20);
    const highSmooth = stabilize(stateB, { x: 100, y: 0 }, 80);

    expect(lowSmooth.x).toBeGreaterThan(highSmooth.x);
  });

  it('converges toward raw input with repeated identical inputs', () => {
    const state = createStabilizerState({ x: 0, y: 0 });

    let out = { x: 0, y: 0 };
    for (let i = 0; i < 20; i++) {
      out = stabilize(state, { x: 100, y: 100 }, 50);
    }

    expect(out.x).toBeCloseTo(100, 0);
    expect(out.y).toBeCloseTo(100, 0);
  });

  it('flush returns points converging on the final position', () => {
    const state = createStabilizerState({ x: 0, y: 0 });
    stabilize(state, { x: 50, y: 50 }, 50);
    stabilize(state, { x: 100, y: 100 }, 50);

    const flushed = flushStabilizer(state);
    expect(flushed.length).toBeGreaterThan(0);

    const last = flushed[flushed.length - 1]!;
    expect(last.x).toBeCloseTo(100, 0);
    expect(last.y).toBeCloseTo(100, 0);
  });

  it('flush is a no-op when buffer has only one point', () => {
    const state = createStabilizerState({ x: 50, y: 50 });
    const flushed = flushStabilizer(state);
    expect(flushed.length).toBe(0);
  });

  it('smooths out a jerky diagonal path', () => {
    const state = createStabilizerState({ x: 0, y: 0 });
    const outputs: Array<{ x: number; y: number }> = [];

    const rawPoints = [
      { x: 12, y: 8 },
      { x: 18, y: 22 },
      { x: 30, y: 15 },
      { x: 42, y: 28 },
      { x: 50, y: 20 },
    ];

    for (const pt of rawPoints) {
      outputs.push(stabilize(state, pt, 60));
    }

    let rawVariance = 0;
    let smoothVariance = 0;
    for (let i = 1; i < rawPoints.length; i++) {
      const rawDy = rawPoints[i]!.y - rawPoints[i - 1]!.y;
      const smoothDy = outputs[i]!.y - outputs[i - 1]!.y;
      rawVariance += rawDy * rawDy;
      smoothVariance += smoothDy * smoothDy;
    }

    expect(smoothVariance).toBeLessThan(rawVariance);
  });
});
