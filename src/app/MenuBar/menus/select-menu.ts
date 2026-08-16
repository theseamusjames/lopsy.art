import { useEditorStore } from '../../editor-store';
import { useUIStore } from '../../ui-store';
import { createRectSelection, invertSelection } from '../../../selection/selection';
import { selectionToPath } from '../../../selection/selection-to-path';
import { createTransformState } from '../../../tools/transform/transform';
import type { MenuDef } from './types';

export type SelectDialogId = 'grow' | 'shrink' | 'feather';

export function selectAll(): void {
  const state = useEditorStore.getState();
  const { width, height } = state.document;
  const rect = { x: 0, y: 0, width, height };
  const mask = createRectSelection(rect, width, height);
  state.setSelection(rect, mask, width, height);
  // Every other setSelection call pairs with setTransform so the marquee
  // overlay and transform handles refresh with the new bounds. Without this,
  // Cmd+A after any prior selection (e.g. the paste's alpha-selection at a
  // sub-canvas region) leaves the handles pinned to the stale bounds — #721.
  useUIStore.getState().setTransform(createTransformState(rect));
}

export function invertSelectionAction(): void {
  const state = useEditorStore.getState();
  const sel = state.selection;
  if (!sel.active || !sel.mask) return;
  const inverted = invertSelection(sel.mask);
  const { width, height } = state.document;
  const rect = { x: 0, y: 0, width, height };
  state.setSelection(rect, inverted, sel.maskWidth, sel.maskHeight);
  useUIStore.getState().setTransform(createTransformState(rect));
}

export function selectionToPathAction(): void {
  const state = useEditorStore.getState();
  const sel = state.selection;
  if (!sel.active || !sel.mask) return;
  const anchors = selectionToPath(sel.mask, sel.maskWidth, sel.maskHeight);
  if (anchors.length === 0) return;
  state.addPath(anchors, true);
}

export function createSelectMenu(showDialog: (id: SelectDialogId) => void): MenuDef {
  return {
    label: 'Select',
    items: [
      { label: 'All', shortcut: '⌘A', action: () => selectAll() },
      { label: 'Deselect', shortcut: '⌘D', action: () => useEditorStore.getState().clearSelection() },
      { label: 'Inverse', shortcut: '⇧⌘I', action: () => invertSelectionAction() },
      { separator: true, label: '' },
      { label: 'Grow…', action: () => showDialog('grow') },
      { label: 'Shrink…', action: () => showDialog('shrink') },
      { label: 'Feather…', action: () => showDialog('feather') },
      { separator: true, label: '' },
      {
        label: 'Selection → Path',
        action: () => selectionToPathAction(),
        disabled: !useEditorStore.getState().selection.active,
      },
    ],
  };
}
