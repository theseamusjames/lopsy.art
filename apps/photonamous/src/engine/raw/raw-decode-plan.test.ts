import { describe, it, expect } from 'vitest';
import { MAX_RAW_WORKERS, rawWorkerCount } from './raw-decode-plan';

describe('rawWorkerCount', () => {
  it('uses one worker per core', () => {
    expect(rawWorkerCount(1)).toBe(1);
    expect(rawWorkerCount(6)).toBe(6);
  });

  it('caps the pool on many-core machines', () => {
    expect(rawWorkerCount(32)).toBe(MAX_RAW_WORKERS);
  });

  it('falls back to four workers when the core count is unknown', () => {
    expect(rawWorkerCount(undefined)).toBe(4);
    expect(rawWorkerCount(0)).toBe(4);
    expect(rawWorkerCount(Number.NaN)).toBe(4);
  });
});
