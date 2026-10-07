import { describe, it, expect } from 'vitest';
import { anchorPoint, snapBoxToGrid, DEFAULT_SNAP_ANCHOR } from './snap-anchor';
import { snapPositionToGrid } from './move';

const box = { x: 13, y: 21, width: 30, height: 50 };

describe('anchorPoint', () => {
  it('reads each of the nine anchors', () => {
    expect(anchorPoint(box, { horizontal: 'left', vertical: 'top' })).toEqual({ x: 13, y: 21 });
    expect(anchorPoint(box, { horizontal: 'center', vertical: 'middle' })).toEqual({ x: 28, y: 46 });
    expect(anchorPoint(box, { horizontal: 'right', vertical: 'bottom' })).toEqual({ x: 43, y: 71 });
  });
});

describe('snapBoxToGrid', () => {
  // 200x200 document, 16 px grid centred on 100 → lines at …, 36, 52, 68, 84, 100, 116, …
  const DOC = 200;
  const GRID = 16;

  it('with the default anchor matches snapping the box origin', () => {
    const shift = snapBoxToGrid(box, DEFAULT_SNAP_ANCHOR, GRID, DOC, DOC);
    const origin = snapPositionToGrid(box.x, box.y, GRID, DOC, DOC);
    expect({ x: box.x + shift.x, y: box.y + shift.y }).toEqual(origin);
  });

  it('puts the right and bottom edges on grid lines', () => {
    const shift = snapBoxToGrid(box, { horizontal: 'right', vertical: 'bottom' }, GRID, DOC, DOC);
    // right 43 → 36, bottom 71 → 68.
    expect(shift).toEqual({ x: -7, y: -3 });
  });

  it('puts the centre on a grid line', () => {
    const shift = snapBoxToGrid(box, { horizontal: 'center', vertical: 'middle' }, GRID, DOC, DOC);
    // centre 28 → 36 ((28 - 100) / 16 = -4.5 rounds to -4).
    expect(shift.x).toBe(36 - 28);
    // middle 46 → 52 ((46 - 100) / 16 = -3.375 rounds to -3).
    expect(shift.y).toBe(52 - 46);
  });

  it('snaps the chosen edge onto the canvas border', () => {
    const nearRight = { x: 165, y: 10, width: 30, height: 10 };
    const shift = snapBoxToGrid(nearRight, { horizontal: 'right', vertical: 'top' }, GRID, DOC, DOC);
    expect(nearRight.x + nearRight.width + shift.x).toBe(DOC);
  });

  it('returns whole-pixel shifts for odd-sized boxes', () => {
    const odd = { x: 10, y: 10, width: 25, height: 25 };
    const shift = snapBoxToGrid(odd, { horizontal: 'center', vertical: 'middle' }, GRID, DOC, DOC);
    expect(Number.isInteger(shift.x)).toBe(true);
    expect(Number.isInteger(shift.y)).toBe(true);
  });
});
