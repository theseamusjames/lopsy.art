/**
 * Roll-up (spec 6.6): a device merges runs of its own small segments into
 * one and deletes the small ones, so listing and reading the journal stays
 * cheap. It only ever touches its own folder. Readers apply ops
 * idempotently, so an overlap left by an interrupted roll-up is harmless,
 * and the next roll-up deletes segments another segment fully covers.
 */

import type { FileId, StorageAdapter, StoredFile } from '../storage/types';
import { isStorageError } from '../storage/errors';
import { decodeSegment, encodeSegment, parseSegmentName, SEGMENT_MIME_TYPE, segmentName } from './journal';
import { ROLES } from './layout';
import type { OpEnvelope } from './types';

/** Segments with fewer ops than this are candidates for a roll-up. */
export const ROLLUP_SMALL_OPS = 1000;

interface Segment {
  readonly file: StoredFile;
  readonly firstSeq: number;
  readonly lastSeq: number;
}

export interface RollUpResult {
  readonly created: readonly string[];
  readonly deleted: number;
  readonly problems: readonly string[];
}

function covers(a: Segment, b: Segment): boolean {
  if (a.file.id === b.file.id || a.firstSeq > b.firstSeq || a.lastSeq < b.lastSeq) return false;
  // Equal ranges: keep one of the two, chosen the same way every time.
  if (a.firstSeq === b.firstSeq && a.lastSeq === b.lastSeq) return a.file.id < b.file.id;
  return true;
}

async function deleteQuietly(adapter: StorageAdapter, id: FileId): Promise<boolean> {
  try {
    await adapter.deletePermanently(id);
    return true;
  } catch (error) {
    if (isStorageError(error) && error.code === 'not-found') return false;
    throw error;
  }
}

/**
 * Rolls up runs of at least `minRun` consecutive small segments of this
 * device, up to `throughSeq` (ops known to be in storage).
 */
export async function rollUpSegments(options: {
  readonly adapter: StorageAdapter;
  readonly folderId: FileId;
  readonly deviceId: string;
  readonly libraryId: string;
  readonly throughSeq: number;
  readonly minRun: number;
}): Promise<RollUpResult> {
  const { adapter, folderId, deviceId, libraryId } = options;
  const problems: string[] = [];
  let deleted = 0;
  const created: string[] = [];

  const all: Segment[] = [];
  for (const file of await adapter.listChildren(folderId)) {
    const range = parseSegmentName(file.name);
    if (range && range.lastSeq <= options.throughSeq) all.push({ file, ...range });
  }
  const live: Segment[] = [];
  for (const seg of all) {
    if (all.some((other) => covers(other, seg))) {
      if (await deleteQuietly(adapter, seg.file.id)) deleted += 1;
    } else {
      live.push(seg);
    }
  }
  live.sort((a, b) => a.firstSeq - b.firstSeq);

  const runs: Segment[][] = [];
  let run: Segment[] = [];
  for (const seg of live) {
    const small = seg.lastSeq - seg.firstSeq + 1 < ROLLUP_SMALL_OPS;
    const prev = run[run.length - 1];
    if (small && (!prev || seg.firstSeq === prev.lastSeq + 1)) {
      run.push(seg);
    } else {
      if (run.length > 0) runs.push(run);
      run = small ? [seg] : [];
    }
  }
  if (run.length > 0) runs.push(run);

  for (const r of runs) {
    if (r.length < options.minRun) continue;
    const first = (r[0] as Segment).firstSeq;
    const last = (r[r.length - 1] as Segment).lastSeq;
    const bySeq = new Map<number, OpEnvelope>();
    let readable = true;
    for (const seg of r) {
      try {
        const decoded = await decodeSegment(await adapter.readContent(seg.file.id), {
          device: deviceId,
          range: { firstSeq: seg.firstSeq, lastSeq: seg.lastSeq },
        });
        if (decoded.errors.length > 0) readable = false;
        for (const op of decoded.ops) bySeq.set(op.seq, op);
      } catch (error) {
        if (isStorageError(error) && error.code !== 'not-found') throw error;
        readable = false;
      }
      if (!readable) break;
    }
    // Never replace segments with a roll-up that would lose an op.
    if (!readable || bySeq.size !== last - first + 1) {
      problems.push(`Skipped roll-up of ${segmentName(first, last)}: its segments are not all readable`);
      continue;
    }
    const ops = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
    const name = segmentName(first, last);
    await adapter.createFile(
      {
        parentId: folderId,
        name,
        mimeType: SEGMENT_MIME_TYPE,
        properties: { 'lp.lib': libraryId, 'lp.role': ROLES.segment, 'lp.device': deviceId },
      },
      await encodeSegment(ops),
    );
    created.push(name);
    for (const seg of r) if (await deleteQuietly(adapter, seg.file.id)) deleted += 1;
  }
  return { created, deleted, problems };
}
