/**
 * UI state of the app: which library is open, what the grid shows, the
 * selection, the current view and which dialog is up. The library's own
 * data is not here; it is read from the LibrarySession (hooks.ts).
 */

import { create } from 'zustand';
import type { AssetId, VersionId } from '@lopsy/photos-core/library/types';
import type { ImportJob } from '@lopsy/photos-core/import/types';
import type { Connection, ExportJob, StorageChoice } from './backend';
import { EMPTY_SELECTION, type Selection } from '../library/selection';
import type { Collection, SortOrder } from '../library/asset-query';

export type ViewMode = 'grid' | 'single' | 'compare' | 'cull';
export type DialogName = 'import' | 'export' | 'delete' | 'help' | 'sync' | null;

export interface EditTarget {
  readonly assetId: AssetId;
  readonly versionId: VersionId;
}

export interface UiState {
  readonly connection: Connection | null;
  readonly connecting: StorageChoice | null;
  readonly connectError: string | null;

  readonly collection: Collection;
  readonly sort: SortOrder;
  readonly text: string;
  readonly thumbSize: number;
  readonly selection: Selection;
  readonly mode: ViewMode;
  readonly infoOpen: boolean;
  readonly dialog: DialogName;
  readonly editing: EditTarget | null;
  /** Columns the grid is showing, for up/down arrows. */
  readonly gridColumns: number;

  /** Files waiting on the import sheet. Kept here, never passed as props. */
  readonly pendingImport: readonly File[] | null;
  readonly importJob: ImportJob | null;
  readonly exportJob: ExportJob | null;
  /** What the delete confirmation will delete. */
  readonly deleteIds: readonly AssetId[];

  setConnecting(kind: StorageChoice | null, error?: string | null): void;
  setConnection(connection: Connection | null): void;
  setCollection(collection: Collection): void;
  setSort(sort: SortOrder): void;
  setText(text: string): void;
  setThumbSize(size: number): void;
  setSelection(selection: Selection): void;
  setMode(mode: ViewMode): void;
  toggleInfo(): void;
  openDialog(dialog: DialogName): void;
  setEditing(target: EditTarget | null): void;
  setGridColumns(columns: number): void;
  setPendingImport(files: readonly File[] | null): void;
  setImportJob(job: ImportJob | null): void;
  setExportJob(job: ExportJob | null): void;
  askDelete(ids: readonly AssetId[]): void;
}

export const THUMB_SIZE = { min: 96, max: 360, initial: 180 } as const;

export const useUi = create<UiState>()((set) => ({
  connection: null,
  connecting: null,
  connectError: null,
  collection: { kind: 'all' },
  sort: { key: 'captured', descending: true },
  text: '',
  thumbSize: THUMB_SIZE.initial,
  selection: EMPTY_SELECTION,
  mode: 'grid',
  infoOpen: true,
  dialog: null,
  editing: null,
  gridColumns: 1,
  pendingImport: null,
  importJob: null,
  exportJob: null,
  deleteIds: [],

  setConnecting: (kind, error = null) => set({ connecting: kind, connectError: error }),
  setConnection: (connection) =>
    set({
      connection,
      connecting: null,
      connectError: null,
      selection: EMPTY_SELECTION,
      collection: { kind: 'all' },
      mode: 'grid',
      dialog: null,
      editing: null,
      importJob: null,
      exportJob: null,
      pendingImport: null,
    }),
  setCollection: (collection) => set({ collection, selection: EMPTY_SELECTION, mode: 'grid' }),
  setSort: (sort) => set({ sort }),
  setText: (text) => set({ text }),
  setThumbSize: (thumbSize) => set({ thumbSize }),
  setSelection: (selection) => set({ selection }),
  setMode: (mode) => set({ mode }),
  toggleInfo: () => set((s) => ({ infoOpen: !s.infoOpen })),
  openDialog: (dialog) => set({ dialog }),
  setEditing: (editing) => set({ editing }),
  setGridColumns: (gridColumns) => set({ gridColumns }),
  setPendingImport: (pendingImport) => set({ pendingImport, dialog: pendingImport ? 'import' : null }),
  setImportJob: (importJob) => set({ importJob }),
  setExportJob: (exportJob) => set({ exportJob }),
  askDelete: (deleteIds) => set({ deleteIds, dialog: deleteIds.length > 0 ? 'delete' : null }),
}));
