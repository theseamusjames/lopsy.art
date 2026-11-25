/**
 * RAW+JPEG pairs (spec 6.8): the same base name, ignoring case, and
 * capture times within 2 s of each other (or both unknown).
 */

import type { ImageFormat } from '../library/types';

export const RAW_FORMATS: ReadonlySet<ImageFormat> = new Set(['raf', 'dng']);

const RAW_EXTENSIONS = new Set(['raf', 'dng']);
const JPEG_EXTENSIONS = new Set(['jpg', 'jpeg']);
const PAIR_WINDOW_MS = 2000;

function splitName(name: string): { base: string; ext: string } {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const file = name.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  if (dot <= 0) return { base: file.toLowerCase(), ext: '' };
  return { base: file.slice(0, dot).toLowerCase(), ext: file.slice(dot + 1).toLowerCase() };
}

/** The lower-case file name without its extension. */
export function pairBaseName(name: string): string {
  return splitName(name).base;
}

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/;

function localMs(capturedAt: string): number | null {
  const m = LOCAL_TIME.exec(capturedAt);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, s ?? 0);
}

/**
 * Whether two capture times are within 2 s. Compared as the camera's local
 * time: both halves of a pair come from one camera clock.
 */
export function captureTimesMatch(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const ta = localMs(a);
  const tb = localMs(b);
  return ta !== null && tb !== null && Math.abs(ta - tb) <= PAIR_WINDOW_MS;
}

export interface PairCandidate {
  readonly id: string;
  readonly name: string;
}

/**
 * Pairs by name alone, before any file is read: for each JPEG (by
 * extension), the first unclaimed RAW with the same base name. Returns
 * JPEG id to RAW id.
 */
export function pairCandidatesByName(files: readonly PairCandidate[]): Map<string, string> {
  const raws = new Map<string, string[]>();
  for (const f of files) {
    const { base, ext } = splitName(f.name);
    if (!RAW_EXTENSIONS.has(ext)) continue;
    const list = raws.get(base) ?? [];
    list.push(f.id);
    raws.set(base, list);
  }
  const out = new Map<string, string>();
  for (const f of files) {
    const { base, ext } = splitName(f.name);
    if (!JPEG_EXTENSIONS.has(ext)) continue;
    const raw = raws.get(base)?.shift();
    if (raw !== undefined) out.set(f.id, raw);
  }
  return out;
}

export interface PairableFile {
  readonly id: string;
  readonly name: string;
  readonly format: ImageFormat;
  readonly capturedAt: string | null;
}

/** Whether a read RAW and JPEG form a pair. */
export function isRawJpegPair(raw: PairableFile, jpeg: PairableFile): boolean {
  return (
    RAW_FORMATS.has(raw.format) &&
    jpeg.format === 'jpeg' &&
    pairBaseName(raw.name) === pairBaseName(jpeg.name) &&
    captureTimesMatch(raw.capturedAt, jpeg.capturedAt)
  );
}

/** Every RAW+JPEG pair among files already read (for the pre-import sheet). */
export function findRawJpegPairs(files: readonly PairableFile[]): { raw: PairableFile; jpeg: PairableFile }[] {
  const out: { raw: PairableFile; jpeg: PairableFile }[] = [];
  const used = new Set<string>();
  for (const jpeg of files) {
    if (jpeg.format !== 'jpeg') continue;
    const raw = files.find((r) => !used.has(r.id) && isRawJpegPair(r, jpeg));
    if (raw) {
      used.add(raw.id);
      out.push({ raw, jpeg });
    }
  }
  return out;
}
