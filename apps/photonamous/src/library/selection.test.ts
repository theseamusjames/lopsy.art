import { describe, expect, it } from 'vitest';
import {
  EMPTY_SELECTION,
  focusAt,
  moveFocus,
  orderedSelection,
  pruneSelection,
  selectAll,
  selectOne,
  selectRange,
  targetIds,
  toggleOne,
} from './selection';

const order = ['a', 'b', 'c', 'd', 'e'];

describe('selection', () => {
  it('selects one photo on click', () => {
    const s = selectOne('c');
    expect([...s.ids]).toEqual(['c']);
    expect(s.anchor).toBe('c');
    expect(s.focus).toBe('c');
  });

  it('toggles with cmd/ctrl-click', () => {
    let s = toggleOne(selectOne('a'), 'c');
    expect([...s.ids].sort()).toEqual(['a', 'c']);
    s = toggleOne(s, 'a');
    expect([...s.ids]).toEqual(['c']);
  });

  it('selects a range in display order with shift-click, either direction', () => {
    const s = selectRange(selectOne('b'), order, 'd');
    expect(orderedSelection(s, order)).toEqual(['b', 'c', 'd']);
    const back = selectRange(selectOne('d'), order, 'a');
    expect(orderedSelection(back, order)).toEqual(['a', 'b', 'c', 'd']);
    expect(back.anchor).toBe('d');
  });

  it('keeps the anchor across repeated shift-clicks', () => {
    let s = selectRange(selectOne('c'), order, 'e');
    s = selectRange(s, order, 'a');
    expect(orderedSelection(s, order)).toEqual(['a', 'b', 'c']);
  });

  it('adds a range to the selection when additive', () => {
    const s = selectRange(toggleOne(selectOne('a'), 'c'), order, 'e', true);
    expect(orderedSelection(s, order)).toEqual(['a', 'c', 'd', 'e']);
  });

  it('falls back to a single click without an anchor', () => {
    expect([...selectRange(EMPTY_SELECTION, order, 'b').ids]).toEqual(['b']);
  });

  it('selects all', () => {
    expect(selectAll(order, null).ids.size).toBe(5);
  });

  it('moves focus with the arrows and clamps at the ends', () => {
    let s = moveFocus(EMPTY_SELECTION, order, 1);
    expect(s.focus).toBe('a');
    s = moveFocus(s, order, 3);
    expect(s.focus).toBe('d');
    s = moveFocus(s, order, 10);
    expect(s.focus).toBe('e');
    s = moveFocus(s, order, -1);
    expect(s.focus).toBe('d');
    expect([...s.ids]).toEqual(['d']);
  });

  it('extends the range with shift-arrow', () => {
    const s = moveFocus(moveFocus(selectOne('b'), order, 1, true), order, 1, true);
    expect(orderedSelection(s, order)).toEqual(['b', 'c', 'd']);
  });

  it('prunes ids that are no longer visible and keeps identity otherwise', () => {
    const s = selectRange(selectOne('a'), order, 'c');
    expect(pruneSelection(s, new Set(order))).toBe(s);
    const pruned = pruneSelection(s, new Set(['a', 'b']));
    expect([...pruned.ids].sort()).toEqual(['a', 'b']);
    expect(pruned.focus).toBeNull();
  });

  it('moves focus to an index, selecting it, growing the range or leaving the selection', () => {
    expect([...focusAt(selectOne('b'), order, 3, 'select').ids]).toEqual(['d']);
    const grown = focusAt(selectOne('b'), order, 3, 'extend');
    expect(orderedSelection(grown, order)).toEqual(['b', 'c', 'd']);
    expect(grown.anchor).toBe('b');
    expect(grown.focus).toBe('d');
    const kept = focusAt(toggleOne(selectOne('a'), 'c'), order, 4, 'keep');
    expect(orderedSelection(kept, order)).toEqual(['a', 'c']);
    expect(kept.focus).toBe('e');
    expect(kept.anchor).toBe('c');
    expect(focusAt(EMPTY_SELECTION, order, 2, 'extend').ids).toEqual(new Set(['c']));
    expect(focusAt(selectOne('a'), order, 9, 'select')).toEqual(selectOne('a'));
  });

  it('targets the focus when nothing is selected', () => {
    expect(targetIds({ ids: new Set(), anchor: null, focus: 'b' })).toEqual(['b']);
    expect(targetIds(EMPTY_SELECTION)).toEqual([]);
  });
});
