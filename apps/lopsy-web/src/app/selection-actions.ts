import { useEditorStore } from './editor-store';
import { useUIStore } from './ui-store';
import { createRectSelection, growSelection, invertSelection, selectionBounds, shrinkSelection } from '../selection/selection';
import { selectionToPaths } from '../selection/selection-to-path';
import { createTransformState } from '../tools/transform/transform';
import { commitLiveFloat } from './interactions/live-float';
import { featherMaskOnGpu } from './interactions/selection-handlers';
import { getEngine } from '../engine-wasm/engine-state';
import { seedSelectionMaskRef } from '../engine-wasm/sync-state';
import type { Refusal } from '../commands/refusal';

export type SelectionModifyKind = 'grow' | 'shrink' | 'feather';

export const SELECTION_MODIFY_LABELS: Readonly<Record<SelectionModifyKind, string>> = {
  grow: 'Grow Selection',
  shrink: 'Shrink Selection',
  feather: 'Feather Selection',
};

/** Grow, Shrink or Feather left nothing selected, so the selection was kept. */
export const EMPTY_MODIFIED_SELECTION: Refusal = {
  reason: 'No pixels would remain selected. The selection was not changed.',
  notice: 'info',
};

/**
 * What Grow, Shrink or Feather did: `applied`; `no-selection` (nothing
 * done); `empty`, kept as it was because nothing would remain selected; or
 * `stale`, the feather result dropped because the selection changed while
 * it was being read.
 */
export type SelectionModifyOutcome = 'applied' | 'no-selection' | 'empty' | 'stale';

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

/** Select > Inverse. False, with nothing changed but a committed float, when nothing is selected. */
export function invertSelectionAction(): boolean {
  // Invert what is on screen: a pending Move-tool scale or rotate has to
  // reach the mask first, and the float it leaves must not outlive the swap.
  commitLiveFloat();
  const state = useEditorStore.getState();
  const sel = state.selection;
  if (!sel.active || !sel.mask) return false;
  const inverted = invertSelection(sel.mask);
  // Bounds-driven commands (Crop, transform handles, Define Pattern) read
  // the rect, so it has to frame what the inverted mask covers (#1492).
  const { width, height } = state.document;
  const rect = selectionBounds(inverted, sel.maskWidth, sel.maskHeight)
    ?? { x: 0, y: 0, width, height };
  state.pushHistoryMetadata('Inverse Selection');
  state.setSelection(rect, inverted, sel.maskWidth, sel.maskHeight);
  useUIStore.getState().setTransform(createTransformState(rect));
  return true;
}

/** Select > Selection → Path. Returns how many paths it added. */
export function selectionToPathAction(): number {
  const state = useEditorStore.getState();
  const sel = state.selection;
  if (!sel.active || !sel.mask) return 0;
  const paths = selectionToPaths(sel.mask, sel.maskWidth, sel.maskHeight);
  if (paths.length === 0) return 0;
  state.pushHistoryMetadata('Selection to Path');
  for (const anchors of paths) {
    state.addPath(anchors, true);
  }
  return paths.length;
}

/**
 * Select > Grow… / Shrink… / Feather… Apply. A feather with the engine
 * running reads the result from the GPU, so it returns a promise; every
 * other case has finished when it returns.
 */
export function modifySelection(
  kind: SelectionModifyKind,
  amount: number,
): SelectionModifyOutcome | Promise<SelectionModifyOutcome> {
  // Grow, shrink or feather the outline on screen, including a pending
  // Move-tool scale or rotate.
  commitLiveFloat();
  const editor = useEditorStore.getState();
  const sel = editor.selection;
  if (!sel.active || !sel.mask) return 'no-selection';
  const { width: docW, height: docH } = editor.document;
  const apply = (newMask: Uint8ClampedArray): SelectionModifyOutcome => {
    const newBounds = selectionBounds(newMask, docW, docH);
    // An empty result would read as "no selection", which Delete, Fill
    // and filters treat as the whole layer (#1026). Keep the selection.
    if (!newBounds) return 'empty';
    editor.pushHistoryMetadata(SELECTION_MODIFY_LABELS[kind]);
    editor.setSelection(newBounds, newMask, docW, docH);
    useUIStore.getState().setTransform(createTransformState(newBounds));
    return 'applied';
  };
  const engine = getEngine();
  if (kind === 'feather' && engine) {
    const before = sel.mask;
    return featherMaskOnGpu(engine, before, docW, docH, amount)
      .catch(() => null)
      .then((feathered) => {
        // The selection changed while the feather was being read.
        if (useEditorStore.getState().selection.mask !== before) return 'stale';
        if (!feathered) return apply(before);
        // #763: the feathered bytes are already on the GPU — seed the
        // tracked ref so the next syncSelection skips the echo upload.
        seedSelectionMaskRef(engine, feathered.mask);
        return apply(feathered.mask);
      });
  }
  if (kind === 'feather') return apply(sel.mask);
  return apply(kind === 'grow' ? growSelection(sel.mask, docW, docH, amount) : shrinkSelection(sel.mask, docW, docH, amount));
}
