import { describe, it, expect } from 'vitest';
import { recordStartupTiming } from './startup-timing';

describe('recordStartupTiming', () => {
  it('records a measure spanning from the given start to now', () => {
    const start = performance.now();
    recordStartupTiming('lopsy:test-step', start);

    const entries = performance.getEntriesByName('lopsy:test-step');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.startTime).toBeCloseTo(start, 3);
    expect(entries[0]?.duration).toBeGreaterThanOrEqual(0);
  });
});
