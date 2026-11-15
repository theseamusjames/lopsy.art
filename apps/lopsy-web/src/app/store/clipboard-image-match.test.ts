import { describe, it, expect } from 'vitest';
import { pixelsLikelySame } from './clipboard-image-match';

/** Build a solid-color RGBA buffer of `count` pixels. */
function solid(count: number, r: number, g: number, b: number, a: number): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = a;
  }
  return buf;
}

describe('pixelsLikelySame', () => {
  it('returns true for identical opaque buffers', () => {
    const a = solid(1000, 200, 100, 50, 255);
    const b = solid(1000, 200, 100, 50, 255);
    expect(pixelsLikelySame(a, b)).toBe(true);
  });

  it('returns false for buffers of different length', () => {
    expect(pixelsLikelySame(solid(100, 0, 0, 0, 255), solid(101, 0, 0, 0, 255))).toBe(false);
  });

  it('returns false for empty buffers', () => {
    expect(pixelsLikelySame(solid(0, 0, 0, 0, 0), solid(0, 0, 0, 0, 0))).toBe(false);
  });

  it('returns false when opaque colors clearly differ', () => {
    const red = solid(1000, 255, 0, 0, 255);
    const blue = solid(1000, 0, 0, 255, 255);
    expect(pixelsLikelySame(red, blue)).toBe(false);
  });

  it('tolerates small RGB noise on opaque pixels (round-trip rounding)', () => {
    const a = solid(1000, 128, 128, 128, 255);
    const b = solid(1000, 128, 128, 128, 255);
    // Nudge every channel by <= the 6-unit tolerance.
    for (let i = 0; i < 1000; i++) {
      b[i * 4] = 132;
      b[i * 4 + 1] = 123;
      b[i * 4 + 2] = 130;
    }
    expect(pixelsLikelySame(a, b)).toBe(true);
  });

  it('rejects RGB differences beyond tolerance on opaque pixels', () => {
    const a = solid(1000, 100, 100, 100, 255);
    const b = solid(1000, 120, 100, 100, 255); // +20 on red, well past tolerance
    expect(pixelsLikelySame(a, b)).toBe(false);
  });

  it('returns false when the alpha shape differs', () => {
    const opaque = solid(1000, 50, 50, 50, 255);
    const transparent = solid(1000, 50, 50, 50, 0);
    expect(pixelsLikelySame(opaque, transparent)).toBe(false);
  });

  it('ignores RGB under partial/low alpha (premultiplied round-trip is unreliable there)', () => {
    // Same alpha shape (semi-transparent), wildly different RGB — should still
    // match because RGB is only compared where both alphas are near-opaque.
    const a = solid(1000, 10, 20, 30, 100);
    const b = solid(1000, 200, 180, 160, 100);
    expect(pixelsLikelySame(a, b)).toBe(true);
  });

  it('detects a differing region within otherwise-matching content', () => {
    const a = solid(1000, 0, 0, 0, 255);
    const b = solid(1000, 0, 0, 0, 255);
    // Flip a large fraction of pixels to a very different color — well past the
    // 2% mismatch threshold.
    for (let i = 0; i < 500; i++) {
      b[i * 4] = 255;
      b[i * 4 + 1] = 255;
      b[i * 4 + 2] = 255;
    }
    expect(pixelsLikelySame(a, b)).toBe(false);
  });
});
