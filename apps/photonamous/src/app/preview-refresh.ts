/**
 * Keeps every version's previews in step with its recipe (spec 6.9), for
 * edits made outside the Edit view: a preset or a paste from the grid, a
 * new version, a change synced from another device. A version is stale
 * when its thumb or screen preview is not current (`isPreviewCurrent`):
 * missing, rendered from another recipe (its `recipeHash`), or rendered by
 * an older pipeline than this build's.
 *
 * Stale versions are rendered one at a time in the background. Repeated
 * changes to one version coalesce to its latest hash; a render whose hash
 * went out of date is cancelled; a version whose recipe matches another
 * version of the same photo that has current previews reuses those files.
 * Nothing runs while the Edit view is open (it owns the GPU).
 */

import { isDevelopable } from '../library/develop-source';
import { isPreviewCurrent } from '@lopsy/photos-core/library/pipeline';
import { recipeHash, type Recipe } from '@lopsy/photos-core/library/recipe';
import type { Asset, LibraryView, PreviewRef, Version, VersionId } from '@lopsy/photos-core/library/types';
import type { EditPreviews } from './backend';

export interface PreviewTarget {
  readonly versionId: VersionId;
  readonly hash: string;
}

const hashes = new WeakMap<Recipe, string>();

/** recipeHash, remembered per recipe object (recipes are immutable values in the view). */
export function cachedRecipeHash(recipe: Recipe): string {
  let hash = hashes.get(recipe);
  if (hash === undefined) {
    hash = recipeHash(recipe);
    hashes.set(recipe, hash);
  }
  return hash;
}

function renderable(asset: Asset | undefined): asset is Asset {
  if (asset === undefined || asset.deleted) return false;
  // A Lopsy document renders from its flattened render (developSource).
  if (asset.kind === 'document') return isDevelopable(asset);
  return asset.kind === 'original' && asset.originalStatus !== 'missing';
}

export function isStale(version: Version, hash: string): boolean {
  return !isPreviewCurrent(version.thumb, version, hash) || !isPreviewCurrent(version.screen, version, hash);
}

/** Whether a version's previews are behind its recipe and can be made again. */
export function awaitsPreviews(view: LibraryView, version: Version, hashOf: (recipe: Recipe) => string = cachedRecipeHash): boolean {
  return !version.deleted && renderable(view.assets.get(version.assetId)) && isStale(version, hashOf(version.recipe));
}

/** Versions whose previews do not show their recipe. */
export function staleVersions(view: LibraryView, hashOf: (recipe: Recipe) => string = cachedRecipeHash): PreviewTarget[] {
  const targets: PreviewTarget[] = [];
  for (const version of view.versions.values()) {
    if (awaitsPreviews(view, version, hashOf)) targets.push({ versionId: version.id, hash: hashOf(version.recipe) });
  }
  return targets;
}

/** Current previews of another version of the same photo with the same recipe, to point at instead of rendering. */
export function reusablePreviews(
  view: LibraryView,
  target: PreviewTarget,
): { readonly thumb: PreviewRef; readonly screen: PreviewRef } | null {
  const version = view.versions.get(target.versionId);
  if (!version) return null;
  for (const other of view.versions.values()) {
    if (other.id === version.id || other.deleted || other.assetId !== version.assetId) continue;
    // Only previews current for this version: the same recipe, rendered by this build's pipeline.
    if (other.thumb && other.screen && isPreviewCurrent(other.thumb, version, target.hash) && isPreviewCurrent(other.screen, version, target.hash)) {
      return { thumb: other.thumb, screen: other.screen };
    }
  }
  return null;
}

export interface PreviewRefreshProgress {
  /** Versions waiting for new previews, the one rendering included. */
  readonly pending: number;
  readonly paused: boolean;
  /** Versions whose render failed for their current recipe; tried again when it changes. */
  readonly failed: number;
}

export interface PreviewRefresherOptions {
  readonly source: { getView(): LibraryView; subscribe(listener: () => void): () => void };
  readonly render: (asset: Asset, version: Version, signal: AbortSignal) => Promise<{ readonly thumb: Blob; readonly screen: Blob }>;
  readonly store: (versionId: VersionId, previews: EditPreviews) => Promise<void>;
  readonly reuse: (versionId: VersionId, thumb: PreviewRef, screen: PreviewRef) => void;
  /** True while the Edit view is open; call `refresh()` when it changes. */
  readonly isPaused: () => boolean;
  readonly hashOf?: (recipe: Recipe) => string;
  /** Defers background work; by default to the next idle moment. */
  readonly schedule?: (task: () => void) => void;
}

function defaultSchedule(task: () => void): void {
  const idle: unknown = Reflect.get(globalThis, 'requestIdleCallback');
  if (typeof idle === 'function') Reflect.apply(idle, globalThis, [task, { timeout: 1000 }]);
  else setTimeout(task, 0);
}

export class PreviewRefresher {
  private readonly pending = new Map<VersionId, string>();
  private readonly failed = new Map<VersionId, string>();
  private current: { readonly target: PreviewTarget; readonly controller: AbortController } | null = null;
  private readonly listeners = new Set<() => void>();
  private progress: PreviewRefreshProgress = { pending: 0, paused: false, failed: 0 };
  private unsubscribe: (() => void) | null = null;
  private scanQueued = false;
  private pumpQueued = false;
  private stopped = false;
  private readonly hashOf: (recipe: Recipe) => string;
  private readonly schedule: (task: () => void) => void;

  constructor(private readonly options: PreviewRefresherOptions) {
    this.hashOf = options.hashOf ?? cachedRecipeHash;
    this.schedule = options.schedule ?? defaultSchedule;
  }

  start(): void {
    this.stopped = false;
    this.unsubscribe ??= this.options.source.subscribe(() => this.queueScan());
    this.queueScan();
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.current?.controller.abort();
    this.pending.clear();
    this.update();
  }

  /** Re-reads the pause state and the library; call when the Edit view opens or closes. */
  refresh(): void {
    if (this.options.isPaused()) this.current?.controller.abort();
    this.queueScan();
  }

  getProgress(): PreviewRefreshProgress {
    return this.progress;
  }

  /** Whether the render of this version's previews failed for the recipe it has now (it is not tried again until that changes). */
  hasFailed(versionId: VersionId): boolean {
    return this.failed.has(versionId);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Runs a scan now (tests; the app scans on every library change). */
  scanNow(): void {
    this.scanQueued = false;
    if (this.stopped) return;
    const targets = staleVersions(this.options.source.getView(), this.hashOf);
    const wanted = new Map(targets.map((target) => [target.versionId, target.hash]));
    this.pending.clear();
    for (const [versionId, hash] of wanted) {
      if (this.failed.get(versionId) === hash) continue;
      if (this.current?.target.versionId === versionId && this.current.target.hash === hash) continue;
      this.pending.set(versionId, hash);
    }
    for (const versionId of [...this.failed.keys()]) {
      if (wanted.get(versionId) !== this.failed.get(versionId)) this.failed.delete(versionId);
    }
    // A render for a hash the version has moved on from is wasted work.
    if (this.current && wanted.get(this.current.target.versionId) !== this.current.target.hash) this.current.controller.abort();
    this.update();
    this.queuePump();
  }

  private queueScan(): void {
    if (this.scanQueued || this.stopped) return;
    this.scanQueued = true;
    this.schedule(() => this.scanNow());
  }

  private queuePump(): void {
    if (this.pumpQueued || this.current || this.stopped) return;
    this.pumpQueued = true;
    this.schedule(() => {
      this.pumpQueued = false;
      void this.pump();
    });
  }

  private update(): void {
    this.progress = {
      pending: this.pending.size + (this.current ? 1 : 0),
      paused: this.options.isPaused(),
      failed: this.failed.size,
    };
    for (const listener of this.listeners) listener();
  }

  /** Renders (or reuses) the next stale version, then schedules the one after. */
  async pump(): Promise<void> {
    if (this.current || this.stopped || this.options.isPaused()) {
      this.update();
      return;
    }
    const next = this.pending.entries().next();
    if (next.done) return;
    const [versionId, hash] = next.value;
    this.pending.delete(versionId);
    const target: PreviewTarget = { versionId, hash };
    const controller = new AbortController();
    this.current = { target, controller };
    this.update();
    try {
      await this.refreshOne(target, controller.signal);
    } catch {
      if (!controller.signal.aborted) this.failed.set(versionId, hash);
    } finally {
      this.current = null;
      if (controller.signal.aborted && !this.stopped) this.queueScan();
      this.update();
      this.queuePump();
    }
  }

  private async refreshOne(target: PreviewTarget, signal: AbortSignal): Promise<void> {
    const view = this.options.source.getView();
    const version = view.versions.get(target.versionId);
    const asset = version ? view.assets.get(version.assetId) : undefined;
    if (!version || !renderable(asset) || this.hashOf(version.recipe) !== target.hash || !isStale(version, target.hash)) return;
    const shared = reusablePreviews(view, target);
    if (shared) {
      this.options.reuse(target.versionId, shared.thumb, shared.screen);
      return;
    }
    const rendered = await this.options.render(asset, version, signal);
    if (signal.aborted) return;
    const now = this.options.source.getView().versions.get(target.versionId);
    if (!now || this.hashOf(now.recipe) !== target.hash) return;
    await this.options.store(target.versionId, { thumb: rendered.thumb, screen: rendered.screen, recipeHash: target.hash });
    const after = this.options.source.getView().versions.get(target.versionId);
    // Stored but still stale (the library refused the change): do not render it again in a loop.
    if (after && this.hashOf(after.recipe) === target.hash && isStale(after, target.hash)) throw new Error('The previews were not recorded');
  }
}
