import { describe, it, expect } from 'vitest';
import { encodeBMP } from './bmp-encoder';

function makeImageData(width: number, height: number, fill: [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = fill[3];
  }
  return { width, height, data, colorSpace: 'srgb' } as ImageData;
}

describe('encodeBMP', () => {
  it('produces a valid BMP file header', async () => {
    const img = makeImageData(2, 2, [255, 0, 0, 255]);
    const blob = encodeBMP(img);
    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);

    // Magic bytes
    expect(view.getUint8(0)).toBe(0x42); // 'B'
    expect(view.getUint8(1)).toBe(0x4d); // 'M'

    // Pixel data offset
    expect(view.getUint32(10, true)).toBe(54);

    // DIB header size
    expect(view.getUint32(14, true)).toBe(40);

    // Dimensions
    expect(view.getInt32(18, true)).toBe(2);
    expect(view.getInt32(22, true)).toBe(2);

    // Bits per pixel
    expect(view.getUint16(28, true)).toBe(24);
  });

  it('stores pixels in BGR bottom-to-top order', async () => {
    // 1x2 image: top pixel red, bottom pixel blue
    const data = new Uint8ClampedArray([
      255, 0, 0, 255,   // top row: red
      0, 0, 255, 255,   // bottom row: blue
    ]);
    const img = { width: 1, height: 2, data, colorSpace: 'srgb' } as ImageData;
    const blob = encodeBMP(img);
    const buf = await blob.arrayBuffer();
    const pixels = new Uint8Array(buf, 54);

    // Row size padded to 4 bytes: ceil(1*3/4)*4 = 4
    const rowSize = 4;

    // First row in BMP = bottom row of image = blue pixel (BGR: 255, 0, 0)
    expect(pixels[0]).toBe(255); // B
    expect(pixels[1]).toBe(0);   // G
    expect(pixels[2]).toBe(0);   // R

    // Second row in BMP = top row of image = red pixel (BGR: 0, 0, 255)
    expect(pixels[rowSize]).toBe(0);     // B
    expect(pixels[rowSize + 1]).toBe(0); // G
    expect(pixels[rowSize + 2]).toBe(255); // R
  });

  it('produces correct file size', async () => {
    const img = makeImageData(3, 2, [0, 0, 0, 255]);
    const blob = encodeBMP(img);
    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);

    // Row size: ceil(3*3/4)*4 = ceil(9/4)*4 = 3*4 = 12
    const rowSize = 12;
    const expectedSize = 54 + rowSize * 2;
    expect(view.getUint32(2, true)).toBe(expectedSize);
    expect(buf.byteLength).toBe(expectedSize);
  });

  it('sets mime type to image/bmp', () => {
    const img = makeImageData(1, 1, [0, 0, 0, 255]);
    const blob = encodeBMP(img);
    expect(blob.type).toBe('image/bmp');
  });
});
