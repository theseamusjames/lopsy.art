import { describe, expect, it } from 'vitest';
import type { ImportItem, ImportItemState } from '@lopsy/photos-core/import/types';
import {
  fullSizeFileError,
  importFileErrors,
  lopsyRefusalFileError,
  openFailureFileError,
  reducedExportFileError,
  skippedFileErrors,
} from './file-error-events';

function item(fileName: string, state: ImportItemState, error: string | null): ImportItem {
  return { id: fileName, fileName, byteSize: 10, state, sentBytes: 0, assetId: null, error };
}

const PRIVATE = /Ada|Lovelace|Passport|Holiday|1AbC/i;

describe('skippedFileErrors', () => {
  it('reports the files a pick leaves out by format, one event each with the count, and nothing of their names', () => {
    const errors = skippedFileErrors(['Ada.NEF', 'Lovelace.nef', 'Passport scan.heic', 'notes.txt', 'Holiday.xmp', 'File type not supported.zzz']);
    expect(errors).toEqual([
      { kind: 'unsupported-type', reason: 'File type not supported', format: 'nef', count: 2 },
      { kind: 'unsupported-type', reason: 'File type not supported', format: 'heic', count: 1 },
      { kind: 'unsupported-type', reason: 'File type not supported', format: 'other', count: 2 },
      { kind: 'unsupported-type', reason: 'File type not supported', format: 'xmp', count: 1 },
    ]);
    expect(JSON.stringify(errors)).not.toMatch(PRIVATE);
    expect(skippedFileErrors([])).toEqual([]);
  });
});

describe('importFileErrors', () => {
  it('groups the refused files by reason and format; duplicates, folders, trash and other failures are not file refusals', () => {
    const errors = importFileErrors([
      item('Ada.jpg', 'unsupported', 'Not a supported photo format'),
      item('Lovelace.JPG', 'unsupported', 'Not a supported photo format'),
      item('Holiday.cr3', 'unsupported', 'Not a supported photo format'),
      item('Passport.dng', 'unsupported', 'Larger than 1 GB'),
      item('Ada poster.lopsy', 'unsupported', 'Lopsy documents are not imported as photos'),
      item('Ada folder', 'unsupported', 'A folder: pick the photos in it'),
      item('Ada.raf', 'unsupported', "In Drive's trash"),
      item('Ada copy.raf', 'duplicate', null),
      item('Ada upload.raf', 'failed', 'Upload failed for 1AbCdriveId'),
      item('Ada fine.raf', 'done', null),
    ]);
    expect(errors).toEqual([
      { kind: 'decode-failed', reason: 'Not a supported photo format', format: 'jpeg', count: 2 },
      { kind: 'unsupported-type', reason: 'Not a supported photo format', format: 'cr3', count: 1 },
      { kind: 'too-large', reason: 'File size exceeded 1 GB', format: 'dng', limit: 1024 * 1024 * 1024, count: 1 },
      { kind: 'unsupported-type', reason: 'Lopsy documents are not imported as photos', format: 'lopsy', count: 1 },
    ]);
    expect(JSON.stringify(errors)).not.toMatch(PRIVATE);
  });

  it('sends nothing for an error sentence it does not know, whatever it says', () => {
    expect(importFileErrors([item('x.jpg', 'unsupported', 'Ada Lovelace’s file 1AbC is odd')])).toEqual([]);
  });
});

describe('the Edit view’s events', () => {
  it('reports why a photo is shown below its own size, with the limit only for a size limit', () => {
    expect(fullSizeFileError('too-large', 16382, 'raf')).toEqual({ kind: 'too-large', reason: 'Photo long edge exceeded 16382', format: 'raf', limit: 16382 });
    expect(fullSizeFileError('stepped-down', 16382, 'jpeg')).toEqual({
      kind: 'too-large',
      reason: 'Graphics memory ran short at full size; photo shown smaller',
      format: 'jpeg',
    });
    expect(fullSizeFileError('failed', 16382, 'png')).toEqual({ kind: 'too-large', reason: 'Photo could not load at full size on this device', format: 'png' });
  });

  it('passes on the engine’s refusal of a RAW, shortened, and nothing else a failure says', () => {
    const long = `This Sony RAW's white balance [${Array.from({ length: 90 }, (_, i) => i).join(', ')}] is not four positive levels`;
    expect(long.length).toBeGreaterThan(300);
    expect(openFailureFileError(long, long, 'arw', 'Ada.ARW')).toEqual({
      kind: 'raw-refused',
      reason: "This Sony RAW's white balance is not four positive levels",
      format: 'arw',
    });
    expect(openFailureFileError('RAF decode failed: Not a Fujifilm RAF file (bad magic)', 'RAF decode failed: Not a Fujifilm RAF file (bad magic)', 'raf', 'x.raf')).toEqual({
      kind: 'raw-refused',
      reason: 'Not a Fujifilm RAF file (bad magic)',
      format: 'raf',
    });
    // Not the engine's refusal: its words are never sent.
    expect(openFailureFileError('Worker failed at https://example.com/Ada', null, 'dng', 'Ada.dng')).toEqual({
      kind: 'raw-refused',
      reason: 'RAW file could not be decoded',
      format: 'dng',
    });
    expect(openFailureFileError('The RAW file decoded to an empty image', null, 'raf', 'x.raf').reason).toBe('RAW file decoded to an empty image');
    expect(openFailureFileError('The source image could not be decoded: Ada.jpg', null, 'jpeg', 'Ada.jpg')).toEqual({
      kind: 'decode-failed',
      reason: 'Photo could not be decoded',
      format: 'jpeg',
    });
  });

  it('does not send an engine sentence that mentions the file’s name', () => {
    const name = 'This Sony RAW is damaged.arw';
    expect(openFailureFileError('This Sony RAW is damaged', 'This Sony RAW is damaged', 'arw', name).reason).toBe('RAW file could not be decoded');
  });
});

describe('Edit in Lopsy and exports', () => {
  it('reports Edit in Lopsy refused for a photo too large for Lopsy here, with the limit', () => {
    expect(lopsyRefusalFileError(8190, 'raf')).toEqual({ kind: 'too-large', reason: 'Edit in Lopsy: photo long edge exceeded 8190', format: 'raf', limit: 8190 });
  });

  it('reports an export made smaller than its full size, and why', () => {
    expect(reducedExportFileError('settings', 'dng')).toEqual({ kind: 'too-large', reason: 'Export made smaller: settings cannot be made in parts', format: 'dng' });
    expect(reducedExportFileError('failed', 'jpeg')).toEqual({ kind: 'too-large', reason: 'Export made smaller: making it in parts failed', format: 'jpeg' });
  });
});
