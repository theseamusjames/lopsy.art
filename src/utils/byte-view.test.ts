import { describe, it, expect } from 'vitest';
import { bytesOf } from './byte-view';

describe('bytesOf', () => {
  it('covers only the view, not the whole shared buffer', () => {
    const shared = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const view = new Uint8ClampedArray(shared.buffer, 3, 4);
    const bytes = bytesOf(view);
    expect(Array.from(bytes)).toEqual([4, 5, 6, 7]);
    expect(bytes.buffer).toBe(shared.buffer);
  });

  it('returns every byte of a view that owns its buffer', () => {
    const owned = new Uint8ClampedArray([9, 8, 7]);
    expect(Array.from(bytesOf(owned))).toEqual([9, 8, 7]);
  });
});
