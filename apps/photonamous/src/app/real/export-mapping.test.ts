import { describe, expect, it } from 'vitest';
import type { ExportRequest } from '../backend';
import { DEFAULT_EXPORT_SETTINGS } from '@lopsy/photos-core/export/types';
import { makeAsset, makeView } from '../../library/test-fixtures';
import { exportFolderName, fromCoreProgress, toExportDestination, toExportSelection, toExportSettings } from './export-mapping';

const request: ExportRequest = {
  versionIds: ['v-a', 'v-b', 'v-gone'],
  format: 'jpeg',
  quality: 85,
  longEdge: 2048,
  destination: 'library',
  name: 'Trip: day 1 ',
};

describe('export mapping', () => {
  it('maps settings', () => {
    const defaults = { allowEnlarge: false, pngDepth: 16, zip: true };
    expect(toExportSettings(request)).toEqual({
      format: 'jpeg',
      colorSpace: 'srgb',
      quality: 0.85,
      maxLongEdge: 2048,
      size: { mode: 'long', px: 2048 },
      ...defaults,
    });
    expect(toExportSettings({ ...request, format: 'tiff', colorSpace: 'rec2020', longEdge: null, quality: 0 })).toEqual({
      format: 'tiff',
      colorSpace: 'rec2020',
      quality: 0.01,
      maxLongEdge: null,
      size: { mode: 'original' },
      ...defaults,
    });
    // The dialog's size choices become the settings' own fields.
    const extras = { size: { mode: 'short' as const, px: 1080 }, allowEnlarge: true, pngDepth: 8 as const, zip: false };
    expect(toExportSettings({ ...request, extras })).toMatchObject({ ...extras, maxLongEdge: null });
    // A preset's other choices (metadata, names) carry over.
    expect(toExportSettings({ ...request, base: { ...DEFAULT_EXPORT_SETTINGS, metadata: 'none' } }).metadata).toBe('none');
  });

  it('maps the destination with a safe name', () => {
    expect(toExportDestination(request, 'Export')).toEqual({ kind: 'library', folderName: 'Trip- day 1' });
    expect(toExportDestination({ ...request, destination: 'download', name: '  ' }, 'Export 2026-11-18')).toEqual({
      kind: 'download',
      zipName: 'Export 2026-11-18.zip',
    });
    expect(exportFolderName('a/b', 'x')).toBe('a-b');
  });

  it('pairs versions with their assets and drops missing ones', () => {
    const view = makeView([makeAsset('a'), makeAsset('b', { deleted: true })]);
    expect(toExportSelection(view, request.versionIds)).toEqual([{ assetId: 'a', versionId: 'v-a' }]);
  });

  it('counts finished and failed items', () => {
    const base = { assetId: 'a', fileName: null, byteSize: null, fileId: null, error: null };
    const p = fromCoreProgress({
      finished: false,
      items: [
        { ...base, id: '1', versionId: 'v1', state: 'done' },
        { ...base, id: '2', versionId: 'v2', state: 'failed', error: 'No engine' },
        { ...base, id: '3', versionId: 'v3', state: 'rendering' },
      ],
    });
    expect(p).toEqual({ total: 3, done: 2, failures: [{ versionId: 'v2', error: 'No engine' }], finished: false });
  });
});
