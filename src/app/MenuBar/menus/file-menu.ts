import { useUIStore } from '../../ui-store';
import { useEditorStore } from '../../editor-store';
import { addPngMetadata, addJpegComment } from '../../../utils/image-metadata';
import { encodeBMP } from '../../../utils/bmp-encoder';
import { contextOptions, canvasColorSpace, isWideGamut, createImageDataFromArray } from '../../../engine/color-space';
import { seedBitmapFromBlob } from '../../../engine/bitmap-cache';
import { getEngine } from '../../../engine-wasm/engine-state';
import {
  compositeForExport,
  exportPng16,
  getCompositeSize,
} from '../../../engine-wasm/wasm-bridge';
import type { MenuDef } from './types';
import { exportPsdFile, importPsdFile } from '../../../io/psd';
import { describeError, notifyError } from '../../notifications-store';
import { finalizePendingStrokeGlobal } from '../../interactions/pending-stroke';
import { flushLayerSync } from '../../../engine-wasm/engine-sync';

// Re-export so existing callers (App.tsx, e2e tests) keep working.
export { importPsdFile, exportPsdFile };

import { importDngFile } from '../../../io/dng';
import { saveProject } from '../../../io/project-save';
import { loadProject } from '../../../io/project-load';

// Re-export ExportFormat and ExportOptions from export-logic so the rest of
// the codebase imports from one place.
export type { ExportFormat, ExportOptions } from '../export-logic';
import type { ExportFormat, ExportOptions } from '../export-logic';
import { qualityToFraction, FORMAT_EXT, FORMAT_MIME } from '../export-logic';

const METADATA_NOTE = 'Made with Lopsy — http://lopsy.art';

function confirmIfDirty(): boolean {
  if (!useEditorStore.getState().isDirty) return true;
  return window.confirm('You have unsaved changes. Are you sure you want to continue?');
}

export function openProjectFromDisk(): void {
  if (!confirmIfDirty()) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.lopsy';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    loadProject(file).catch((err) => notifyError(`Failed to open project: ${describeError(err)}`));
  };
  input.click();
}

export function openFileFromDisk(): void {
  if (!confirmIfDirty()) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,.psd,.dng,.lopsy';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;

    // Route .lopsy project files to the project loader
    if (/\.lopsy$/i.test(file.name)) {
      loadProject(file).catch((err) => notifyError(`Failed to open project: ${describeError(err)}`));
      return;
    }

    // Route PSD files to the PSD importer
    if (/\.psd$/i.test(file.name)) {
      file
        .arrayBuffer()
        .then((buffer) => importPsdFile(new Uint8Array(buffer), file.name.replace(/\.psd$/i, '')))
        .catch((err) => notifyError(`Failed to import PSD: ${describeError(err)}`));
      return;
    }

    // Route DNG (raw) files to the WASM DNG decoder
    if (/\.dng$/i.test(file.name)) {
      file
        .arrayBuffer()
        .then((buffer) => importDngFile(new Uint8Array(buffer), file.name.replace(/\.dng$/i, '')))
        .catch((err) => notifyError(`Failed to import DNG: ${describeError(err)}`));
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      // Use sRGB context — internal pipeline works in sRGB
      const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const name = file.name.replace(/\.[^.]+$/, '');
        useEditorStore.getState().openImageAsDocument(imageData, name);
        // Seed the bitmap cache from the original file so the rendering
        // path uses the browser's native decoded bitmap rather than one
        // rebuilt from the canvas-round-tripped ImageData.
        const layerId = useEditorStore.getState().document.activeLayerId;
        if (layerId) seedBitmapFromBlob(layerId, file);
        useEditorStore.getState().fitToView();
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };
  input.click();
}

/** Callback registry so MenuBar.tsx can open the Export dialog in response to
 *  a File-menu action without creating a circular import. MenuBar registers
 *  its setter once on mount. */
let openExportDialogFn: (() => void) | null = null;
export function registerOpenExportDialog(fn: () => void): void {
  openExportDialogFn = fn;
}
export function unregisterOpenExportDialog(): void {
  openExportDialogFn = null;
}

/** Quick-export using the WASM engine's GPU compositor (no dialog). */
export function exportCanvas(format: ExportFormat): void {
  const engine = getEngine();
  if (!engine) return;
  finalizePendingStrokeGlobal();
  flushLayerSync(useEditorStore.getState());
  const docName = useEditorStore.getState().document.name;
  exportViaEngine(engine, { format, quality: 92, highQuality: false, filename: docName || 'lopsy' });
}

/**
 * Full export triggered from the Export dialog. Accepts quality (1–100) and
 * scale multiplier; PNG bypasses the quality parameter.
 */
export function exportCanvasWithOptions(options: ExportOptions): void {
  const engine = getEngine();
  if (!engine) return;
  finalizePendingStrokeGlobal();
  flushLayerSync(useEditorStore.getState());
  exportViaEngine(engine, options);
}

/**
 * Build a preview thumbnail blob URL for the export dialog. Runs the
 * compositor, applies the chosen format/quality, and returns an object URL.
 * Caller must revoke the URL when done.
 */
export async function buildExportPreview(options: ExportOptions): Promise<string | null> {
  const engine = getEngine();
  if (!engine) return null;
  finalizePendingStrokeGlobal();
  flushLayerSync(useEditorStore.getState());
  const sizeArr = getCompositeSize(engine);
  const width = sizeArr[0] ?? 0;
  const height = sizeArr[1] ?? 0;
  if (width === 0 || height === 0) return null;

  const rawPixels = compositeForExport(engine);
  const clamped = new Uint8ClampedArray(width * height * 4);
  clamped.set(rawPixels);
  const imageData = createImageDataFromArray(clamped, width, height);

  // Scale to a thumbnail ≤ 220px for the preview pane
  const THUMB_MAX = 220;
  const thumbScale = Math.min(1, THUMB_MAX / Math.max(width, height));
  const thumbW = Math.max(1, Math.round(width * thumbScale));
  const thumbH = Math.max(1, Math.round(height * thumbScale));

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = width;
  srcCanvas.height = height;
  const srcCtx = srcCanvas.getContext('2d', contextOptions);
  if (!srcCtx) return null;
  srcCtx.putImageData(imageData, 0, 0);

  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = thumbW;
  thumbCanvas.height = thumbH;
  const thumbCtx = thumbCanvas.getContext('2d', contextOptions);
  if (!thumbCtx) return null;
  thumbCtx.drawImage(srcCanvas, 0, 0, thumbW, thumbH);

  // Encode at the chosen format/quality so JPEG artifacts appear in preview.
  // BMP has no canvas.toBlob support, so use PNG for BMP previews.
  const mimeType = FORMAT_MIME[options.format === 'bmp' ? 'png' : options.format];
  const qualityFraction = qualityToFraction(options.quality);

  return new Promise<string | null>((resolve) => {
    thumbCanvas.toBlob(
      (blob) => resolve(blob ? URL.createObjectURL(blob) : null),
      mimeType,
      qualityFraction,
    );
  });
}

function exportViaEngine(engine: NonNullable<ReturnType<typeof getEngine>>, options: ExportOptions): void {
  const { format, quality, highQuality, filename } = options;
  const sizeArr = getCompositeSize(engine);
  const srcWidth = sizeArr[0] ?? 0;
  const srcHeight = sizeArr[1] ?? 0;
  if (srcWidth === 0 || srcHeight === 0) return;

  // PNG with high quality uses the 16-bit WASM path — composites at full
  // precision and encodes directly in Rust, bypassing the 8-bit canvas.toBlob.
  if (format === 'png' && highQuality) {
    try {
      const colorSpace: number = isWideGamut() ? 1 : 0;
      const pngBytes = exportPng16(engine, colorSpace);
      const blob = new Blob([pngBytes as BlobPart], { type: 'image/png' });
      addPngMetadata(blob, { Software: 'Lopsy', Comment: METADATA_NOTE })
        .then((b) => downloadBlob(b, 'png', filename))
        .catch((err) => notifyError(`Failed to export: ${describeError(err)}`));
    } catch (err) {
      notifyError(`Failed to export PNG: ${describeError(err)}`);
    }
    return;
  }

  const rawPixels = compositeForExport(engine);
  const clamped = new Uint8ClampedArray(srcWidth * srcHeight * 4);
  clamped.set(rawPixels);
  const imageData = createImageDataFromArray(clamped, srcWidth, srcHeight);

  const canvas = document.createElement('canvas');
  canvas.width = srcWidth;
  canvas.height = srcHeight;
  const ctx = canvas.getContext('2d', contextOptions);
  if (!ctx) return;
  ctx.putImageData(imageData, 0, 0);

  finishCanvasExport(canvas, srcWidth, srcHeight, format, quality, filename);
}

function downloadBlob(blob: Blob, ext = 'png', filename = 'lopsy'): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  useEditorStore.getState().markClean();
}

function finishCanvasExport(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  format: ExportFormat,
  quality: number,
  filename: string,
): void {
  const mimeType = FORMAT_MIME[format];
  const ext = FORMAT_EXT[format];
  const qualityFraction = qualityToFraction(quality);

  // BMP is encoded on the JS side — no canvas.toBlob support
  if (format === 'bmp') {
    const ctx = canvas.getContext('2d', contextOptions);
    if (!ctx) return;
    const imageData = ctx.getImageData(0, 0, width, height);
    downloadBlob(encodeBMP(imageData), ext, filename);
    return;
  }

  const finishExport = async (blob: Blob) => {
    const tagged =
      format === 'png'
        ? await addPngMetadata(blob, { Software: 'Lopsy', Comment: METADATA_NOTE })
        : format === 'jpeg'
          ? await addJpegComment(blob, METADATA_NOTE)
          : blob;
    downloadBlob(tagged, ext, filename);
  };

  // Prefer OffscreenCanvas.convertToBlob which passes colorSpace to the
  // encoder, producing a color-space-aware blob. Fall back to toBlob.
  if (typeof OffscreenCanvas !== 'undefined') {
    const offscreen = new OffscreenCanvas(width, height);
    const offCtx = offscreen.getContext('2d', contextOptions);
    if (offCtx) {
      offCtx.drawImage(canvas, 0, 0);
      offscreen
        .convertToBlob({ type: mimeType, quality: qualityFraction, colorSpace: canvasColorSpace } as ImageEncodeOptions)
        .then(finishExport)
        .catch((err) => notifyError(`Failed to export: ${describeError(err)}`));
      return;
    }
  }

  canvas.toBlob((blob) => {
    if (!blob) {
      notifyError('Failed to export: browser could not encode image.');
      return;
    }
    finishExport(blob).catch((err) => notifyError(`Failed to export: ${describeError(err)}`));
  }, mimeType, qualityFraction);
}

/**
 * Export each artboard region as a separate PNG file.
 * Composites the full document once, then crops to each artboard's bounds.
 */
export function exportArtboards(): void {
  const engine = getEngine();
  if (!engine) return;

  const state = useEditorStore.getState();
  const { artboards } = state;
  if (artboards.length === 0) {
    notifyError('No artboards defined. Add artboards in the Artboards panel first.');
    return;
  }

  finalizePendingStrokeGlobal();
  flushLayerSync(state);

  const sizeArr = getCompositeSize(engine);
  const docW = sizeArr[0] ?? 0;
  const docH = sizeArr[1] ?? 0;
  if (docW === 0 || docH === 0) return;

  const rawPixels = compositeForExport(engine);
  const clamped = new Uint8ClampedArray(rawPixels.length);
  clamped.set(rawPixels);

  for (const ab of artboards) {
    const x = Math.max(0, Math.round(ab.x));
    const y = Math.max(0, Math.round(ab.y));
    const w = Math.min(Math.round(ab.width), docW - x);
    const h = Math.min(Math.round(ab.height), docH - y);
    if (w <= 0 || h <= 0) continue;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', contextOptions);
    if (!ctx) continue;

    const abData = ctx.createImageData(w, h);
    for (let row = 0; row < h; row++) {
      const srcOffset = ((y + row) * docW + x) * 4;
      const dstOffset = row * w * 4;
      abData.data.set(clamped.subarray(srcOffset, srcOffset + w * 4), dstOffset);
    }
    ctx.putImageData(abData, 0, 0);

    // eslint-disable-next-line no-useless-escape
    const safeName = ab.name.replace(/[\/\\?%*:|"<>]/g, '-');
    const mimeType = 'image/png';

    const finishExport = (blob: Blob) => {
      addPngMetadata(blob, { Software: 'Lopsy', Comment: METADATA_NOTE })
        .then((tagged) => {
          const url = URL.createObjectURL(tagged);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${safeName}.png`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        })
        .catch((err) => notifyError(`Failed to export artboard "${ab.name}": ${describeError(err)}`));
    };

    if (typeof OffscreenCanvas !== 'undefined') {
      const offscreen = new OffscreenCanvas(w, h);
      const offCtx = offscreen.getContext('2d', contextOptions);
      if (offCtx) {
        offCtx.drawImage(canvas, 0, 0);
        offscreen
          .convertToBlob({ type: mimeType } as ImageEncodeOptions)
          .then(finishExport)
          .catch((err) => notifyError(`Failed to export artboard "${ab.name}": ${describeError(err)}`));
        continue;
      }
    }

    canvas.toBlob((blob) => {
      if (!blob) {
        notifyError(`Failed to export artboard "${ab.name}": browser could not encode image.`);
        return;
      }
      finishExport(blob);
    }, mimeType);
  }
}


export const fileMenu: MenuDef = {
  label: 'File',
  items: [
    { label: 'New', shortcut: '⌘N', action: () => { if (confirmIfDirty()) useUIStore.getState().setShowNewDocumentModal(true); } },
    { label: 'Open...', shortcut: '⌘O', action: () => openFileFromDisk() },
    { separator: true, label: '' },
    { label: 'Save Project', shortcut: '⌘S', action: () => { saveProject().catch((err) => notifyError(`Save failed: ${describeError(err)}`)); } },
    { label: 'Open Project...', action: () => openProjectFromDisk() },
    { separator: true, label: '' },
    { label: 'Export…', shortcut: '⌥⇧⌘E', action: () => openExportDialogFn?.() },
    { label: 'Quick Export PNG', shortcut: '⇧⌘E', action: () => exportCanvas('png') },
    { label: 'Export PSD', action: () => exportPsdFile(16) },
  ],
};
