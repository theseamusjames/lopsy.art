/**
 * Going to a step in the History list (spec 5.4): by undoing and redoing,
 * which add steps to the journal rather than delete any (spec 6.6). The
 * list is oldest first; undo and redo act on this device's own steps.
 */

import type { HistoryStep } from '@lopsy/photos-core/library/types';

/** The pseudo-step for the photo as it was imported, before any step. */
export const ORIGINAL_STEP_ID = '';

export interface HistoryMoves {
  readonly undo: number;
  readonly redo: number;
}

function isOwn(step: HistoryStep): boolean {
  return step.own !== false;
}

/**
 * How many undos, then redos, bring the edit to step `targetId` (or to the
 * original with ORIGINAL_STEP_ID): undo every own active step after it,
 * redo every own undone step up to it.
 */
export function movesTo(history: readonly HistoryStep[], targetId: string): HistoryMoves {
  const index = targetId === ORIGINAL_STEP_ID ? -1 : history.findIndex((s) => s.id === targetId);
  if (targetId !== ORIGINAL_STEP_ID && index < 0) return { undo: 0, redo: 0 };
  let undo = 0;
  let redo = 0;
  history.forEach((step, i) => {
    if (!isOwn(step)) return;
    if (i > index && step.active) undo++;
    if (i <= index && !step.active) redo++;
  });
  return { undo, redo };
}

/** The step the edit stands at: the newest active one, or ORIGINAL_STEP_ID. */
export function currentStepId(history: readonly HistoryStep[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const step = history[i];
    if (step?.active) return step.id;
  }
  return ORIGINAL_STEP_ID;
}
