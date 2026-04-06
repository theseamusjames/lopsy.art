/**
 * Minimal BMP encoder — produces an uncompressed 24-bit BMP file.
 * BMP stores rows bottom-to-top in BGR order, padded to 4-byte boundaries.
 */
export function encodeBMP(imageData: ImageData): Blob {
  const { width, height, data } = imageData;
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelDataSize = rowSize * height;
  const fileSize = 54 + pixelDataSize;
  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  // File header (14 bytes)
  view.setUint8(0, 0x42); // 'B'
  view.setUint8(1, 0x4d); // 'M'
  view.setUint32(2, fileSize, true);
  view.setUint32(6, 0, true); // reserved
  view.setUint32(10, 54, true); // pixel data offset

  // DIB header — BITMAPINFOHEADER (40 bytes)
  view.setUint32(14, 40, true); // header size
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true); // color planes
  view.setUint16(28, 24, true); // bits per pixel
  view.setUint32(30, 0, true); // compression (BI_RGB = none)
  view.setUint32(34, pixelDataSize, true);
  view.setUint32(38, 2835, true); // horizontal resolution (~72 DPI)
  view.setUint32(42, 2835, true); // vertical resolution (~72 DPI)
  view.setUint32(46, 0, true); // colors in palette
  view.setUint32(50, 0, true); // important colors

  // Pixel data — bottom-to-top rows, BGR byte order
  const pixels = new Uint8Array(buffer, 54);
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width;
    const dstRow = y * rowSize;
    for (let x = 0; x < width; x++) {
      const srcIdx = (srcRow + x) * 4;
      const dstIdx = dstRow + x * 3;
      pixels[dstIdx] = data[srcIdx + 2]!; // B
      pixels[dstIdx + 1] = data[srcIdx + 1]!; // G
      pixels[dstIdx + 2] = data[srcIdx]!; // R
    }
  }

  return new Blob([buffer], { type: 'image/bmp' });
}
