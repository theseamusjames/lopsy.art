/**
 * UI state of the app: which library is open, what the grid shows, the
 * selection, the current view and which dialog is up. The library's own
 * data is not here; it is read from the LibrarySession (hooks.ts).
 */

import { create } from 'zustand';
import type { AssetId, VersionId } from '@lopsy/photos-core/library/types';
import type { ImportJob } from '@lopsy/photos-core/import/types';
import type { InterruptedImport } from '@lopsy/photos-core/import/interrupted';
import type { Connection, ExportJob, StorageChoice } from './backend';
import { EMPTY_SELECTION, type Selection } from '../library/selection';
import type { Collection, SortOrder } from '../library/asset-query';
import { NO_FACETS, type FacetFilter } from '../library/finding';
import type { CopiedEdits } from '../library/recipe-copy';

import type { CompareSize } from '../library/compare';

/** `cull` is the view users know as Full screen: one photo filling the screen, where marking moves on. */
export type ViewMode = 'grid' | 'single' | 'compare' | 'cull';
export type DialogName = 'import' | 'export' | 'delete' | 'help' | 'sync' | 'settings' | 'copy-edits' | 'new-version' | null;

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
  readonly facets: FacetFilter;
  readonly groupBursts: boolean;
  /** Burst covers shown open. */
  readonly expandedBursts: ReadonlySet<AssetId>;
  readonly thumbSize: number;
  readonly selection: Selection;
  readonly mode: ViewMode;
  /** How many photos the side-by-side view holds: two up, or four up. */
  readonly compareSize: CompareSize;
  readonly infoOpen: boolean;
  readonly dialog: DialogName;
  readonly editing: EditTarget | null;
  /** What the Edit view's status bar shows: the photo's size and the size it is edited at; null while nothing is loaded. */
  readonly editSizes: EditSizes | null;
  /** Columns the grid is showing, for up/down arrows. */
  readonly gridColumns: number;

  /** Files waiting on the import sheet. Kept here, never passed as props. */
  readonly pendingImport: readonly File[] | null;
  readonly importJob: ImportJob | null;
  /** What a reload left of imports, files to choose again (backend getInterruptedImport); null when nothing is missing. */
  readonly interruptedImport: InterruptedImport | null;
  readonly exportJob: ExportJob | null;
  /** What the delete confirmation will delete. */
  readonly deleteIds: readonly AssetId[];
  /** Edits copied for pasting onto other photos. */
  readonly copiedEdits: CopiedEdits | null;

  setConnecting(kind: StorageChoice | null, error?: string | null): void;
  setConnection(connection: Connection | null): void;
  setCollection(collection: Collection): void;
  setSort(sort: SortOrder): void;
  setText(text: string): void;
  setFacets(facets: FacetFilter): void;
  setGroupBursts(on: boolean): void;
  toggleBurst(coverId: AssetId): void;
  setThumbSize(size: number): void;
  setSelection(selection: Selection): void;
  setMode(mode: ViewMode): void;
  setCompareSize(size: CompareSize): void;
  toggleInfo(): void;
  openDialog(dialog: DialogName): void;
  setEditing(target: EditTarget | null): void;
  setEditSizes(sizes: EditSizes | null): void;
  setGridColumns(columns: number): void;
  setPendingImport(files: readonly File[] | null): void;
  setImportJob(job: ImportJob | null): void;
  setInterruptedImport(interrupted: InterruptedImport | null): void;
  setExportJob(job: ExportJob | null): void;
  askDelete(ids: readonly AssetId[]): void;
  setCopiedEdits(copied: CopiedEdits | null): void;
}

/** Pixel sizes, width by height. */
export interface EditSizes {
  /** The photo as a full-size export makes it: framed and cropped, at full resolution. */
  readonly photo: { readonly width: number; readonly height: number };
  /** The working image the Edit view edits, the same frame at the working size. */
  readonly working: { readonly width: number; readonly height: number };
}

export const THUMB_SIZE = { min: 96, max: 360, initial: 180 } as const;

export const useUi = create<UiState>()((set) => ({
  connection: null,
  connecting: null,
  connectError: null,
  collection: { kind: 'all' },
  sort: { key: 'captured', descending: true },
  text: '',
  facets: NO_FACETS,
  groupBursts: false,
  expandedBursts: new Set<AssetId>(),
  thumbSize: THUMB_SIZE.initial,
  selection: EMPTY_SELECTION,
  mode: 'grid',
  compareSize: 2,
  infoOpen: true,
  dialog: null,
  editing: null,
  editSizes: null,
  gridColumns: 1,
  pendingImport: null,
  importJob: null,
  interruptedImport: null,
  exportJob: null,
  deleteIds: [],
  copiedEdits: null,

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
      editSizes: null,
      importJob: null,
      interruptedImport: null,
      exportJob: null,
      pendingImport: null,
    }),
  setCollection: (collection) => set({ collection, selection: EMPTY_SELECTION, mode: 'grid', facets: NO_FACETS }),
  setSort: (sort) => set({ sort }),
  setText: (text) => set({ text }),
  setFacets: (facets) => set({ facets }),
  setGroupBursts: (groupBursts) => set({ groupBursts, expandedBursts: new Set() }),
  toggleBurst: (coverId) =>
    set((s) => {
      const next = new Set(s.expandedBursts);
      if (next.has(coverId)) next.delete(coverId);
      else next.add(coverId);
      return { expandedBursts: next };
    }),
  setThumbSize: (thumbSize) => set({ thumbSize }),
  setSelection: (selection) => set({ selection }),
  setMode: (mode) => set({ mode }),
  setCompareSize: (compareSize) => set({ compareSize }),
  toggleInfo: () => set((s) => ({ infoOpen: !s.infoOpen })),
  openDialog: (dialog) => set({ dialog }),
  setEditSizes: (editSizes) => set({ editSizes }),
  setEditing: (editing) => set(editing ? { editing } : { editing, editSizes: null }),
  setGridColumns: (gridColumns) => set({ gridColumns }),
  setPendingImport: (pendingImport) => set({ pendingImport, dialog: pendingImport ? 'import' : null }),
  setImportJob: (importJob) => set({ importJob }),
  setInterruptedImport: (interruptedImport) => set({ interruptedImport }),
  setExportJob: (exportJob) => set({ exportJob }),
  setCopiedEdits: (copiedEdits) => set({ copiedEdits }),
  askDelete: (deleteIds) => set({ deleteIds, dialog: deleteIds.length > 0 ? 'delete' : null }),
}));
