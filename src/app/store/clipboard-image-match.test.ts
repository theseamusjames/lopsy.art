import { describe, it, expect, beforeEach } from 'vitest';
import {
  pngBytesMatch,
  setLastCopyPngBytes,
  getLastCopyPngBytes,
} from './clipboard-image-match';

describe('pngBytesMatch', () => {
  it('returns true for byte-identical buffers', () => {
    const a = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
    const b = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
    expect(pngBytesMatch(a, b)).toBe(true);
  });

  it('returns true for the same buffer instance', () => {
    const a = new Uint8Array([1, 2, 3]);
    expect(pngBytesMatch(a, a)).toBe(true);
  });

  it('returns false for different-length buffers', () => {
    expect(pngBytesMatch(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3, 4]))).toBe(false);
  });

  it('returns false for empty buffers (no bytes means nothing to trust)', () => {
    expect(pngBytesMatch(new Uint8Array(), new Uint8Array())).toBe(false);
  });

  it('returns false when a single byte differs', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 6]);
    expect(pngBytesMatch(a, b)).toBe(false);
  });
});

describe('lastCopyPngBytes storage (#724)', () => {
  beforeEach(() => {
    setLastCopyPngBytes(null);
  });

  it('starts null before any copy — tryPasteInternalCopy must decline in that case', () => {
    expect(getLastCopyPngBytes()).toBeNull();
  });

  it('round-trips a byte array through set/get', () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 0, 42, 99]);
    setLastCopyPngBytes(bytes);
    expect(getLastCopyPngBytes()).toBe(bytes);
  });

  it('a second copy replaces the stored bytes (old paste-back becomes external)', () => {
    const first = new Uint8Array([1, 2, 3]);
    const second = new Uint8Array([9, 8, 7, 6]);
    setLastCopyPngBytes(first);
    setLastCopyPngBytes(second);
    expect(getLastCopyPngBytes()).toBe(second);
    expect(pngBytesMatch(getLastCopyPngBytes()!, first)).toBe(false);
    expect(pngBytesMatch(getLastCopyPngBytes()!, second)).toBe(true);
  });
});
