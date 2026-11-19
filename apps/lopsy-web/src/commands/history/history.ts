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

function assertSteps(direction: Direction, steps: number): void {
  const available = availableSteps(direction);
  if (available === 0) throw new CommandError('refused', `Nothing to ${direction}.`);
  if (steps <= available) return;
  const unit = available === 1 ? 'step' : 'steps';
  throw new CommandError('refused', `Only ${available} ${unit} to ${direction}; asked for ${steps}.`);
}

export const historyUndo = defineCommand({
  id: 'history.undo',
  summary:
    'Undoes the last step (or `steps` steps) of the document history, as Edit > Undo and the History panel do; returns the undo and redo labels after it.',
  surface: 'document',
  params: { steps: stepsSpec('undo') },
  run({ steps }): HistoryLabels {
    requireDocument();
    assertSteps('undo', steps);
    const store = useEditorStore.getState();
    if (steps === 1) store.undo();
    else store.undoBy(steps);
    return historyLabels();
  },
});

export const historyRedo = defineCommand({
  id: 'history.redo',
  summary:
    'Redoes the last undone step (or `steps` steps), as Edit > Redo and the History panel do; returns the undo and redo labels after it.',
  surface: 'document',
  params: { steps: stepsSpec('redo') },
  run({ steps }): HistoryLabels {
    requireDocument();
    assertSteps('redo', steps);
    const store = useEditorStore.getState();
    if (steps === 1) store.redo();
    else store.redoBy(steps);
    return historyLabels();
  },
});
