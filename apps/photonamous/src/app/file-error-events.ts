/**
 * The `file_error` events Photonamous sends (packages/tracking/README.md),
 * each built apart from what the person is shown: fixed sentences, the
 * engine's refusal sentences, and a format from the fixed list. Never a
 * file name, a folder or album name, a Drive id or anything in the file.
 * Pure: the places that tell the person send them.
 */

import { engineReason, formatFromName, type FileError, type FileFormat } from '@lopsy/tracking/file-error';
import type { ImportItem } from '@lopsy/photos-core/import/types';
import { MAX_ORIGINAL_BYTES } from '@lopsy/photos-core/import/importer';
import type { FullSizeOutcome } from '../engine/full-size';

/** Files an import sheet leaves out because the app does not read their type: one event per format, with the count. */
export function skippedFileErrors(names: readonly string[]): FileError[] {
  const counts = new Map<FileFormat, number>();
  for (const name of names) {
    const format = formatFromName(name);
    counts.set(format, (counts.get(format) ?? 0) + 1);
  }
  return [...counts].map(([format, count]) => ({ kind: 'unsupported-type', reason: 'File type not supported', format, count }));
}

/** Formats the importer reads; a file of one of these it refuses was named as one and is not one. */
const READABLE: ReadonlySet<FileFormat> = new Set(['raf', 'dng', 'arw', 'jpeg', 'png', 'webp']);


/**
 * An import item the importer refused ('unsupported'), by its fixed error
 * sentence; null for one that is not a file refusal (a folder, a file in
 * Drive's trash) or an error this does not know.
 */
function itemError(item: ImportItem): Omit<FileError, 'count'> | null {
  const format = formatFromName(item.fileName);
  switch (item.error) {
    case 'Not a supported photo format':
      return READABLE.has(format)
        ? { kind: 'decode-failed', reason: 'Not a supported photo format', format }
        : { kind: 'unsupported-type', reason: 'Not a supported photo format', format };
    case 'Larger than 1 GB':
      return { kind: 'too-large', reason: 'File size exceeded 1 GB', format, limit: MAX_ORIGINAL_BYTES };
    case 'Lopsy documents are not imported as photos':
      return { kind: 'unsupported-type', reason: 'Lopsy documents are not imported as photos', format: 'lopsy' };
    default:
      return null;
  }
}

/** The files an import refused, one event per reason and format, with the count. Duplicates are not failures. */
export function importFileErrors(items: readonly ImportItem[]): FileError[] {
  const groups = new Map<string, { error: Omit<FileError, 'count'>; count: number }>();
  for (const item of items) {
    if (item.state !== 'unsupported') continue;
    const error = itemError(item);
    if (!error) continue;
    const key = `${error.kind}|${error.reason}|${error.format}`;
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { error, count: 1 });
  }
  return [...groups.values()].map(({ error, count }) => ({ ...error, count }));
}

/** Why a photo is shown below its own size for the device's sake, as an event. */
export function fullSizeFileError(outcome: FullSizeOutcome, limit: number, format: FileFormat): FileError {
  if (outcome === 'too-large') return { kind: 'too-large', reason: `Photo long edge exceeded ${limit}`, format, limit };
  if (outcome === 'stepped-down') return { kind: 'too-large', reason: 'Graphics memory ran short at full size; photo shown smaller', format };
  return { kind: 'too-large', reason: 'Photo could not load at full size on this device', format };
}

/** Edit in Lopsy refused a photo larger than Lopsy can open on this device. */
export function lopsyRefusalFileError(limit: number, format: FileFormat): FileError {
  return { kind: 'too-large', reason: `Edit in Lopsy: photo long edge exceeded ${limit}`, format, limit };
}

/** An export of a photo larger than the GPU, meant for tiles, made at the held size: with these settings, or after a tile failed. */
export function reducedExportFileError(cause: 'settings' | 'failed', format: FileFormat): FileError {
  return {
    kind: 'too-large',
    reason: cause === 'settings' ? 'Export made smaller: settings cannot be made in parts' : 'Export made smaller: making it in parts failed',
    format,
  };
}

const RAW_FORMATS: ReadonlySet<FileFormat> = new Set(['raf', 'dng', 'arw']);

/** The fixed sentences of a RAW decode that went wrong after the engine took the file. */
const RAW_FIXED = new Set(['The RAW file decoded to an empty image']);

/**
 * A photo the Edit view could not open (the decode, not the reading of the
 * original from storage, which is no fault of the file). `engineSentence`:
 * the engine refused the file with this sentence (`RawPrepareError`,
 * `RawRefusedError`); null for any other failure, whose message is never
 * sent. `fileName` only keeps an engine sentence that mentions it out.
 */
export function openFailureFileError(
  message: string,
  engineSentence: string | null,
  format: FileFormat,
  fileName: string | null,
): FileError {
  if (RAW_FORMATS.has(format)) {
    if (engineSentence !== null) {
      return { kind: 'raw-refused', reason: engineReason(engineSentence, 'RAW file could not be decoded', fileName), format };
    }
    return { kind: 'raw-refused', reason: RAW_FIXED.has(message) ? message.replace(/^The /, '') : 'RAW file could not be decoded', format };
  }
  return { kind: 'decode-failed', reason: 'Photo could not be decoded', format };
}
