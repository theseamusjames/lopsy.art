/**
 * Decode an image blob, preserving high-bit-depth data when possible.
 *
 * Tries the WASM PNG decoder first (supports 16-bit). If the blob is not
 * a PNG or decoding fails, falls back to the browser's canvas 2D API
 * which quantizes to 8-bit per channel.
 *
 * On success via WASM, pixels are already uploaded to the GPU for the given
 * layerId. The returned object indicates which path was used so the caller
 * knows whether to upload pixels from JS.
 *
 * An image larger than a layer can be here is refused with
 * `ImageTooLargeError` before it is decoded into a layer or a canvas: a PNG
 * from its header, anything else from the browser's decode's size.
 */
import { getEngine } from '../engine-wasm/engine-state';
import { decodeAndUploadImage } from '../engine-wasm/wasm-bridge';
import { contextOptions } from '../engine/color-space';
import { getDocumentSizeLimit } from '../engine-wasm/gpu-limits';
import { assertFitsDocument } from '../io/image-too-large';
import { pngSize } from '../io/image-header-size';

export interface DecodeResult {
  width: number;
  height: number;
  /** If true, pixels are already on the GPU for layerId — skip JS upload. */
  gpuUploaded: boolean;
  /** Only set when gpuUploaded is false (canvas 2D fallback). */
  imageData?: ImageData;
}

export async function decodeImageBlob(
  blob: Blob,
  layerId: string,
): Promise<DecodeResult> {
  const engine = getEngine();

  // Try WASM decode path for high-bit-depth PNG support
  if (engine) {
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const header = pngSize(bytes);
    if (header) assertFitsDocument(header.width, header.height, getDocumentSizeLimit());
    const result = decodeAndUploadImage(engine, layerId, bytes);
    if (result.length >= 2) {
      return { width: result[0]!, height: result[1]!, gpuUploaded: true };
    }
  }

  // Fallback: browser decode via canvas 2D (8-bit per channel)
  const bitmap = await createImageBitmap(blob);
  try {
    assertFitsDocument(bitmap.width, bitmap.height, getDocumentSizeLimit());
  } catch (err) {
    bitmap.close();
    throw err;
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', contextOptions);
  if (!ctx) {
    bitmap.close();
    throw new Error('Failed to create canvas context');
  }
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();

  return { width: imageData.width, height: imageData.height, gpuUploaded: false, imageData };
}
