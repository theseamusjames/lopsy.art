/**
 * Rebuild library from storage (spec 6.6, Repair), the database half:
 * lists every original by its tags, checks checksums against what storage
 * reports, finds originals the database has no entry for, and marks
 * entries whose original is missing, trashed or changed. Re-reading an
 * orphan's metadata is import's job, so orphans are returned for the app
 * to re-import rather than adopted here.
 */

import type { FileId, StoredFile } from '../storage/types';
import type { PhotosLibrarySession } from './session';
import type { AssetId, OriginalStatus } from './types';

export interface RepairReport {
  /** Originals found in storage by their tags. */
  readonly originalsFound: number;
  /** Assets whose original was checked. */
  readonly assetsChecked: number;
  /** Tagged originals of this library with no asset: re-import these. */
  readonly orphans: readonly FileId[];
  readonly missing: readonly AssetId[];
  readonly trashed: readonly AssetId[];
  /** The checksum in storage differs from the one recorded at import. */
  readonly changed: readonly AssetId[];
  /** Assets marked by an earlier repair whose original is fine again. */
  readonly restored: readonly AssetId[];
}

function statusOf(file: StoredFile | null, sha256: string): OriginalStatus {
  if (!file) return 'missing';
  if (file.trashed) return 'trashed';
  const stored = file.sha256 ?? file.properties['lp.sha'] ?? null;
  // Storage that reports no checksum cannot contradict the one from import.
  if (stored !== null && sha256 !== '' && stored.toLowerCase() !== sha256.toLowerCase()) return 'changed';
  return 'ok';
}

export async function repairLibrary(session: PhotosLibrarySession): Promise<RepairReport> {
  const { adapter, libraryId } = session;
  const tagged = (await adapter.findByProperty('lp.role', 'original')).filter(
    (f) => !f.isFolder && (f.properties['lp.lib'] === undefined || f.properties['lp.lib'] === libraryId),
  );
  const byId = new Map(tagged.map((f) => [f.id, f]));

  const view = session.getView();
  const known = new Set<FileId>();
  const found: Record<OriginalStatus, AssetId[]> = { ok: [], missing: [], trashed: [], changed: [] };
  const restored: AssetId[] = [];
  let assetsChecked = 0;
  for (const asset of view.assets.values()) {
    if (asset.kind !== 'original') continue;
    known.add(asset.fileId);
    if (asset.deleted) continue;
    assetsChecked += 1;
    // Trashed files are not listed by tag, so anything not found is looked up by ID.
    const file = byId.get(asset.fileId) ?? (await adapter.getFile(asset.fileId));
    const status = statusOf(file, asset.sha256);
    const before = asset.originalStatus ?? 'ok';
    if (status === before) {
      if (status !== 'ok') found[status].push(asset.id);
      continue;
    }
    found[status].push(asset.id);
    if (status === 'ok') restored.push(asset.id);
  }

  for (const status of ['missing', 'trashed', 'changed'] as const) {
    const toMark = found[status].filter((id) => (view.assets.get(id)?.originalStatus ?? 'ok') !== status);
    if (toMark.length > 0) session.setOriginalStatus(toMark, status);
  }
  if (restored.length > 0) session.setOriginalStatus(restored, 'ok');

  return {
    originalsFound: tagged.length,
    assetsChecked,
    orphans: tagged.filter((f) => !known.has(f.id)).map((f) => f.id),
    missing: found.missing,
    trashed: found.trashed,
    changed: found.changed,
    restored,
  };
}
