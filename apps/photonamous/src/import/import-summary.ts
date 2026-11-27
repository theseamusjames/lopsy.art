/**
 * What the import sheet says before an import starts: how many photos,
 * their size, which files are not photos and which RAW+JPEG pairs there
 * are. Pure; works on names and sizes only.
 */

export interface FileLike {
  readonly name: string;
  readonly size: number;
}

const PHOTO_EXTENSIONS = new Set(['raf', 'dng', 'arw', 'cr2', 'nef', 'jpg', 'jpeg', 'png', 'webp']);
const RAW_EXTENSIONS = new Set(['raf', 'dng', 'arw', 'cr2', 'nef']);
const JPEG_EXTENSIONS = new Set(['jpg', 'jpeg']);

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function baseNameOf(name: string): string {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const file = name.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  return (dot < 0 ? file : file.slice(0, dot)).toLowerCase();
}

export function isPhotoFile(name: string): boolean {
  return PHOTO_EXTENSIONS.has(extensionOf(name));
}

export function isRawFile(name: string): boolean {
  return RAW_EXTENSIONS.has(extensionOf(name));
}

export interface ImportSummary {
  readonly photoCount: number;
  readonly totalBytes: number;
  /** Files that are not photos the app can read; they are left out. */
  readonly skippedNames: readonly string[];
  /** RAW+JPEG pairs (same name, same folder). */
  readonly pairCount: number;
  /** Bytes saved by keeping only the RAW of each pair. */
  readonly pairJpegBytes: number;
}

/** `relativePath` is the folder path when the file came from a folder; it keeps IMG_1 in two folders apart. */
export function summarizeImport(
  files: readonly FileLike[],
  relativePath: (index: number) => string = () => '',
): ImportSummary {
  let photoCount = 0;
  let totalBytes = 0;
  const skippedNames: string[] = [];
  const raws = new Set<string>();
  const jpegs = new Map<string, number>();
  files.forEach((f, i) => {
    if (!isPhotoFile(f.name)) {
      skippedNames.push(f.name);
      return;
    }
    photoCount++;
    totalBytes += f.size;
    const folder = relativePath(i);
    const dir = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : '';
    const key = `${dir}|${baseNameOf(f.name)}`;
    const ext = extensionOf(f.name);
    if (RAW_EXTENSIONS.has(ext)) raws.add(key);
    else if (JPEG_EXTENSIONS.has(ext)) jpegs.set(key, f.size);
  });
  let pairCount = 0;
  let pairJpegBytes = 0;
  for (const [key, size] of jpegs) {
    if (raws.has(key)) {
      pairCount++;
      pairJpegBytes += size;
    }
  }
  return { photoCount, totalBytes, skippedNames, pairCount, pairJpegBytes };
}

/** "1.4 GB", "820 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}
