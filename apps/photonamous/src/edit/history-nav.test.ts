import { describe, expect, it } from 'vitest';
import type { HistoryStep } from '@lopsy/photos-core/library/types';
import { ORIGINAL_STEP_ID, currentStepId, movesTo } from './history-nav';

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
