/**
 * Snapshots (spec 6.6): the whole merged state with per-field stamps, plus
 * the version vector (device -> last seq included), as gzipped JSON named
 * `<hlc>-<deviceId>.json.gz`. A new device loads the newest readable one
 * and then the journal past its vector.
 */

import { gunzipText, gzipText, DecodeError } from './gzip';
import { parseHlc } from './hlc';
import { isDeviceId } from './ids';
import { MergeStore, type SerializedStore } from './merge-store';
import type { FileId, StorageAdapter, StoredFile } from '../storage/types';
import { isRecord } from './validate';

export const SNAPSHOT_FORMAT = 1;
export const MAX_SNAPSHOT_BYTES = 512 * 1024 * 1024;
/** Snapshots kept in `snapshots/` (spec 6.6). */
export const SNAPSHOTS_KEPT = 3;

export type VersionVector = Readonly<Record<string, number>>;

export interface SnapshotData {
  readonly format: number;
  readonly libraryId: string;
  /** The device that wrote it. */
  readonly device: string;
  readonly hlc: string;
  readonly vector: VersionVector;
  readonly store: SerializedStore;
}

export interface LoadedSnapshot {
  readonly libraryId: string;
  readonly device: string;
  readonly hlc: string;
  readonly vector: VersionVector;
  readonly store: MergeStore;
}

const SUFFIX = '.json.gz';
const HLC_PREFIX_LENGTH = 22;

export function snapshotName(hlc: string, device: string): string {
  return `${hlc}-${device}${SUFFIX}`;
}

export function parseSnapshotName(name: string): { hlc: string; device: string } | null {
  if (!name.endsWith(SUFFIX)) return null;
  const base = name.slice(0, -SUFFIX.length);
  const rest = base.slice(HLC_PREFIX_LENGTH);
  // The stamp ends with the device ID and the name repeats it: `<prefix><d>-<d>`.
  if (rest.length % 2 === 0) return null;
  const device = rest.slice(0, (rest.length - 1) / 2);
  if (rest !== `${device}-${device}`) return null;
  const hlc = base.slice(0, HLC_PREFIX_LENGTH + device.length);
  const stamp = parseHlc(hlc);
  if (!stamp || stamp.device !== device) return null;
  return { hlc, device };
}

export function isVersionVector(value: unknown): value is VersionVector {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([device, seq]) => isDeviceId(device) && typeof seq === 'number' && Number.isSafeInteger(seq) && seq >= 0,
  );
}

export async function encodeSnapshot(data: SnapshotData): Promise<Blob> {
  return gzipText(JSON.stringify(data));
}

/** Throws `DecodeError` on anything unreadable or malformed. */
export async function decodeSnapshot(blob: Blob): Promise<LoadedSnapshot> {
  const text = await gunzipText(blob, MAX_SNAPSHOT_BYTES);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new DecodeError('Snapshot is not JSON', { cause: error });
  }
  if (!isRecord(parsed)) throw new DecodeError('Snapshot is not an object');
  const { format, libraryId, device, hlc, vector, store } = parsed;
  if (format !== SNAPSHOT_FORMAT) throw new DecodeError(`Snapshot format ${String(format)} is not supported`);
  if (typeof libraryId !== 'string' || libraryId === '') throw new DecodeError('Snapshot has no library ID');
  if (!isDeviceId(device)) throw new DecodeError('Snapshot has an invalid device');
  if (typeof hlc !== 'string' || parseHlc(hlc)?.device !== device) throw new DecodeError('Snapshot has an invalid hlc');
  if (!isVersionVector(vector)) throw new DecodeError('Snapshot has an invalid version vector');
  let merged: MergeStore;
  try {
    merged = MergeStore.deserialize(store);
  } catch (error) {
    throw new DecodeError('Snapshot state is malformed', { cause: error });
  }
  return { libraryId, device, hlc, vector, store: merged };
}

/** Snapshot files in the folder, newest first. Unrecognised names are ignored. */
export async function listSnapshots(adapter: StorageAdapter, snapshotsId: FileId): Promise<StoredFile[]> {
  const files = (await adapter.listChildren(snapshotsId)).filter((f) => !f.isFolder && parseSnapshotName(f.name));
  return files.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}

export interface NewestSnapshot {
  readonly snapshot: LoadedSnapshot | null;
  readonly file: StoredFile | null;
  /** Snapshots that were skipped because they could not be read. */
  readonly errors: readonly string[];
}

/** Loads the newest readable snapshot of this library, trying older ones if the newest is damaged. */
export async function loadNewestSnapshot(
  adapter: StorageAdapter,
  snapshotsId: FileId,
  libraryId: string,
): Promise<NewestSnapshot> {
  const errors: string[] = [];
  for (const file of await listSnapshots(adapter, snapshotsId)) {
    try {
      const snapshot = await decodeSnapshot(await adapter.readContent(file.id));
      if (snapshot.libraryId !== libraryId) {
        errors.push(`${file.name}: belongs to another library`);
        continue;
      }
      return { snapshot, file, errors };
    } catch (error) {
      if (!(error instanceof DecodeError)) throw error;
      errors.push(`${file.name}: ${error.message}`);
    }
  }
  return { snapshot: null, file: null, errors };
}

/**
 * Writes a snapshot, then deletes this device's snapshots that are older
 * than the newest `SNAPSHOTS_KEPT`. Other devices' files are left to them,
 * as with journal roll-ups: no device deletes what another device wrote.
 */
export async function writeSnapshot(
  adapter: StorageAdapter,
  snapshotsId: FileId,
  data: SnapshotData,
): Promise<StoredFile> {
  const file = await adapter.createFile(
    {
      parentId: snapshotsId,
      name: snapshotName(data.hlc, data.device),
      mimeType: 'application/gzip',
      properties: { 'lp.lib': data.libraryId, 'lp.role': 'snapshot', 'lp.device': data.device },
    },
    await encodeSnapshot(data),
  );
  const all = await listSnapshots(adapter, snapshotsId);
  for (const old of all.slice(SNAPSHOTS_KEPT)) {
    if (parseSnapshotName(old.name)?.device !== data.device || old.id === file.id) continue;
    try {
      await adapter.deletePermanently(old.id);
    } catch (error) {
      // Losing the race to delete an old snapshot is harmless; it is retried next time.
      console.warn('Could not delete old snapshot', old.name, error);
    }
  }
  return file;
}
