/**
 * Lightweight recording hook that filter-actions (and other dispatchers) can
 * call without creating a circular dependency.  The action store registers
 * itself as the recorder by calling `setRecorder`.
 */

import type { ActionStep } from './action-types';

type StepRecorder = (step: ActionStep) => void;

let recorder: StepRecorder | null = null;

/** Called by the action store to wire itself in. */
export function setRecorder(fn: StepRecorder | null): void {
  recorder = fn;
}

/** Called by dispatchers (filter-actions, etc.) to emit a recordable step. */
export function recordStep(step: ActionStep): void {
  recorder?.(step);
}
