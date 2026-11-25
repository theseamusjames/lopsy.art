/**
 * How a file stores layer pixels. `rgba8-gzip`: gzip of 8-bit RGBA, the
 * blob's size in `pixelWidth`/`pixelHeight`. `rgba16-lz4`: the blob
 * `readLayerPixelsLz4U16` writes and `uploadLayerPixelsCompressedU16` reads
 * (a 32-byte header with the crop and full size, then LZ4 of 16-bit RGBA).
 */
export type LayerPixelFormat = 'rgba8-gzip' | 'rgba16-lz4';

/** Width and height a `rgba16-lz4` blob's header records for the whole layer. */
export function rgba16BlobSize(blob: Uint8Array): { width: number; height: number } | null {
  if (blob.byteLength < 24) return null;
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  return { width: view.getInt32(16, true), height: view.getInt32(20, true) };
}
