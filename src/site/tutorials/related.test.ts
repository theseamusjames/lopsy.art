import { describe, expect, it } from 'vitest';
import { byNewest, pickRelated } from './related';
import type { Tutorial } from './types';

function tutorial(slug: string, overrides: Partial<Tutorial> = {}): Tutorial {
  return {
    slug,
    title: slug,
    description: '',
    published: '2026-01-01',
    publishedAt: '2026-01-01T00:00',
    updated: '2026-01-01',
    level: null,
    duration: null,
    tags: [],
    related: [],
    cover: null,
    isDraft: false,
    intro: '',
    steps: [],
    ...overrides,
  };
}

describe('byNewest', () => {
  it('sorts by publish time descending, then title', () => {
    const list = [
      tutorial('b', { publishedAt: '2026-01-01T00:00' }),
      tutorial('c', { publishedAt: '2026-02-01T00:00' }),
      tutorial('a', { publishedAt: '2026-01-01T00:00' }),
      tutorial('d', { publishedAt: '2026-01-01T09:15' }),
    ];
    expect(list.sort(byNewest).map((t) => t.slug)).toEqual(['c', 'd', 'a', 'b']);
  });
});

describe('pickRelated', () => {
  const all = [
    tutorial('current', { tags: ['masks', 'selections'], related: ['explicit', 'missing', 'current'] }),
    tutorial('explicit', { publishedAt: '2025-01-01T00:00' }),
    tutorial('two-tags', { tags: ['masks', 'selections'], publishedAt: '2025-06-01T00:00' }),
    tutorial('one-tag-old', { tags: ['masks'], publishedAt: '2025-01-01T00:00' }),
    tutorial('one-tag-new', { tags: ['selections'], publishedAt: '2026-05-01T00:00' }),
    tutorial('no-tags', { publishedAt: '2026-09-01T00:00' }),
  ];
  const current = all[0]!;

  it('puts explicit picks first, then ranks by shared tags and recency', () => {
    expect(pickRelated(current, all, 4).map((t) => t.slug)).toEqual([
      'explicit',
      'two-tags',
      'one-tag-new',
      'one-tag-old',
    ]);
  });

  it('never includes the tutorial itself or duplicates', () => {
    const slugs = pickRelated(current, all, 10).map((t) => t.slug);
    expect(slugs).not.toContain('current');
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toHaveLength(5);
  });

  it('respects the limit', () => {
    expect(pickRelated(current, all, 1)).toHaveLength(1);
  });

  it('returns nothing when there is only one tutorial', () => {
    expect(pickRelated(current, [current], 3)).toEqual([]);
  });
});
