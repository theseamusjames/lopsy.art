import { describe, expect, it } from 'vitest';
import { placeMenu } from './menu-place';

describe('placeMenu', () => {
  it('opens under its button when the menu fits there', () => {
    expect(placeMenu({ left: 40, top: 100, bottom: 124 }, 800, 260)).toEqual({ left: 40, top: 128, bottom: null, maxHeight: 664 });
  });

  it('opens over it when there is too little room below and more above', () => {
    expect(placeMenu({ left: 40, top: 760, bottom: 788 }, 800, 100)).toEqual({ left: 40, top: null, bottom: 44, maxHeight: 748 });
  });

  it('stays under it when above is no better, and scrolls', () => {
    const place = placeMenu({ left: 0, top: 60, bottom: 84 }, 300, 260);
    expect(place.top).toBe(88);
    expect(place.maxHeight).toBe(204);
  });
});
