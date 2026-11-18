/**
 * DEVELOPMENT DOUBLE. An in-memory `LibrarySession` that behaves enough
 * like the real one to drive the UI: marks, keywords, albums, versions,
 * recipe history and a sync status that ticks. Nothing is stored.
 */

import type {
  Album,
  AlbumId,
  Asset,
  AssetId,
  AssetMarks,
  ExportPreset,
  ExportPresetId,
  HistoryStep,
  Json,
  LibraryLayout,
  LibrarySession,
  LibraryView,
  NewAsset,
  OriginalStatus,
  Preset,
  PresetId,
  PreviewRef,
  SyncStatus,
  Version,
  VersionId,
} from '@lopsy/photos-core/library/types';
import {
  DEFAULT_RECIPE,
  isRecipeGroupId,
  pickGroups,
  recipeFromPaths,
  recipeHash,
  recipeToPaths,
  sanitizeRecipeValues,
  type Recipe,
  type RecipeGroupId,
} from '@lopsy/photos-core/library/recipe';
import { exportSettingsFromJson, exportSettingsProblem, type ExportSettings } from '@lopsy/photos-core/export/types';
import { BUILT_IN_PREFIX } from '@lopsy/photos-core/library/presets';
import type { StorageAdapter, StorageKind } from '@lopsy/photos-core/storage/types';

let counter = 0;
export function fakeId(prefix: string): string {
  counter++;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

function unsupported(): Promise<never> {
  return Promise.reject(new Error('The development backend has no real storage.'));
}

function fakeAdapter(kind: StorageKind, label: string, usedBytes: () => number): StorageAdapter {
  return {
    kind,
    label,
    getRoot: unsupported,
    createFolder: unsupported,
    createFile: unsupported,
    updateContent: unsupported,
    updateProperties: unsupported,
    move: unsupported,
    getFile: unsupported,
    readContent: unsupported,
    listChildren: unsupported,
    findByProperty: unsupported,
    trash: () => Promise.resolve(),
    untrash: () => Promise.resolve(),
    deletePermanently: unsupported,
    getChangeCursor: unsupported,
    listChanges: unsupported,
    getQuota: () => {
      const used = usedBytes();
      // A large seeded library gets a bigger plan, so the fake is not always full.
      const limit = used < 12_000_000_000 ? 15_000_000_000 : Math.ceil((used * 1.5) / 1e11) * 1e11;
      return Promise.resolve({ usedBytes: used, limitBytes: limit });
    },
  };
}

interface RecipeStep extends HistoryStep {
  readonly before: Recipe;
  readonly after: Recipe;
}

/** The preview file ids the fake hands out; fake-previews.ts renders them. */
export function fakePreviewRef(assetId: AssetId, size: 'thumb' | 'screen', recipe: Recipe, aspect: number): PreviewRef {
  const edge = size === 'thumb' ? 512 : 2048;
  const width = aspect >= 1 ? edge : Math.round(edge * aspect);
  const height = aspect >= 1 ? Math.round(edge / aspect) : edge;
  return { fileId: `fake-preview:${assetId}:${size}`, recipeHash: recipeHash(recipe), width, height };
}

export class FakeSession implements LibrarySession {
  readonly libraryId = fakeId('library');
  readonly deviceId = fakeId('device');
  readonly layout: LibraryLayout;
  readonly adapter: StorageAdapter;

  private assets = new Map<AssetId, Asset>();
  private versions = new Map<VersionId, Version>();
  private albums = new Map<AlbumId, Album>();
  private settings = new Map<string, Json>();
  private presets = new Map<PresetId, Preset>();
  private exportPresets = new Map<ExportPresetId, ExportPreset>();
  private steps = new Map<VersionId, RecipeStep[]>();
  private view: LibraryView | null = null;
  private listeners = new Set<() => void>();
  private syncListeners = new Set<() => void>();
  private status: SyncStatus = { state: 'idle', pendingOps: 0, lastSyncedAt: new Date().toISOString(), error: null };
  private timer: ReturnType<typeof setInterval>;

  constructor(kind: StorageKind, label: string) {
    this.adapter = fakeAdapter(kind, label, () => {
      let used = 0;
      for (const a of this.assets.values()) if (!a.deleted) used += a.byteSize;
      return used;
    });
    const ids = ['root', 'originals', 'documents', 'exports', 'data', 'journal', 'snapshots', 'previews', 'devices'];
    const [rootId = '', originalsId = '', documentsId = '', exportsId = '', dataId = '', journalId = '', snapshotsId = '', previewsId = '', devicesId = ''] =
      ids.map((n) => `fake-folder:${n}`);
    this.layout = { libraryId: this.libraryId, rootId, originalsId, documentsId, exportsId, dataId, journalId, snapshotsId, previewsId, devicesId };
    this.timer = setInterval(() => this.tickSync(), 2500);
  }

  getView(): LibraryView {
    if (this.view === null) {
      this.view = {
        assets: new Map(this.assets),
        versions: new Map(this.versions),
        albums: new Map(this.albums),
        settings: new Map(this.settings),
        presets: new Map(this.presets),
        exportPresets: new Map(this.exportPresets),
      };
    }
    return this.view;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Every change goes through here: new view, one more pending op. */
  private changed(ops = 1): void {
    this.view = null;
    for (const l of this.listeners) l();
    this.setStatus({ ...this.status, pendingOps: this.status.pendingOps + ops });
  }

  private patchAssets(ids: readonly AssetId[], patch: (a: Asset) => Asset): void {
    let n = 0;
    for (const id of ids) {
      const a = this.assets.get(id);
      if (!a) continue;
      this.assets.set(id, patch(a));
      n++;
    }
    if (n > 0) this.changed(n);
  }

  addAsset(asset: NewAsset): { assetId: AssetId; versionId: VersionId } {
    const assetId = asset.id ?? fakeId('asset');
    const versionId = fakeId('version');
    const aspect = asset.width && asset.height ? asset.width / asset.height : 1.5;
    const recipe = asset.recipe ?? DEFAULT_RECIPE;
    const { marks, keywords, recipe: _recipe, id: _id, ...facts } = asset;
    this.assets.set(assetId, {
      ...facts,
      id: assetId,
      rating: marks?.rating ?? 0,
      label: marks?.label ?? null,
      setAside: marks?.setAside ?? false,
      title: marks?.title ?? '',
      caption: marks?.caption ?? '',
      keywords: [...(keywords ?? [])],
      primaryVersionId: versionId,
      deleted: false,
    });
    this.versions.set(versionId, {
      id: versionId,
      assetId,
      name: 'Original',
      recipe,
      createdAt: asset.importedAt,
      thumb: fakePreviewRef(assetId, 'thumb', recipe, aspect),
      screen: fakePreviewRef(assetId, 'screen', recipe, aspect),
      deleted: false,
    });
    this.changed();
    return { assetId, versionId };
  }

  /** Fake-only: links the halves of a RAW+JPEG pair (the real import sets this at addAsset). */
  linkPair(a: AssetId, b: AssetId): void {
    this.patchAssets([a], (x) => ({ ...x, pairedWith: b }));
    this.patchAssets([b], (x) => ({ ...x, pairedWith: a }));
  }

  setMarks(assetIds: readonly AssetId[], marks: Partial<AssetMarks>): void {
    this.patchAssets(assetIds, (a) => ({ ...a, ...marks }));
  }

  /** Fake-only: what a repair would record. */
  setOriginalStatus(assetIds: readonly AssetId[], status: OriginalStatus): void {
    this.patchAssets(assetIds, (a) => ({ ...a, originalStatus: status }));
  }

  setKeyword(assetIds: readonly AssetId[], keyword: string, present: boolean): void {
    const k = keyword.trim();
    if (k === '') return;
    this.patchAssets(assetIds, (a) => ({
      ...a,
      keywords: present ? (a.keywords.includes(k) ? a.keywords : [...a.keywords, k]) : a.keywords.filter((x) => x !== k),
    }));
  }

  deleteAssets(assetIds: readonly AssetId[]): void {
    this.patchAssets(assetIds, (a) => ({ ...a, deleted: true }));
  }

  restoreAssets(assetIds: readonly AssetId[]): void {
    this.patchAssets(assetIds, (a) => ({ ...a, deleted: false }));
  }

  createVersion(assetId: AssetId, name: string, recipe: Recipe = DEFAULT_RECIPE): VersionId {
    const asset = this.assets.get(assetId);
    const id = fakeId('version');
    const aspect = asset?.width && asset.height ? asset.width / asset.height : 1.5;
    this.versions.set(id, {
      id,
      assetId,
      name,
      recipe,
      createdAt: new Date().toISOString(),
      thumb: fakePreviewRef(assetId, 'thumb', recipe, aspect),
      screen: fakePreviewRef(assetId, 'screen', recipe, aspect),
      deleted: false,
    });
    this.changed();
    return id;
  }

  private patchVersion(id: VersionId, patch: (v: Version) => Version): void {
    const v = this.versions.get(id);
    if (!v) return;
    this.versions.set(id, patch(v));
    this.changed();
  }

  renameVersion(versionId: VersionId, name: string): void {
    this.patchVersion(versionId, (v) => ({ ...v, name }));
  }

  deleteVersion(versionId: VersionId): void {
    this.patchVersion(versionId, (v) => ({ ...v, deleted: true }));
  }

  editRecipe(versionId: VersionId, changes: Readonly<Record<string, Json>>, label: string): void {
    const v = this.versions.get(versionId);
    if (!v) return;
    this.setRecipe(versionId, recipeFromPaths({ ...recipeToPaths(v.recipe), ...changes }), label);
  }

  setRecipe(versionId: VersionId, recipe: Recipe, label: string): void {
    const v = this.versions.get(versionId);
    if (!v) return;
    const kept = (this.steps.get(versionId) ?? []).filter((s) => s.active);
    kept.push({ id: fakeId('step'), label, hlc: new Date().toISOString(), active: true, before: v.recipe, after: recipe });
    this.steps.set(versionId, kept);
    this.patchVersion(versionId, (x) => ({ ...x, recipe }));
  }

  setPreview(versionId: VersionId, size: 'thumb' | 'screen', preview: PreviewRef): void {
    this.patchVersion(versionId, (v) => ({ ...v, [size]: preview }));
  }

  undo(versionId: VersionId): boolean {
    const steps = this.steps.get(versionId) ?? [];
    const i = steps.map((s) => s.active).lastIndexOf(true);
    const step = steps[i];
    if (!step) return false;
    steps[i] = { ...step, active: false };
    this.patchVersion(versionId, (v) => ({ ...v, recipe: step.before }));
    return true;
  }

  redo(versionId: VersionId): boolean {
    const steps = this.steps.get(versionId) ?? [];
    const i = steps.findIndex((s) => !s.active);
    const step = steps[i];
    if (!step) return false;
    steps[i] = { ...step, active: true };
    this.patchVersion(versionId, (v) => ({ ...v, recipe: step.after }));
    return true;
  }

  history(versionId: VersionId): readonly HistoryStep[] {
    return (this.steps.get(versionId) ?? []).map(({ id, label, hlc, active }) => ({ id, label, hlc, active }));
  }

  createAlbum(name: string): AlbumId {
    const id = fakeId('album');
    this.albums.set(id, { id, name, assetIds: [], deleted: false });
    this.changed();
    return id;
  }

  private patchAlbum(id: AlbumId, patch: (a: Album) => Album): void {
    const a = this.albums.get(id);
    if (!a) return;
    this.albums.set(id, patch(a));
    this.changed();
  }

  renameAlbum(albumId: AlbumId, name: string): void {
    this.patchAlbum(albumId, (a) => ({ ...a, name }));
  }

  deleteAlbum(albumId: AlbumId): void {
    this.patchAlbum(albumId, (a) => ({ ...a, deleted: true }));
  }

  setAlbumMember(albumId: AlbumId, assetId: AssetId, present: boolean): void {
    this.patchAlbum(albumId, (a) => {
      const has = a.assetIds.includes(assetId);
      if (has === present) return a;
      return { ...a, assetIds: present ? [...a.assetIds, assetId] : a.assetIds.filter((x) => x !== assetId) };
    });
  }

  setSetting(key: string, value: Json): void {
    this.settings.set(key, value);
    this.changed();
  }

  applyRecipeValues(versionIds: readonly VersionId[], values: Readonly<Record<string, Json>>, label: string): void {
    const clean = sanitizeRecipeValues(values);
    if (Object.keys(clean).length === 0) return;
    for (const id of new Set(versionIds)) this.editRecipe(id, clean, label);
  }

  savePreset(name: string, recipe: Recipe, groups: readonly RecipeGroupId[]): PresetId {
    const id = fakeId('preset');
    const kept = [...new Set(groups)].filter(isRecipeGroupId);
    this.presets.set(id, {
      id,
      name,
      groups: kept,
      values: pickGroups(recipe, kept),
      createdAt: new Date().toISOString(),
      deleted: false,
    });
    this.changed();
    return id;
  }

  renamePreset(presetId: PresetId, name: string): void {
    const p = this.presets.get(presetId);
    if (!p || presetId.startsWith(BUILT_IN_PREFIX)) return;
    this.presets.set(presetId, { ...p, name });
    this.changed();
  }

  deletePreset(presetId: PresetId): void {
    const p = this.presets.get(presetId);
    if (!p) return;
    this.presets.set(presetId, { ...p, deleted: true });
    this.changed();
  }

  saveExportPreset(name: string, settings: ExportSettings): ExportPresetId {
    const problem = exportSettingsProblem(settings);
    if (problem !== null) throw new Error(problem);
    const id = fakeId('export-preset');
    this.exportPresets.set(id, {
      id,
      name,
      settings: exportSettingsFromJson(settings),
      createdAt: new Date().toISOString(),
      deleted: false,
    });
    this.changed();
    return id;
  }

  renameExportPreset(presetId: ExportPresetId, name: string): void {
    const p = this.exportPresets.get(presetId);
    if (!p) return;
    this.exportPresets.set(presetId, { ...p, name });
    this.changed();
  }

  deleteExportPreset(presetId: ExportPresetId): void {
    const p = this.exportPresets.get(presetId);
    if (!p) return;
    this.exportPresets.set(presetId, { ...p, deleted: true });
    this.changed();
  }

  /** Nothing is stored, so everything is as durable as it gets at once. */
  async whenDurable(): Promise<void> {}

  async syncNow(): Promise<void> {
    this.setStatus({ ...this.status, state: 'syncing' });
    await new Promise((r) => setTimeout(r, 600));
    this.setStatus({ state: 'idle', pendingOps: 0, lastSyncedAt: new Date().toISOString(), error: null });
  }

  /** Fake-only: forgets pending ops (after seeding). */
  markSynced(): void {
    this.setStatus({ state: 'idle', pendingOps: 0, lastSyncedAt: new Date().toISOString(), error: null });
  }

  private tickSync(): void {
    if (this.status.pendingOps > 0 && this.status.state === 'idle') void this.syncNow();
  }

  getSyncStatus(): SyncStatus {
    return this.status;
  }

  private setStatus(status: SyncStatus): void {
    this.status = status;
    for (const l of this.syncListeners) l();
  }

  subscribeSync(listener: () => void): () => void {
    this.syncListeners.add(listener);
    return () => this.syncListeners.delete(listener);
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    this.listeners.clear();
    this.syncListeners.clear();
  }
}
