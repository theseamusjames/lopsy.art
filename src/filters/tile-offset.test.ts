import { describe, it, expect } from 'vitest';
import { applyTileOffsetPixels } from './tile-offset';

/** Build a solid-color RGBA buffer. */
function solidPixels(width: number, height: number, r: number, g: number, b: number, a = 255): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return data;
}

/** Read RGBA at (x, y) from a pixel buffer. */
function px(data: Uint8ClampedArray, width: number, x: number, y: number): [number, number, number, number] {
  const i = (y * width + x) * 4;
  return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 0];
}

/** 4×1 strip: pixels 0–3 have red channel values 10,20,30,40 respectively. */
function gradientStrip(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(4 * 1 * 4);
  for (let x = 0; x < 4; x++) {
    data[x * 4] = (x + 1) * 10;   // r = 10, 20, 30, 40
    data[x * 4 + 3] = 255;
  }
  return data;
}

describe('applyTileOffsetPixels', () => {
  it('offset (0, 0) is identity for a solid image', () => {
    const src = solidPixels(8, 8, 255, 128, 64);
    const result = applyTileOffsetPixels(src, 8, 8, 0, 0, true);
    expect(result.length).toBe(src.length);
    expect(px(result, 8, 0, 0)).toEqual([255, 128, 64, 255]);
    expect(px(result, 8, 7, 7)).toEqual([255, 128, 64, 255]);
  });

  it('offset by (width, height) with wrap is identity', () => {
    const src = gradientStrip();
    const result = applyTileOffsetPixels(src, 4, 1, 4, 1, true);
    for (let x = 0; x < 4; x++) {
      expect(px(result, 4, x, 0)).toEqual(px(src, 4, x, 0));
    }
  });

  it('wrap: half-width offset moves right half to left', () => {
    // Strip: [10, 20, 30, 40]
    // Offset by 2: output at x reads from src at (x - 2) mod 4
    // x=0 → src x=2 (r=30), x=1 → src x=3 (r=40), x=2 → src x=0 (r=10), x=3 → src x=1 (r=20)
    const src = gradientStrip();
    const result = applyTileOffsetPixels(src, 4, 1, 2, 0, true);
    expect(px(result, 4, 0, 0)[0]).toBe(30);
    expect(px(result, 4, 1, 0)[0]).toBe(40);
    expect(px(result, 4, 2, 0)[0]).toBe(10);
    expect(px(result, 4, 3, 0)[0]).toBe(20);
  });

  it('wrap: negative offset wraps correctly', () => {
    // Offset by -1: output x reads from src at (x + 1) mod 4
    // x=0 → src x=1 (r=20), x=1 → src x=2 (r=30), x=2 → src x=3 (r=40), x=3 → src x=0 (r=10)
    const src = gradientStrip();
    const result = applyTileOffsetPixels(src, 4, 1, -1, 0, true);
    expect(px(result, 4, 0, 0)[0]).toBe(20);
    expect(px(result, 4, 1, 0)[0]).toBe(30);
    expect(px(result, 4, 2, 0)[0]).toBe(40);
    expect(px(result, 4, 3, 0)[0]).toBe(10);
  });

  it('no-wrap: exposed edges are transparent', () => {
    const src = solidPixels(4, 4, 255, 0, 0);
    // Shift right by 2: left 2 columns become transparent
    const result = applyTileOffsetPixels(src, 4, 4, 2, 0, false);
    expect(px(result, 4, 0, 0)[3]).toBe(0); // left transparent
    expect(px(result, 4, 1, 0)[3]).toBe(0);
    expect(px(result, 4, 2, 0)).toEqual([255, 0, 0, 255]); // content shifted here
    expect(px(result, 4, 3, 0)).toEqual([255, 0, 0, 255]);
  });

  it('no-wrap: shift down fills top rows with transparent', () => {
    const src = solidPixels(4, 4, 0, 255, 0);
    const result = applyTileOffsetPixels(src, 4, 4, 0, 2, false);
    expect(px(result, 4, 0, 0)[3]).toBe(0); // row 0 transparent
    expect(px(result, 4, 0, 1)[3]).toBe(0); // row 1 transparent
    expect(px(result, 4, 0, 2)[1]).toBe(255); // row 2 has green content
    expect(px(result, 4, 0, 3)[1]).toBe(255);
  });

  it('wrap: vertical offset moves content correctly', () => {
    // 1×4 strip, each row has unique green channel value: y=0→20, y=1→40, y=2→60, y=3→80
    const data = new Uint8ClampedArray(1 * 4 * 4);
    for (let y = 0; y < 4; y++) {
      data[(y * 1 + 0) * 4 + 1] = (y + 1) * 20;
      data[(y * 1 + 0) * 4 + 3] = 255;
    }
    // Offset by (0, 1): output y reads from src at (y - 1) mod 4
    // y=0 → src y=3 (g=80), y=1 → src y=0 (g=20), y=2 → src y=1 (g=40), y=3 → src y=2 (g=60)
    const result = applyTileOffsetPixels(data, 1, 4, 0, 1, true);
    expect(px(result, 1, 0, 0)[1]).toBe(80);
    expect(px(result, 1, 0, 1)[1]).toBe(20);
    expect(px(result, 1, 0, 2)[1]).toBe(40);
    expect(px(result, 1, 0, 3)[1]).toBe(60);
  });

  it('preserves alpha channel through offset', () => {
    const src = solidPixels(4, 4, 100, 150, 200, 128);
    const result = applyTileOffsetPixels(src, 4, 4, 1, 1, true);
    const [r, g, b, a] = px(result, 4, 0, 0);
    expect(r).toBe(100);
    expect(g).toBe(150);
    expect(b).toBe(200);
    expect(a).toBe(128);
  });
});
