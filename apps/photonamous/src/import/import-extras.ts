/**
 * Import sheet extras (spec 5.3): photos the library seems to hold
 * already, and the album and keywords an import adds its photos to. Pure
 * apart from `applyImportExtras`, which goes through the session.
 */

import type { AlbumId, Asset, AssetId, LibrarySession } from '@lopsy/photos-core/library/types';
import type { ImportProgress } from '@lopsy/photos-core/import/types';
import { isPhotoFile } from './import-summary';

interface NamedFile {
  readonly name: string;
  readonly size: number;
}

/**
 * Picked photos that look like ones already in the library: same file
 * name (any case) and size. The import itself compares checksums and
 * skips the real duplicates; this is the warning before it starts.
 */
export function likelyDuplicates(files: readonly NamedFile[], assets: Iterable<Asset>): NamedFile[] {
  const known = new Set<string>();
  for (const a of assets) if (!a.deleted) known.add(`${a.fileName.toLowerCase()}|${a.byteSize}`);
  return files.filter((f) => isPhotoFile(f.name) && known.has(`${f.name.toLowerCase()}|${f.size}`));
}

/** Keywords as typed: comma-separated, trimmed, each once. */
export function parseKeywords(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(',')) {
    const k = part.trim();
    if (k !== '' && !out.some((o) => o.toLowerCase() === k.toLowerCase())) out.push(k);
  }
  return out;
}

export interface ImportExtras {
  readonly albumId: AlbumId | null;
  readonly keywords: readonly string[];
}

/** The photos an import brought in (or found already there), for its album and keywords. */
export function importedAssetIds(progress: ImportProgress): AssetId[] {
  const ids = new Set<AssetId>();
  for (const item of progress.items) {
    if ((item.state === 'done' || item.state === 'duplicate') && item.assetId !== null) ids.add(item.assetId);
  }
  return [...ids];
}

export function applyImportExtras(session: LibrarySession, progress: ImportProgress, extras: ImportExtras): number {
  const ids = importedAssetIds(progress);
  if (ids.length === 0) return 0;
  session.libraryStep('Album and keywords for the import', () => {
    if (extras.albumId !== null) for (const id of ids) session.setAlbumMember(extras.albumId, id, true);
    for (const k of extras.keywords) session.setKeyword(ids, k, true);
  });
  return ids.length;
}
