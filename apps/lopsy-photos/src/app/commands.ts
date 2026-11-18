/**
 * What each command in the shortcut registry does. Buttons in the UI call
 * the same functions, so a key and a click always behave alike.
 */

import type { AssetId, ColorLabel, Rating, VersionId } from '@lopsy/photos-core/library/types';
import { itemAssets, itemVersionId, nextVersionName, parseItem, versionItemId, versionsByAsset, type ItemId } from '../library/items';
import type { CommandId } from '../shortcuts/registry';
import { useUi, type ViewMode } from './store';
import { showToast } from './toasts';
import { asGroupIds, pasteRecipeValues, pickRecipeValues } from '../library/recipe-copy';
import { EMPTY_SELECTION, moveFocus, orderedSelection, selectAll, selectOne, targetIds } from '../library/selection';

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

/** Makes a new version of the focused tile's version (same edits), opens its stack and selects it. */
export function newVersion(): void {
  const ui = useUi.getState();
  const id = ui.selection.focus ?? [...ui.selection.ids][0];
  if (id === undefined) return;
  const view = session().getView();
  const { assetId } = parseItem(id);
  const from = itemVersionId(id, view);
  const source = from === null ? undefined : view.versions.get(from);
  const names = (versionsByAsset(view).get(assetId) ?? []).map((v) => v.name);
  const versionId = session().createVersion(assetId, nextVersionName(names), source?.recipe);
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

export function toggleSetAside(orderedIds: readonly AssetId[], ids = currentTargets()): void {
  if (ids.length === 0) return;
  const view = session().getView();
  const allAside = ids.every((id) => view.assets.get(id)?.setAside === true);
  const { mode, selection } = useUi.getState();
  // The photo may leave the list it is in, so pick the next one first.
  const next = selection.focus !== null && (mode === 'single' || mode === 'cull') ? neighbour(orderedIds, selection.focus) : null;
  session().setMarks(ids, { setAside: !allAside });
  if (next !== null) useUi.getState().setSelection(selectOne(next));
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
