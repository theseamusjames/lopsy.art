import type { KeyboardEvent } from 'react';

/** The radio a key moves to among `count` from `index`: the arrows wrap, Home and End go to the ends. Null for other keys. */
export function radioMove(key: string, index: number, count: number): number | null {
  if (count === 0 || index < 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** The one radio Tab stops on: the checked one, or the first when none is. */
export function radioTabIndex(index: number, checkedIndex: number): 0 | -1 {
  return index === (checkedIndex < 0 ? 0 : checkedIndex) ? 0 : -1;
}

/**
 * A key pressed in a radio group made of role="radio" buttons (each with
 * `radioTabIndex`, so the group is one Tab stop): the arrows move to the
 * next radio and choose it (`onPick` with its index), Home and End go to
 * the ends, and Space and Enter press the focused button. None of these
 * also runs the page's shortcuts (the arrows move the grid's selection,
 * Enter opens the editor).
 */
export function handleRadioKeys(e: KeyboardEvent<HTMLElement>, onPick: (index: number) => void): void {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
  const index = radios.findIndex((radio) => radio === document.activeElement);
  if (index < 0) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.stopPropagation();
    return;
  }
  const next = radioMove(e.key, index, radios.length);
  if (next === null) return;
  e.preventDefault();
  e.stopPropagation();
  radios[next]?.focus();
  onPick(next);
}
