import { describe, expect, it } from 'vitest';
import { booleanOpRefusal } from './path-boolean-ops';
import type { StoredPath } from '../types/paths';

function path(id: string): StoredPath {
  return { id, name: id, anchors: [], closed: true };
}

describe('booleanOpRefusal', () => {
  it('needs two paths', () => {
    expect(booleanOpRefusal([], null)?.reason).toBe('A boolean path operation needs two paths; the document has 0.');
    expect(booleanOpRefusal([path('a')], 'a')?.reason).toBe('A boolean path operation needs two paths; the document has 1.');
  });

  it('needs a selected path that exists', () => {
    expect(booleanOpRefusal([path('a'), path('b')], null)?.notice).toBeNull();
    expect(booleanOpRefusal([path('a'), path('b')], 'gone')).not.toBeNull();
  });

  it('is null with two paths and one selected', () => {
    expect(booleanOpRefusal([path('a'), path('b')], 'a')).toBeNull();
  });
});
