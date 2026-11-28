/**
 * The import job (spec 6.8): each file is read, hashed, checked for
 * duplicates, inspected, given previews, copied into staging, uploaded
 * into its date folder, verified against the adapter's checksum and only
 * then added to the library. Failures are per file and never stop the job.
 *
 * A refused or expired sign-in is not a failure: the upload stage waits
 * (`needsSignIn`) until `authorization` says a new token was taken, then
 * tries the same work again, a resumable upload from where Drive has it.
 *
 * With a queue store and a staging store, a job survives a reload:
 * `resumeImports` rebuilds it from the queue and continues each unfinished
 * file from its staged copy. Without them it runs from the `File`s alone.
 */

import { findPreset } from '../library/presets';
import { DEFAULT_RECIPE, PIPELINE_VERSION, recipeFromPaths, recipeHash, recipeToPaths } from '../library/recipe';
import type { Recipe } from '../library/recipe';
import type { AlbumId, AssetId, LibrarySession, LibraryView, NewAsset, VersionId } from '../library/types';
import { isStorageError } from '../storage/errors';
import { notifyAll } from '../listeners';
import { shownMessage } from '../shown-message';
import type { FileId, StoredFile } from '../storage/types';
import { defaultImportLocks, importLockName } from './claim-locks';
import type { ImportLocks } from './claim-locks';
import { ensureFolderPath, originalsFolderSegments, uniqueName } from './folders';
import type { FolderCache } from './folders';
import { sha256Hex } from './hash';
import { inspectImage } from './inspect';
import { isRawJpegPair, pairCandidatesByName } from './pairs';
import type { PairableFile } from './pairs';
import type { ImportItemRecord, ImportJobRecord, ImportQueueStore } from './queue-store';
import { InterruptedIndex, type InterruptedMatch } from './interrupted';
import type { StagingStore } from './staging';
import { applySidecarFile, applySidecarToExisting, isSidecarName, matchSidecars } from '../xmp/sidecars';
import type {
  AuthorizationSignal,
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
  /** Waits between upload attempts; after the last, the item waits for a resume. */
  readonly retryDelaysMs?: readonly number[];
  /** Identifies this tab in the queue's leases; one per page load by default. */
  readonly ownerId?: string;
  /** Who runs which job; this page's Web Locks (or in-process locks) by default. */
  readonly locks?: ImportLocks;
  /** When the storage's sign-in has a new token: a job waiting for sign-in carries on. */
  readonly authorization?: AuthorizationSignal;
}

export interface ResumeContext {
  readonly session: LibrarySession;
  readonly previewRenderer: PreviewRenderer;
  readonly queueStore: ImportQueueStore;
  readonly staging?: StagingStore;
  readonly now?: () => Date;
  readonly retryDelaysMs?: readonly number[];
  readonly ownerId?: string;
  /** Where the locks do not span tabs: how long a job's heartbeat holds it for its owner. Default 3 min. */
  readonly leaseMs?: number;
  /** Who runs which job; this page's Web Locks (or in-process locks) by default. */
  readonly locks?: ImportLocks;
  /** When the storage's sign-in has a new token: a job waiting for sign-in carries on. */
  readonly authorization?: AuthorizationSignal;
}

export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 15_000, 30_000, 60_000];
/**
 * Long enough to outlast hidden-tab throttling, which runs a background
 * tab's timers about once a minute; work in progress renews it as well.
 */
export const DEFAULT_LEASE_MS = 180_000;
const HEARTBEAT_MS = 10_000;
/** Overlapping resumes that lose a claim look again this many times. */
const CLAIM_ATTEMPTS = 3;

/** This page load's identity in the queue's leases. */
const THIS_TAB = crypto.randomUUID();

/** Where an item's copy is staged: per job and item, so two jobs or two equal files never share one. */
export function itemStagingKey(jobId: string, index: number): string {
  return `${jobId}.${index}`;
}

/** Where a photo's `.xmp` sidecar is staged, next to the photo's own copy. */
export function sidecarStagingKey(stagingKey: string): string {
  return `${stagingKey}.xmp`;
}

/**
 * The key that lets a resumable adapter continue this file's upload after
 * a reload. Per planned asset, not per content, so a stale upload session
 * for the same bytes can never stand in for this one.
 */
export function uploadResumeKey(libraryId: string, assetId: AssetId): string {
  return `${libraryId}:${assetId}`;
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
  readonly stagingKey: string;
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
  /** The `.xmp` sidecar to apply once the asset is added. */
  readonly sidecar: Blob | null;
  /** Set for a sidecar file: it is skipped with this reason, never imported. */
  readonly skipReason: string | null;
}

interface Work extends Omit<WorkSpec, 'assetId'> {
  /** Generated up front; a file chosen again for an interrupted import takes the id that import planned for it. */
  assetId: AssetId;
  readonly index: number;
  /** What pairing needs once the file is read; null when it could not be read. */
  readonly read: Deferred<PairableFile | null>;
  /** The library asset this file ended up as (its own, or the one it duplicates). */
  readonly outcome: Deferred<AssetId | null>;
  /** Resolves when the item has left the prepare stage, either way. */
  readonly preparedSignal: Deferred<void>;
  /** The staging key this item wrote, to delete when it is finished with. */
  /** The interrupted import's record of this file, when it was chosen again; updated once it is in the library. */
  interruptedMatch: InterruptedMatch | null;
  /** The library's RAW this JPEG pairs with, from the interrupted import's record. */
  pairHint: AssetId | null;
  stagedKey: string | null;
  /** The staging key of this item's sidecar, deleted with the photo's copy. */
  sidecarKey: string | null;
  /** Chosen once, so a retried upload keeps its name. */
  destinationName: string | null;
  /** Upload attempts that failed and were retried. */
  attempts: number;
  /** Upload attempts the storage refused for sign-in, retried once there was a new token. */
  signInWaits: number;
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

/** An upload failure worth trying again, that is not a StorageError. */
class RetryableUpload extends Error {}

/** What a person is shown of an error (shown-message.ts). */
function errorMessage(error: unknown): string {
  return shownMessage(error, 'Import');
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
  readonly retryDelaysMs: readonly number[];
  readonly ownerId: string;
  readonly authorization: AuthorizationSignal | null;
  readonly specs: readonly WorkSpec[];
  /** Persisting the job record; work waits for it. */
  readonly saved: Promise<void>;
  /** The job's lock, released when it ends. */
  readonly claim: Promise<(() => void) | null>;
  /** What a reload left of earlier imports, for files chosen again (interrupted.ts); null when there is none. */
  readonly interrupted: Promise<InterruptedIndex | null>;
}

/** The recipe a preset gives a new version, or null when there is no such preset. */
function presetRecipe(session: LibrarySession, presetId: string | undefined): Recipe | null {
  if (presetId === undefined) return null;
  const preset = findPreset(session.getView().presets, presetId);
  return preset ? recipeFromPaths({ ...recipeToPaths(DEFAULT_RECIPE), ...preset.values }) : null;
}

function warn(what: string) {
  return (error: unknown) => console.warn(`Import: ${what}:`, error);
}

function jobRecord(setup: Omit<JobSetup, 'saved' | 'claim' | 'interrupted'>, items: readonly ImportItemRecord[]): ImportJobRecord {
  return {
    id: setup.jobId,
    libraryId: setup.session.libraryId,
    createdAt: setup.now().toISOString(),
    options: setup.options,
    recipe: setup.recipe,
    keywords: setup.keywords,
    albumId: setup.albumId,
    items,
    owner: setup.ownerId,
    heartbeatAt: setup.now().toISOString(),
  };
}

function newItemRecord(spec: WorkSpec, index: number): ImportItemRecord {
  return {
    ...(spec.settled ? { stagingKey: spec.settled.stagingKey, sidecarStaged: spec.sidecar !== null } : {}),
    index,
    fileName: spec.fileName,
    byteSize: spec.byteSize,
    lastModified: spec.lastModified,
    plannedAssetId: spec.assetId,
    sha256: spec.settled?.sha256 ?? null,
    state: spec.skipReason === null ? 'queued' : 'skipped',
    assetId: null,
    error: spec.skipReason,
    staged: spec.settled !== null,
    pairedWith: spec.settled?.pairedWith ?? null,
    folderSegments: spec.settled?.folderSegments ?? null,
    destinationName: spec.settled?.destinationName ?? null,
  };
}

export function startImport(files: readonly File[], ctx: ImportContext): ImportJob {
  const options: ImportOptions = { ...DEFAULT_IMPORT_OPTIONS, ...ctx.options };
  const now = ctx.now ?? (() => new Date());
  const applySidecars = options.applySidecars ?? true;
  const match = matchSidecars(files.map((f) => f.name));
  const specs: WorkSpec[] = files.map((file, index) => {
    let skipReason: string | null = null;
    if (isSidecarName(file.name)) {
      const image = match.imageFor.get(index);
      const imageName = image === null || image === undefined ? null : (files[image]?.name ?? null);
      if (imageName === null) skipReason = 'XMP sidecar with no matching photo';
      else skipReason = applySidecars ? `XMP sidecar, applied to ${imageName}` : `XMP sidecar for ${imageName}, not applied`;
    }
    const sidecarIndex = match.sidecarFor.get(index);
    return {
      content: file,
      fileName: file.name,
      byteSize: file.size,
      lastModified: file.lastModified,
      assetId: crypto.randomUUID(),
      settled: null,
      resumeError: null,
      sidecar: applySidecars && sidecarIndex !== undefined ? (files[sidecarIndex] ?? null) : null,
      skipReason,
    };
  });
  const base = {
    jobId: crypto.randomUUID(),
    session: ctx.session,
    previewRenderer: ctx.previewRenderer,
    options,
    now,
    recipe: ctx.recipe ?? presetRecipe(ctx.session, options.presetId),
    keywords: ctx.keywords ?? null,
    albumId: ctx.albumId ?? null,
    queueStore: ctx.queueStore ?? null,
    staging: ctx.staging ?? null,
    retryDelaysMs: ctx.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS,
    ownerId: ctx.ownerId ?? THIS_TAB,
    authorization: ctx.authorization ?? null,
    specs,
  };
  const store = base.queueStore && specs.length > 0 ? base.queueStore : null;
  // The lock is taken before the record is saved, so no resume can claim a job that is starting.
  const claim = store
    ? (ctx.locks ?? defaultImportLocks()).tryAcquire(importLockName(base.jobId)).catch((error: unknown) => {
        warn('taking the job lock')(error);
        return null;
      })
    : Promise.resolve(null);
  const saved = store
    ? claim.then(() => store.saveJob(jobRecord(base, specs.map(newItemRecord)))).catch(warn('saving the queue'))
    : Promise.resolve();
  const interrupted = store
    ? store.listJobs(base.session.libraryId).then(
        (records) => {
          const index = new InterruptedIndex(records);
          return index.size > 0 ? index : null;
        },
        (error: unknown) => {
          warn('reading interrupted imports')(error);
          return null;
        },
      )
    : Promise.resolve(null);
  return runJob({ ...base, saved, claim, interrupted });
}

/**
 * Continues the library's unfinished imports after a reload, as one new
 * job, from their staged copies. A job is claimed under its lock, so jobs
 * another tab (or this one) is running, or that an overlapping resume is
 * claiming, are left alone; where the locks do not span tabs, so is a job
 * whose heartbeat is younger than the lease. The claim itself is one
 * atomic swap in the queue. Items that never reached staging, or whose
 * staged copy is gone, cannot go on: they are not failed one by one but
 * kept, with the rest of their job, in one interrupted record
 * (interrupted.ts), for the person to choose them again. Null when
 * nothing can go on.
 */
export async function resumeImports(ctx: ResumeContext): Promise<ImportJob | null> {
  const locks = ctx.locks ?? defaultImportLocks();
  for (let attempt = 1; ; attempt++) {
    const job = await tryResume(ctx, locks);
    if (job !== 'conflict') return job;
    if (attempt >= CLAIM_ATTEMPTS) return null;
  }
}

async function tryResume(ctx: ResumeContext, locks: ImportLocks): Promise<ImportJob | null | 'conflict'> {
  const { session, queueStore } = ctx;
  const now = ctx.now ?? (() => new Date());
  const leaseMs = ctx.leaseMs ?? DEFAULT_LEASE_MS;
  const held = (record: ImportJobRecord) => {
    if (locks.acrossTabs || !record.owner || !record.heartbeatAt) return false;
    const age = now().getTime() - Date.parse(record.heartbeatAt);
    return Number.isFinite(age) && age < leaseMs;
  };
  const candidates = (await queueStore.listJobs(session.libraryId))
    .filter((record) => record.interrupted !== true && !held(record))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const releases: (() => void)[] = [];
  try {
    const records: ImportJobRecord[] = [];
    for (const record of candidates) {
      const release = await locks.tryAcquire(importLockName(record.id));
      if (!release) continue;
      releases.push(release);
      records.push(record);
    }
    return await claimRecords(ctx, locks, records, now);
  } finally {
    for (const release of releases) release();
  }
}

/** Builds the resumed job from `records`, whose locks are held, and swaps it in for them. */
async function claimRecords(
  ctx: ResumeContext,
  locks: ImportLocks,
  records: readonly ImportJobRecord[],
  now: () => Date,
): Promise<ImportJob | null | 'conflict'> {
  const { session, queueStore } = ctx;
  const specs: WorkSpec[] = [];
  let options: ImportOptions | null = null;
  let recipe: Recipe | null = null;
  let keywords: readonly string[] | null = null;
  let albumId: AlbumId | null = null;
  // Every file of these jobs, for the interrupted record when some of them cannot go on.
  const everything: ImportItemRecord[] = [];
  let lost = 0;
  for (const record of records) {
    for (const item of record.items) {
      if (TERMINAL.has(item.state)) {
        everything.push({ ...item, index: everything.length });
        continue;
      }
      options ??= record.options;
      recipe ??= record.recipe;
      keywords ??= record.keywords;
      albumId ??= record.albumId;
      let content: Blob | null = null;
      let sidecar: Blob | null = null;
      const stagingKey = item.stagingKey ?? item.sha256;
      if (item.sha256 !== null && stagingKey !== null && item.staged) {
        content = ctx.staging ? await ctx.staging.get(stagingKey).catch(() => null) : null;
        if (content && item.sidecarStaged && ctx.staging) {
          sidecar = await ctx.staging.get(sidecarStagingKey(stagingKey)).catch(() => null);
        }
      }
      // Never staged, or its copy is gone: the page held only the File, so only choosing it again can finish it.
      everything.push({ ...item, index: everything.length, needsFile: content === null });
      if (content === null) {
        lost++;
        continue;
      }
      specs.push({
        content,
        fileName: item.fileName,
        byteSize: item.byteSize,
        lastModified: item.lastModified,
        assetId: item.plannedAssetId,
        settled:
          item.sha256 === null || stagingKey === null
            ? null
            : {
                sha256: item.sha256,
                stagingKey,
                pairedWith: item.pairedWith,
                folderSegments: item.folderSegments,
                destinationName: item.destinationName,
              },
        resumeError: null,
        sidecar,
        skipReason: null,
      });
    }
  }
  // One summary for what a reload left: saved first, so a resume that loses its claim below can drop it again.
  const first = records[0];
  const interrupted: ImportJobRecord | null =
    lost > 0 && first
      ? {
          id: crypto.randomUUID(),
          libraryId: session.libraryId,
          createdAt: first.createdAt,
          options: first.options,
          recipe: first.recipe,
          keywords: first.keywords,
          albumId: first.albumId,
          items: everything,
          owner: null,
          heartbeatAt: null,
          interrupted: true,
        }
      : null;
  if (specs.length === 0) {
    if (interrupted) await queueStore.saveJob(interrupted);
    for (const record of records) await queueStore.deleteJob(record.id);
    return null;
  }
  if (interrupted) await queueStore.saveJob(interrupted);
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
    retryDelaysMs: ctx.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS,
    ownerId: ctx.ownerId ?? THIS_TAB,
    authorization: ctx.authorization ?? null,
    specs,
  };
  const release = await locks.tryAcquire(importLockName(base.jobId));
  const claimed = await queueStore.claimJobs(jobRecord(base, specs.map(newItemRecord)), records).catch(async (error: unknown) => {
    release?.();
    if (interrupted) await queueStore.deleteJob(interrupted.id).catch(warn('dropping an interrupted record'));
    throw error;
  });
  if (!claimed) {
    // Another resume claimed one of them between the listing and the lock, or its owner renewed it.
    release?.();
    if (interrupted) await queueStore.deleteJob(interrupted.id).catch(warn('dropping an interrupted record'));
    return 'conflict';
  }
  return runJob({ ...base, saved: Promise.resolve(), claim: Promise.resolve(release), interrupted: Promise.resolve(null) });
}

function runJob(setup: JobSetup): ImportJob {
  const { jobId, session, previewRenderer, options, now, queueStore, staging } = setup;
  const concurrency = Math.max(1, Math.floor(options.concurrency) || 1);
  const abort = new AbortController();
  let stopping: 'cancel' | 'pause' | null = null;
  let pauseReason = 'Paused';

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
    stagedKey: spec.settled && spec.content ? spec.settled.stagingKey : null,
    sidecarKey: spec.settled && spec.content && spec.sidecar ? sidecarStagingKey(spec.settled.stagingKey) : null,
    destinationName: spec.settled?.destinationName ?? null,
    attempts: 0,
    signInWaits: 0,
    interruptedMatch: null,
    pairHint: null,
  }));
  const worksByAssetId = new Map(works.map((w) => [w.assetId, w]));

  // Persistence, in order, after the job record is saved.
  let persisted: Promise<void> = setup.saved;
  // A file chosen again for an interrupted import: its record learns where it is in the library, so the summary counts it.
  for (const work of works) {
    void work.outcome.promise.then((assetId) => {
      const match = work.interruptedMatch;
      const store = queueStore;
      if (assetId === null || !match || !store) return;
      persisted = persisted
        .then(() => store.updateItem(match.recordId, match.item.index, { assetId, needsFile: false }))
        .catch(warn('updating an interrupted import'));
    });
  }
  const persist = (index: number, patch: Partial<ImportItemRecord>) => {
    const store = queueStore;
    if (!store) return;
    persisted = persisted.then(() => store.updateItem(jobId, index, patch)).catch(warn('updating the queue'));
    // Progress renews the lease too, so it holds while timers are throttled in a hidden tab.
    if (now().getTime() - renewedAt >= HEARTBEAT_MS) renew();
  };
  // The lease: other tabs leave this job alone while its heartbeat is fresh.
  let renewedAt = now().getTime();
  const renew = () => {
    const store = queueStore;
    if (!store) return;
    renewedAt = now().getTime();
    const at = now().toISOString();
    persisted = persisted.then(() => store.heartbeat(jobId, setup.ownerId, at)).catch(warn('renewing the lease'));
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
    notifyAll(listeners, 'an import');
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

  // Sign-in. A refused or expired token never fails a file: the work waits
  // until the storage's sign-in has a new token, and is then tried again.
  let needsSignIn = false;
  /** Counts the tokens taken since the job started, so work refused with an older one retries at once. */
  let authEpoch = 0;
  let signedIn = deferred<void>();
  const jobStopped = new Promise<void>((resolve) => abort.signal.addEventListener('abort', () => resolve(), { once: true }));
  const unsubscribeAuth =
    setup.authorization?.subscribe(() => {
      authEpoch++;
      const waiting = signedIn;
      signedIn = deferred<void>();
      waiting.resolve();
      if (needsSignIn) {
        needsSignIn = false;
        snapshot = null;
        notify();
      }
    }) ?? null;
  const isSignInRefused = (error: unknown) => isStorageError(error) && error.code === 'auth';
  /** Waits for a token newer than `since` (at once when one came meanwhile), or for the job to stop. */
  const waitForSignIn = async (since: number): Promise<void> => {
    if (authEpoch !== since) return;
    if (!needsSignIn) {
      needsSignIn = true;
      snapshot = null;
      notify();
    }
    await Promise.race([signedIn.promise, jobStopped]);
  };

  const unstage = async (work: Work) => {
    if (!staging) return;
    for (const key of [work.stagedKey, work.sidecarKey]) {
      if (key) await staging.delete(key).catch(warn('deleting a staged copy'));
    }
    work.stagedKey = null;
    work.sidecarKey = null;
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
  /**
   * Preparation stops only on cancel. A paused job still stages what it
   * has read, so a resume (after a reload too) can finish every item;
   * nothing is written to storage while paused.
   */
  const checkCancelled = () => {
    if (stopping === 'cancel') throw new Stopped();
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
  // them as stale until the engine renders the edit. They stand in for the
  // default recipe on this build's pipeline, so they record it: a later
  // pipeline renders them again, as it does every preview made before it.
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
      pipeline: PIPELINE_VERSION,
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
    if (setup.albumId !== null) {
      const albumId = setup.albumId;
      session.withoutLibraryHistory(() => session.setAlbumMember(albumId, added.assetId, true));
    }
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
   * the copy. Runs ahead of the uploads so a reload finds every file staged,
   * and goes on through a pause (`checkCancelled`) up to the staging.
   */
  const prepare = async (work: Work): Promise<Prepared | null> => {
    const { index } = work;
    await setup.saved;
    if (isTerminal(index)) return null;
    checkCancelled();
    if (work.skipReason !== null) {
      await endEarly(work, 'skipped', { error: work.skipReason }, null);
      return null;
    }
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
    if (work.settled === null) {
      // Chosen again after a reload interrupted its import: what the library has is not read again.
      const found = await setup.interrupted;
      const match = found?.take({ name: work.fileName, size: work.byteSize, lastModified: work.lastModified }, session.getView()) ?? null;
      if (match?.existing) {
        const asset = session.getView().assets.get(match.existing);
        if (asset) work.read.resolve({ id: String(index), name: work.fileName, format: asset.format, capturedAt: asset.capturedAt });
        await endEarly(work, 'duplicate', { assetId: match.existing }, match.existing);
        return null;
      }
      work.interruptedMatch = match;
      work.pairHint = match?.pairedWith ?? null;
      const planned = match?.item.plannedAssetId;
      if (planned !== undefined && !session.getView().assets.has(planned) && !worksByAssetId.has(planned)) {
        // The interrupted import's own id: an upload of it that reached Drive after all is found by its tags
        // (findStoredOriginal), and one Drive holds part of goes on from there (the resume key), never a second copy.
        worksByAssetId.delete(work.assetId);
        work.assetId = planned;
        worksByAssetId.set(planned, work);
        persist(index, { plannedAssetId: planned });
      }
    }
    patch(index, { state: 'reading', error: null });

    if (work.byteSize > MAX_ORIGINAL_BYTES) {
      await endEarly(work, 'unsupported', { error: 'Larger than 1 GB' }, null);
      return null;
    }
    const bytes = new Uint8Array(await work.content.arrayBuffer());
    const sha = await sha256Hex(bytes);
    checkCancelled();
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
        const note = work.sidecar ? await applySidecarToExisting(session, existing, work.sidecar) : null;
        await endEarly(work, 'duplicate', { assetId: existing, ...(note ? { error: note } : {}) }, existing);
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

    let pairCandidate: AssetId | null = work.settled?.pairedWith ?? work.pairHint;
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
    checkCancelled();

    const fallback = work.lastModified > 0 ? new Date(work.lastModified) : now();
    const segments = work.settled?.folderSegments ?? originalsFolderSegments(metadata.capturedAt, fallback);

    let unstagedNote: string | null = null;
    if (staging && work.stagedKey === null && earlierCopy === null) {
      const room = await staging.hasRoomFor(work.byteSize).catch(() => false);
      if (room) {
        try {
          const key = itemStagingKey(jobId, index);
          await staging.put(key, work.content);
          work.stagedKey = key;
          if (work.sidecar) {
            await staging.put(sidecarStagingKey(key), work.sidecar);
            work.sidecarKey = sidecarStagingKey(key);
          }
        } catch (error) {
          warn('staging a file')(error);
        }
      }
      if (work.stagedKey === null) unstagedNote = 'Not staged on this device: closing the tab stops this upload';
    }
    persist(index, {
      ...(work.stagedKey !== null ? { stagingKey: work.stagedKey } : {}),
      staged: work.stagedKey !== null,
      sidecarStaged: work.sidecarKey !== null,
      pairedWith: pairCandidate,
      folderSegments: segments,
    });
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
    let stored = work.settled || work.attempts > 0 || work.signInWaits > 0 || work.interruptedMatch !== null ? await findStoredOriginal(work, sha) : null;
    if (!stored) {
      let name = work.destinationName;
      if (name === null) name = await reserveName(folderId, work.fileName);
      else (await folderNames(folderId)).add(name);
      work.destinationName = name;
      persist(index, { destinationName: name });
      checkStopped();
      const newFile = {
        parentId: folderId,
        name,
        mimeType: metadata.mimeType,
        properties: { 'lp.lib': session.libraryId, 'lp.role': 'original', 'lp.asset': work.assetId, 'lp.sha': sha },
      };
      const onProgress = (sentBytes: number) => patch(index, { sentBytes }, false);
      stored = await session.adapter.createFile(newFile, content, {
        signal: abort.signal,
        resumeKey: uploadResumeKey(session.libraryId, work.assetId),
        onProgress,
      });
      if (stored.trashed || stored.properties['lp.asset'] !== work.assetId) {
        // A resumed session handed back some other upload: start this one afresh.
        stored = await session.adapter.createFile(newFile, content, { signal: abort.signal, onProgress });
      }
    }

    setState(work, 'verifying', { sentBytes: work.byteSize });
    if (stored.sha256 !== null && stored.sha256.toLowerCase() !== sha) {
      await session.adapter.trash(stored.id).catch(() => undefined);
      throw new RetryableUpload('Checksum mismatch: the stored copy differs from the file');
    }

    // The original is safely stored: from here the item completes even if stopped, so no stored file is left without its asset.
    let added: { assetId: AssetId; versionId: VersionId };
    try {
      added = addToLibrary(work, metadata, sha, stored.id, pairedWith);
    } catch (error) {
      // The library cannot be written (read-only, or taken over by another tab): keep everything staged and stop.
      pauseReason = `Paused: the library could not be updated (${errorMessage(error)})`;
      stop(queueStore ? 'pause' : 'cancel');
      throw new Stopped();
    }
    const { assetId, versionId } = added;
    // Only now, with the checksum verified and the asset saved in the library on this device, is the staged copy let go.
    // If that save fails the copy stays staged, so a reload can still finish the import.
    if (await session.whenDurable().then(() => true, warn('saving the new photo on this device'))) await unstage(work);
    let note = previews.error;
    if (work.sidecar) {
      const applied = await applySidecarFile(session, assetId, versionId, work.sidecar, metadata.orientation).catch(() => null);
      if (!applied) note = 'Its XMP sidecar could not be read';
    }
    for (const size of ['thumb', 'screen'] as const) {
      const preview = previews[size];
      if (!preview) continue;
      // A preview refused for sign-in waits for the new token like the original did.
      for (;;) {
        if (stopping) break;
        const epoch = authEpoch;
        try {
          await uploadPreview(assetId, versionId, size, preview);
          break;
        } catch (error) {
          if (isSignInRefused(error)) {
            await waitForSignIn(epoch);
            continue;
          }
          note = `Preview not uploaded: ${errorMessage(error)}`;
          break;
        }
      }
    }
    await finish(work, 'done', { assetId, error: note });
    return assetId;
  };

  const isStopped = (error: unknown) =>
    error instanceof Stopped || (isStorageError(error) && error.code === 'aborted') || stopping !== null;

  const failed = async (work: Work, error: unknown) => {
    const stopped = isStopped(error);
    if (stopped && stopping === 'pause') {
      patch(work.index, { state: 'queued', sentBytes: 0, error: pauseReason });
    } else {
      await finish(work, 'failed', { error: stopped ? 'Cancelled' : errorMessage(error) });
    }
  };

  /**
   * An upload that failed for a reason other than stopping: the staged copy
   * is kept and the item stays unfinished, waiting for a resume.
   */
  const park = (work: Work, error: unknown) => {
    const note = `Waiting to retry: ${errorMessage(error)}`;
    patch(work.index, { state: 'queued', sentBytes: 0, error: note });
    persist(work.index, { state: 'queued', error: note });
  };

  /** Worth retrying soon: dropped connections, rate limits, server errors, a bad checksum. (Sign-in waits for a token instead.) */
  const retryable = (error: unknown) => error instanceof RetryableUpload || (isStorageError(error) && error.retryable);

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      abort.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });

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
        for (;;) {
          if (stopping) throw new Stopped();
          const epoch = authEpoch;
          try {
            outcome = await upload(work, prep);
            break;
          } catch (error) {
            if (isStopped(error)) throw error;
            if (isSignInRefused(error)) {
              // Not a failure and not an attempt: the item waits for a token, then goes on from where it
              // stood (a resumable upload continues from Drive's offset; a finished one is found by its tags).
              work.signInWaits++;
              patch(work.index, { state: work.stagedKey !== null ? 'staged' : 'queued', sentBytes: 0, error: null });
              await waitForSignIn(epoch);
              continue;
            }
            const delay = setup.retryDelaysMs[work.attempts];
            if (!retryable(error) || delay === undefined) {
              park(work, error);
              break;
            }
            work.attempts++;
            patch(work.index, { state: 'uploading', error: `Retrying in ${Math.round(delay / 1000)} s: ${errorMessage(error)}` });
            await sleep(delay);
          }
        }
      } catch (error) {
        await failed(work, error);
      } finally {
        work.outcome.resolve(outcome);
      }
    }
  };

  const getProgress = (): ImportProgress => {
    if (!snapshot) snapshot = { items: items.slice(), finished, needsSignIn: needsSignIn && !finished };
    return snapshot;
  };

  const heartbeat = queueStore ? setInterval(renew, HEARTBEAT_MS) : null;

  const workerCount = Math.min(concurrency, works.length);
  const preparers = Promise.all(Array.from({ length: workerCount }, preparer)).then(() => {
    preparing = false;
    wake();
  });
  const uploaders = Promise.all(Array.from({ length: workerCount }, uploader));
  const done = Promise.all([preparers, uploaders]).then(async () => {
    if (heartbeat !== null) clearInterval(heartbeat);
    unsubscribeAuth?.();
    await persisted;
    if (queueStore && works.length > 0) {
      if (works.every((w) => isTerminal(w.index))) await queueStore.deleteJob(jobId).catch(warn('clearing the queue'));
      else await queueStore.heartbeat(jobId, null, now().toISOString()).catch(warn('releasing the lease'));
    }
    (await setup.claim)?.();
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
