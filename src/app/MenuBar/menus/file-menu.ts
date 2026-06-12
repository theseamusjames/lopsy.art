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
import { importRafFile } from '../../../io/raf';
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
  // Mixing `image/*` with bare extensions causes Chrome on macOS to
  // restrict the picker to a single filter (often the last extension
  // listed), so users see only `.raf` files. List explicit extensions
  // for every supported type to keep all files visible.
  input.accept = '.jpg,.jpeg,.png,.gif,.bmp,.webp,.psd,.dng,.raf,.lopsy';
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

    // Route RAF (Fujifilm raw) files to the WASM RAF decoder
    if (/\.raf$/i.test(file.name)) {
      file
        .arrayBuffer()
        .then((buffer) => importRafFile(new Uint8Array(buffer), file.name.replace(/\.raf$/i, '')))
        .catch((err) => notifyError(`Failed to import RAF: ${describeError(err)}`));
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(file);
    // Revoke runs in every branch (success, decode error, fallback timeout).
    // Without an explicit error path, a corrupt or unsupported image leaked
    // the blob URL for the lifetime of the tab.
    let revoked = false;
    const revoke = () => {
      if (revoked) return;
      revoked = true;
      URL.revokeObjectURL(url);
    };
    img.onload = () => {
      try {
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
      } finally {
        revoke();
      }
    };
    img.onerror = () => {
      notifyError(`Failed to open image: ${file.name}`);
      revoke();
    };
    // Browser quirk fallback: if neither onload nor onerror fires within
    // a generous window (shouldn't happen in practice), reclaim the blob.
    setTimeout(revoke, 60_000);
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
