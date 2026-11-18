/**
 * Project Save — serializes the full Lopsy document state to .lopsy bytes
 * (serializeProject) and saves them as a download (saveProject).
 *
 * File format (binary):
 *   [4 bytes: manifest JSON byte length (uint32 LE)]
 *   [N bytes: manifest JSON (UTF-8)]
 *   [for each layer with pixel data: an LZ4 16-bit blob (v3, `pixelFormat:
 *    'rgba16-lz4'`) or gzip-compressed raw RGBA8 bytes]
 *   [for each layer with mask data: raw mask bytes]
 *
 * The manifest contains enough metadata to reconstruct the full layer stack.
 * Pixel data blobs are referenced by index in the manifest's pixelDataIndex.
 */

import { useEditorStore } from '../app/editor-store';
import { getEngine } from '../engine-wasm/engine-state';
import { readLayerAsImageData, readLayerBackupBlob } from '../engine-wasm/gpu-pixel-access';
import { finalizePendingStrokeGlobal } from '../app/interactions/pending-stroke';
import { commitLayerTransform } from '../app/interactions/layer-transform';
import { flushLayerSync } from '../engine-wasm/engine-sync';
import { materializeAllMaskData } from '../app/mask-data-sync';
import { notifyError, describeError } from '../app/notifications-store';
import type { Layer, TextTransform } from '../types/layers';
import type { DocumentColorMode } from '../types/color-mode';
import type { StoredPath } from '../types/paths';
import { useUIStore, type Guide } from '../app/ui-store';

const LOPSY_MAGIC = new Uint8Array([0x4c, 0x4f, 0x50, 0x53, 0x59, 0x00]); // "LOPSY\0"
/**
 * v2: drop shadows and outer glows are cast from the layer plus its Stroke
 * (`STROKED_SILHOUETTE_VERSION`); v1 effects are migrated on load.
 */
/**
 * v3: layer pixels are stored at 16 bits per channel as the engine's LZ4
 * u16 blob (`pixelFormat: 'rgba16-lz4'`), and the manifest may carry a
 * Lopsy Photos source block (`photos`). v2 files still open.
 */
export const FORMAT_VERSION = 3;

/**
 * What Save Project writes: v2, 8-bit gzipped RGBA, so its files stay as
 * small as before and open in every Lopsy that reads v2. v3 (16-bit) is
 * written only for Lopsy Photos, which keeps full precision.
 */
export const DEFAULT_SAVE_VERSION = 2;

export interface SerializeOptions {
  /** A Lopsy Photos source block for the manifest. */
  readonly photos?: PhotosSourceBlock;
  /** 16 writes v3 with 16-bit layer pixels; 8 (the default) writes v2. */
  readonly precision?: 8 | 16;
}

/** The engine's u16 compressed-blob format; `uploadLayerPixelsCompressedU16` reads it back. */
export const PIXEL_FORMAT_RGBA16_LZ4 = 'rgba16-lz4';

/** Where a document belongs in a Lopsy Photos library (spec 6.12). */
export interface PhotosSourceBlock {
  readonly libraryId: string;
  readonly assetId: string;
  readonly versionId: string;
  readonly recipeHash: string;
  /** The library's document asset, once the file has been saved to Photos. */
  readonly documentId?: string;
  /** The photo's camera metadata summary, as Photos sent it. */
  readonly camera?: {
    readonly make?: string;
    readonly model?: string;
    readonly lens?: string;
    readonly iso?: number;
    readonly shutter?: string;
    readonly aperture?: number;
    readonly focalLength?: number;
    readonly capturedAt?: string;
  };
}

export interface LopsyManifest {
  readonly version: number;
  readonly documentName: string;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly backgroundColor: { r: number; g: number; b: number; a: number };
  readonly layers: readonly SerializedLayer[];
  readonly layerOrder: readonly string[];
  readonly rootGroupId: string | null;
  readonly activeLayerId: string | null;
  /** Document color mode. Absent in files saved before color modes existed → treated as 'rgb'. */
  readonly colorMode?: DocumentColorMode;
  /** Palette for indexed-mode documents. Absent in every other mode. */
  readonly indexedPalette?: readonly { r: number; g: number; b: number; a: number }[];
  /** Pixels per inch from the New Document modal. Absent in older files → 72. */
  readonly dpi?: number;
  /** Stored vector paths (Paths panel). Absent in files saved before these were serialized. */
  readonly paths?: readonly StoredPath[];
  /** Canvas guides. Absent in files saved before these were serialized. */
  readonly guides?: readonly Guide[];
  /** Set when the document came from or was saved to Lopsy Photos. Absent before v3. */
  readonly photos?: PhotosSourceBlock;
}

// Serialized layer — all layer fields except pixel data (which is stored as blobs)
export interface SerializedLayer {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly opacity: number;
  readonly blendMode: string;
  readonly x: number;
  readonly y: number;
  readonly clipToBelow: boolean;
  readonly effects: unknown;
  // raster
  readonly width?: number;
  readonly height?: number;
  // text
  readonly text?: string;
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly fontWeight?: number;
  readonly fontStyle?: string;
  readonly color?: unknown;
  readonly colorSpans?: unknown;
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
  readonly paragraphSpacing?: number;
  readonly textAlign?: string;
  readonly textWidth?: number | null;
  readonly underline?: boolean;
  readonly strikethrough?: boolean;
  readonly vertical?: boolean;
  readonly pathId?: string;
  readonly prePathX?: number;
  readonly prePathY?: number;
  readonly pathAnchorX?: number;
  readonly pathAnchorY?: number;
  readonly textTransform?: TextTransform;
  // shape
  readonly shapeType?: string;
  readonly fill?: unknown;
  readonly stroke?: unknown;
  readonly strokeWidth?: number;
  readonly points?: unknown[];
  readonly cornerRadius?: number;
  // group
  readonly children?: readonly string[];
  readonly collapsed?: boolean;
  readonly adjustments?: unknown;
  readonly adjustmentsEnabled?: boolean;
  // mask
  readonly maskEnabled?: boolean;
  readonly maskWidth?: number;
  readonly maskHeight?: number;
  /** Index into the pixel data blobs list (-1 = no pixel data) */
  readonly pixelDataIndex: number;
  /** Index into the mask data blobs list (-1 = no mask data) */
  readonly maskDataIndex: number;
  /** True dimensions of the pixel blob (the rendered bitmap), independent of
   * the layer's logical width/height. Absent in pre-fix v1 files. */
  readonly pixelWidth?: number;
  readonly pixelHeight?: number;
  /** `'rgba16-lz4'` for a 16-bit blob (v3). Absent: gzip-compressed RGBA8. */
  readonly pixelFormat?: typeof PIXEL_FORMAT_RGBA16_LZ4;
}

export function serializeLayer(
  layer: Layer,
  pixelDataIndex: number,
  maskDataIndex: number,
  pixelWidth: number,
  pixelHeight: number,
): SerializedLayer {
  const base = {
    id: layer.id,
    name: layer.name,
    type: layer.type,
    visible: layer.visible,
    locked: layer.locked,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    x: layer.x,
    y: layer.y,
    clipToBelow: layer.clipToBelow,
    effects: layer.effects,
    pixelDataIndex,
    maskDataIndex,
    pixelWidth,
    pixelHeight,
    maskEnabled: layer.mask?.enabled,
    maskWidth: layer.mask?.width,
    maskHeight: layer.mask?.height,
  };

  if (layer.type === 'raster') {
    return { ...base, width: layer.width, height: layer.height };
  }
  if (layer.type === 'text') {
    return {
      ...base,
      text: layer.text,
      fontFamily: layer.fontFamily,
      fontSize: layer.fontSize,
      fontWeight: layer.fontWeight,
      fontStyle: layer.fontStyle,
      color: layer.color,
      ...(layer.colorSpans?.length ? { colorSpans: layer.colorSpans } : {}),
      lineHeight: layer.lineHeight,
      letterSpacing: layer.letterSpacing,
      paragraphSpacing: layer.paragraphSpacing,
      textAlign: layer.textAlign,
      textWidth: layer.width,
      underline: layer.underline,
      strikethrough: layer.strikethrough,
      vertical: layer.vertical ?? false,
      pathId: layer.pathId,
      prePathX: layer.prePathX,
      prePathY: layer.prePathY,
      pathAnchorX: layer.pathAnchorX,
      pathAnchorY: layer.pathAnchorY,
      textTransform: layer.transform,
    };
  }
  if (layer.type === 'shape') {
    return {
      ...base,
      shapeType: layer.shapeType,
      fill: layer.fill,
      stroke: layer.stroke,
      strokeWidth: layer.strokeWidth,
      points: [...layer.points],
      width: layer.width,
      height: layer.height,
      cornerRadius: layer.cornerRadius,
    };
  }
  if (layer.type === 'group') {
    return {
      ...base,
      children: layer.children,
      collapsed: layer.collapsed,
      adjustments: layer.adjustments,
      adjustmentsEnabled: layer.adjustmentsEnabled,
    };
  }
  return base;
}

async function compressBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  // Copy to a plain ArrayBuffer to satisfy the WritableStreamDefaultWriter
  // overloads which require ArrayBufferView<ArrayBuffer> (not SharedArrayBuffer).
  const copyBuf = new Uint8Array(bytes.length);
  copyBuf.set(bytes);
  writer.write(copyBuf);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Serialize the current document to `.lopsy` bytes. Pending strokes and
 * transforms are committed first so the file holds what the user sees.
 * Throws when the engine is not ready or a readback fails.
 */
export async function serializeProject(options: SerializeOptions = {}): Promise<ArrayBuffer> {
  const isPrecise = options.precision === 16;
  const version = isPrecise ? FORMAT_VERSION : DEFAULT_SAVE_VERSION;
  if (!getEngine()) throw new Error('engine not ready.');

  finalizePendingStrokeGlobal();
  // A live multi-layer transform shows its text resampled; baking it
  // re-renders that text sharp, which is what the file must hold (#1527).
  commitLayerTransform();
  // Mask readbacks are lazy (#756, #780); read back any mask whose JS
  // copy lags the GPU so the file contains the current mask.
  await materializeAllMaskData();
  const state = useEditorStore.getState();
  flushLayerSync(state);

  const { document: doc } = state;

  const pixelBlobs: Uint8Array[] = [];
  const maskBlobs: Uint8Array[] = [];

  const serializedLayers: SerializedLayer[] = [];
  for (const layer of doc.layers) {
    let pixelDataIndex = -1;
    let maskDataIndex = -1;
    let pixelWidth = 0;
    let pixelHeight = 0;

    let pixelFormat: SerializedLayer['pixelFormat'];

    // Read pixel data for raster layers (not groups — they have no texture).
    // 16 bits per channel where the engine has content; a layer with none
    // reads back empty, and falls back to the 8-bit path so it keeps its size.
    const blob16 = isPrecise && layer.type !== 'group' ? await readLayerBackupBlob(layer.id) : null;
    if (blob16 && blob16.length >= 24) {
      const header = new DataView(blob16.buffer, blob16.byteOffset, 24);
      pixelDataIndex = pixelBlobs.length;
      pixelBlobs.push(blob16);
      pixelWidth = header.getInt32(16, true);
      pixelHeight = header.getInt32(20, true);
      pixelFormat = PIXEL_FORMAT_RGBA16_LZ4;
    } else if (layer.type !== 'group') {
      const imageData = await readLayerAsImageData(layer.id);
      if (imageData) {
        const raw = new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength);
        const compressed = await compressBytes(raw);
        pixelDataIndex = pixelBlobs.length;
        pixelBlobs.push(compressed);
        // Record the blob's true dimensions. For text/shape layers these
        // differ from the layer's logical width/height (e.g. text width is
        // the box width, not the rendered bitmap), so the load path can't
        // infer them and must read them back from here.
        pixelWidth = imageData.width;
        pixelHeight = imageData.height;
      }
    }

    // Read mask data if present
    if (layer.mask && layer.mask.data.length > 0) {
      const maskBytes = new Uint8Array(layer.mask.data.buffer, layer.mask.data.byteOffset, layer.mask.data.byteLength);
      maskDataIndex = maskBlobs.length;
      maskBlobs.push(maskBytes);
    }

    const serialized = serializeLayer(layer, pixelDataIndex, maskDataIndex, pixelWidth, pixelHeight);
    serializedLayers.push(pixelFormat ? { ...serialized, pixelFormat } : serialized);
  }

  const manifest: LopsyManifest = {
    version,
    documentName: doc.name,
    documentWidth: doc.width,
    documentHeight: doc.height,
    backgroundColor: doc.backgroundColor,
    layers: serializedLayers,
    layerOrder: doc.layerOrder,
    rootGroupId: doc.rootGroupId ?? null,
    activeLayerId: doc.activeLayerId ?? null,
    colorMode: doc.colorMode,
    indexedPalette: doc.indexedPalette,
    dpi: doc.dpi,
    paths: state.paths,
    guides: useUIStore.getState().guides,
    ...(options.photos ? { photos: options.photos } : {}),
  };

  const manifestJson = JSON.stringify(manifest);
  const manifestBytes = new TextEncoder().encode(manifestJson);

  // Build the pixel-blob size table: [count: u32 LE][size0: u32 LE][size1: u32 LE]...
  const allBlobs = [...pixelBlobs, ...maskBlobs];
  const blobSizeTableLen = (1 + allBlobs.length) * 4;
  const blobSizeTable = new Uint8Array(blobSizeTableLen);
  const blobSizeView = new DataView(blobSizeTable.buffer);
  blobSizeView.setUint32(0, allBlobs.length, true);
  let offset = 4;
  for (const blob of allBlobs) {
    blobSizeView.setUint32(offset, blob.length, true);
    offset += 4;
  }

  // Header: magic(6) + version(2) + manifest length(4)
  const header = new Uint8Array(12);
  header.set(LOPSY_MAGIC, 0);
  const headerView = new DataView(header.buffer);
  headerView.setUint16(6, version, true);
  headerView.setUint32(8, manifestBytes.length, true);

  const parts = [header, manifestBytes, blobSizeTable, ...allBlobs];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out.buffer;
}

/**
 * Save the current project to a .lopsy file and trigger a download.
 */
export async function saveProject(): Promise<void> {
  if (!getEngine()) {
    notifyError('Cannot save: engine not ready.');
    return;
  }

  try {
    const bytes = await serializeProject();
    const doc = useEditorStore.getState().document;
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.name || 'lopsy'}.lopsy`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    useEditorStore.getState().markClean();
  } catch (err) {
    notifyError(`Failed to save project: ${describeError(err)}`);
  }
}
