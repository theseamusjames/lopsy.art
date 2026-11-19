import { describe, expect, it } from 'vitest';
import { chooseBackendName, seedCount } from './backend-registry';

describe('backend registry', () => {
  it('uses the real backend unless the fake is asked for', () => {
    expect(chooseBackendName('')).toBe('real');
    expect(chooseBackendName('?backend=fake')).toBe('fake');
    expect(chooseBackendName('?backend=other')).toBe('real');
  });
  it('reads the seed count', () => {
    expect(seedCount('')).toBe(240);
    expect(seedCount('?seed=50000')).toBe(50000);
    expect(seedCount('?seed=-1')).toBe(240);
  });
});
