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

/**
 * The step Undo takes back: the one the history marks as next (the
 * library's), else the newest active step of this device's own.
 */
export function stepToUndo(history: readonly HistoryStep[]): HistoryStep | null {
  if (history.some((s) => s.nextUndo !== undefined)) return history.find((s) => s.nextUndo) ?? null;
  for (let i = history.length - 1; i >= 0; i--) {
    const step = history[i];
    if (step?.active && isOwn(step)) return step;
  }
  return null;
}

/**
 * The step Redo brings back: the one the history marks as next, else the
 * oldest undone step of this device's own after the newest active one.
 */
export function stepToRedo(history: readonly HistoryStep[]): HistoryStep | null {
  if (history.some((s) => s.nextRedo !== undefined)) return history.find((s) => s.nextRedo) ?? null;
  let lastActive = -1;
  history.forEach((step, i) => {
    if (step.active) lastActive = i;
  });
  return history.slice(lastActive + 1).find((s) => !s.active && isOwn(s)) ?? null;
}
