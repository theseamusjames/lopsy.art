import { useUIStore } from '../../ui-store';
import { useEditorStore } from '../../editor-store';
import { contextOptions, createImageDataFromArray } from '../../../engine/color-space';
import { getEngine } from '../../../engine-wasm/engine-state';
import { compositeForExport, getCompositeSize } from '../../../engine-wasm/wasm-bridge';
import type { MenuDef } from './types';
import { commandItem } from './command-item';
import { registerDialogOpener, unregisterDialogOpener } from '../dialog-openers';
import { exportPsdFile, importPsdFile } from '../../../io/psd';
import { describeError, notifyError } from '../../notifications-store';
import { finalizePendingStrokeGlobal } from '../../interactions/pending-stroke';
import { commitLayerTransform } from '../../interactions/layer-transform';
import { flushLayerSync } from '../../../engine-wasm/engine-sync';
import { encodeDocumentImageBlob, Png16EncodeError, type EncodedImageBlob } from '../../../io/export-image';
import { openFile, OPEN_FILE_ACCEPT } from '../../../io/open-file';

// Re-export so existing callers (App.tsx, e2e tests) keep working.
export { importPsdFile, exportPsdFile };

import { saveProject } from '../../../io/project-save';
import { loadProject } from '../../../io/project-load';
import { addDocumentToPhotos } from '../../../io/photos-handoff/photos-handoff';
import { isPhotosEnabled } from '../../../io/photos-handoff/photos-url';

// Re-export ExportFormat and ExportOptions from export-logic so the rest of
// the codebase imports from one place.
export type { ExportFormat, ExportOptions } from '../export-logic';
import type { ExportFormat, ExportOptions } from '../export-logic';
import { qualityToFraction, FORMAT_MIME } from '../export-logic';

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
  input.accept = OPEN_FILE_ACCEPT;
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    void openFile(file);
  };
  input.click();
}

/** File > New: the unsaved-changes confirm, then the New Document modal. */
export function startNewDocument(): void {
  if (confirmIfDirty()) useUIStore.getState().setShowNewDocumentModal(true);
}

/** File > Save Project: the download, with a toast if it fails. */
export function saveProjectFromMenu(): void {
  saveProject().catch((err) => notifyError(`Save failed: ${describeError(err)}`));
}

/** MenuBar registers its Export dialog opener once on mount, so ui.dialog.export can open it. */
export function registerOpenExportDialog(fn: () => void): void {
  registerDialogOpener('export', fn);
}
export function unregisterOpenExportDialog(): void {
  unregisterDialogOpener('export');
}

/** Quick-export using the WASM engine's GPU compositor (no dialog). */
export function exportCanvas(format: ExportFormat): void {
  const pending = encodeDocumentImageBlob({ format, quality: 92, highQuality: false });
  const docName = useEditorStore.getState().document.name;
  downloadExport(pending, docName || 'lopsy');
}

/**
 * Full export triggered from the Export dialog. Accepts quality (1–100) and
 * scale multiplier; PNG bypasses the quality parameter.
 */
export function exportCanvasWithOptions(options: ExportOptions): void {
  downloadExport(encodeDocumentImageBlob(options), options.filename);
}

/**
 * A cached export preview: the composite has been rendered and downscaled
 * once, and every format/quality change re-runs only the small toBlob on
 * the cached thumbnail. Avoids re-compositing a 4K document (64 MB, ~500 ms)
 * every time the user clicks a format button or the Quality slider pauses
 * (#762).
 */
export interface ExportPreviewSession {
  /** Encode the cached thumbnail at the given format/quality and return a blob URL. */
  encode: (options: ExportOptions) => Promise<string | null>;
}

/**
 * Composite the document once, downscale to a preview thumbnail, and return
 * a session whose `encode()` re-runs only the small canvas.toBlob call on
 * every format/quality change (#762). Returns `null` if the engine or the
 * canvas 2D context is unavailable.
 */
export async function createExportPreviewSession(): Promise<ExportPreviewSession | null> {
  const engine = getEngine();
  if (!engine) return null;
  finalizePendingStrokeGlobal();
  // A live multi-layer transform shows its text resampled; baking it re-renders the text sharp.
  commitLayerTransform();
  flushLayerSync(useEditorStore.getState());
  const sizeArr = getCompositeSize(engine);
  const width = sizeArr[0] ?? 0;
  const height = sizeArr[1] ?? 0;
  if (width === 0 || height === 0) return null;

  const rawPixels = await compositeForExport(engine);
  const clamped = new Uint8ClampedArray(width * height * 4);
  clamped.set(rawPixels);
  const imageData = createImageDataFromArray(clamped, width, height);

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

  return {
    encode: (options: ExportOptions): Promise<string | null> => {
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
    },
  };
}

/**
 * Convenience: composite + encode in one call. Retained for callers that
 * want a one-shot preview (Storybook, ad-hoc uses). The Export dialog now
 * caches the composite via `createExportPreviewSession` and only re-encodes
 * per option change — see #762.
 */
export async function buildExportPreview(options: ExportOptions): Promise<string | null> {
  const session = await createExportPreviewSession();
  if (!session) return null;
  return session.encode(options);
}

function reportExportError(err: unknown): void {
  const label = err instanceof Png16EncodeError ? 'Failed to export PNG' : 'Failed to export';
  notifyError(`${label}: ${describeError(err)}`);
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

function downloadExport(pending: Promise<EncodedImageBlob | null>, filename: string): void {
  pending
    .then((image) => {
      if (image) downloadBlob(image.blob, image.ext, filename);
    })
    .catch(reportExportError);
}

export function createFileMenu(): MenuDef {
  return {
    label: 'File',
    items: [
      commandItem('New', 'ui.file.new', undefined, '⌘N'),
      commandItem('Open...', 'ui.file.open', undefined, '⌘O'),
      { separator: true, label: '' },
      commandItem('Save Project', 'ui.file.save-project', undefined, '⌘S'),
      commandItem('Open Project...', 'ui.file.open-project'),
      // Only builds that name Photonamous' URL (VITE_PHOTONAMOUS_URL) offer the handoff.
      ...(isPhotosEnabled() ? [{ label: 'Add to Photonamous', action: () => { void addDocumentToPhotos(); } }] : []),
      { separator: true, label: '' },
      commandItem('Export…', 'ui.dialog.export', undefined, '⌥⇧⌘E'),
      commandItem('Quick Export PNG', 'ui.file.quick-export-png', undefined, '⇧⌘E'),
      commandItem('Export PSD', 'ui.file.export-psd'),
    ],
  };
}
