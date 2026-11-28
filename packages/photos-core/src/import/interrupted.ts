/**
 * What a reload left of an import. A file that had been copied into
 * staging carries on by itself (`resumeImports`); one that had not exists
 * only on the person's disk, and the page held it only in memory. Those
 * are kept, with every other file of the same job, in an interrupted
 * record (`ImportJobRecord.interrupted`): one summary for the job, and the
 * list of files that were not imported. Choosing the same files again
 * (any picker, a folder, a drop) is matched against the record by name,
 * size and modified time (`InterruptedIndex`): what the library already
 * has is left alone without being read, what is missing is imported. The
 * record goes once every file in it is accounted for, or when dismissed.
 */

import type { AssetId, LibraryView } from '../library/types';
import type { ImportItemRecord, ImportJobRecord, ImportQueueStore } from './queue-store';

export interface MissingFile {
  readonly fileName: string;
  readonly byteSize: number;
  readonly lastModified: number;
}

export interface InterruptedImport {
  /** The files those imports had. */
  readonly total: number;
  /** Of them, in the library now. */
  readonly imported: number;
  /** Never staged on this device and not in the library: choosing them again finishes the import. */
  readonly missing: readonly MissingFile[];
}

/** The library asset an item ended up as, if it is in the library now. */
function inLibrary(view: LibraryView, item: ImportItemRecord): AssetId | null {
  for (const id of [item.assetId, item.plannedAssetId]) {
    if (id === null) continue;
    const asset = view.assets.get(id);
    if (asset && !asset.deleted) return asset.id;
  }
  return null;
}

function isMissing(view: LibraryView, item: ImportItemRecord): boolean {
  return item.needsFile === true && inLibrary(view, item) === null;
}

/** The library's interrupted imports, as one summary; records with nothing missing are cleared. Null when there are none. */
export async function readInterruptedImports(store: ImportQueueStore, libraryId: string, view: LibraryView): Promise<InterruptedImport | null> {
  const records = (await store.listJobs(libraryId)).filter((r) => r.interrupted === true);
  let total = 0;
  let imported = 0;
  const missing: MissingFile[] = [];
  for (const record of records.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const left = record.items.filter((item) => isMissing(view, item));
    if (left.length === 0) {
      await store.deleteJob(record.id);
      continue;
    }
    total += record.items.length;
    imported += record.items.filter((item) => inLibrary(view, item) !== null).length;
    for (const item of left) missing.push({ fileName: item.fileName, byteSize: item.byteSize, lastModified: item.lastModified });
  }
  return missing.length === 0 ? null : { total, imported, missing };
}

/** Forgets the library's interrupted imports: the person has dismissed them. */
export async function dismissInterruptedImports(store: ImportQueueStore, libraryId: string): Promise<void> {
  for (const record of await store.listJobs(libraryId)) if (record.interrupted === true) await store.deleteJob(record.id);
}

/** The missing files' names, one per line, to copy or save. */
export function missingFilesText(missing: readonly MissingFile[]): string {
  return `${missing.map((f) => f.fileName).join('\n')}\n`;
}

/** One file of an interrupted record, as a file chosen again matches it. */
export interface InterruptedMatch {
  readonly recordId: string;
  readonly item: ImportItemRecord;
  /** The asset the library already has for it; null when it is missing. */
  readonly existing: AssetId | null;
  /** Its RAW partner in the library, for the JPEG half of a pair whose RAW was imported. */
  readonly pairedWith: AssetId | null;
}

function fileKey(name: string, size: number, lastModified: number): string {
  return `${size}:${lastModified}:${name}`;
}

/**
 * Finds a chosen file among interrupted records, by its name, size and
 * modified time. Each record item is matched once.
 */
export class InterruptedIndex {
  private readonly byKey = new Map<string, { recordId: string; item: ImportItemRecord; planned: Map<AssetId, ImportItemRecord> }[]>();

  constructor(records: readonly ImportJobRecord[]) {
    for (const record of records) {
      if (record.interrupted !== true) continue;
      const planned = new Map(record.items.map((item) => [item.plannedAssetId, item]));
      for (const item of record.items) {
        const key = fileKey(item.fileName, item.byteSize, item.lastModified);
        const list = this.byKey.get(key) ?? [];
        list.push({ recordId: record.id, item, planned });
        this.byKey.set(key, list);
      }
    }
  }

  get size(): number {
    return this.byKey.size;
  }

  take(file: { readonly name: string; readonly size: number; readonly lastModified: number }, view: LibraryView): InterruptedMatch | null {
    const list = this.byKey.get(fileKey(file.name, file.size, file.lastModified));
    const found = list?.shift();
    if (!found) return null;
    const { recordId, item, planned } = found;
    const partner = item.pairedWith === null ? undefined : planned.get(item.pairedWith);
    return {
      recordId,
      item,
      existing: inLibrary(view, item),
      pairedWith: partner ? inLibrary(view, partner) : null,
    };
  }
}
