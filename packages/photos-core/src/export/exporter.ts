/**
 * The export job (spec 5.5, 6.11): each selected version is rendered by
 * the injected renderer, given the metadata the settings ask for, then
 * written to `Exports/<folderName>/` or collected for download (zipped
 * when there are several). One item at a time: the GPU is the bottleneck.
 * Failures are per item and never stop the job.
 *
 * POC scope: the queue is not persisted in IndexedDB (spec 6.11), so a
 * reload loses the job.
 */

import { ensureFolderPath } from '../import/folders';
import type { FolderCache } from '../import/folders';
import type { AssetId, LibrarySession, VersionId } from '../library/types';
import { isStorageError } from '../storage/errors';
import type { FileId } from '../storage/types';
import { applyExportMetadata } from './exif-writer';
import { exportFileName, sanitizeFileName } from './file-names';
import { DEFAULT_EXPORT_SETTINGS } from './types';
import type {
  ExportDestination,
  ExportItem,
  ExportItemState,
  ExportJob,
  ExportProgress,
  ExportRenderer,
  ExportResult,
  ExportSettings,
  ExportedFile,
} from './types';
import { createZip } from './zip';

export interface ExportContext {
  readonly session: LibrarySession;
  readonly renderer: ExportRenderer;
  readonly settings: Partial<ExportSettings>;
  readonly destination: ExportDestination;
  readonly now?: () => Date;
}

export interface ExportSelection {
  readonly assetId: AssetId;
  readonly versionId: VersionId;
}

class Cancelled extends Error {
  constructor() {
    super('Cancelled');
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function startExport(selection: readonly ExportSelection[], ctx: ExportContext): ExportJob {
  const { session, renderer, destination } = ctx;
  const settings: ExportSettings = { ...DEFAULT_EXPORT_SETTINGS, ...ctx.settings };
  const now = ctx.now ?? (() => new Date());
  const jobId = crypto.randomUUID();
  const abort = new AbortController();
  let cancelled = false;

  const items: ExportItem[] = selection.map((s, index) => ({
    id: `${jobId}:${index}`,
    assetId: s.assetId,
    versionId: s.versionId,
    state: 'queued',
    fileName: null,
    byteSize: null,
    fileId: null,
    error: null,
  }));
  const listeners = new Set<() => void>();
  let snapshot: ExportProgress | null = null;
  let finished = false;

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const patch = (index: number, change: Partial<ExportItem>) => {
    const current = items[index];
    if (!current) return;
    items[index] = { ...current, ...change };
    snapshot = null;
    notify();
  };
  const stateOf = (index: number): ExportItemState => items[index]?.state ?? 'failed';
  const checkCancelled = () => {
    if (cancelled) throw new Cancelled();
  };

  const files: ExportedFile[] = [];
  const taken = new Set<string>();
  const folderCache: FolderCache = new Map();
  let folderId: FileId | null = null;
  let folderNamesRead = false;

  const libraryFolder = async (): Promise<FileId> => {
    if (destination.kind !== 'library') throw new Error('Not a library export');
    const id = await ensureFolderPath(
      session.adapter,
      session.layout.exportsId,
      [sanitizeFileName(destination.folderName)],
      folderCache,
      { 'lp.lib': session.libraryId },
    );
    if (!folderNamesRead) {
      for (const child of await session.adapter.listChildren(id)) taken.add(child.name);
      folderNamesRead = true;
    }
    folderId = id;
    return id;
  };

  const run = async (index: number) => {
    const chosen = selection[index];
    if (!chosen || stateOf(index) !== 'queued') return;
    try {
      checkCancelled();
      const view = session.getView();
      const asset = view.assets.get(chosen.assetId);
      const version = view.versions.get(chosen.versionId);
      if (!asset || asset.deleted) throw new Error('Photo not in the library');
      if (!version || version.deleted || version.assetId !== asset.id) throw new Error('Version not found');

      patch(index, { state: 'rendering' });
      const rendered = await renderer.render(asset, version, settings, abort.signal);
      checkCancelled();
      const blob = await applyExportMetadata(rendered, asset, settings);
      checkCancelled();

      patch(index, { state: 'writing' });
      const parentId = destination.kind === 'library' ? await libraryFolder() : null;
      checkCancelled();
      const name = exportFileName(settings.fileNameTemplate, { asset, version, seq: index + 1 }, settings.format, taken);
      if (parentId === null) {
        files.push({ name, blob });
        patch(index, { state: 'done', fileName: name, byteSize: blob.size });
        return;
      }
      const stored = await session.adapter.createFile(
        {
          parentId,
          name,
          mimeType: settings.format === 'png' ? 'image/png' : 'image/jpeg',
          properties: { 'lp.lib': session.libraryId, 'lp.role': 'export', 'lp.asset': asset.id },
        },
        blob,
        { signal: abort.signal },
      );
      patch(index, { state: 'done', fileName: name, byteSize: blob.size, fileId: stored.id });
    } catch (error) {
      const wasCancelled =
        cancelled || error instanceof Cancelled || (isStorageError(error) && error.code === 'aborted');
      patch(index, { state: 'failed', error: wasCancelled ? 'Cancelled' : errorMessage(error) });
    }
  };

  const getProgress = (): ExportProgress => {
    if (!snapshot) snapshot = { items: items.slice(), finished };
    return snapshot;
  };

  const done = (async (): Promise<ExportResult> => {
    for (let index = 0; index < selection.length; index++) await run(index);
    let zip: ExportedFile | null = null;
    if (destination.kind === 'download' && files.length > 1 && !cancelled) {
      const base = sanitizeFileName(destination.zipName ?? `Lopsy export ${localDay(now())}`).replace(/\.zip$/i, '');
      zip = { name: `${base}.zip`, blob: await createZip(files.map((f) => ({ name: f.name, blob: f.blob, modified: now() }))) };
    }
    finished = true;
    snapshot = null;
    notify();
    return { ...getProgress(), files: files.slice(), zip, folderId };
  })();

  return {
    id: jobId,
    getProgress,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      abort.abort();
      items.forEach((item, index) => {
        if (item.state === 'queued') patch(index, { state: 'failed', error: 'Cancelled' });
      });
    },
    finished: done,
  };
}
