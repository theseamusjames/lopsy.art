import { describe, it, expect } from 'vitest';
import { MAX_RAF_WORKERS, rafWorkerCount } from './raf-decode-plan';

describe('rafWorkerCount', () => {
  it('uses one worker per core', () => {
    expect(rafWorkerCount(1)).toBe(1);
    expect(rafWorkerCount(6)).toBe(6);
  });

  it('caps the pool on many-core machines', () => {
    expect(rafWorkerCount(32)).toBe(MAX_RAF_WORKERS);
  });

  it('falls back to four workers when the core count is unknown', () => {
    expect(rafWorkerCount(undefined)).toBe(4);
    expect(rafWorkerCount(0)).toBe(4);
    expect(rafWorkerCount(Number.NaN)).toBe(4);
  });
});
