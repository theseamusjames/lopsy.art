/**
 * What each command in the shortcut registry does. Buttons in the UI call
 * the same functions, so a key and a click always behave alike.
 */

import type { AssetId, ColorLabel, LibraryHistory, LibrarySession, LibraryView, Rating, VersionId } from '@lopsy/photos-core/library/types';
import { getBackend } from './backend-registry';
import { itemAssets, itemVersionId, nextVersionName, parseItem, versionItemId, versionsByAsset, type ItemId } from '../library/items';
import type { CommandId } from '../shortcuts/registry';
import { useUi, type ViewMode } from './store';
import { showToast } from './toasts';
import { findPreset } from '@lopsy/photos-core/library/presets';
import { asGroupIds, pasteRecipeValues, pickRecipeValues } from '../library/recipe-copy';
import { EMPTY_SELECTION, moveFocus, nextAfterRemoval, orderedSelection, selectAll, selectOne, targetIds } from '../library/selection';

/** The tiles a command acts on: in Single, Cull and Compare the one in focus, in the grid the selection. */
export function currentItems(): ItemId[] {
  const { selection, mode } = useUi.getState();
  if (mode !== 'grid' && selection.focus !== null) return [selection.focus];
  return targetIds(selection);
}

/** The photos a command acts on (marks, delete, albums belong to the photo, whichever version is shown). */
export function currentTargets(): AssetId[] {
  return itemAssets(currentItems());
}

/** The versions a command acts on (edit, export, Lopsy, paste): each tile's own version. */
export function currentVersions(): { assetId: AssetId; versionId: VersionId }[] {
  const view = session().getView();
  const out: { assetId: AssetId; versionId: VersionId }[] = [];
  for (const id of currentItems()) {
    const versionId = itemVersionId(id, view);
    if (versionId !== null) out.push({ assetId: parseItem(id).assetId, versionId });
  }
  return out;
}

/** Library undo and redo (marks, albums, versions, the delete record), with what it did said in a toast. */
/**
 * The last delete, while nothing has been done in the library since: ⌘Z
 * undoes it the way the toast's Undo does, bringing back the record and
 * its files together. Deleting is kept out of library history (a library
 * undo would bring back only the record), so this is how ⌘Z reaches it.
 */
let lastDelete: { session: LibrarySession; assetIds: readonly AssetId[]; history: LibraryHistory } | null = null;

/** Called after photos were moved to the trash. */
export function rememberDelete(assetIds: readonly AssetId[]): void {
  const s = session();
  lastDelete = { session: s, assetIds, history: s.libraryHistory() };
}

/** Brings deleted photos back with their files (the delete's Undo). */
export async function undoDelete(assetIds: readonly AssetId[]): Promise<void> {
  const s = session();
  if (lastDelete && lastDelete.assetIds === assetIds) lastDelete = null;
  try {
    await getBackend().untrashAssets(s, assetIds);
    const first = assetIds[0];
    if (first !== undefined) useUi.getState().setSelection(selectOne(first));
    showToast(`Brought back ${assetIds.length === 1 ? 'the photo' : `${assetIds.length.toLocaleString()} photos`} from the trash.`, 3000);
  } catch (e) {
    showToast(e instanceof Error ? e.message : String(e));
  }
}

export function undoLibrary(redo: boolean): void {
  const s = session();
  // Right after a delete, with nothing done since (the history is the same object), ⌘Z undoes the delete.
  const pending = lastDelete;
  if (!redo && pending && pending.session === s && s.libraryHistory() === pending.history) {
    void undoDelete(pending.assetIds);
    return;
  }
  lastDelete = null;
  const label = redo ? s.redoLibrary() : s.undoLibrary();
  if (label === null) showToast(redo ? 'Nothing to redo.' : 'Nothing to undo.', 3000);
  else showToast(`${redo ? 'Redid' : 'Undid'}: ${label}`, 3000);
}

/** Opens the Copy edits dialog for the focused photo. */
export function askCopyEdits(): void {
  const ui = useUi.getState();
  if (ui.selection.focus === null && ui.selection.ids.size === 0) return;
  ui.openDialog('copy-edits');
}

/** The version Copy edits copies from: the focused tile's. */
export function copySource(): { assetId: AssetId; versionId: VersionId; name: string } | null {
  const ui = useUi.getState();
  const id = ui.selection.focus ?? [...ui.selection.ids][0];
  if (id === undefined) return null;
  const view = session().getView();
  const { assetId } = parseItem(id);
  const versionId = itemVersionId(id, view);
  const asset = view.assets.get(assetId);
  if (!asset || versionId === null) return null;
  return { assetId, versionId, name: asset.fileName };
}

export function copyEdits(chosen: readonly string[]): void {
  const groupIds = asGroupIds(chosen);
  const source = copySource();
  const version = source ? session().getView().versions.get(source.versionId) : undefined;
  if (!source || !version) return;
  const ui = useUi.getState();
  ui.setCopiedEdits({ values: pickRecipeValues(version.recipe, groupIds), groupIds, sourceName: source.name });
  ui.openDialog(null);
  showToast(`Copied edits from ${source.name}. Select photos and paste.`);
}

/** Applies an edit preset to every selected tile's version, one history step each. */
export function applyPreset(presetId: string): void {
  const s = session();
  const preset = findPreset(s.getView().presets, presetId);
  const versionIds = currentVersions().map((v) => v.versionId);
  if (!preset || versionIds.length === 0) return;
  s.applyRecipeValues(versionIds, preset.values, `Preset: ${preset.name}`);
  showToast(`Applied “${preset.name}” to ${versionIds.length.toLocaleString()} photo${versionIds.length === 1 ? '' : 's'}.`);
}

/** Pastes the copied edits onto every selected tile's version. */
export function pasteEdits(): void {
  const copied = useUi.getState().copiedEdits;
  if (!copied) {
    showToast('Copy edits from a photo first.');
    return;
  }
  const versionIds = currentVersions().map((v) => v.versionId);
  if (versionIds.length === 0) return;
  pasteRecipeValues(session(), versionIds, copied);
  showToast(`Pasted edits onto ${versionIds.length.toLocaleString()} photo${versionIds.length === 1 ? '' : 's'}.`);
}

/** The tile for a version: the photo's own tile for its shown version. */
function tileFor(view: LibraryView, assetId: AssetId, versionId: VersionId): ItemId {
  return view.assets.get(assetId)?.primaryVersionId === versionId ? assetId : versionItemId(assetId, versionId);
}

/** Makes the version the one its photo shows (in the grid, albums, exports of the photo), and keeps it selected. */
export function makeShownVersion(assetId: AssetId, versionId: VersionId): void {
  const s = session();
  if (s.getView().assets.get(assetId)?.primaryVersionId === versionId) return;
  s.setPrimaryVersion(assetId, versionId);
  useUi.getState().setSelection(selectOne(assetId));
}

/**
 * Deletes a version. The shown one can go too, when the photo has another:
 * the next one (else the one before) becomes the shown version first. The
 * last version of a photo is never deleted. Selects what is left.
 */
export function deleteVersionOf(assetId: AssetId, versionId: VersionId): void {
  const s = session();
  const view = s.getView();
  const asset = view.assets.get(assetId);
  const versions = versionsByAsset(view).get(assetId) ?? [];
  if (!asset || versions.length < 2 || !versions.some((v) => v.id === versionId)) return;
  const i = versions.findIndex((v) => v.id === versionId);
  const next = versions[i + 1] ?? versions[i - 1];
  if (!next) return;
  // One undo step: the switch and the delete come back together.
  s.libraryStep(`Delete ${versions[i]?.name ?? 'version'}`, () => {
    if (asset.primaryVersionId === versionId) s.setPrimaryVersion(assetId, next.id);
    s.deleteVersion(versionId);
  });
  const ui = useUi.getState();
  const focus = ui.selection.focus;
  if (focus !== null && parseItem(focus).assetId === assetId) {
    const shown = itemVersionId(focus, view);
    const keep = shown !== null && shown !== versionId ? tileFor(s.getView(), assetId, shown) : assetId;
    ui.setSelection(selectOne(keep));
  }
}

/** Makes a new version of the focused tile's version (same edits), opens its stack and selects it. */
export function newVersion(): void {
  const ui = useUi.getState();
  if (ui.selection.focus === null && ui.selection.ids.size === 0) return;
  ui.openDialog('new-version');
}

/** The name New version offers: the first "Version N" the photo does not use. */
export function suggestedVersionName(): string {
  const ui = useUi.getState();
  const id = ui.selection.focus ?? [...ui.selection.ids][0];
  if (id === undefined) return 'Version 2';
  const names = (versionsByAsset(session().getView()).get(parseItem(id).assetId) ?? []).map((v) => v.name);
  return nextVersionName(names);
}

/** Creates the version New version asked for, named `name`. */
export function createNamedVersion(name: string): void {
  const ui = useUi.getState();
  ui.openDialog(null);
  const id = ui.selection.focus ?? [...ui.selection.ids][0];
  if (id === undefined) return;
  const view = session().getView();
  const { assetId } = parseItem(id);
  const from = itemVersionId(id, view);
  const source = from === null ? undefined : view.versions.get(from);
  const versionId = session().createVersion(assetId, name.trim() || suggestedVersionName(), source?.recipe);
  if (!versionId) return;
  if (!ui.expandedBursts.has(assetId)) ui.toggleBurst(assetId);
  ui.setSelection(selectOne(versionItemId(assetId, versionId)));
}

function session() {
  const connection = useUi.getState().connection;
  if (!connection) throw new Error('No library is open');
  return connection.session;
}

/** The next photo after `id` in display order, or the previous one at the end. */
function neighbour(orderedIds: readonly AssetId[], id: AssetId): AssetId | null {
  const i = orderedIds.indexOf(id);
  if (i < 0) return null;
  return orderedIds[i + 1] ?? orderedIds[i - 1] ?? null;
}

/** After marking in Single/Cull view: move on, so the next photo is up. */
function advance(orderedIds: readonly AssetId[], from: AssetId): void {
  const next = neighbour(orderedIds, from);
  if (next !== null && orderedIds.indexOf(next) > orderedIds.indexOf(from)) useUi.getState().setSelection(selectOne(next));
}

export function setRating(rating: Rating, orderedIds: readonly AssetId[], ids = currentTargets()): void {
  if (ids.length === 0) return;
  session().setMarks(ids, { rating });
  const { mode, selection } = useUi.getState();
  if (mode === 'cull' && selection.focus !== null) advance(orderedIds, selection.focus);
}

/** Whether photos marked this way leave the list on screen (All photos hides set-aside ones; Set aside shows only them). */
function leavesCollection(setAside: boolean): boolean {
  const kind = useUi.getState().collection.kind;
  return setAside ? kind === 'all' || kind === 'date' : kind === 'set-aside';
}

/** After photos leave the grid, the next one is selected (or nothing, when none is left). */
export function selectAfterRemoval(orderedIds: readonly string[], removed: readonly AssetId[]): void {
  const next = nextAfterRemoval(orderedIds, new Set(removed), (id) => parseItem(id).assetId);
  useUi.getState().setSelection(next === null ? EMPTY_SELECTION : selectOne(next));
}

export function toggleSetAside(orderedIds: readonly AssetId[], ids = currentTargets()): void {
  if (ids.length === 0) return;
  const s = session();
  const view = s.getView();
  const before = new Map(ids.map((id) => [id, view.assets.get(id)?.setAside === true]));
  const allAside = [...before.values()].every(Boolean);
  const setAside = !allAside;
  const { mode, selection } = useUi.getState();
  // In Single and Cull view marking moves on, as rating does.
  const next = selection.focus !== null && (mode === 'single' || mode === 'cull') ? neighbour(orderedIds, selection.focus) : null;
  s.setMarks(ids, { setAside });
  if (leavesCollection(setAside)) selectAfterRemoval(orderedIds, ids);
  else if (next !== null) useUi.getState().setSelection(selectOne(next));
  const words = `${ids.length === 1 ? 'Photo' : `${ids.length.toLocaleString()} photos`} ${setAside ? 'set aside' : 'back from Set aside'}.`;
  showToast(words, 6000, {
    label: 'Undo',
    run: () => {
      const back = [...before.entries()];
      const was = back.filter(([, aside]) => aside).map(([id]) => id);
      const wasNot = back.filter(([, aside]) => !aside).map(([id]) => id);
      if (was.length > 0) s.setMarks(was, { setAside: true });
      if (wasNot.length > 0) s.setMarks(wasNot, { setAside: false });
      useUi.getState().setSelection(selectOne(ids[0] as AssetId));
    },
  });
}

export function setLabel(label: ColorLabel | null, orderedIds: readonly AssetId[], ids = currentTargets()): void {
  if (ids.length === 0) return;
  session().setMarks(ids, { label });
  const { mode, selection } = useUi.getState();
  if (mode === 'cull' && selection.focus !== null) advance(orderedIds, selection.focus);
}

/** Sets the label, or removes it when every target already has it. */
export function toggleLabel(label: ColorLabel, orderedIds: readonly AssetId[], ids = currentTargets()): void {
  if (ids.length === 0) return;
  const view = session().getView();
  const all = ids.every((id) => view.assets.get(id)?.label === label);
  setLabel(all ? null : label, orderedIds, ids);
}

export function openEdit(): void {
  const { selection } = useUi.getState();
  const id = selection.focus ?? [...selection.ids][0];
  if (id === undefined) return;
  const view = session().getView();
  const { assetId } = parseItem(id);
  const versionId = itemVersionId(id, view);
  if (!view.assets.get(assetId) || versionId === null) return;
  useUi.getState().setEditing({ assetId, versionId });
}

function enterMode(mode: ViewMode, orderedIds: readonly AssetId[]): void {
  const ui = useUi.getState();
  if (ui.selection.focus === null) {
    const first = orderedSelection(ui.selection, orderedIds)[0] ?? orderedIds[0];
    if (first === undefined) return;
    ui.setSelection(selectOne(first));
  }
  ui.setMode(mode);
}

export function openCull(orderedIds: readonly AssetId[]): void {
  enterMode('cull', orderedIds);
  if (useUi.getState().mode === 'cull' && document.fullscreenElement === null) {
    document.documentElement.requestFullscreen?.().catch(() => {
      // Full screen was refused; Cull mode still fills the window.
    });
  }
}

/** Compare needs two to four selected photos; extra ones are left out. */
export function canCompare(): boolean {
  return useUi.getState().selection.ids.size >= 2;
}

export function openCompare(orderedIds: readonly AssetId[]): void {
  if (!canCompare()) return;
  const ui = useUi.getState();
  const shown = orderedSelection(ui.selection, orderedIds).slice(0, 4);
  // The keys act on the focused photo, so it must be one of those shown.
  if (ui.selection.focus === null || !shown.includes(ui.selection.focus)) {
    ui.setSelection({ ...ui.selection, focus: shown[0] ?? null });
  }
  ui.setMode('compare');
}

export function backOut(): void {
  const ui = useUi.getState();
  if (ui.dialog !== null) return ui.openDialog(null);
  if (ui.mode !== 'grid') {
    if (ui.mode === 'cull' && document.fullscreenElement !== null) void document.exitFullscreen().catch(() => {});
    return ui.setMode('grid');
  }
  ui.setSelection(EMPTY_SELECTION);
}

export function askDeleteTargets(): void {
  useUi.getState().askDelete(currentTargets());
}

const RATINGS: Partial<Record<CommandId, Rating>> = { 'rate-0': 0, 'rate-1': 1, 'rate-2': 2, 'rate-3': 3, 'rate-4': 4, 'rate-5': 5 };
const LABELS: Partial<Record<CommandId, ColorLabel>> = {
  'label-red': 'red',
  'label-yellow': 'yellow',
  'label-green': 'green',
  'label-blue': 'blue',
  'label-purple': 'purple',
};

export function runCommand(id: CommandId, orderedIds: readonly AssetId[]): void {
  const ui = useUi.getState();
  const rating = RATINGS[id];
  if (rating !== undefined) return setRating(rating, orderedIds);
  const label = LABELS[id];
  if (label !== undefined) return toggleLabel(label, orderedIds);
  switch (id) {
    case 'set-aside':
      return toggleSetAside(orderedIds);
    case 'move-left':
    case 'move-right':
    case 'move-up':
    case 'move-down':
    case 'extend-left':
    case 'extend-right': {
      const step = ui.mode === 'grid' && (id === 'move-up' || id === 'move-down') ? ui.gridColumns : 1;
      const delta = id === 'move-left' || id === 'move-up' || id === 'extend-left' ? -step : step;
      return ui.setSelection(moveFocus(ui.selection, orderedIds, delta, id.startsWith('extend')));
    }
    case 'open-edit':
      return openEdit();
    case 'open-single':
      return ui.mode === 'single' ? ui.setMode('grid') : enterMode('single', orderedIds);
    case 'open-compare':
      return openCompare(orderedIds);
    case 'open-cull':
      return openCull(orderedIds);
    case 'back':
      return backOut();
    case 'toggle-info':
      return ui.toggleInfo();
    case 'select-all':
      return ui.setSelection(selectAll(orderedIds, ui.selection.focus));
    case 'select-none':
      return ui.setSelection(EMPTY_SELECTION);
    case 'delete':
      return askDeleteTargets();
    case 'undo-library':
      return undoLibrary(false);
    case 'redo-library':
      return undoLibrary(true);
    case 'copy-edits':
      return askCopyEdits();
    case 'paste-edits':
      return pasteEdits();
    case 'help':
      return ui.openDialog(ui.dialog === 'help' ? null : 'help');
    default:
      return;
  }
}
