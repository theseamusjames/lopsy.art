import { describe, it, expect } from 'vitest';
import { nextPathName } from './paths-slice';

describe('nextPathName (#1086)', () => {
  it('starts at Path 1 in a document with no paths', () => {
    expect(nextPathName([])).toBe('Path 1');
  });

  it('numbers past the highest loaded default name', () => {
    expect(nextPathName([{ name: 'Path 1' }, { name: 'Path 2' }])).toBe('Path 3');
    expect(nextPathName([{ name: 'Path 10' }, { name: 'Path 2' }])).toBe('Path 11');
  });

  it('ignores renamed paths and names that only resemble the default', () => {
    expect(nextPathName([{ name: 'Mic handle' }, { name: 'Path 4 copy' }, { name: 'My Path 9' }])).toBe('Path 1');
    expect(nextPathName([{ name: 'Outline' }, { name: 'Path 3' }])).toBe('Path 4');
  });
});
