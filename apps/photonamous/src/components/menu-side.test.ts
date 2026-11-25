import { describe, expect, it } from 'vitest';
import { menuSide } from './menu-side';

describe('menuSide', () => {
  it("lines a menu up with its button's left edge when it fits", () => {
    expect(menuSide(300, 240, 1280)).toBe('start');
    expect(menuSide(1032, 240, 1280)).toBe('start');
  });

  it("switches to the button's right edge when the menu would run off the window", () => {
    expect(menuSide(1033, 240, 1280)).toBe('end');
    expect(menuSide(1240, 240, 1280)).toBe('end');
  });
});
