import { describe, expect, it } from 'vitest';
import type { HistoryStep } from '@lopsy/photos-core/library/types';
import { ORIGINAL_STEP_ID, currentStepId, movesTo, stepToRedo, stepToUndo } from './history-nav';

function step(id: string, active: boolean, own = true): HistoryStep {
  return { id, label: id, hlc: id, active, own };
}

const H = [step('a', true), step('b', true), step('c', true), step('d', false), step('e', false)];

describe('movesTo', () => {
  it('undoes the steps after an earlier one', () => {
    expect(movesTo(H, 'a')).toEqual({ undo: 2, redo: 0 });
    expect(movesTo(H, ORIGINAL_STEP_ID)).toEqual({ undo: 3, redo: 0 });
  });

  it('redoes undone steps up to a later one', () => {
    expect(movesTo(H, 'e')).toEqual({ undo: 0, redo: 2 });
    expect(movesTo(H, 'c')).toEqual({ undo: 0, redo: 0 });
  });

  it("leaves other devices' steps alone and ignores unknown ids", () => {
    const mixed = [step('a', true), step('x', true, false), step('b', true)];
    expect(movesTo(mixed, 'a')).toEqual({ undo: 1, redo: 0 });
    expect(movesTo(H, 'zz')).toEqual({ undo: 0, redo: 0 });
  });
});

describe('currentStepId', () => {
  it('is the newest active step, or the original', () => {
    expect(currentStepId(H)).toBe('c');
    expect(currentStepId([step('a', false)])).toBe(ORIGINAL_STEP_ID);
  });
});

describe('stepToUndo and stepToRedo', () => {
  const step = (id: string, active: boolean, extra: Partial<HistoryStep> = {}): HistoryStep => ({ id, label: `Step ${id}`, hlc: id, active, own: true, ...extra });

  it('follow a linear history', () => {
    const history = [step('1', true), step('2', true), step('3', false), step('4', false)];
    expect(stepToUndo(history)?.id).toBe('2');
    expect(stepToRedo(history)?.id).toBe('3');
    expect(stepToUndo([])).toBeNull();
    expect(stepToRedo([step('1', true)])).toBeNull();
  });

  it('skip steps made on other devices', () => {
    const history = [step('1', true), step('2', true, { own: false })];
    expect(stepToUndo(history)?.id).toBe('1');
  });

  it('take the steps the library marks', () => {
    const history = [step('1', true, { nextUndo: false, nextRedo: false }), step('2', false, { nextUndo: false, nextRedo: true })];
    expect(stepToUndo(history)).toBeNull();
    expect(stepToRedo(history)?.id).toBe('2');
  });
});
