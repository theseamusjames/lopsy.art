import { describe, expect, it } from 'vitest';
import { comparePhotos } from './compare';

const GRID = ['a', 'b', 'c', 'd', 'e', 'f'];

describe('comparePhotos', () => {
  it('shows the selected photos, in the grid\'s order, up to the size of the view', () => {
    expect(comparePhotos(['d', 'b'], 'd', GRID, 2)).toEqual(['b', 'd']);
    expect(comparePhotos(['a', 'b', 'c', 'd', 'e'], 'a', GRID, 4)).toEqual(['a', 'b', 'c', 'd']);
    expect(comparePhotos(['a', 'c', 'e'], 'a', GRID, 2)).toEqual(['a', 'c']);
  });

  it('fills the view with the photos that follow when fewer are selected', () => {
    expect(comparePhotos(['b'], 'b', GRID, 2)).toEqual(['b', 'c']);
    expect(comparePhotos(['b', 'c'], 'b', GRID, 4)).toEqual(['b', 'c', 'd', 'e']);
    // The ones between two selected photos come before any beyond them.
    expect(comparePhotos(['a', 'd'], 'a', GRID, 4)).toEqual(['a', 'b', 'c', 'd']);
    expect(comparePhotos(['b', 'f'], 'b', GRID, 4)).toEqual(['b', 'c', 'd', 'f']);
  });

  it('goes back for more at the end of the grid', () => {
    expect(comparePhotos(['f'], 'f', GRID, 2)).toEqual(['e', 'f']);
    expect(comparePhotos(['e'], 'e', GRID, 4)).toEqual(['c', 'd', 'e', 'f']);
  });

  it('starts from the focused photo, or the first, when nothing is selected', () => {
    expect(comparePhotos([], 'c', GRID, 2)).toEqual(['c', 'd']);
    expect(comparePhotos([], null, GRID, 4)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('shows what there is in a grid smaller than the view', () => {
    expect(comparePhotos(['a'], 'a', ['a', 'b', 'c'], 4)).toEqual(['a', 'b', 'c']);
    expect(comparePhotos([], null, ['a'], 2)).toEqual(['a']);
    expect(comparePhotos([], null, [], 2)).toEqual([]);
  });

  it('ignores a selected photo the grid no longer shows', () => {
    expect(comparePhotos(['gone', 'b'], 'b', GRID, 2)).toEqual(['b', 'c']);
  });
});
