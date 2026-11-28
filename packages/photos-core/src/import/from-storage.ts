/**
 * "Add from Google Drive" (spec 5.3, 6.5): files the user picked (through
 * the Picker, so `drive.file` lets the app see them) are adopted into the
 * library. Each is checked against the library by Drive's checksum before
 * any download, read, inspected and given previews, then either moved into
 * `Originals/YYYY/YYYY-MM-DD/` or left where it is, and tagged. Nothing is
 * uploaded: the original already is in storage.
 */

import type { OriginalsCache } from '../cache/originals-cache';
import { DEFAULT_RECIPE, PIPELINE_VERSION, recipeHash } from '../library/recipe';
import type { Recipe } from '../library/recipe';
import type { AlbumId, AssetId, LibrarySession, LibraryView, NewAsset, VersionId } from '../library/types';
import { isStorageError } from '../storage/errors';
import { notifyAll } from '../listeners';
import { shownMessage } from '../shown-message';
import { withSignIn } from '../auth/sign-in-wait';
import type { SignInGate } from '../auth/types';
import type { FileId, StoredFile } from '../storage/types';
import { ensureFolderPath, originalsFolderSegments } from './folders';
import type { FolderCache } from './folders';
import { sha256Hex } from './hash';
import { DEFAULT_IMPORT_OPTIONS, MAX_ORIGINAL_BYTES, PREVIEW_SIZES } from './importer';
import { inspectImage } from './inspect';
import { isRawJpegPair, pairCandidatesByName } from './pairs';
import type { PairableFile } from './pairs';
import { applySidecarFile, applySidecarToExisting, isSidecarName, matchSidecars } from '../xmp/sidecars';
import type { EmbeddedPreview, ImportItem, ImportItemState, ImportJob, ImportOptions, ImportProgress, PreviewRenderer } from './types';

export interface StorageImportOptions extends ImportOptions {
  /** Move picked files into `Originals/` (default), or leave them where they are and only tag them. */
  readonly move: boolean;
}

export interface StorageImportContext {
  readonly session: LibrarySession;
  readonly previewRenderer: PreviewRenderer;
  readonly options?: Partial<StorageImportOptions>;
  readonly now?: () => Date;
  /** When given, each download is kept in the device's originals cache for editing later. */
  readonly originalsCache?: OriginalsCache;
  readonly recipe?: Recipe;
  readonly keywords?: readonly string[];
  readonly albumId?: AlbumId;
  /** The storage's sign-in: work refused for sign-in waits for its next token instead of failing (auth/sign-in-wait.ts). */
  readonly signIn?: SignInGate;
}

const PROGRESS_INTERVAL_MS = 100;
const TERMINAL: ReadonlySet<ImportItemState> = new Set(['duplicate', 'unsupported', 'done', 'failed', 'skipped', 'stopped']);

/** MIME types worth downloading to look at; the magic bytes decide after that. */
function mayBePhoto(mimeType: string): boolean {
  return mimeType === '' || mimeType.startsWith('image/') || mimeType === 'application/octet-stream';
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
  readonly fileId: FileId;
  readonly assetId: AssetId;
  file: StoredFile | null;
  /** The picked `.xmp` sidecar to apply once the asset is added. */
  sidecar: StoredFile | null;
  /** Set for a sidecar file: it is skipped with this reason. */
  skipReason: string | null;
  readonly read: Deferred<PairableFile | null>;
  readonly outcome: Deferred<AssetId | null>;
}

class Stopped extends Error {
  constructor() {
    super('Cancelled');
  }
}

/** What a person is shown of an error (shown-message.ts). */
function errorMessage(error: unknown): string {
  return shownMessage(error, 'Import');
}

/** Adopts files already in storage (picked from Drive) into the library. */
export function startImportFromStorage(fileIds: readonly FileId[], ctx: StorageImportContext): ImportJob {
  const { session, previewRenderer, originalsCache } = ctx;
  const options: StorageImportOptions = { ...DEFAULT_IMPORT_OPTIONS, move: true, ...ctx.options };
  const concurrency = Math.max(1, Math.floor(options.concurrency) || 1);
  const now = ctx.now ?? (() => new Date());
  const jobId = crypto.randomUUID();
  const abort = new AbortController();
  let stopped = false;

  const items: ImportItem[] = fileIds.map((fileId, index) => ({
    id: `${jobId}:${index}`,
    fileName: fileId,
    byteSize: 0,
    state: 'queued',
    sentBytes: 0,
    assetId: null,
    error: null,
  }));
  const works: Work[] = fileIds.map((fileId, index) => ({
    index,
    fileId,
    assetId: crypto.randomUUID(),
    file: null,
    sidecar: null,
    skipReason: null,
    read: deferred<PairableFile | null>(),
    outcome: deferred<AssetId | null>(),
  }));

  const listeners = new Set<() => void>();
  let snapshot: ImportProgress | null = null;
  let finished = false;
  let progressTimer: ReturnType<typeof setTimeout> | null = null;
  const notify = () => {
    if (progressTimer !== null) {
      clearTimeout(progressTimer);
      progressTimer = null;
    }
    notifyAll(listeners, 'an import from storage');
  };
  const patch = (index: number, change: Partial<ImportItem>, immediate = true) => {
    const current = items[index];
    if (!current) return;
    items[index] = { ...current, ...change };
    snapshot = null;
    if (immediate) notify();
    else if (progressTimer === null) progressTimer = setTimeout(notify, PROGRESS_INTERVAL_MS);
  };
  const isTerminal = (index: number) => TERMINAL.has(items[index]?.state ?? 'failed');
  const checkStopped = () => {
    if (stopped) throw new Stopped();
  };

  // Sign-in: a refusal waits for the next token (the job says so: needsSignIn), then the same call runs again.
  let waitingForSignIn = 0;
  const onWait = (waiting: boolean) => {
    waitingForSignIn += waiting ? 1 : -1;
    snapshot = null;
    notify();
  };
  const storage = <T>(call: () => Promise<T>): Promise<T> => withSignIn(ctx.signIn ?? null, call, { signal: abort.signal, onWait });

  let indexedView: LibraryView | null = null;
  let libraryBySha = new Map<string, AssetId>();
  const existingAsset = (sha: string): AssetId | null => {
    const view = session.getView();
    if (view !== indexedView) {
      libraryBySha = new Map();
      for (const asset of view.assets.values()) if (!asset.deleted) libraryBySha.set(asset.sha256, asset.id);
      indexedView = view;
    }
    return libraryBySha.get(sha.toLowerCase()) ?? null;
  };

  /** One claim per file ID and per checksum: a later copy waits for the earlier one and takes over if it fails. */
  const claims = new Map<string, Work>();
  const claim = async (work: Work, key: string): Promise<AssetId | null> => {
    for (;;) {
      const earlier = claims.get(key);
      if (!earlier || earlier === work) {
        claims.set(key, work);
        return null;
      }
      const outcome = await earlier.outcome.promise;
      if (outcome !== null) return outcome;
      if (claims.get(key) === earlier) claims.set(key, work);
    }
  };

  const duplicateOf = async (work: Work, sha: string): Promise<AssetId | null> => {
    if (!options.skipDuplicates) return null;
    const existing = existingAsset(sha);
    if (existing !== null) return existing;
    return claim(work, `sha:${sha.toLowerCase()}`);
  };

  /** Applies a duplicate's sidecar to the asset already in the library, when that one is untouched. */
  const duplicateNote = async (work: Work, assetId: AssetId, sha: string): Promise<{ error?: string }> => {
    if (!work.sidecar || existingAsset(sha) !== assetId) return {};
    const sidecarId = work.sidecar.id;
    const blob = await storage(() => session.adapter.readContent(sidecarId, { signal: abort.signal })).catch(() => null);
    if (!blob) return { error: 'Photo already in the library; its XMP sidecar could not be read' };
    return { error: await applySidecarToExisting(session, assetId, blob) };
  };

  const folderCache: FolderCache = new Map();
  const previewRecipeHash = recipeHash(DEFAULT_RECIPE);

  const renderPreviews = async (preview: EmbeddedPreview | null) => {
    if (!preview) return { thumb: null, screen: null, error: 'No preview the browser can show' };
    try {
      const screen = await previewRenderer.render(preview.blob, PREVIEW_SIZES.screen, preview.orientation);
      const thumb = await previewRenderer.render(preview.blob, PREVIEW_SIZES.thumb, preview.orientation);
      return { thumb, screen, error: null };
    } catch (error) {
      return { thumb: null, screen: null, error: `Preview not rendered: ${errorMessage(error)}` };
    }
  };

  const download = async (work: Work, file: StoredFile): Promise<Blob> => {
    const onProgress = (received: number) => patch(work.index, { sentBytes: received }, false);
    if (originalsCache && file.sha256) {
      const ref = { fileId: file.id, sha256: file.sha256, byteSize: file.size };
      return storage(() => originalsCache.readOriginal(session.adapter, ref, { signal: abort.signal, onProgress }));
    }
    return storage(() => session.adapter.readContent(file.id, { signal: abort.signal, onProgress }));
  };

  const finish = (work: Work, state: ImportItemState, change: Partial<ImportItem> = {}, outcome: AssetId | null = null) => {
    work.outcome.resolve(outcome);
    patch(work.index, { ...change, state });
  };

  const run = async (work: Work) => {
    const { index } = work;
    try {
      if (isTerminal(index)) return;
      checkStopped();
      const file = work.file;
      if (!file) {
        finish(work, 'failed', { error: 'Not found, or not shared with the app' });
        return;
      }
      if (work.skipReason !== null) {
        finish(work, 'skipped', { error: work.skipReason });
        return;
      }
      if (file.isFolder) {
        finish(work, 'unsupported', { error: 'A folder: pick the photos in it' });
        return;
      }
      if (file.trashed) {
        finish(work, 'unsupported', { error: "In Drive's trash" });
        return;
      }
      if (!mayBePhoto(file.mimeType)) {
        finish(work, 'unsupported', { error: 'Not a supported photo format' });
        return;
      }
      if (file.size > MAX_ORIGINAL_BYTES) {
        finish(work, 'unsupported', { error: 'Larger than 1 GB' });
        return;
      }
      const sameFile = await claim(work, `id:${file.id}`);
      if (sameFile !== null) {
        finish(work, 'duplicate', { assetId: sameFile }, sameFile);
        return;
      }
      if (file.sha256) {
        const dup = await duplicateOf(work, file.sha256);
        if (dup !== null) {
          finish(work, 'duplicate', { assetId: dup, ...(await duplicateNote(work, dup, file.sha256)) }, dup);
          return;
        }
      }
      checkStopped();

      patch(index, { state: 'reading', sentBytes: 0 });
      const content = await download(work, file);
      checkStopped();
      const bytes = new Uint8Array(await content.arrayBuffer());
      const sha = await sha256Hex(bytes);
      if (file.sha256 && file.sha256.toLowerCase() !== sha) {
        finish(work, 'failed', { error: 'The download does not match the checksum Drive reports' });
        return;
      }
      if (!file.sha256) {
        originalsCache?.cache.put(sha, content).catch(() => undefined);
        const dup = await duplicateOf(work, sha);
        if (dup !== null) {
          finish(work, 'duplicate', { assetId: dup, ...(await duplicateNote(work, dup, sha)) }, dup);
          return;
        }
      }
      const inspected = inspectImage(bytes, content);
      if (!inspected || inspected.metadata.format === 'lopsy') {
        finish(work, 'unsupported', { error: 'Not a supported photo format' });
        return;
      }
      const { metadata } = inspected;
      work.read.resolve({ id: String(index), name: file.name, format: metadata.format, capturedAt: metadata.capturedAt });

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
          checkStopped();
        }
      }

      const previews = await renderPreviews(inspected.preview);
      checkStopped();

      patch(index, { state: 'uploading', sentBytes: file.size });
      let placed = file;
      if (options.move) {
        const modified = Date.parse(file.modifiedTime);
        const segments = originalsFolderSegments(metadata.capturedAt, Number.isNaN(modified) ? now() : new Date(modified));
        const folderId = await storage(() =>
          ensureFolderPath(session.adapter, session.layout.originalsId, segments, folderCache, { 'lp.lib': session.libraryId }),
        );
        checkStopped();
        if (file.parentId !== folderId) placed = await storage(() => session.adapter.move(file.id, folderId));
      }
      placed = await storage(() =>
        session.adapter.updateProperties(file.id, { 'lp.lib': session.libraryId, 'lp.role': 'original', 'lp.asset': work.assetId, 'lp.sha': sha }),
      );

      const asset: NewAsset = {
        id: work.assetId,
        kind: 'original',
        fileId: placed.id,
        sha256: sha,
        fileName: placed.name,
        byteSize: bytes.length,
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
      const { assetId, versionId } = session.addAsset(asset);
      if (ctx.albumId !== undefined) {
        const albumId = ctx.albumId;
        session.withoutLibraryHistory(() => session.setAlbumMember(albumId, assetId, true));
      }

      let note = previews.error;
      if (work.sidecar) {
        const sidecar = work.sidecar;
        const applied = await storage(() => session.adapter.readContent(sidecar.id, { signal: abort.signal }))
          .then((blob) => applySidecarFile(session, assetId, versionId, blob, metadata.orientation))
          .catch(() => null);
        if (!applied) note = 'Its XMP sidecar could not be read';
      }
      if (!stopped) {
        for (const size of ['thumb', 'screen'] as const) {
          const preview = previews[size];
          if (!preview) continue;
          try {
            await storage(() => uploadPreview(assetId, versionId, size, preview));
          } catch (error) {
            note = `Preview not uploaded: ${errorMessage(error)}`;
          }
        }
      }
      finish(work, 'done', { assetId, error: note }, assetId);
    } catch (error) {
      const cancelled = stopped || error instanceof Stopped || (isStorageError(error) && error.code === 'aborted');
      // Stopped is not a failure: the file stays in Drive as it was, and can be added again.
      if (cancelled) finish(work, 'stopped', { error: null });
      else finish(work, 'failed', { error: errorMessage(error) });
    } finally {
      work.read.resolve(null);
      work.outcome.resolve(null);
    }
  };

  const uploadPreview = async (
    assetId: AssetId,
    versionId: VersionId,
    size: 'thumb' | 'screen',
    preview: { readonly blob: Blob; readonly width: number; readonly height: number },
  ) => {
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
      // As at import (importer.ts): the camera's picture stands in for the default recipe on this pipeline.
      pipeline: PIPELINE_VERSION,
      width: preview.width,
      height: preview.height,
    });
  };

  let pairOf = new Map<string, string>();

  const getProgress = (): ImportProgress => {
    snapshot ??= { items: items.slice(), finished, needsSignIn: waitingForSignIn > 0 && !finished && !stopped, ...(stopped ? { stopped: true } : {}) };
    return snapshot;
  };

  const done = (async () => {
    // File facts first (cheap), so names are known for pairing before any download.
    await Promise.all(
      works.map(async (work) => {
        try {
          work.file = await storage(() => session.adapter.getFile(work.fileId));
        } catch {
          work.file = null;
        }
        if (work.file) patch(work.index, { fileName: work.file.name, byteSize: work.file.size });
      }),
    );
    const applySidecars = options.applySidecars ?? true;
    const names = works.map((w) => w.file?.name ?? '');
    const match = matchSidecars(names);
    for (const work of works) {
      if (!work.file || work.file.isFolder || !isSidecarName(work.file.name)) continue;
      const image = match.imageFor.get(work.index);
      const imageName = image === null || image === undefined ? null : (names[image] ?? null);
      if (imageName === null) work.skipReason = 'XMP sidecar with no matching photo';
      else work.skipReason = applySidecars ? `XMP sidecar, applied to ${imageName}` : `XMP sidecar for ${imageName}, not applied`;
    }
    if (applySidecars) {
      for (const [image, sidecar] of match.sidecarFor) {
        const target = works[image];
        if (target) target.sidecar = works[sidecar]?.file ?? null;
      }
    }
    pairOf = pairCandidatesByName(works.filter((w) => w.file).map((w) => ({ id: String(w.index), name: w.file?.name ?? '' })));
    const raws = new Set([...pairOf.values()].map(Number));
    // RAWs with a JPEG partner go first, so a JPEG never waits on a RAW still queued behind it.
    const queue = [...works.filter((w) => raws.has(w.index)), ...works.filter((w) => !raws.has(w.index))];
    const worker = async () => {
      for (let work = queue.shift(); work; work = queue.shift()) await run(work);
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, works.length) }, worker));
    finished = true;
    snapshot = null;
    notify();
    return getProgress();
  })();

  const stop = () => {
    if (stopped) return;
    stopped = true;
    abort.abort();
    snapshot = null;
    for (const work of works) {
      if (items[work.index]?.state === 'queued') finish(work, 'stopped', { error: null });
    }
  };

  return {
    id: jobId,
    getProgress,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cancel: stop,
    // Nothing is staged: the files stay in storage, so picking them again resumes.
    pause: stop,
    finished: done,
  };
}
