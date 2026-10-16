import { describe, it, expect } from 'vitest';
import { ADD_MENU_MAX_HEIGHT, placeAddMenu } from './add-menu-placement';

describe('placeAddMenu', () => {
  it('opens upward at full height when there is room above', () => {
    const p = placeAddMenu({ top: 500, bottom: 524, left: 1200 }, 800);
    expect(p.isAbove).toBe(true);
    expect(p.y).toBe(496);
    expect(p.left).toBe(1200);
    expect(p.maxHeight).toBe(ADD_MENU_MAX_HEIGHT);
  });

  it('opens downward when the button is near the top of the viewport', () => {
    const p = placeAddMenu({ top: 120, bottom: 144, left: 10 }, 800);
    expect(p.isAbove).toBe(false);
    expect(p.y).toBe(148);
    expect(p.maxHeight).toBe(ADD_MENU_MAX_HEIGHT);
  });

  it('caps the height to the larger side when neither side fits it', () => {
    const p = placeAddMenu({ top: 200, bottom: 224, left: 0 }, 400);
    expect(p.isAbove).toBe(true);
    expect(p.maxHeight).toBe(188);
  });

  it('never returns a negative height', () => {
    expect(placeAddMenu({ top: 0, bottom: 10, left: 0 }, 10).maxHeight).toBe(0);
  });
});
