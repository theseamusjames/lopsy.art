import type { FileId, StorageAdapter } from '../storage/types';

const CAPTURE_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/**
 * The date folders under `Originals/` (spec 6.5): ['2026', '2026-11-14'].
 * Uses the capture date as the camera wrote it (its local day), else the
 * fallback's day in this device's time zone.
 */
export function originalsFolderSegments(capturedAt: string | null, fallback: Date): [string, string] {
  const m = capturedAt ? CAPTURE_DATE.exec(capturedAt) : null;
  if (m) {
    const [, y = '', mo = '', d = ''] = m;
    return [y, `${y}-${mo}-${d}`];
  }
  const date = Number.isNaN(fallback.getTime()) ? new Date(0) : fallback;
  const y = pad(date.getFullYear(), 4);
  return [y, `${y}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`];
}

/** Folder IDs by `rootId/segment/segment`; holds promises so concurrent imports create a folder once. */
export type FolderCache = Map<string, Promise<FileId>>;

/** Finds or creates `segments` under `rootId`, one level at a time, and returns the last folder's ID. */
export async function ensureFolderPath(
  adapter: StorageAdapter,
  rootId: FileId,
  segments: readonly string[],
  cache: FolderCache,
  properties?: Readonly<Record<string, string>>,
): Promise<FileId> {
  let parentId = rootId;
  let key = rootId;
  for (const segment of segments) {
    key = `${key}/${segment}`;
    let pending = cache.get(key);
    if (!pending) {
      const parent = parentId;
      pending = (async () => {
        const children = await adapter.listChildren(parent);
        const existing = children.find((c) => c.isFolder && c.name === segment);
        if (existing) return existing.id;
        return (await adapter.createFolder(parent, segment, properties)).id;
      })();
      cache.set(key, pending);
      const settled = pending;
      settled.catch(() => {
        if (cache.get(key) === settled) cache.delete(key);
      });
    }
    parentId = await pending;
  }
  return parentId;
}

/**
 * `name`, or `name (2)`, `name (3)`... before the extension, whichever is
 * not in `existingNames` (compared without case, as macOS and Windows do).
 */
export function uniqueName(existingNames: Iterable<string>, name: string): string {
  const taken = new Set<string>();
  for (const n of existingNames) taken.add(n.toLowerCase());
  if (!taken.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
