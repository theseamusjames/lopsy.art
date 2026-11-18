import { describe, expect, it } from 'vitest';
import type { ExportRequest } from '../backend';
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
    expect(toExportSettings(request)).toEqual({ format: 'jpeg', quality: 0.85, maxLongEdge: 2048 });
    expect(toExportSettings({ ...request, format: 'png', longEdge: null, quality: 0 })).toEqual({
      format: 'png',
      quality: 0.01,
      maxLongEdge: null,
    });
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
