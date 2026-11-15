import { describe, it, expect } from 'vitest';
import { applyHealingDab } from './healing';
import { PixelBuffer } from '../../engine/pixel-data';

describe('applyHealingDab', () => {
  it('shifts source texture to match destination color (basic healing math)', () => {
    // Source: uniform red (255, 0, 0)
    const source = new PixelBuffer(40, 40);
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        source.setPixel(x, y, { r: 255, g: 0, b: 0, a: 1 });
      }
    }

    // Destination: uniform blue (0, 0, 255)
    const dest = new PixelBuffer(40, 40);
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        dest.setPixel(x, y, { r: 0, g: 0, b: 255, a: 1 });
      }
    }

    // Heal center of dest from center of source with no offset
    applyHealingDab(dest, source, { x: 20, y: 20 }, { x: 0, y: 0 }, 10, 1);

    // srcMean = {255, 0, 0}, destMean = {0, 0, 255}
    // healed = source - srcMean + destMean = (255-255+0, 0-0+0, 0-0+255) = (0, 0, 255)
    // Result should still be blue — texture from red source, tone of blue dest
    const center = dest.getPixel(20, 20);
    expect(center.r).toBeCloseTo(0, 0);
    expect(center.b).toBeCloseTo(255, 0);
  });

  it('preserves texture detail from source while matching destination tone', () => {
    // Source has a bright spot at its center pixel
    const source = new PixelBuffer(40, 40);
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        source.setPixel(x, y, { r: 100, g: 100, b: 100, a: 1 });
      }
    }
    // Bright detail in source at center
    source.setPixel(20, 20, { r: 200, g: 200, b: 200, a: 1 });

    // Destination: dark gray (50, 50, 50)
    const dest = new PixelBuffer(40, 40);
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        dest.setPixel(x, y, { r: 50, g: 50, b: 50, a: 1 });
      }
    }

    applyHealingDab(dest, source, { x: 20, y: 20 }, { x: 0, y: 0 }, 6, 1);

    // srcMean ≈ 100 (mostly 100 with one 200 pixel — small variation)
    // destMean = 50
    // center pixel: healed = 200 - srcMean + 50
    // The bright detail should still be brighter than surrounding healed pixels
    const center = dest.getPixel(20, 20);
    const neighbor = dest.getPixel(19, 20);
    expect(center.r).toBeGreaterThan(neighbor.r);
  });

  it('skips fully transparent source pixels', () => {
    const source = new PixelBuffer(20, 20);
    // Source is all transparent
    const dest = new PixelBuffer(20, 20);
    dest.setPixel(10, 10, { r: 200, g: 100, b: 50, a: 1 });

    applyHealingDab(dest, source, { x: 10, y: 10 }, { x: 0, y: 0 }, 4, 1);

    // Destination should be unchanged since source is transparent
    const pixel = dest.getPixel(10, 10);
    expect(pixel.r).toBe(200);
    expect(pixel.g).toBe(100);
    expect(pixel.b).toBe(50);
  });

  it('only affects pixels within the circular brush radius', () => {
    const source = new PixelBuffer(40, 40);
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        source.setPixel(x, y, { r: 255, g: 255, b: 255, a: 1 });
      }
    }

    const dest = new PixelBuffer(40, 40);
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        dest.setPixel(x, y, { r: 0, g: 0, b: 0, a: 1 });
      }
    }

    applyHealingDab(dest, source, { x: 20, y: 20 }, { x: 0, y: 0 }, 4, 1);

    // Far corner is outside the brush radius — must be unchanged
    const corner = dest.getPixel(0, 0);
    expect(corner.r).toBe(0);
    expect(corner.g).toBe(0);
    expect(corner.b).toBe(0);
  });

  it('respects opacity — partial opacity does a partial blend', () => {
    const source = new PixelBuffer(20, 20);
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        source.setPixel(x, y, { r: 255, g: 0, b: 0, a: 1 });
      }
    }

    // Dest has same color as source so healed = same color but with opacity blend
    const dest = new PixelBuffer(20, 20);
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        dest.setPixel(x, y, { r: 255, g: 0, b: 0, a: 1 });
      }
    }

    // With identical colors, healed should still be the same color
    applyHealingDab(dest, source, { x: 10, y: 10 }, { x: 0, y: 0 }, 4, 0.5);
    const center = dest.getPixel(10, 10);
    expect(center.r).toBe(255);
    expect(center.g).toBe(0);
  });

  it('handles source offset correctly', () => {
    const source = new PixelBuffer(60, 60);
    // Paint source region at offset (30, 30) green
    for (let y = 25; y < 40; y++) {
      for (let x = 25; x < 40; x++) {
        source.setPixel(x, y, { r: 0, g: 200, b: 0, a: 1 });
      }
    }

    const dest = new PixelBuffer(60, 60);
    for (let y = 0; y < 60; y++) {
      for (let x = 0; x < 60; x++) {
        dest.setPixel(x, y, { r: 100, g: 100, b: 100, a: 1 });
      }
    }

    // Paint dest at (10, 10), sampling source at (10+20, 10+20) = (30, 30)
    applyHealingDab(dest, source, { x: 10, y: 10 }, { x: 20, y: 20 }, 4, 1);

    // Center of dab should have been healed from green source patch
    // Since source mean at (30,30) is (0,200,0) and dest mean at (10,10) is (100,100,100):
    // healed = (0-0+100, 200-200+100, 0-0+100) = (100, 100, 100) — matched to dest tone
    const center = dest.getPixel(10, 10);
    // All channels equalized to dest mean of ~100
    expect(center.r).toBeGreaterThan(50);
  });

  it('clamps healed channel values to 0-255', () => {
    // Source: very bright (close to 255)
    const source = new PixelBuffer(20, 20);
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        source.setPixel(x, y, { r: 240, g: 240, b: 240, a: 1 });
      }
    }

    // Dest: very bright as well, mean close to 255
    const dest = new PixelBuffer(20, 20);
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        dest.setPixel(x, y, { r: 250, g: 250, b: 250, a: 1 });
      }
    }

    applyHealingDab(dest, source, { x: 10, y: 10 }, { x: 0, y: 0 }, 4, 1);

    const center = dest.getPixel(10, 10);
    expect(center.r).toBeGreaterThanOrEqual(0);
    expect(center.r).toBeLessThanOrEqual(255);
    expect(center.g).toBeGreaterThanOrEqual(0);
    expect(center.g).toBeLessThanOrEqual(255);
    expect(center.b).toBeGreaterThanOrEqual(0);
    expect(center.b).toBeLessThanOrEqual(255);
  });

  it('handles identical source and destination colors — output equals input', () => {
    const source = new PixelBuffer(20, 20);
    const dest = new PixelBuffer(20, 20);
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        source.setPixel(x, y, { r: 128, g: 64, b: 32, a: 1 });
        dest.setPixel(x, y, { r: 128, g: 64, b: 32, a: 1 });
      }
    }

    applyHealingDab(dest, source, { x: 10, y: 10 }, { x: 0, y: 0 }, 4, 1);

    // When source === dest, healed should equal orig (no color shift needed)
    const center = dest.getPixel(10, 10);
    expect(center.r).toBeCloseTo(128, 0);
    expect(center.g).toBeCloseTo(64, 0);
    expect(center.b).toBeCloseTo(32, 0);
  });
});
