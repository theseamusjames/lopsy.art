import { describe, expect, it } from 'vitest';
import { DEFAULT_RECIPE } from '@lopsy/photos-core/library/recipe';
import { applyChanges } from '../edit-controls';
import { historySteps, pushStep, redoStep, startHistory, undoStep } from './recipe-history';

describe('recipe history', () => {
  it('undoes and redoes steps', () => {
    const a = applyChanges(DEFAULT_RECIPE, { 'tone.exposure': 1 });
    const b = applyChanges(a, { 'tone.contrast': 10 });
    let h = pushStep(pushStep(startHistory(DEFAULT_RECIPE), a, 'Exposure +1.00'), b, 'Contrast +10');
    expect(h.present).toBe(b);
    h = undoStep(h);
    expect(h.present).toBe(a);
    expect(h.presentLabel).toBe('Exposure +1.00');
    h = undoStep(undoStep(h));
    expect(h.present).toBe(DEFAULT_RECIPE);
    h = redoStep(h);
    expect(h.present).toBe(a);
    const c = applyChanges(a, { 'tone.blacks': -4 });
    h = pushStep(h, c, 'Blacks −4');
    expect(redoStep(h)).toBe(h);
  });
});

describe('historySteps', () => {
  it('lists the steps oldest first with the undone ones inactive', () => {
    const a = applyChanges(DEFAULT_RECIPE, { 'tone.exposure': 1 });
    let h = pushStep(pushStep(startHistory(DEFAULT_RECIPE), a, 'One'), a, 'Two');
    h = undoStep(h);
    expect(historySteps(h).map((s) => [s.id, s.label, s.active])).toEqual([
      ['step-1', 'One', true],
      ['step-2', 'Two', false],
    ]);
    expect(historySteps(startHistory(DEFAULT_RECIPE))).toEqual([]);
  });
});
