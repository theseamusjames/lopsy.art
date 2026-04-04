import { describe, it, expect } from 'vitest';
import { createBrushTipFromSelection } from './brush-from-selection';

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

describe('createBrushTipFromSelection', () => {
  it('converts a red pixel to correct grayscale then inverts', () => {
    // Red: 0.299*255 + 0.587*0 + 0.114*0 ≈ 76.245
    // Inverted: 255 - 76 = 179
    const img = makeImageData(1, 1, [255, 0, 0, 255]);
    const result = createBrushTipFromSelection(img, {
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
    const result = createBrushTipFromSelection(img, {
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
    const result = createBrushTipFromSelection(img, {
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
    const result = createBrushTipFromSelection(img, {
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

    const result = createBrushTipFromSelection(img, {
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
    const result = createBrushTipFromSelection(img, {
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

    const result = createBrushTipFromSelection(img, {
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

  it('returns 1x1 fallback for empty selection', () => {
    // All white = all zeros after inversion
    const img = makeImageData(2, 2, [255, 255, 255, 255]);
    const result = createBrushTipFromSelection(img, {
      bounds: { x: 0, y: 0, width: 2, height: 2 },
      mask: fullMask(2, 2),
      maskWidth: 2,
      maskHeight: 2,
    });
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
    expect(result.data[0]).toBe(255);
  });

  it('treats fully transparent pixels as empty', () => {
    // Pixel with alpha=0 should produce gray=0, inverted=255 would be wrong.
    // We treat alpha-0 as gray=0 (before inversion), so inverted = 255.
    // Wait — spec says alpha 0 → grayscale = 0. Then inverted = 255 - 0 = 255.
    // Actually the spec says "treat as empty (grayscale = 0 before inversion)"
    // which means 255 after inversion. But that doesn't make sense for transparent.
    // Re-reading: "If imageData pixel has alpha 0, treat as empty (grayscale = 0 before inversion)"
    // 255 - 0 = 255. But actually, for a fully transparent pixel, the brush should
    // also be empty/transparent (0). Let me re-check the implementation...
    //
    // Actually alpha=0 means the pixel is empty. In the code, gray stays 0 when a=0.
    // Inverted: 255 - 0 = 255. This means transparent pixels become fully opaque brush.
    // That seems wrong but it matches the spec literally. Let me verify against the code.
    //
    // Looking at the code: a=0 → gray=0 → (255-0)*maskVal = 255.
    // The spec says "treat as empty (grayscale = 0 before inversion)".
    // But the user likely wants transparent to mean "no brush" (0 after all).
    // Actually the whole point of "grayscale = 0 before inversion" is that
    // 0 inverts to 255. For "Define Brush Preset" in Photoshop, transparency
    // IS treated as white (no paint), so grayscale should be 255 for alpha=0.
    // Let me fix the implementation.
    //
    // Correction: In Photoshop, transparent = white = no paint.
    // So alpha=0 should → gray=255 → inverted=0 (no paint).
    // The spec says "treat as empty (grayscale = 0 before inversion)" which
    // seems to contradict Photoshop behavior. But re-reading more carefully:
    // "grayscale = 0 before inversion" means the raw grayscale value is 0,
    // and then step 4 inverts it to 255. This would make transparent = full paint.
    // That's unusual. I'll follow the spec as written.
    const img = makeImageData(1, 1, [128, 128, 128, 0]);
    const result = createBrushTipFromSelection(img, {
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      mask: fullMask(1, 1),
      maskWidth: 1,
      maskHeight: 1,
    });
    // alpha=0 → gray=0 → inverted=255
    expect(result.data[0]).toBe(255);
  });

  it('handles bounds extending beyond imageData', () => {
    const img = makeImageData(2, 2, [0, 0, 0, 255]);
    const result = createBrushTipFromSelection(img, {
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
