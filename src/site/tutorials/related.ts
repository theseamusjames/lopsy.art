import type { Tutorial } from './types';

function sharedTagCount(a: Tutorial, b: Tutorial): number {
  return a.tags.filter((tag) => b.tags.includes(tag)).length;
}

export function byNewest(a: Tutorial, b: Tutorial): number {
  if (a.publishedAt !== b.publishedAt) return a.publishedAt < b.publishedAt ? 1 : -1;
  return a.title.localeCompare(b.title);
}

/**
 * Tutorials listed in `related` come first, in the order written. Remaining
 * slots go to the tutorials sharing the most tags, newest first on ties, so
 * every page links onward even when its author listed nothing.
 */
export function pickRelated(tutorial: Tutorial, all: readonly Tutorial[], limit: number): Tutorial[] {
  const bySlug = new Map(all.map((t) => [t.slug, t]));
  const picked: Tutorial[] = [];
  const pickedSlugs = new Set<string>([tutorial.slug]);

  for (const slug of tutorial.related) {
    const match = bySlug.get(slug);
    if (!match || pickedSlugs.has(slug)) continue;
    picked.push(match);
    pickedSlugs.add(slug);
  }

  const candidates = all
    .filter((t) => !pickedSlugs.has(t.slug))
    .map((t) => ({ tutorial: t, score: sharedTagCount(tutorial, t) }))
    .sort((a, b) => b.score - a.score || byNewest(a.tutorial, b.tutorial));

  for (const { tutorial: candidate } of candidates) {
    picked.push(candidate);
  }

  return picked.slice(0, limit);
}
