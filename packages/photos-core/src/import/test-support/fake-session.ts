/**
 * A minimal LibrarySession for import tests: it keeps assets and versions
 * in memory and implements what the importer uses (getView, addAsset,
 * setPreview, setKeyword, setAlbumMember). Everything else throws.
 */

import { DEFAULT_RECIPE } from '../../library/recipe';
import type {
  AlbumId,
  Asset,
  AssetId,
  LibraryLayout,
  LibrarySession,
  LibraryView,
  NewAsset,
  PreviewRef,
  SyncStatus,
  Preset,
  Version,
  VersionId,
} from '../../library/types';
import type { FileId, StorageAdapter } from '../../storage/types';

function unused(name: string): never {
  throw new Error(`FakeLibrarySession.${name} is not implemented`);
}

export class FakeLibrarySession implements LibrarySession {
  readonly libraryId = 'lib-test';
  readonly deviceId = 'device-test';
  readonly layout: LibraryLayout;
  readonly adapter: StorageAdapter;
  readonly albumMembers: { albumId: AlbumId; assetId: AssetId }[] = [];
  private view: LibraryView = {
    assets: new Map(),
    versions: new Map(),
    albums: new Map(),
    settings: new Map(),
    presets: new Map(),
    exportPresets: new Map(),
  };

  /** Adds a saved preset to the view, for imports that apply one. */
  addPresetForTest(preset: Preset): void {
    this.view = { ...this.view, presets: new Map([...this.view.presets, [preset.id, preset]]) };
  }
  private readonly listeners = new Set<() => void>();
  private nextVersion = 1;

  constructor(
    adapter: StorageAdapter,
    folders: { rootId: FileId; originalsId: FileId; previewsId: FileId; exportsId?: FileId },
  ) {
    this.adapter = adapter;
    this.layout = {
      libraryId: this.libraryId,
      rootId: folders.rootId,
      originalsId: folders.originalsId,
      documentsId: 'unused-documents',
      exportsId: folders.exportsId ?? 'unused-exports',
      dataId: 'unused-data',
      journalId: 'unused-journal',
      snapshotsId: 'unused-snapshots',
      previewsId: folders.previewsId,
      devicesId: 'unused-devices',
    };
  }

  private update(assets: ReadonlyMap<AssetId, Asset>, versions: ReadonlyMap<VersionId, Version>) {
    this.view = { ...this.view, assets, versions };
    for (const l of this.listeners) l();
  }

  getView(): LibraryView {
    return this.view;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  addAsset(asset: NewAsset): { assetId: AssetId; versionId: VersionId } {
    const assetId = asset.id ?? crypto.randomUUID();
    const versionId = `v${this.nextVersion++}`;
    const { marks, keywords, recipe, id: _id, ...facts } = asset;
    const full: Asset = {
      ...facts,
      id: assetId,
      rating: marks?.rating ?? 0,
      label: marks?.label ?? null,
      setAside: marks?.setAside ?? false,
      title: marks?.title ?? '',
      caption: marks?.caption ?? '',
      keywords: keywords ?? [],
      primaryVersionId: versionId,
      deleted: false,
    };
    const version: Version = {
      id: versionId,
      assetId,
      name: 'Original',
      recipe: recipe ?? DEFAULT_RECIPE,
      createdAt: asset.importedAt,
      thumb: null,
      screen: null,
      deleted: false,
    };
    this.update(new Map(this.view.assets).set(assetId, full), new Map(this.view.versions).set(versionId, version));
    return { assetId, versionId };
  }

  /** Adds an asset as if another device had imported it. */
  seed(asset: NewAsset & { deleted?: boolean }): AssetId {
    const { assetId } = this.addAsset(asset);
    if (asset.deleted) this.deleteAssets([assetId]);
    return assetId;
  }

  setPreview(versionId: VersionId, size: 'thumb' | 'screen', preview: PreviewRef): void {
    const v = this.view.versions.get(versionId);
    if (!v) throw new Error(`No version ${versionId}`);
    this.update(this.view.assets, new Map(this.view.versions).set(versionId, { ...v, [size]: preview }));
  }

  setKeyword(assetIds: readonly AssetId[], keyword: string, present: boolean): void {
    const assets = new Map(this.view.assets);
    for (const id of assetIds) {
      const a = assets.get(id);
      if (!a) continue;
      const rest = a.keywords.filter((k) => k !== keyword);
      assets.set(id, { ...a, keywords: present ? [...rest, keyword] : rest });
    }
    this.update(assets, this.view.versions);
  }

  deleteAssets(assetIds: readonly AssetId[]): void {
    const assets = new Map(this.view.assets);
    for (const id of assetIds) {
      const a = assets.get(id);
      if (a) assets.set(id, { ...a, deleted: true });
    }
    this.update(assets, this.view.versions);
  }

  setAlbumMember(albumId: AlbumId, assetId: AssetId, present: boolean): void {
    if (present) this.albumMembers.push({ albumId, assetId });
  }

  setMarks(): void {
    unused('setMarks');
  }
  restoreAssets(): void {
    unused('restoreAssets');
  }
  createVersion(): VersionId {
    return unused('createVersion');
  }
  renameVersion(): void {
    unused('renameVersion');
  }
  deleteVersion(): void {
    unused('deleteVersion');
  }
  editRecipe(): void {
    unused('editRecipe');
  }
  setRecipe(): void {
    unused('setRecipe');
  }
  undo(): boolean {
    return unused('undo');
  }
  redo(): boolean {
    return unused('redo');
  }
  history(): never {
    return unused('history');
  }
  createAlbum(): AlbumId {
    return unused('createAlbum');
  }
  renameAlbum(): void {
    unused('renameAlbum');
  }
  deleteAlbum(): void {
    unused('deleteAlbum');
  }
  setSetting(): void {
    unused('setSetting');
  }
  applyRecipeValues(): void {
    unused('applyRecipeValues');
  }
  savePreset(): string {
    return unused('savePreset');
  }
  renamePreset(): void {
    unused('renamePreset');
  }
  deletePreset(): void {
    unused('deletePreset');
  }
  saveExportPreset(): string {
    return unused('saveExportPreset');
  }
  renameExportPreset(): void {
    unused('renameExportPreset');
  }
  deleteExportPreset(): void {
    unused('deleteExportPreset');
  }
  async syncNow(): Promise<void> {}
  getSyncStatus(): SyncStatus {
    return { state: 'idle', pendingOps: 0, lastSyncedAt: null, error: null };
  }
  subscribeSync(): () => void {
    return () => {};
  }
  async close(): Promise<void> {}
}
