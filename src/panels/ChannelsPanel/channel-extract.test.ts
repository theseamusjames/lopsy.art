// @vitest-environment jsdom
import '../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { extractChannel } from './channel-extract';

function makeImageData(pixels: number[][]): ImageData {
  // pixels is array of [r, g, b, a] tuples
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b, a], i) => {
    data[i * 4] = r!;
    data[i * 4 + 1] = g!;
    data[i * 4 + 2] = b!;
    data[i * 4 + 3] = a!;
  });
  const width = Math.ceil(Math.sqrt(pixels.length));
  const height = Math.ceil(pixels.length / width);
  return new ImageData(data, width, height);
}

describe('extractChannel', () => {
  const pixel = [200, 100, 50, 180] as [number, number, number, number];
  const source = makeImageData([pixel]);

  it('extracts the R channel as grayscale', () => {
    const result = extractChannel(source, 'r');
    expect(result.data[0]).toBe(200);
    expect(result.data[1]).toBe(200);
    expect(result.data[2]).toBe(200);
    expect(result.data[3]).toBe(255);
  });

  it('extracts the G channel as grayscale', () => {
    const result = extractChannel(source, 'g');
    expect(result.data[0]).toBe(100);
    expect(result.data[1]).toBe(100);
    expect(result.data[2]).toBe(100);
    expect(result.data[3]).toBe(255);
  });

  it('extracts the B channel as grayscale', () => {
    const result = extractChannel(source, 'b');
    expect(result.data[0]).toBe(50);
    expect(result.data[1]).toBe(50);
    expect(result.data[2]).toBe(50);
    expect(result.data[3]).toBe(255);
  });

  it('extracts the A channel as grayscale', () => {
    const result = extractChannel(source, 'a');
    expect(result.data[0]).toBe(180);
    expect(result.data[1]).toBe(180);
    expect(result.data[2]).toBe(180);
    expect(result.data[3]).toBe(255);
  });

  it('preserves image dimensions', () => {
    const wide = makeImageData(Array.from({ length: 9 }, (_, i) => [i * 20, i * 10, i * 5, 255] as [number, number, number, number]));
    const result = extractChannel(wide, 'r');
    expect(result.width).toBe(wide.width);
    expect(result.height).toBe(wide.height);
  });

  it('output alpha is always 255', () => {
    const transparent = makeImageData([[128, 64, 32, 0]]);
    const result = extractChannel(transparent, 'r');
    // Alpha channel of output should be fully opaque even though source has alpha=0
    expect(result.data[3]).toBe(255);
  });

  it('zero-value channel maps to black', () => {
    const black = makeImageData([[0, 0, 0, 255]]);
    const result = extractChannel(black, 'r');
    expect(result.data[0]).toBe(0);
    expect(result.data[1]).toBe(0);
    expect(result.data[2]).toBe(0);
  });

  it('full-value channel maps to white', () => {
    const white = makeImageData([[255, 255, 255, 255]]);
    const result = extractChannel(white, 'g');
    expect(result.data[0]).toBe(255);
    expect(result.data[1]).toBe(255);
    expect(result.data[2]).toBe(255);
  });

  it('handles multi-pixel images correctly', () => {
    const pixels = [
      [255, 0, 0, 255],
      [0, 128, 0, 255],
      [0, 0, 64, 255],
    ] as [number, number, number, number][];
    const src = makeImageData(pixels);
    const result = extractChannel(src, 'r');

    // First pixel: r=255
    expect(result.data[0]).toBe(255);
    // Second pixel: r=0
    expect(result.data[4]).toBe(0);
    // Third pixel: r=0
    expect(result.data[8]).toBe(0);
  });
});
