import { describe, it, expect } from 'vitest';
import { createBrushTipFromSelection, createColorBrushTipFromSelection } from './brush-from-selection';

function makeImageData(width: number, height: number, fill?: [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = fill[0];
      data[i + 1] = fill[1];
      data[i + 2] = fill[2];
      data[i + 3] = fill[3];
    }
  }
  return { width, height, data, colorSpace: 'srgb' } as ImageData;
}

function fullMask(width: number, height: number): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(width * height);
  mask.fill(255);
  return mask;
}

function tipOf(...args: Parameters<typeof createBrushTipFromSelection>) {
  const tip = createBrushTipFromSelection(...args);
  if (!tip) throw new Error('expected a brush tip');
  return tip;
}

describe('createBrushTipFromSelection', () => {
  it('converts a red pixel to correct grayscale then inverts', () => {
    // Red: 0.299*255 + 0.587*0 + 0.114*0 ≈ 76.245
    // Inverted: 255 - 76 = 179
    const img = makeImageData(1, 1, [255, 0, 0, 255]);
    const result = tipOf(img, {
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      mask: fullMask(1, 1),
      maskWidth: 1,
      maskHeight: 1,
    });
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
    // 255 - round(76.245) = 255 - 76 = 179
    expect(result.data[0]).toBe(179);
  });

  it('converts a green pixel to correct grayscale then inverts', () => {
    // Green: 0.299*0 + 0.587*255 + 0.114*0 ≈ 149.685
    // Inverted: 255 - 150 = 105
    const img = makeImageData(1, 1, [0, 255, 0, 255]);
    const result = tipOf(img, {
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      mask: fullMask(1, 1),
      maskWidth: 1,
      maskHeight: 1,
    });
    expect(result.data[0]).toBe(105);
  });

  it('converts a blue pixel to correct grayscale then inverts', () => {
    // Blue: 0.299*0 + 0.587*0 + 0.114*255 ≈ 29.07
    // Inverted: 255 - 29 = 226
    const img = makeImageData(1, 1, [0, 0, 255, 255]);
    const result = tipOf(img, {
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      mask: fullMask(1, 1),
      maskWidth: 1,
      maskHeight: 1,
    });
    expect(result.data[0]).toBe(226);
  });

  it('applies mask multiplication — mask=128 halves the value', () => {
    // Black pixel: gray=0, inverted=255, * (128/255) ≈ 128
    const img = makeImageData(1, 1, [0, 0, 0, 255]);
    const mask = new Uint8ClampedArray([128]);
    const result = tipOf(img, {
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      mask,
      maskWidth: 1,
      maskHeight: 1,
    });
    expect(result.data[0]).toBe(Math.round(255 * (128 / 255)));
  });

  it('white pixel becomes 0 (transparent brush)', () => {
    // Use a 2x1 image: first pixel black (keeps content so crop doesn't
    // collapse), second pixel white to verify it inverts to 0.
    const img = makeImageData(2, 1);
    // pixel 0: black
    img.data[0] = 0; img.data[1] = 0; img.data[2] = 0; img.data[3] = 255;
    // pixel 1: white
    img.data[4] = 255; img.data[5] = 255; img.data[6] = 255; img.data[7] = 255;

    const result = tipOf(img, {
      bounds: { x: 0, y: 0, width: 2, height: 1 },
      mask: fullMask(2, 1),
      maskWidth: 2,
      maskHeight: 1,
    });
    // Black pixel → gray=0 → inverted=255 (keeps content)
    // White pixel → gray=255 → inverted=0
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
    expect(result.data[0]).toBe(255);
    // The white pixel column was trimmed because its value is 0
  });

  it('black pixel becomes 255 (opaque brush)', () => {
    const img = makeImageData(1, 1, [0, 0, 0, 255]);
    const result = tipOf(img, {
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      mask: fullMask(1, 1),
      maskWidth: 1,
      maskHeight: 1,
    });
    expect(result.data[0]).toBe(255);
  });

  it('crops empty borders from the brush tip', () => {
    // 3x3 image: only center pixel is black, rest is white
    const img = makeImageData(3, 3, [255, 255, 255, 255]);
    // Set center pixel to black
    const idx = (1 * 3 + 1) * 4;
    img.data[idx] = 0;
    img.data[idx + 1] = 0;
    img.data[idx + 2] = 0;

    const result = tipOf(img, {
      bounds: { x: 0, y: 0, width: 3, height: 3 },
      mask: fullMask(3, 3),
      maskWidth: 3,
      maskHeight: 3,
    });

    // White pixels invert to 0, black center inverts to 255
    // Cropping should leave only the 1x1 center
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
    expect(result.data[0]).toBe(255);
  });

  it('returns null when the selection holds only white pixels (#1306)', () => {
    const img = makeImageData(2, 2, [255, 255, 255, 255]);
    const result = createBrushTipFromSelection(img, {
      bounds: { x: 0, y: 0, width: 2, height: 2 },
      mask: fullMask(2, 2),
      maskWidth: 2,
      maskHeight: 2,
    });
    expect(result).toBeNull();
  });

  it('returns null when the selection holds only transparent pixels (#1306)', () => {
    const img = makeImageData(1, 1, [128, 128, 128, 0]);
    const result = createBrushTipFromSelection(img, {
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      mask: fullMask(1, 1),
      maskWidth: 1,
      maskHeight: 1,
    });
    expect(result).toBeNull();
  });

  it('returns null when the selection lies outside the image', () => {
    const img = makeImageData(2, 2, [0, 0, 0, 255]);
    const result = createBrushTipFromSelection(img, {
      bounds: { x: 5, y: 5, width: 2, height: 2 },
      mask: fullMask(8, 8),
      maskWidth: 8,
      maskHeight: 8,
    });
    expect(result).toBeNull();
  });

  it('handles bounds extending beyond imageData', () => {
    const img = makeImageData(2, 2, [0, 0, 0, 255]);
    const result = tipOf(img, {
      bounds: { x: -1, y: -1, width: 4, height: 4 },
      mask: fullMask(4, 4),
      maskWidth: 4,
      maskHeight: 4,
    });
    // Should clamp to the 2x2 region that overlaps the image
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
  });
});

describe('createColorBrushTipFromSelection', () => {
  it('returns null when every selected pixel is transparent (#1306)', () => {
    const img = makeImageData(2, 2, [255, 0, 0, 0]);
    const result = createColorBrushTipFromSelection(img, {
      bounds: { x: 0, y: 0, width: 2, height: 2 },
      mask: fullMask(2, 2),
      maskWidth: 2,
      maskHeight: 2,
    });
    expect(result).toBeNull();
  });

  it('keeps white opaque pixels in a color tip', () => {
    const img = makeImageData(2, 2, [255, 255, 255, 255]);
    const result = createColorBrushTipFromSelection(img, {
      bounds: { x: 0, y: 0, width: 2, height: 2 },
      mask: fullMask(2, 2),
      maskWidth: 2,
      maskHeight: 2,
    });
    expect(result?.width).toBe(2);
    expect(result?.kind).toBe('color');
  });
});
