import { describe, expect, it } from 'vitest';
import { radioMove, radioTabIndex } from './radio-keys';

describe('radioMove', () => {
  it('moves with the arrows, wrapping, and to the ends with Home and End', () => {
    expect(radioMove('ArrowRight', 1, 5)).toBe(2);
    expect(radioMove('ArrowDown', 4, 5)).toBe(0);
    expect(radioMove('ArrowLeft', 0, 5)).toBe(4);
    expect(radioMove('ArrowUp', 3, 5)).toBe(2);
    expect(radioMove('Home', 3, 5)).toBe(0);
    expect(radioMove('End', 1, 5)).toBe(4);
  });

  it('ignores other keys, and a group without focus', () => {
    expect(radioMove('a', 1, 5)).toBeNull();
    expect(radioMove('ArrowRight', -1, 5)).toBeNull();
  });
});

describe('radioTabIndex', () => {
  it('makes the checked radio the one Tab stop, or the first when none is checked', () => {
    expect([0, 1, 2].map((i) => radioTabIndex(i, 1))).toEqual([-1, 0, -1]);
    expect([0, 1, 2].map((i) => radioTabIndex(i, -1))).toEqual([0, -1, -1]);
  });
});
