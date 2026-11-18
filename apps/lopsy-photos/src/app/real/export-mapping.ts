/** Translates the Export dialog's request to photos-core's export job, and its progress back. Pure. */

import type { LibraryView, VersionId } from '@lopsy/photos-core/library/types';
import type { ExportSelection } from '@lopsy/photos-core/export/exporter';
import type { ExportDestination, ExportProgress as CoreProgress, ExportSettings } from '@lopsy/photos-core/export/types';
import type { ExportProgress, ExportRequest } from '../backend';
import { maxLongEdgeOf, withExtras } from '../../library/export-size';

export function toExportSettings(request: ExportRequest): Partial<ExportSettings> {
  const settings: Partial<ExportSettings> = {
    ...(request.base ?? {}),
    format: request.format,
    colorSpace: request.colorSpace ?? 'srgb',
    quality: Math.min(1, Math.max(0.01, request.quality / 100)),
    maxLongEdge: request.longEdge !== null && request.longEdge > 0 ? Math.round(request.longEdge) : null,
  };
  if (!request.extras) return settings;
  // The size rides in the extras; photos-core's long edge is only for what it can say itself.
  return withExtras({ ...settings, maxLongEdge: maxLongEdgeOf(request.extras) }, request.extras);
}

/** What to hand the browser after a download export: the zip, or each file when asked for separate files. */
export function filesToDownload(
  result: { readonly zip: { name: string; blob: Blob } | null; readonly files: readonly { name: string; blob: Blob }[] },
  zip: boolean,
): { name: string; blob: Blob }[] {
  if (zip && result.zip) return [result.zip];
  return [...result.files];
}

/** A name safe as a folder or zip name. */
export function exportFolderName(name: string, fallback: string): string {
  const cleaned = name
    .trim()
    .replace(/[/\\:*?"<>|]+/g, '-')
    .replace(/[. ]+$/, '');
  return cleaned === '' ? fallback : cleaned;
}

export function toExportDestination(request: ExportRequest, fallbackName: string): ExportDestination {
  const name = exportFolderName(request.name, fallbackName);
  return request.destination === 'library' ? { kind: 'library', folderName: name } : { kind: 'download', zipName: `${name}.zip` };
}

/** The versions to export with their assets; versions no longer in the library are left out. */
export function toExportSelection(view: LibraryView, versionIds: readonly VersionId[]): ExportSelection[] {
  const out: ExportSelection[] = [];
  for (const versionId of versionIds) {
    const version = view.versions.get(versionId);
    if (!version || version.deleted) continue;
    const asset = view.assets.get(version.assetId);
    if (!asset || asset.deleted) continue;
    out.push({ assetId: asset.id, versionId });
  }
  return out;
}

export function fromCoreProgress(progress: CoreProgress): ExportProgress {
  let done = 0;
  const failures: { versionId: VersionId; error: string }[] = [];
  for (const item of progress.items) {
    if (item.state === 'done') done++;
    else if (item.state === 'failed') {
      done++;
      failures.push({ versionId: item.versionId, error: item.error ?? 'Failed' });
    }
  }
  return { total: progress.items.length, done, failures, finished: progress.finished };
}
