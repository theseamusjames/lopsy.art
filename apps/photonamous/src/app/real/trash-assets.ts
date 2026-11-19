/**
 * Deleting photos: the library records the deletion first, then the files
 * go to the storage's trash. In that order a failure part-way leaves files
 * in storage that the library no longer lists (found again by Check
 * library), never photos the library lists whose originals are in a trash
 * that empties itself.
 */

import type { AssetId, LibrarySession, LibraryView } from '@lopsy/photos-core/library/types';
import { isStorageError } from '@lopsy/photos-core/storage/errors';
import type { FileId } from '@lopsy/photos-core/storage/types';
import { unguarded, writeRefusal } from '../guard-session';
import { plural } from '../../import/import-summary';

export class TrashRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrashRefusedError';
  }
}

/** The session for a delete or restore, or the reason it may not write (read-only, another tab). */
function writable(session: LibrarySession): LibrarySession {
  const raw = unguarded(session);
  const refusal = writeRefusal(raw);
  if (refusal !== null) throw new TrashRefusedError(refusal);
  return raw;
}

/** The files that go to the trash with the photos and come back with them: originals, then renders and previews. */
function filesOf(view: LibraryView, ids: ReadonlySet<AssetId>): { originals: FileId[]; previews: FileId[] } {
  const originals: FileId[] = [];
  const previews: FileId[] = [];
  for (const id of ids) {
    const asset = view.assets.get(id);
    if (!asset) continue;
    originals.push(asset.fileId);
    if (asset.renderFileId) previews.push(asset.renderFileId);
  }
  for (const version of view.versions.values()) {
    if (!ids.has(version.assetId)) continue;
    if (version.thumb) previews.push(version.thumb.fileId);
    if (version.screen) previews.push(version.screen.fileId);
  }
  return { originals, previews };
}

export async function trashAssets(session: LibrarySession, assetIds: readonly AssetId[]): Promise<void> {
  const raw = writable(session);
  const view = raw.getView();
  const ids = new Set(assetIds.filter((id) => view.assets.get(id)?.deleted === false));
  if (ids.size === 0) return;
  const { originals, previews } = filesOf(view, ids);

  // The record first: throws (read-only, lock lost) before any file moves.
  // Kept out of library history: undoing it there would bring the record
  // back with its files still in a trash that empties itself. The UI's
  // Undo (toast or ⌘Z right after) runs `untrashAssets`, which moves both.
  raw.withoutLibraryHistory(() => raw.deleteAssets([...ids]));
  // And saved on this device before anything is trashed: a tab that dies in
  // between must not bring the photos back with their originals in a trash
  // that empties itself.
  await raw.whenDurable();

  const failed: FileId[] = [];
  for (const fileId of originals) {
    try {
      await raw.adapter.trash(fileId);
    } catch (error) {
      // Already gone is fine: the photo has left the library either way.
      if (!(isStorageError(error) && error.code === 'not-found')) failed.push(fileId);
    }
  }
  await Promise.allSettled(previews.map((fileId) => raw.adapter.trash(fileId)));
  if (failed.length > 0) {
    throw new Error(
      `The photos left the library, but ${plural(failed.length, 'original')} could not be moved to the trash. Check library in Settings lists ${failed.length === 1 ? 'it' : 'them'}.`,
    );
  }
}

/**
 * Trashes originals of deleted photos that a failed delete left outside
 * the trash. Only files whose every asset is deleted are touched: a live
 * photo's original is never trashed this way. Already-gone files count as
 * done. Resolves with how many were moved; throws when some could not be.
 */
export async function trashLeftoverOriginals(session: LibrarySession, fileIds: readonly FileId[]): Promise<number> {
  const view = session.getView();
  const live = new Set<FileId>();
  const deleted = new Set<FileId>();
  for (const asset of view.assets.values()) {
    if (asset.kind !== 'original') continue;
    (asset.deleted ? deleted : live).add(asset.fileId);
  }
  let moved = 0;
  const failed: FileId[] = [];
  for (const fileId of new Set(fileIds)) {
    if (live.has(fileId) || !deleted.has(fileId)) continue;
    try {
      await session.adapter.trash(fileId);
      moved += 1;
    } catch (error) {
      if (isStorageError(error) && error.code === 'not-found') moved += 1;
      else failed.push(fileId);
    }
  }
  if (failed.length > 0) {
    throw new Error(`${plural(failed.length, 'original')} could not be moved to the trash. Try again later.`);
  }
  return moved;
}

/**
 * Undoes `trashAssets`: the photos come back to the library and their
 * originals and previews out of the storage's trash. Files already gone
 * for good are skipped; the photo comes back and Check library reports it.
 */
export async function untrashAssets(session: LibrarySession, assetIds: readonly AssetId[]): Promise<void> {
  const raw = writable(session);
  const view = raw.getView();
  const ids = new Set(assetIds.filter((id) => view.assets.get(id)?.deleted === true));
  if (ids.size === 0) return;
  // Out of library history too, for the same reason: undoing a restore there would
  // delete the record and leave the files out of the trash.
  raw.withoutLibraryHistory(() => raw.restoreAssets([...ids]));
  const { originals, previews } = filesOf(view, ids);
  await Promise.allSettled([...originals, ...previews].map((fileId) => raw.adapter.untrash(fileId)));
}
