import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { requireDocument } from '../context';
import { useEditorStore } from '../../app/editor-store';
import { hasDeferredHistoryEntry } from '../../app/store/deferred-history';

export interface HistoryLabels {
  /** Oldest first; the last label is the step the next undo reverts. */
  undo: string[];
  /** Oldest first; the last label is the step the next redo reapplies. */
  redo: string[];
}

type Direction = 'undo' | 'redo';

const stepsSpec = (direction: Direction) =>
  ({
    type: 'number',
    integer: true,
    min: 1,
    default: 1,
    description: `How many history steps to ${direction} at once, as clicking a row in the History panel does.`,
  }) as const;

function historyLabels(): HistoryLabels {
  const { undoStack, redoStack } = useEditorStore.getState();
  return { undo: undoStack.map((entry) => entry.label), redo: redoStack.map((entry) => entry.label) };
}

/**
 * An uncommitted text layer's "Add Text Layer" entry is recorded ahead of an
 * undo or redo (deferred-history.ts): it adds one step to undo, and since
 * recording it clears the redo stack, it leaves nothing to redo.
 */
function availableSteps(direction: Direction): number {
  const { undoStack, redoStack, document } = useEditorStore.getState();
  const isDeferred = hasDeferredHistoryEntry(document.layers);
  if (direction === 'undo') return undoStack.length + (isDeferred ? 1 : 0);
  return isDeferred ? 0 : redoStack.length;
}

/**
 * Asking for more steps than the history holds is refused before anything
 * runs. With none available the store is still called, as Edit > Undo and
 * Cmd+Z call it: it finalizes a pending stroke, drops a live Move float and
 * records a deferred text entry whatever the stacks hold.
 */
function assertNotTooMany(direction: Direction, steps: number): void {
  const available = availableSteps(direction);
  if (available === 0 || steps <= available) return;
  const unit = available === 1 ? 'step' : 'steps';
  throw new CommandError('refused', `Only ${available} ${unit} to ${direction}; asked for ${steps}.`);
}

/** How many entries a jump appended to the opposite stack: it appends new snapshots, never entries the stack held before. */
function stepsMoved(before: readonly unknown[], after: readonly unknown[]): number {
  const known = new Set(before);
  let moved = 0;
  for (let i = after.length - 1; i >= 0 && !known.has(after[i]); i--) moved++;
  return moved;
}

function assertMoved(direction: Direction, moved: number): void {
  if (moved === 0) throw new CommandError('refused', `Nothing to ${direction}.`);
}

export const historyUndo = defineCommand({
  id: 'history.undo',
  summary:
    'Undoes the last step (or `steps` steps) of the document history, as Edit > Undo, Cmd+Z and the History panel do: a pending stroke is finalized and a live Move float dropped first, even when there turns out to be nothing to undo, which is then refused. Returns the undo and redo labels after it.',
  surface: 'document',
  params: { steps: stepsSpec('undo') },
  run({ steps }): HistoryLabels {
    requireDocument();
    assertNotTooMany('undo', steps);
    const store = useEditorStore.getState();
    const redoBefore = store.redoStack;
    if (steps === 1) store.undo();
    else store.undoBy(steps);
    assertMoved('undo', stepsMoved(redoBefore, useEditorStore.getState().redoStack));
    return historyLabels();
  },
});

export const historyRedo = defineCommand({
  id: 'history.redo',
  summary:
    'Redoes the last undone step (or `steps` steps), as Edit > Redo, Cmd+Shift+Z and the History panel do: a live Move float is dropped and an uncommitted text layer\'s entry recorded first, even when there turns out to be nothing to redo, which is then refused. Returns the undo and redo labels after it.',
  surface: 'document',
  params: { steps: stepsSpec('redo') },
  run({ steps }): HistoryLabels {
    const doc = requireDocument();
    assertNotTooMany('redo', steps);
    const isDeferred = hasDeferredHistoryEntry(doc.layers);
    const store = useEditorStore.getState();
    const undoBefore = store.undoStack;
    if (steps === 1) store.redo();
    else store.redoBy(steps);
    assertMoved('redo', isDeferred ? 0 : stepsMoved(undoBefore, useEditorStore.getState().undoStack));
    return historyLabels();
  },
});
