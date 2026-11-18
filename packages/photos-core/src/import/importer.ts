/**
 * The import job (spec 6.8): each file is read, hashed, checked for
 * duplicates, inspected, given previews, uploaded into its date folder,
 * verified against the adapter's checksum and only then added to the
 * library. Failures are per file and never stop the job.
 *
 * POC scope: the staged OPFS copy and the resumable queue in IndexedDB
 * (spec 6.8) are not here; a reload loses the job.
 */

import { DEFAULT_RECIPE, recipeHash } from '../library/recipe';
import type { Recipe } from '../library/recipe';
import type { AlbumId, AssetId, LibrarySession, LibraryView, NewAsset, VersionId } from '../library/types';
import { isStorageError } from '../storage/errors';
import type { FileId } from '../storage/types';
import { ensureFolderPath, originalsFolderSegments, uniqueName } from './folders';
import type { FolderCache } from './folders';
import { sha256Hex } from './hash';
import { inspectImage } from './inspect';
import { isRawJpegPair, pairCandidatesByName } from './pairs';
import type { PairableFile } from './pairs';
import type {
  EmbeddedPreview,
  ImageMetadata,
  ImportItem,
  ImportItemState,
  ImportJob,
  ImportOptions,
  ImportProgress,
  PreviewRenderer,
} from './types';

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = { skipDuplicates: true, rawPlusJpeg: 'both', concurrency: 3 };

/** Spec 6.8: originals over 1 GB are refused in 1.0. */
export const MAX_ORIGINAL_BYTES = 1024 * 1024 * 1024;

export const PREVIEW_SIZES = { thumb: 512, screen: 2048 } as const;

/** Progress-only updates are batched to at most one notification per interval. */
const PROGRESS_INTERVAL_MS = 100;

const TERMINAL: ReadonlySet<ImportItemState> = new Set(['duplicate', 'unsupported', 'done', 'failed', 'skipped']);

export interface ImportContext {
  readonly session: LibrarySession;
  readonly previewRenderer: PreviewRenderer;
  readonly options?: Partial<ImportOptions>;
  readonly now?: () => Date;
  /** The primary versions' starting recipe (a preset). */
  readonly recipe?: Recipe;
  readonly keywords?: readonly string[];
  readonly albumId?: AlbumId;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface Work {
  readonly index: number;
  readonly file: File;
  /** Generated up front so the original's tags and the previews can carry it. */
  readonly assetId: AssetId;
  /** What pairing needs once the file is read; null when it could not be read. */
  readonly read: Deferred<PairableFile | null>;
  /** The library asset this file ended up as (its own, or the one it duplicates). */
  readonly outcome: Deferred<AssetId | null>;
}

interface RenderedPreview {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
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

export function startImport(files: readonly File[], ctx: ImportContext): ImportJob {
  const { session, previewRenderer } = ctx;
  const options: ImportOptions = { ...DEFAULT_IMPORT_OPTIONS, ...ctx.options };
  const concurrency = Math.max(1, Math.floor(options.concurrency) || 1);
  const now = ctx.now ?? (() => new Date());
  const jobId = crypto.randomUUID();
  const abort = new AbortController();
  let cancelled = false;

  const items: ImportItem[] = files.map((file, index) => ({
    id: `${jobId}:${index}`,
    fileName: file.name,
    byteSize: file.size,
    state: 'queued',
    sentBytes: 0,
    assetId: null,
    error: null,
  }));
  const works: Work[] = files.map((file, index) => ({
    index,
    file,
    assetId: crypto.randomUUID(),
    read: deferred<PairableFile | null>(),
    outcome: deferred<AssetId | null>(),
  }));

  // Listeners and the progress snapshot.
  const listeners = new Set<() => void>();
  let snapshot: ImportProgress | null = null;
  let finished = false;
  let progressTimer: ReturnType<typeof setTimeout> | null = null;

  const notify = () => {
    if (progressTimer !== null) {
      clearTimeout(progressTimer);
      progressTimer = null;
    }
    for (const listener of [...listeners]) listener();
  };

  const patch = (index: number, change: Partial<ImportItem>, immediate = true) => {
    const current = items[index];
    if (!current) return;
    items[index] = { ...current, ...change };
    snapshot = null;
    if (immediate) notify();
    else if (progressTimer === null) progressTimer = setTimeout(notify, PROGRESS_INTERVAL_MS);
  };

  const stateOf = (index: number): ImportItemState => items[index]?.state ?? 'failed';
  const isTerminal = (index: number) => TERMINAL.has(stateOf(index));

  const finish = (work: Work, state: ImportItemState, change: Partial<ImportItem> = {}) => {
    patch(work.index, { ...change, state });
  };

  // Duplicate checks: the library's non-deleted assets, rebuilt when the view changes, plus this batch.
  let indexedView: LibraryView | null = null;
  let libraryBySha = new Map<string, AssetId>();
  const existingAsset = (sha: string): AssetId | null => {
    const view = session.getView();
    if (view !== indexedView) {
      libraryBySha = new Map();
      for (const asset of view.assets.values()) if (!asset.deleted) libraryBySha.set(asset.sha256, asset.id);
      indexedView = view;
    }
    return libraryBySha.get(sha) ?? null;
  };
  const batchBySha = new Map<string, number>();

  // Folder IDs and the names already used in each folder.
  const folderCache: FolderCache = new Map();
  const namesByFolder = new Map<FileId, Promise<Set<string>>>();
  const reserveName = async (folderId: FileId, name: string): Promise<string> => {
    let names = namesByFolder.get(folderId);
    if (!names) {
      names = session.adapter.listChildren(folderId).then((children) => new Set(children.map((c) => c.name)));
      namesByFolder.set(folderId, names);
      names.catch(() => namesByFolder.delete(folderId));
    }
    const taken = await names;
    const chosen = uniqueName(taken, name);
    taken.add(chosen);
    return chosen;
  };

  const pairOf = pairCandidatesByName(works.map((w) => ({ id: String(w.index), name: w.file.name })));
  const rawIndexes = new Set([...pairOf.values()].map(Number));

  const checkCancelled = () => {
    if (cancelled) throw new Cancelled();
  };

  const renderPreviews = async (preview: EmbeddedPreview | null) => {
    if (!preview) return { thumb: null, screen: null, error: 'No preview the browser can show' };
    try {
      const screen: RenderedPreview = await previewRenderer.render(preview.blob, PREVIEW_SIZES.screen, preview.orientation);
      const thumb: RenderedPreview = await previewRenderer.render(preview.blob, PREVIEW_SIZES.thumb, preview.orientation);
      return { thumb, screen, error: null };
    } catch (error) {
      return { thumb: null, screen: null, error: `Preview not rendered: ${errorMessage(error)}` };
    }
  };

  // Previews are made from the camera's JPEG, not from the recipe, so they
  // carry the default recipe's hash: a preset applied at import then shows
  // them as stale until the engine renders the edit.
  const previewRecipeHash = recipeHash(DEFAULT_RECIPE);

  const uploadPreview = async (assetId: AssetId, versionId: VersionId, size: 'thumb' | 'screen', preview: RenderedPreview) => {
    const stored = await session.adapter.createFile(
      {
        parentId: session.layout.previewsId,
        name: `${assetId}.${versionId}.${PREVIEW_SIZES[size]}.jpg`,
        mimeType: 'image/jpeg',
        properties: { 'lp.lib': session.libraryId, 'lp.role': 'preview', 'lp.asset': assetId },
      },
      preview.blob,
      { signal: abort.signal },
    );
    session.setPreview(versionId, size, {
      fileId: stored.id,
      recipeHash: previewRecipeHash,
      width: preview.width,
      height: preview.height,
    });
  };

  const addToLibrary = (work: Work, metadata: ImageMetadata, sha: string, fileId: FileId, pairedWith: AssetId | null) => {
    const asset: NewAsset = {
      id: work.assetId,
      kind: 'original',
      fileId,
      sha256: sha,
      fileName: work.file.name,
      byteSize: work.file.size,
      format: metadata.format,
      mimeType: metadata.mimeType,
      capturedAt: metadata.capturedAt,
      importedAt: now().toISOString(),
      importId: jobId,
      width: metadata.width,
      height: metadata.height,
      orientation: metadata.orientation,
      camera: metadata.camera,
      lens: metadata.lens,
      exposure: metadata.exposure,
      gps: metadata.gps,
      pairedWith,
      source: null,
      renderFileId: null,
      ...(ctx.recipe ? { recipe: ctx.recipe } : {}),
      ...(ctx.keywords ? { keywords: ctx.keywords } : {}),
    };
    const added = session.addAsset(asset);
    if (ctx.albumId !== undefined) session.setAlbumMember(ctx.albumId, added.assetId, true);
    return added;
  };

  const run = async (work: Work) => {
    const { file, index } = work;
    let ownOutcome: AssetId | null = null;
    try {
      if (isTerminal(index)) return;
      checkCancelled();
      patch(index, { state: 'reading' });

      if (file.size > MAX_ORIGINAL_BYTES) {
        work.read.resolve(null);
        finish(work, 'unsupported', { error: 'Larger than 1 GB' });
        return;
      }
      let bytes: Uint8Array | null = new Uint8Array(await file.arrayBuffer());
      const sha = await sha256Hex(bytes);
      checkCancelled();
      const inspected = inspectImage(bytes, file);
      bytes = null;
      if (!inspected) {
        work.read.resolve(null);
        finish(work, 'unsupported', { error: 'Not a supported photo format' });
        return;
      }
      const { metadata } = inspected;
      if (metadata.format === 'lopsy') {
        work.read.resolve(null);
        finish(work, 'unsupported', { error: 'Lopsy documents are not imported as photos' });
        return;
      }
      work.read.resolve({ id: String(index), name: file.name, format: metadata.format, capturedAt: metadata.capturedAt });

      if (options.skipDuplicates) {
        const existing = existingAsset(sha);
        if (existing !== null) {
          ownOutcome = existing;
          finish(work, 'duplicate', { assetId: existing });
          return;
        }
        const earlier = batchBySha.get(sha);
        if (earlier !== undefined && earlier !== index) {
          finish(work, 'duplicate');
          return;
        }
        batchBySha.set(sha, index);
      }

      let pairedWith: AssetId | null = null;
      const rawIndex = pairOf.get(String(index));
      const rawWork = rawIndex === undefined ? undefined : works[Number(rawIndex)];
      if (rawWork && metadata.format === 'jpeg') {
        const raw = await rawWork.read.promise;
        const self: PairableFile = { id: String(index), name: file.name, format: metadata.format, capturedAt: metadata.capturedAt };
        if (raw && isRawJpegPair(raw, self)) {
          if (options.rawPlusJpeg === 'raw-only') {
            finish(work, 'skipped');
            return;
          }
          pairedWith = await rawWork.outcome.promise;
          checkCancelled();
        }
      }

      const previews = await renderPreviews(inspected.preview);
      checkCancelled();

      patch(index, { state: 'uploading', sentBytes: 0 });
      const fallback = file.lastModified > 0 ? new Date(file.lastModified) : now();
      const segments = originalsFolderSegments(metadata.capturedAt, fallback);
      const folderId = await ensureFolderPath(session.adapter, session.layout.originalsId, segments, folderCache, {
        'lp.lib': session.libraryId,
      });
      checkCancelled();
      const name = await reserveName(folderId, file.name);
      checkCancelled();
      const stored = await session.adapter.createFile(
        {
          parentId: folderId,
          name,
          mimeType: metadata.mimeType,
          properties: { 'lp.lib': session.libraryId, 'lp.role': 'original', 'lp.asset': work.assetId, 'lp.sha': sha },
        },
        file,
        {
          signal: abort.signal,
          onProgress: (sentBytes) => patch(index, { sentBytes }, false),
        },
      );

      patch(index, { state: 'verifying', sentBytes: file.size });
      if (stored.sha256 !== null && stored.sha256.toLowerCase() !== sha) {
        await session.adapter.trash(stored.id).catch(() => undefined);
        finish(work, 'failed', { error: 'Checksum mismatch: the stored copy differs from the file' });
        return;
      }

      // The original is safely stored: from here the item completes even if cancelled, so no stored file is left without its asset.
      const { assetId, versionId } = addToLibrary(work, metadata, sha, stored.id, pairedWith);
      ownOutcome = assetId;
      let note = previews.error;
      if (!cancelled) {
        for (const size of ['thumb', 'screen'] as const) {
          const preview = previews[size];
          if (!preview) continue;
          try {
            await uploadPreview(assetId, versionId, size, preview);
          } catch (error) {
            note = `Preview not uploaded: ${errorMessage(error)}`;
          }
        }
      }
      finish(work, 'done', { assetId, error: note });
    } catch (error) {
      const wasCancelled = error instanceof Cancelled || (isStorageError(error) && error.code === 'aborted') || cancelled;
      finish(work, 'failed', { error: wasCancelled ? 'Cancelled' : errorMessage(error) });
    } finally {
      work.read.resolve(null);
      work.outcome.resolve(ownOutcome);
    }
  };

  // RAWs that have a JPEG partner go first, so a JPEG never waits on a RAW still queued behind it.
  const queue = [...works.filter((w) => rawIndexes.has(w.index)), ...works.filter((w) => !rawIndexes.has(w.index))];
  const worker = async () => {
    for (let work = queue.shift(); work; work = queue.shift()) await run(work);
  };

  const getProgress = (): ImportProgress => {
    if (!snapshot) snapshot = { items: items.slice(), finished };
    return snapshot;
  };

  const done = Promise.all(Array.from({ length: Math.min(concurrency, works.length) }, worker)).then(() => {
    finished = true;
    snapshot = null;
    notify();
    return getProgress();
  });

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
      for (const work of works) {
        if (stateOf(work.index) === 'queued') finish(work, 'failed', { error: 'Cancelled' });
      }
    },
    finished: done,
  };
}
