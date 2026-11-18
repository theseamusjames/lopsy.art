/**
 * The import job (spec 6.8): each file is read, hashed, checked for
 * duplicates, inspected, given previews, copied into staging, uploaded
 * into its date folder, verified against the adapter's checksum and only
 * then added to the library. Failures are per file and never stop the job.
 *
 * With a queue store and a staging store, a job survives a reload:
 * `resumeImports` rebuilds it from the queue and continues each unfinished
 * file from its staged copy. Without them it runs from the `File`s alone.
 */

import { DEFAULT_RECIPE, recipeHash } from '../library/recipe';
import type { Recipe } from '../library/recipe';
import type { AlbumId, AssetId, LibrarySession, LibraryView, NewAsset, VersionId } from '../library/types';
import { isStorageError } from '../storage/errors';
import type { FileId, StoredFile } from '../storage/types';
import { ensureFolderPath, originalsFolderSegments, uniqueName } from './folders';
import type { FolderCache } from './folders';
import { sha256Hex } from './hash';
import { inspectImage } from './inspect';
import { isRawJpegPair, pairCandidatesByName } from './pairs';
import type { PairableFile } from './pairs';
import type { ImportItemRecord, ImportJobRecord, ImportQueueStore } from './queue-store';
import type { StagingStore } from './staging';
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
  /** Persists the job so `resumeImports` can continue it after a reload. */
  readonly queueStore?: ImportQueueStore;
  /** Holds each file's copy until its upload is verified. */
  readonly staging?: StagingStore;
}

export interface ResumeContext {
  readonly session: LibrarySession;
  readonly previewRenderer: PreviewRenderer;
  readonly queueStore: ImportQueueStore;
  readonly staging?: StagingStore;
  readonly now?: () => Date;
}

/** The key that lets a resumable adapter continue this file's upload after a reload. */
export function uploadResumeKey(libraryId: string, sha256: string): string {
  return `${libraryId}:${sha256}`;
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

/** What a resumed item already settled before the reload. */
interface Settled {
  readonly sha256: string;
  readonly pairedWith: AssetId | null;
  readonly folderSegments: readonly string[] | null;
  readonly destinationName: string | null;
}

interface WorkSpec {
  readonly content: Blob | null;
  readonly fileName: string;
  readonly byteSize: number;
  readonly lastModified: number;
  /** Generated up front so the original's tags and the previews can carry it. */
  readonly assetId: AssetId;
  readonly settled: Settled | null;
  /** Set when a resumed item cannot continue. */
  readonly resumeError: string | null;
}

interface Work extends WorkSpec {
  readonly index: number;
  /** What pairing needs once the file is read; null when it could not be read. */
  readonly read: Deferred<PairableFile | null>;
  /** The library asset this file ended up as (its own, or the one it duplicates). */
  readonly outcome: Deferred<AssetId | null>;
  /** Resolves when the item has left the prepare stage, either way. */
  readonly preparedSignal: Deferred<void>;
  /** The staging key this item wrote, to delete when it is finished with. */
  stagedKey: string | null;
}

/** What the prepare stage settled for the upload stage. */
interface Prepared {
  readonly sha: string;
  readonly metadata: ImageMetadata;
  readonly segments: readonly string[];
  /** The asset the JPEG half of a pair points at; confirmed at upload. */
  readonly pairCandidate: AssetId | null;
  /** An earlier copy of the same file in this job; this one waits for it at upload. */
  readonly earlierCopy: Work | null;
  readonly unstagedNote: string | null;
}

interface RenderedPreview {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
}

class Stopped extends Error {
  constructor() {
    super('Stopped');
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

interface JobSetup {
  readonly jobId: string;
  readonly session: LibrarySession;
  readonly previewRenderer: PreviewRenderer;
  readonly options: ImportOptions;
  readonly now: () => Date;
  readonly recipe: Recipe | null;
  readonly keywords: readonly string[] | null;
  readonly albumId: AlbumId | null;
  readonly queueStore: ImportQueueStore | null;
  readonly staging: StagingStore | null;
  readonly specs: readonly WorkSpec[];
  /** Persisting the job record; work waits for it. */
  readonly saved: Promise<void>;
}

function warn(what: string) {
  return (error: unknown) => console.warn(`Import: ${what}:`, error);
}

function jobRecord(setup: Omit<JobSetup, 'saved'>, items: readonly ImportItemRecord[]): ImportJobRecord {
  return {
    id: setup.jobId,
    libraryId: setup.session.libraryId,
    createdAt: setup.now().toISOString(),
    options: setup.options,
    recipe: setup.recipe,
    keywords: setup.keywords,
    albumId: setup.albumId,
    items,
  };
}

function newItemRecord(spec: WorkSpec, index: number): ImportItemRecord {
  return {
    index,
    fileName: spec.fileName,
    byteSize: spec.byteSize,
    lastModified: spec.lastModified,
    plannedAssetId: spec.assetId,
    sha256: spec.settled?.sha256 ?? null,
    state: 'queued',
    assetId: null,
    error: null,
    staged: spec.settled !== null,
    pairedWith: spec.settled?.pairedWith ?? null,
    folderSegments: spec.settled?.folderSegments ?? null,
    destinationName: spec.settled?.destinationName ?? null,
  };
}

export function startImport(files: readonly File[], ctx: ImportContext): ImportJob {
  const options: ImportOptions = { ...DEFAULT_IMPORT_OPTIONS, ...ctx.options };
  const now = ctx.now ?? (() => new Date());
  const specs: WorkSpec[] = files.map((file) => ({
    content: file,
    fileName: file.name,
    byteSize: file.size,
    lastModified: file.lastModified,
    assetId: crypto.randomUUID(),
    settled: null,
    resumeError: null,
  }));
  const base = {
    jobId: crypto.randomUUID(),
    session: ctx.session,
    previewRenderer: ctx.previewRenderer,
    options,
    now,
    recipe: ctx.recipe ?? null,
    keywords: ctx.keywords ?? null,
    albumId: ctx.albumId ?? null,
    queueStore: ctx.queueStore ?? null,
    staging: ctx.staging ?? null,
    specs,
  };
  const saved =
    base.queueStore && specs.length > 0
      ? base.queueStore.saveJob(jobRecord(base, specs.map(newItemRecord))).catch(warn('saving the queue'))
      : Promise.resolve();
  return runJob({ ...base, saved });
}

/**
 * Continues the library's unfinished imports after a reload, as one new
 * job, from their staged copies. Items that never reached staging, or
 * whose staged copy is gone, fail with the reason. Null when nothing is
 * unfinished.
 */
export async function resumeImports(ctx: ResumeContext): Promise<ImportJob | null> {
  const { session, queueStore } = ctx;
  const now = ctx.now ?? (() => new Date());
  const records = (await queueStore.listJobs(session.libraryId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const specs: WorkSpec[] = [];
  let options: ImportOptions | null = null;
  let recipe: Recipe | null = null;
  let keywords: readonly string[] | null = null;
  let albumId: AlbumId | null = null;
  for (const record of records) {
    for (const item of record.items) {
      if (TERMINAL.has(item.state)) continue;
      options ??= record.options;
      recipe ??= record.recipe;
      keywords ??= record.keywords;
      albumId ??= record.albumId;
      let content: Blob | null = null;
      let resumeError: string | null = null;
      if (item.sha256 === null || !item.staged) {
        resumeError = 'Interrupted before it was staged on this device; import the file again';
      } else {
        content = ctx.staging ? await ctx.staging.get(item.sha256).catch(() => null) : null;
        if (!content) resumeError = 'Its staged copy on this device is gone; import the file again';
      }
      specs.push({
        content,
        fileName: item.fileName,
        byteSize: item.byteSize,
        lastModified: item.lastModified,
        assetId: item.plannedAssetId,
        settled:
          item.sha256 === null
            ? null
            : {
                sha256: item.sha256,
                pairedWith: item.pairedWith,
                folderSegments: item.folderSegments,
                destinationName: item.destinationName,
              },
        resumeError,
      });
    }
  }
  if (specs.length === 0) {
    for (const record of records) await queueStore.deleteJob(record.id);
    return null;
  }
  const base = {
    jobId: crypto.randomUUID(),
    session,
    previewRenderer: ctx.previewRenderer,
    options: options ?? DEFAULT_IMPORT_OPTIONS,
    now,
    recipe,
    keywords,
    albumId,
    queueStore,
    staging: ctx.staging ?? null,
    specs,
  };
  await queueStore.saveJob(jobRecord(base, specs.map(newItemRecord)));
  for (const record of records) await queueStore.deleteJob(record.id);
  return runJob({ ...base, saved: Promise.resolve() });
}

function runJob(setup: JobSetup): ImportJob {
  const { jobId, session, previewRenderer, options, now, queueStore, staging } = setup;
  const concurrency = Math.max(1, Math.floor(options.concurrency) || 1);
  const abort = new AbortController();
  let stopping: 'cancel' | 'pause' | null = null;

  const items: ImportItem[] = setup.specs.map((spec, index) => ({
    id: `${jobId}:${index}`,
    fileName: spec.fileName,
    byteSize: spec.byteSize,
    state: 'queued',
    sentBytes: 0,
    assetId: null,
    error: null,
  }));
  const works: Work[] = setup.specs.map((spec, index) => ({
    ...spec,
    index,
    read: deferred<PairableFile | null>(),
    outcome: deferred<AssetId | null>(),
    preparedSignal: deferred<void>(),
    stagedKey: spec.settled && spec.content ? spec.settled.sha256 : null,
  }));
  const worksByAssetId = new Map(works.map((w) => [w.assetId, w]));

  // Persistence, in order, after the job record is saved.
  let persisted: Promise<void> = setup.saved;
  const persist = (index: number, patch: Partial<ImportItemRecord>) => {
    const store = queueStore;
    if (!store) return;
    persisted = persisted.then(() => store.updateItem(jobId, index, patch)).catch(warn('updating the queue'));
  };

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

  const setState = (work: Work, state: ImportItemState, change: Partial<ImportItem> = {}) => {
    patch(work.index, { ...change, state });
    persist(work.index, {
      state,
      ...(change.assetId !== undefined ? { assetId: change.assetId } : {}),
      ...(change.error !== undefined ? { error: change.error } : {}),
    });
  };

  const stateOf = (index: number): ImportItemState => items[index]?.state ?? 'failed';
  const isTerminal = (index: number) => TERMINAL.has(stateOf(index));

  const unstage = async (work: Work) => {
    const key = work.stagedKey;
    if (!key || !staging) return;
    work.stagedKey = null;
    await staging.delete(key).catch(warn('deleting a staged copy'));
  };

  const finish = async (work: Work, state: ImportItemState, change: Partial<ImportItem> = {}) => {
    setState(work, state, change);
    await unstage(work);
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
  const batchBySha = new Map<string, Work>();

  // Folder IDs and the names already used in each folder.
  const folderCache: FolderCache = new Map();
  const namesByFolder = new Map<FileId, Promise<Set<string>>>();
  const folderNames = (folderId: FileId): Promise<Set<string>> => {
    let names = namesByFolder.get(folderId);
    if (!names) {
      names = session.adapter.listChildren(folderId).then((children) => new Set(children.map((c) => c.name)));
      namesByFolder.set(folderId, names);
      names.catch(() => namesByFolder.delete(folderId));
    }
    return names;
  };
  const reserveName = async (folderId: FileId, name: string): Promise<string> => {
    const taken = await folderNames(folderId);
    const chosen = uniqueName(taken, name);
    taken.add(chosen);
    return chosen;
  };

  const pairOf = pairCandidatesByName(
    works.filter((w) => w.settled === null).map((w) => ({ id: String(w.index), name: w.fileName })),
  );
  const rawIndexes = new Set([...pairOf.values()].map(Number));

  const checkStopped = () => {
    if (stopping) throw new Stopped();
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
      fileName: work.fileName,
      byteSize: work.byteSize,
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
      ...(setup.recipe ? { recipe: setup.recipe } : {}),
      ...(setup.keywords ? { keywords: setup.keywords } : {}),
    };
    const added = session.addAsset(asset);
    if (setup.albumId !== null) session.setAlbumMember(setup.albumId, added.assetId, true);
    return added;
  };

  /** A resumed item's original that reached storage before the reload. */
  const findStoredOriginal = async (work: Work, sha: string): Promise<StoredFile | null> => {
    const found = await session.adapter.findByProperty('lp.asset', work.assetId);
    return found.find((f) => !f.isFolder && f.properties['lp.role'] === 'original' && f.properties['lp.sha'] === sha && f.sha256 === sha) ?? null;
  };

  /** Ends an item before upload. */
  const endEarly = async (work: Work, state: ImportItemState, change: Partial<ImportItem>, outcome: AssetId | null) => {
    work.outcome.resolve(outcome);
    await finish(work, state, change);
  };

  /**
   * Prepare: read, hash, inspect, check duplicates, settle pairing and stage
   * the copy. Runs ahead of the uploads so a reload finds every file staged.
   */
  const prepare = async (work: Work): Promise<Prepared | null> => {
    const { index } = work;
    await setup.saved;
    if (isTerminal(index)) return null;
    checkStopped();
    if (work.resumeError !== null || work.content === null) {
      await endEarly(work, 'failed', { error: work.resumeError ?? 'No content to import' }, null);
      return null;
    }
    const existingOwn = session.getView().assets.get(work.assetId);
    if (work.settled && existingOwn && !existingOwn.deleted) {
      // Added to the library just before the reload.
      await endEarly(work, 'done', { assetId: existingOwn.id, error: null }, existingOwn.id);
      return null;
    }
    patch(index, { state: 'reading', error: null });

    if (work.byteSize > MAX_ORIGINAL_BYTES) {
      await endEarly(work, 'unsupported', { error: 'Larger than 1 GB' }, null);
      return null;
    }
    const bytes = new Uint8Array(await work.content.arrayBuffer());
    const sha = await sha256Hex(bytes);
    checkStopped();
    if (work.settled && work.settled.sha256 !== sha) {
      await endEarly(work, 'failed', { error: 'Its staged copy on this device is damaged; import the file again' }, null);
      return null;
    }
    persist(index, { sha256: sha });
    const metadata = inspectImage(bytes)?.metadata ?? null;
    if (!metadata) {
      await endEarly(work, 'unsupported', { error: 'Not a supported photo format' }, null);
      return null;
    }
    if (metadata.format === 'lopsy') {
      await endEarly(work, 'unsupported', { error: 'Lopsy documents are not imported as photos' }, null);
      return null;
    }
    work.read.resolve({ id: String(index), name: work.fileName, format: metadata.format, capturedAt: metadata.capturedAt });

    let earlierCopy: Work | null = null;
    if (options.skipDuplicates) {
      const existing = existingAsset(sha);
      if (existing !== null && existing !== work.assetId) {
        await endEarly(work, 'duplicate', { assetId: existing }, existing);
        return null;
      }
      const earlier = batchBySha.get(sha);
      if (earlier && earlier !== work) {
        earlierCopy = earlier;
        // Wait until the earlier copy is queued for upload, so the upload stage never waits on work behind it.
        await earlier.preparedSignal.promise;
      }
      batchBySha.set(sha, work);
    }

    let pairCandidate: AssetId | null = work.settled?.pairedWith ?? null;
    const rawIndex = pairOf.get(String(index));
    const rawWork = rawIndex === undefined ? undefined : works[Number(rawIndex)];
    if (!work.settled && rawWork && metadata.format === 'jpeg') {
      const raw = await rawWork.read.promise;
      const self: PairableFile = { id: String(index), name: work.fileName, format: metadata.format, capturedAt: metadata.capturedAt };
      if (raw && isRawJpegPair(raw, self)) {
        if (options.rawPlusJpeg === 'raw-only') {
          await endEarly(work, 'skipped', {}, null);
          return null;
        }
        pairCandidate = rawWork.assetId;
      }
    }
    const partner = pairCandidate === null ? undefined : worksByAssetId.get(pairCandidate);
    if (partner && partner !== work) await partner.preparedSignal.promise;
    checkStopped();

    const fallback = work.lastModified > 0 ? new Date(work.lastModified) : now();
    const segments = work.settled?.folderSegments ?? originalsFolderSegments(metadata.capturedAt, fallback);

    let unstagedNote: string | null = null;
    if (staging && work.stagedKey === null && earlierCopy === null) {
      const room = await staging.hasRoomFor(work.byteSize).catch(() => false);
      if (room) {
        try {
          await staging.put(sha, work.content);
          work.stagedKey = sha;
        } catch (error) {
          warn('staging a file')(error);
        }
      }
      if (work.stagedKey === null) unstagedNote = 'Not staged on this device: closing the tab stops this upload';
    }
    persist(index, { staged: work.stagedKey !== null, pairedWith: pairCandidate, folderSegments: segments });
    if (work.stagedKey !== null) setState(work, 'staged', { error: null });
    checkStopped();
    return { sha, metadata, segments, pairCandidate, earlierCopy, unstagedNote };
  };

  /** Upload: previews, the original, verification, then the library entry. */
  const upload = async (work: Work, prep: Prepared): Promise<AssetId | null> => {
    const { index } = work;
    const content = work.content;
    if (!content) return null;
    const { sha, metadata } = prep;
    if (prep.earlierCopy) {
      const earlier = await prep.earlierCopy.outcome.promise;
      if (earlier !== null) {
        await finish(work, 'duplicate', { assetId: earlier });
        return earlier;
      }
      checkStopped();
    }
    let pairedWith: AssetId | null = null;
    if (prep.pairCandidate !== null) {
      const partner = worksByAssetId.get(prep.pairCandidate);
      if (partner && partner !== work) {
        pairedWith = await partner.outcome.promise;
      } else {
        const asset = session.getView().assets.get(prep.pairCandidate);
        pairedWith = asset && !asset.deleted ? asset.id : null;
      }
      checkStopped();
    }

    const inspected = inspectImage(new Uint8Array(await content.arrayBuffer()), content);
    const previews = await renderPreviews(inspected?.preview ?? null);
    checkStopped();

    patch(index, { state: 'uploading', sentBytes: 0, error: prep.unstagedNote });
    persist(index, { state: 'uploading' });
    const folderId = await ensureFolderPath(session.adapter, session.layout.originalsId, prep.segments, folderCache, {
      'lp.lib': session.libraryId,
    });
    checkStopped();
    let stored = work.settled ? await findStoredOriginal(work, sha) : null;
    if (!stored) {
      let name = work.settled?.destinationName ?? null;
      if (name === null) name = await reserveName(folderId, work.fileName);
      else (await folderNames(folderId)).add(name);
      persist(index, { destinationName: name });
      checkStopped();
      stored = await session.adapter.createFile(
        {
          parentId: folderId,
          name,
          mimeType: metadata.mimeType,
          properties: { 'lp.lib': session.libraryId, 'lp.role': 'original', 'lp.asset': work.assetId, 'lp.sha': sha },
        },
        content,
        {
          signal: abort.signal,
          resumeKey: uploadResumeKey(session.libraryId, sha),
          onProgress: (sentBytes) => patch(index, { sentBytes }, false),
        },
      );
    }

    setState(work, 'verifying', { sentBytes: work.byteSize });
    if (stored.sha256 !== null && stored.sha256.toLowerCase() !== sha) {
      await session.adapter.trash(stored.id).catch(() => undefined);
      await finish(work, 'failed', { error: 'Checksum mismatch: the stored copy differs from the file' });
      return null;
    }

    // The original is safely stored: from here the item completes even if stopped, so no stored file is left without its asset.
    const { assetId, versionId } = addToLibrary(work, metadata, sha, stored.id, pairedWith);
    await unstage(work);
    let note = previews.error;
    if (!stopping) {
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
    await finish(work, 'done', { assetId, error: note });
    return assetId;
  };

  const failed = async (work: Work, error: unknown) => {
    const stopped = error instanceof Stopped || (isStorageError(error) && error.code === 'aborted') || stopping !== null;
    if (stopped && stopping === 'pause') {
      patch(work.index, { state: 'queued', sentBytes: 0, error: 'Paused' });
    } else {
      await finish(work, 'failed', { error: stopped ? 'Cancelled' : errorMessage(error) });
    }
  };

  // The upload stage takes prepared items in the order they were prepared.
  const ready: { work: Work; prep: Prepared }[] = [];
  const wakers: (() => void)[] = [];
  let preparing = true;
  const wake = () => {
    for (const w of wakers.splice(0)) w();
  };
  const nextReady = async (): Promise<{ work: Work; prep: Prepared } | null> => {
    for (;;) {
      const next = ready.shift();
      if (next) return next;
      if (!preparing) return null;
      await new Promise<void>((resolve) => wakers.push(resolve));
    }
  };

  // Pair partners are prepared first, so an item never waits on one still queued behind it.
  const partners = new Set<number>(rawIndexes);
  for (const w of works) {
    const candidate = w.settled?.pairedWith;
    const partner = candidate ? worksByAssetId.get(candidate) : undefined;
    if (partner) partners.add(partner.index);
  }
  const prepareQueue = [...works.filter((w) => partners.has(w.index)), ...works.filter((w) => !partners.has(w.index))];
  const preparer = async () => {
    for (let work = prepareQueue.shift(); work; work = prepareQueue.shift()) {
      try {
        const prep = await prepare(work);
        if (prep) {
          ready.push({ work, prep });
          wake();
        } else {
          work.outcome.resolve(null);
        }
      } catch (error) {
        await failed(work, error);
        work.outcome.resolve(null);
      } finally {
        work.read.resolve(null);
        work.preparedSignal.resolve();
      }
    }
  };
  const uploader = async () => {
    for (let next = await nextReady(); next; next = await nextReady()) {
      const { work, prep } = next;
      let outcome: AssetId | null = null;
      try {
        if (isTerminal(work.index)) continue;
        if (stopping) throw new Stopped();
        outcome = await upload(work, prep);
      } catch (error) {
        await failed(work, error);
      } finally {
        work.outcome.resolve(outcome);
      }
    }
  };

  const getProgress = (): ImportProgress => {
    if (!snapshot) snapshot = { items: items.slice(), finished };
    return snapshot;
  };

  const workerCount = Math.min(concurrency, works.length);
  const preparers = Promise.all(Array.from({ length: workerCount }, preparer)).then(() => {
    preparing = false;
    wake();
  });
  const uploaders = Promise.all(Array.from({ length: workerCount }, uploader));
  const done = Promise.all([preparers, uploaders]).then(async () => {
    await persisted;
    if (queueStore && works.length > 0 && works.every((w) => isTerminal(w.index))) {
      await queueStore.deleteJob(jobId).catch(warn('clearing the queue'));
    }
    finished = true;
    snapshot = null;
    notify();
    return getProgress();
  });

  const stop = (how: 'cancel' | 'pause') => {
    if (stopping) return;
    stopping = how;
    abort.abort();
    for (const work of works) {
      if (stateOf(work.index) !== 'queued') continue;
      if (how === 'pause') patch(work.index, { error: 'Paused' });
      else void finish(work, 'failed', { error: 'Cancelled' });
    }
  };

  return {
    id: jobId,
    getProgress,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cancel: () => stop('cancel'),
    pause: () => stop(queueStore ? 'pause' : 'cancel'),
    finished: done,
  };
}
