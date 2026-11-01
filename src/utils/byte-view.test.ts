import { describe, it, expect } from 'vitest';
import { bytesOf } from './byte-view';

describe('bytesOf', () => {
  it('covers only the view, not the whole shared buffer', () => {
    const shared = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const view = new Int8Array(shared.buffer, 3, 4);
    const bytes = bytesOf(view);
    expect(Array.from(bytes)).toEqual([4, 5, 6, 7]);
    expect(bytes.buffer).toBe(shared.buffer);
  });

  it('measures multi-byte views in bytes', () => {
    const shared = new Uint16Array(6);
    const view = new Uint16Array(shared.buffer, 4, 2);
    const bytes = bytesOf(view);
    expect(bytes.byteOffset).toBe(4);
    expect(bytes.length).toBe(4);
  });

  it('returns every byte of a view that owns its buffer', () => {
    const owned = Uint8Array.from([9, 8, 7]);
    expect(Array.from(bytesOf(owned))).toEqual([9, 8, 7]);
  });
});
