import { describe, it, expect } from 'vitest';
import { generateFillPixels, fillConfigKey } from './fill-pixels';
import type { FillConfig } from '../types';

describe('generateFillPixels — solid color', () => {
  it('fills every pixel with the specified RGBA color', () => {
    const fill: FillConfig = {
      type: 'solid-color',
      color: { r: 255, g: 0, b: 0, a: 1 },
    };
    const pixels = generateFillPixels(fill, 4, 4);
    expect(pixels.length).toBe(4 * 4 * 4);
    for (let i = 0; i < 16; i++) {
      expect(pixels[i * 4]).toBe(255);     // R
      expect(pixels[i * 4 + 1]).toBe(0);  // G
      expect(pixels[i * 4 + 2]).toBe(0);  // B
      expect(pixels[i * 4 + 3]).toBe(255); // A (1.0 * 255)
    }
  });

  it('preserves partial alpha', () => {
    const fill: FillConfig = {
      type: 'solid-color',
      color: { r: 0, g: 128, b: 255, a: 0.5 },
    };
    const pixels = generateFillPixels(fill, 2, 2);
    expect(pixels[3]).toBe(128); // round(0.5 * 255) = 128
    expect(pixels[0]).toBe(0);
    expect(pixels[1]).toBe(128);
    expect(pixels[2]).toBe(255);
  });
});

describe('generateFillPixels — linear gradient', () => {
  it('produces different colors at opposite ends', () => {
    const fill: FillConfig = {
      type: 'gradient',
      gradientType: 'linear',
      angle: 90, // 90 deg = left-to-right
      reverse: false,
      stops: [
        { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 255, g: 255, b: 255, a: 1 } },
      ],
    };
    const w = 100;
    const h = 100;
    const pixels = generateFillPixels(fill, w, h);

    // Center row: leftmost pixel should be darker than rightmost
    const leftOffset = (50 * w + 0) * 4;   // (y=50, x=0)
    const rightOffset = (50 * w + 99) * 4; // (y=50, x=99)
    const leftR = pixels[leftOffset]!;
    const rightR = pixels[rightOffset]!;
    expect(leftR).toBeLessThan(rightR);
  });

  it('reverse flag flips the gradient direction', () => {
    const stops = [
      { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
      { position: 1, color: { r: 255, g: 255, b: 255, a: 1 } },
    ];
    const base: FillConfig = {
      type: 'gradient',
      gradientType: 'linear',
      angle: 90, // left-to-right so we can probe x=0 vs x=99
      reverse: false,
      stops,
    };
    const reversed: FillConfig = { ...base, reverse: true };
    const w = 100;
    const h = 100;
    const normalPixels = generateFillPixels(base, w, h);
    const revPixels = generateFillPixels(reversed, w, h);

    // With angle=90 forward: left=black, right=white → x=0 → near 0
    // With reverse: positions are flipped → x=0 → near white
    const leftNormal = normalPixels[(50 * w + 0) * 4]!;
    const leftRev = revPixels[(50 * w + 0) * 4]!;
    expect(leftRev).toBeGreaterThan(leftNormal);
  });
});

describe('generateFillPixels — radial gradient', () => {
  it('produces different colors at center vs edge', () => {
    const fill: FillConfig = {
      type: 'gradient',
      gradientType: 'radial',
      angle: 0,
      reverse: false,
      stops: [
        { position: 0, color: { r: 255, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 0, g: 0, b: 255, a: 1 } },
      ],
    };
    const w = 100;
    const h = 100;
    const pixels = generateFillPixels(fill, w, h);

    // Center pixel — should be near red
    const centerOffset = (50 * w + 50) * 4;
    const centerR = pixels[centerOffset]!;
    const centerB = pixels[centerOffset + 2]!;

    // Top-left corner — should be near blue
    const cornerOffset = 0;
    const cornerR = pixels[cornerOffset]!;
    const cornerB = pixels[cornerOffset + 2]!;

    expect(centerR).toBeGreaterThan(centerB);
    expect(cornerB).toBeGreaterThan(cornerR);
  });
});

describe('generateFillPixels — pattern', () => {
  it('produces a non-uniform checkerboard (not all one color)', () => {
    const fill: FillConfig = {
      type: 'pattern',
      patternId: 'test',
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    };
    const w = 64;
    const h = 64;
    const pixels = generateFillPixels(fill, w, h);

    // Checkerboard should have at least two distinct R values
    const firstR = pixels[0]!;
    let foundDifferent = false;
    for (let i = 1; i < w * h; i++) {
      if (pixels[i * 4] !== firstR) {
        foundDifferent = true;
        break;
      }
    }
    expect(foundDifferent).toBe(true);
  });
});

describe('fillConfigKey', () => {
  it('returns the same key for identical configs', () => {
    const fill: FillConfig = { type: 'solid-color', color: { r: 0, g: 0, b: 0, a: 1 } };
    expect(fillConfigKey(fill)).toBe(fillConfigKey(fill));
  });

  it('returns different keys for different colors', () => {
    const a: FillConfig = { type: 'solid-color', color: { r: 255, g: 0, b: 0, a: 1 } };
    const b: FillConfig = { type: 'solid-color', color: { r: 0, g: 255, b: 0, a: 1 } };
    expect(fillConfigKey(a)).not.toBe(fillConfigKey(b));
  });
});
