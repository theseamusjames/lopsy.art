import type { SparseLayerEntry } from '../app/store/types';

/**
 * Layer pixel data — dense ImageData, sparse RLE, and per-layer change
 * versioning.
 *
 * Lives outside the Zustand store so the "GPU is the source of truth"
 * invariant from CLAUDE.md is enforceable: the JS cache here is an
 * optimization, not application state. Anything that used to subscribe
 * to the store's `layerPixelData` / `sparseLayerData` Maps now subscribes
 * to the per-layer version counter via `usePixelDataVersion`.
 *
 * Mutations always bump:
 *   - the affected layer's version (per-layer subscribers)
 *   - the global version (any `useSyncExternalStore` watcher)
 * and fire the listener set so non-React code (engine-sync, etc.) can
 * observe changes.
 */
export class PixelDataManager {
  private pixelData = new Map<string, ImageData>();
  private sparseData = new Map<string, SparseLayerEntry>();
  private layerVersions = new Map<string, number>();
  private globalVersion = 0;
  private listeners = new Set<() => void>();

  // ─── Reads ─────────────────────────────────────────────────────────

  get(layerId: string): ImageData | undefined {
    return this.pixelData.get(layerId);
  }

  getSparse(layerId: string): SparseLayerEntry | undefined {
    return this.sparseData.get(layerId);
  }

  hasDense(layerId: string): boolean {
    return this.pixelData.has(layerId);
  }

  hasSparse(layerId: string): boolean {
    return this.sparseData.has(layerId);
  }

  /** Per-layer monotonic version. Increments on every mutation involving
   *  this layer. Useful as a useEffect dep or useSyncExternalStore snapshot. */
  versionOf(layerId: string): number {
    return this.layerVersions.get(layerId) ?? 0;
  }

  /** Global version, bumped on every mutation to any layer. */
  version(): number {
    return this.globalVersion;
  }

  /** Read-only view of the dense map — for engine-sync and export paths
   *  that currently iterate all entries. Callers must not mutate. */
  denseMap(): ReadonlyMap<string, ImageData> {
    return this.pixelData;
  }

  sparseMap(): ReadonlyMap<string, SparseLayerEntry> {
    return this.sparseData;
  }

  // ─── Writes ────────────────────────────────────────────────────────

  /** Store dense pixel data for a layer. Any sparse entry for the same
   *  layer is dropped — the two are mutually exclusive. */
  setDense(layerId: string, data: ImageData): void {
    this.pixelData.set(layerId, data);
    this.sparseData.delete(layerId);
    this.bump(layerId);
  }

  setSparse(layerId: string, entry: SparseLayerEntry): void {
    this.sparseData.set(layerId, entry);
    this.pixelData.delete(layerId);
    this.bump(layerId);
  }

  /** Remove any data (dense or sparse) for a layer. */
  remove(layerId: string): void {
    const hadDense = this.pixelData.delete(layerId);
    const hadSparse = this.sparseData.delete(layerId);
    if (hadDense || hadSparse) this.bump(layerId);
  }

  /** Drop the dense entry but keep any sparse entry. Used after a
   *  sparsify pass when the dense ImageData is no longer needed. */
  removeDense(layerId: string): void {
    if (this.pixelData.delete(layerId)) this.bump(layerId);
  }

  /** Wholesale replacement — used when restoring a history snapshot or
   *  loading a new document. Clears everything and re-populates atomically
   *  (single notify). */
  replace(dense: Map<string, ImageData>, sparse: Map<string, SparseLayerEntry>): void {
    this.pixelData = new Map(dense);
    this.sparseData = new Map(sparse);
    // All layers versioned together — easiest way is to bump everything.
    for (const id of this.pixelData.keys()) {
      this.layerVersions.set(id, (this.layerVersions.get(id) ?? 0) + 1);
    }
    for (const id of this.sparseData.keys()) {
      this.layerVersions.set(id, (this.layerVersions.get(id) ?? 0) + 1);
    }
    this.globalVersion++;
    this.notify();
  }

  /** Drop every layer's data. Used on document create/open. */
  clearAll(): void {
    if (this.pixelData.size === 0 && this.sparseData.size === 0) return;
    this.pixelData.clear();
    this.sparseData.clear();
    // Don't reset versionOf — callers watching a specific layer should see
    // the cleanup bump, not a silent rewind to zero.
    const touched = new Set<string>();
    for (const id of this.layerVersions.keys()) touched.add(id);
    for (const id of touched) {
      this.layerVersions.set(id, (this.layerVersions.get(id) ?? 0) + 1);
    }
    this.globalVersion++;
    this.notify();
  }

  // ─── Subscriptions ─────────────────────────────────────────────────

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private bump(layerId: string): void {
    this.layerVersions.set(layerId, (this.layerVersions.get(layerId) ?? 0) + 1);
    this.globalVersion++;
    this.notify();
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

/** Process-wide singleton. Matches the single-engine singleton in
 *  engine-state.ts — there's exactly one active document at a time. */
export const pixelDataManager = new PixelDataManager();
