import { describe, expect, it } from 'vitest';
import { SHORT_LIST, isLongList, shortList } from './short-list';

const albums = Array.from({ length: 84 }, (_, i) => `Album ${i + 1}`);
const none = () => false;

describe('shortList', () => {
  it('shows a short list whole', () => {
    const few = albums.slice(0, SHORT_LIST);
    expect(shortList(few, false, none)).toBe(few);
    expect(isLongList(few.length)).toBe(false);
  });

  it('shows the first rows of a long one until it is opened out', () => {
    expect(shortList(albums, false, none)).toEqual(albums.slice(0, SHORT_LIST));
    expect(shortList(albums, true, none)).toBe(albums);
    expect(isLongList(albums.length)).toBe(true);
  });

  it('keeps the selected row in sight when it is further down', () => {
    expect(shortList(albums, false, (a) => a === 'Album 40')).toEqual([...albums.slice(0, SHORT_LIST), 'Album 40']);
    // One of the first rows is already there.
    expect(shortList(albums, false, (a) => a === 'Album 3')).toEqual(albums.slice(0, SHORT_LIST));
  });
});
