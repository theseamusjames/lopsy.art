/**
 * Image export as bytes: composites the document in the engine and encodes
 * it as PNG (8- or 16-bit), JPEG, WebP or BMP with the metadata and colour
 * profile File > Export… and Quick Export PNG write. Downloading the result
 * is the menu's job (file-menu.ts); this module only produces the bytes and
 * throws when it cannot.
 */
import { useEditorStore } from '../app/editor-store';
import { getEngine } from '../engine-wasm/engine-state';
import { buildIccProfile, compositeForExport, convertP3ToSrgb, exportPng16, getCompositeSize, type Engine } from '../engine-wasm/wasm-bridge';
import { flushLayerSync } from '../engine-wasm/engine-sync';
import { finalizePendingStrokeGlobal } from '../app/interactions/pending-stroke';
import { commitLayerTransform } from '../app/interactions/layer-transform';
import { canvasColorSpace, contextOptions, createImageDataFromArray, isWideGamut } from '../engine/color-space';
import { addJpegComment, addPngMetadata, type EmbeddedIccProfile } from '../utils/image-metadata';
import { encodeBMP } from '../utils/bmp-encoder';
import { FORMAT_EXT, FORMAT_MIME, qualityToFraction, type ExportFormat, type ExportOptions } from '../app/MenuBar/export-logic';

const METADATA_NOTE = 'Made with Lopsy — http://lopsy.art';

/** Color space code shared with the WASM export functions: 0 = sRGB, 1 = Display P3. */
const COLOR_SPACE_DISPLAY_P3 = 1;

export type ImageExportSettings = Pick<ExportOptions, 'format' | 'quality' | 'highQuality'>;

export interface EncodedImage {
  bytes: Uint8Array;
  mime: string;
  ext: string;
  width: number;
  height: number;
}

/** The 16-bit PNG encoder failed; the menu toasts this one as "Failed to export PNG: …". */
export class Png16EncodeError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : 'Unknown error');
    this.name = 'Png16EncodeError';
  }
}

/**
 * The ICC profile to embed when an exported file ends up untagged.
 * Wide-gamut sessions need the Display P3 profile (built in Rust) so readers
 * interpret the P3 pixel values correctly; sRGB sessions return undefined and
 * keep the historical sRGB tagging.
 */
function exportIccProfile(): EmbeddedIccProfile | undefined {
  if (!isWideGamut()) return undefined;
  return { name: 'Display P3', data: buildIccProfile(COLOR_SPACE_DISPLAY_P3) };
}

async function encoded(blob: Blob, format: ExportFormat, width: number, height: number): Promise<EncodedImage> {
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: FORMAT_MIME[format], ext: FORMAT_EXT[format], width, height };
}

/**
 * Commits what export must see: the pending stroke, and a live multi-layer
 * transform (which shows its text resampled; baking it re-renders the text
 * sharp), then pushes the store to the engine.
 */
function prepareForExport(): void {
  finalizePendingStrokeGlobal();
  commitLayerTransform();
  flushLayerSync(useEditorStore.getState());
}

/**
 * The document composite encoded as `options` says, after the export
 * pre-steps, which run before this returns. Resolves null where the menu
 * exports nothing and says nothing: no engine, an empty composite, or no 2D
 * context.
 */
export function encodeDocumentImage(options: ImageExportSettings): Promise<EncodedImage | null> {
  const engine = getEngine();
  if (!engine) return Promise.resolve(null);
  prepareForExport();
  return encodeCompositeImage(engine, options);
}

async function encodePng16(engine: Engine, width: number, height: number): Promise<EncodedImage> {
  let blob: Blob;
  try {
    const colorSpace: number = isWideGamut() ? COLOR_SPACE_DISPLAY_P3 : 0;
    const pngBytes = await exportPng16(engine, colorSpace);
    blob = new Blob([pngBytes as BlobPart], { type: 'image/png' });
  } catch (err) {
    throw new Png16EncodeError(err);
  }
  const tagged = await addPngMetadata(blob, { Software: 'Lopsy', Comment: METADATA_NOTE }, exportIccProfile());
  return encoded(tagged, 'png', width, height);
}

/** The composite as `encodeDocumentImage` encodes it, without the pre-steps: for reads that must not change the document. */
export async function encodeCompositeImage(engine: Engine, options: ImageExportSettings): Promise<EncodedImage | null> {
  const { format, quality, highQuality } = options;
  const sizeArr = getCompositeSize(engine);
  const srcWidth = sizeArr[0] ?? 0;
  const srcHeight = sizeArr[1] ?? 0;
  if (srcWidth === 0 || srcHeight === 0) return null;

  // PNG with high quality uses the 16-bit WASM path — composites at full
  // precision and encodes directly in Rust, bypassing the 8-bit canvas.toBlob.
  if (format === 'png' && highQuality) return encodePng16(engine, srcWidth, srcHeight);

  const rawPixels = await compositeForExport(engine);
  const clamped = new Uint8ClampedArray(srcWidth * srcHeight * 4);
  clamped.set(rawPixels);
  const imageData = createImageDataFromArray(clamped, srcWidth, srcHeight);
  return encodeImageData(imageData, format, quality);
}

/** Pixels in the working colour space, encoded as export encodes the composite. */
export function encodeImageData(imageData: ImageData, format: ExportFormat, quality: number): Promise<EncodedImage | null> {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d', contextOptions);
  if (!ctx) return Promise.resolve(null);
  ctx.putImageData(imageData, 0, 0);
  return encodeCanvas(canvas, imageData.width, imageData.height, format, quality);
}

function encodeBmpCanvas(canvas: HTMLCanvasElement, width: number, height: number): Promise<EncodedImage | null> {
  const ctx = canvas.getContext('2d', contextOptions);
  if (!ctx) return Promise.resolve(null);
  const imageData = ctx.getImageData(0, 0, width, height);
  // BMP cannot carry an ICC profile, so wide-gamut pixels are converted
  // to sRGB in Rust — readers assume sRGB and would otherwise show
  // desaturated colors.
  const pixels = isWideGamut()
    ? convertP3ToSrgb(new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength))
    : imageData.data;
  return encoded(encodeBMP({ width, height, data: pixels }), 'bmp', width, height);
}

function canvasBlob(canvas: HTMLCanvasElement, width: number, height: number, mimeType: string, qualityFraction: number): Promise<Blob> {
  // Prefer OffscreenCanvas.convertToBlob which passes colorSpace to the
  // encoder, producing a color-space-aware blob. Fall back to toBlob.
  if (typeof OffscreenCanvas !== 'undefined') {
    const offscreen = new OffscreenCanvas(width, height);
    const offCtx = offscreen.getContext('2d', contextOptions);
    if (offCtx) {
      offCtx.drawImage(canvas, 0, 0);
      return offscreen.convertToBlob({ type: mimeType, quality: qualityFraction, colorSpace: canvasColorSpace } as ImageEncodeOptions);
    }
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('browser could not encode image.'));
    }, mimeType, qualityFraction);
  });
}

async function encodeCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  format: ExportFormat,
  quality: number,
): Promise<EncodedImage | null> {
  // BMP is encoded on the JS side — no canvas.toBlob support
  if (format === 'bmp') return encodeBmpCanvas(canvas, width, height);
  const blob = await canvasBlob(canvas, width, height, FORMAT_MIME[format], qualityToFraction(quality));
  const tagged =
    format === 'png'
      ? await addPngMetadata(blob, { Software: 'Lopsy', Comment: METADATA_NOTE }, exportIccProfile())
      : format === 'jpeg'
        ? await addJpegComment(blob, METADATA_NOTE, exportIccProfile())
        : blob;
  return encoded(tagged, format, width, height);
}
