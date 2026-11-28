/**
 * What File > Open... does with the file the picker returns: routes it by
 * extension to the project loader, the PSD / DNG / RAF importers, or the
 * browser's image decoder, and opens it as the document.
 */
import { useEditorStore } from '../app/editor-store';
import { seedBitmapFromBlob } from '../engine/bitmap-cache';
import { describeError } from '../app/notifications-store';
import { importPsdFile } from './psd';
import { importDngFile } from './dng';
import { importRafFile } from './raf';
import { loadProjectOrThrow } from './project-load';
import { assertFitsDocument, type TooLargeKind } from './image-too-large';
import { getDocumentSizeLimit } from '../engine-wasm/gpu-limits';
import { showIfTooLarge, toastOpenFailure } from '../app/report-open-failure';

/**
 * Mixing `image/*` with bare extensions causes Chrome on macOS to
 * restrict the picker to a single filter (often the last extension
 * listed), so users see only `.raf` files. List explicit extensions
 * for every supported type to keep all files visible.
 */
export const OPEN_FILE_ACCEPT = '.jpg,.jpeg,.png,.gif,.bmp,.webp,.psd,.dng,.raf,.lopsy';

/** Whether File > Open...'s picker offers files with this name. */
export function isOpenableFileName(name: string): boolean {
  const ext = /\.[^.]+$/.exec(name)?.[0]?.toLowerCase();
  return ext !== undefined && OPEN_FILE_ACCEPT.split(',').includes(ext);
}

export interface OpenedFile {
  /** Settles once the fonts of an opened project's text layers are loaded; resolved for other files. */
  readonly fonts: Promise<void>;
}

const NO_FONTS: OpenedFile = { fonts: Promise.resolve() };

/** The picked file could not be decoded as an image. */
export class ImageDecodeError extends Error {
  constructor(fileName: string) {
    super(`Failed to open image: ${fileName}`);
    this.name = 'ImageDecodeError';
  }
}

function placeDecodedImage(img: HTMLImageElement, file: File): void {
  // Before the canvas and its pixels: an image this device cannot hold is refused with nothing made.
  assertFitsDocument(img.naturalWidth, img.naturalHeight, getDocumentSizeLimit());
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  // Use sRGB context — internal pipeline works in sRGB
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (!ctx) return;
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

function openImageFile(file: File): Promise<OpenedFile> {
  return new Promise((resolve, reject) => {
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
        placeDecodedImage(img, file);
        resolve(NO_FONTS);
      } catch (err) {
        reject(err);
      } finally {
        revoke();
      }
    };
    img.onerror = () => {
      reject(new ImageDecodeError(file.name));
      revoke();
    };
    // Browser quirk fallback: if neither onload nor onerror fires within
    // a generous window (shouldn't happen in practice), reclaim the blob.
    setTimeout(revoke, 60_000);
    img.src = url;
  });
}

type Importer = (data: Uint8Array, name: string) => Promise<void>;

function importBytes(file: File, extension: RegExp, importer: Importer): Promise<OpenedFile> {
  return file
    .arrayBuffer()
    .then((buffer) => importer(new Uint8Array(buffer), file.name.replace(extension, '')))
    .then(() => NO_FONTS);
}

interface OpenRoute {
  /** What the message over the canvas calls the file when it is too large. */
  readonly kind: TooLargeKind;
  open(file: File): Promise<OpenedFile>;
  /** The toast File > Open... shows when `open` fails; null for a failure it does not toast. */
  failure(err: unknown, file: File): string | null;
}

const PROJECT: OpenRoute = {
  kind: 'project',
  open: (file) => loadProjectOrThrow(file),
  failure: (err) => `Failed to load project: ${describeError(err)}`,
};

const importRoute = (label: string, extension: RegExp, importer: Importer): OpenRoute => ({
  kind: 'image',
  open: (file) => importBytes(file, extension, importer),
  failure: (err) => `Failed to import ${label}: ${describeError(err)}`,
});

const PSD = importRoute('PSD', /\.psd$/i, importPsdFile);
const DNG = importRoute('DNG', /\.dng$/i, importDngFile);
const RAF = importRoute('RAF', /\.raf$/i, importRafFile);

const IMAGE: OpenRoute = {
  kind: 'image',
  open: openImageFile,
  // Only a decode error is toasted: anything else thrown while placing the image escaped the load handler uncaught.
  failure: (err) => (err instanceof ImageDecodeError ? err.message : null),
};

function routeFor(file: File): OpenRoute {
  if (/\.lopsy$/i.test(file.name)) return PROJECT;
  if (/\.psd$/i.test(file.name)) return PSD;
  if (/\.dng$/i.test(file.name)) return DNG;
  if (/\.raf$/i.test(file.name)) return RAF;
  return IMAGE;
}

/** Opens `file` as the document as File > Open... does; rejects with the reason it could not. */
export function openFileOrThrow(file: File): Promise<OpenedFile> {
  return routeFor(file).open(file);
}

/** What a file is called in the message over the canvas when it is too large: a project, or an image. */
export function openKindFor(file: File): TooLargeKind {
  return routeFor(file).kind;
}

/**
 * File > Open...'s handling of the picked file: a failure is reported once,
 * as the message over the canvas when the file is too large for this
 * device, else as a toast.
 */
export function openFile(file: File): Promise<void> {
  const route = routeFor(file);
  return route.open(file).then(
    () => undefined,
    (err: unknown) => {
      const attempt = { kind: route.kind, name: file.name };
      if (showIfTooLarge(err, attempt)) return;
      const message = route.failure(err, file);
      if (message === null) throw err;
      toastOpenFailure(err, attempt, message);
    },
  );
}
