/** The edit harness's in-memory history: a recipe with undo and redo. */

import type { Recipe } from '@lopsy/photos-core/library/recipe';
import type { HistoryStep } from '@lopsy/photos-core/library/types';

export interface RecipeHistory {
  readonly past: readonly { readonly recipe: Recipe; readonly label: string }[];
  readonly present: Recipe;
  readonly presentLabel: string;
  readonly future: readonly { readonly recipe: Recipe; readonly label: string }[];
}

export function startHistory(recipe: Recipe): RecipeHistory {
  return { past: [], present: recipe, presentLabel: 'Original', future: [] };
}

export function pushStep(history: RecipeHistory, recipe: Recipe, label: string): RecipeHistory {
  return {
    past: [...history.past, { recipe: history.present, label: history.presentLabel }],
    present: recipe,
    presentLabel: label,
    future: [],
  };
}

export function undoStep(history: RecipeHistory): RecipeHistory {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous.recipe,
    presentLabel: previous.label,
    future: [{ recipe: history.present, label: history.presentLabel }, ...history.future],
  };
}

export function redoStep(history: RecipeHistory): RecipeHistory {
  const [next, ...rest] = history.future;
  if (!next) return history;
  return {
    past: [...history.past, { recipe: history.present, label: history.presentLabel }],
    present: next.recipe,
    presentLabel: next.label,
    future: rest,
  };
}

/** The steps as `LibrarySession.history` lists them: oldest first, undone ones inactive. */
export function historySteps(history: RecipeHistory): HistoryStep[] {
  const states = [...history.past.map((p) => p.label), history.presentLabel, ...history.future.map((f) => f.label)];
  return states.slice(1).map((label, i) => ({
    id: `step-${i + 1}`,
    label,
    hlc: String(i + 1).padStart(6, '0'),
    active: i + 1 <= history.past.length,
    own: true,
  }));
}
