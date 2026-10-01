import { describe, expect, it } from 'vitest';
import { parsePost } from './parse-post';

function post(frontmatter: string, body = 'Body text.'): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

const VALID = `title: GPU Undo Snapshots
description: How Lopsy snapshots layers for undo by duplicating GPU textures instead of reading pixels back.
published: 2026-10-01 14:30`;

describe('parsePost', () => {
  it('reads the frontmatter and body', () => {
    const result = parsePost('gpu-undo', post(`${VALID}\nauthor: Seamus\ntags: WebGL, Undo\nhero: c.jpg\nheroAlt: A diagram`, '## Intro\n\nText.'));
    expect(result.errors).toEqual([]);
    expect(result.post).toMatchObject({
      slug: 'gpu-undo',
      title: 'GPU Undo Snapshots',
      published: '2026-10-01',
      publishedAt: '2026-10-01T14:30',
      updated: '2026-10-01',
      author: 'Seamus',
      tags: ['webgl', 'undo'],
      hero: { src: 'c.jpg', alt: 'A diagram' },
      isDraft: false,
      readingMinutes: 1,
    });
    expect(result.post?.blocks.map((b) => b.kind)).toEqual(['heading', 'prose']);
  });

  it('leaves optional fields empty', () => {
    const result = parsePost('a', post(VALID));
    expect(result.post).toMatchObject({ author: null, tags: [], hero: null, share: null });
    expect(result.post?.summary).toBe(result.post?.description);
  });

  it('reads a list summary separate from the search description', () => {
    expect(parsePost('a', post(`${VALID}\nsummary: A longer blurb for the blog list.`)).post?.summary).toBe('A longer blurb for the blog list.');
  });

  it('reads a share image, taking its alt text from heroAlt unless shareAlt is set', () => {
    const fromHero = parsePost('a', post(`${VALID}\nhero: h.jpg\nheroAlt: Collage\nshare: s.jpg`));
    expect(fromHero.post?.share).toEqual({ src: 's.jpg', alt: 'Collage' });
    const own = parsePost('a', post(`${VALID}\nhero: h.jpg\nheroAlt: Collage\nshare: s.jpg\nshareAlt: Wide crop`));
    expect(own.post?.share).toEqual({ src: 's.jpg', alt: 'Wide crop' });
    expect(parsePost('a', post(`${VALID}\nshare: s.jpg`)).errors).toEqual(['`share` needs a `shareAlt` (or `heroAlt`) description.']);
  });

  it('reports missing fields, bad dates, hero without alt and an empty body', () => {
    const result = parsePost('Bad_Slug', post('published: 2026-13-01\nhero: c.jpg', '\n'));
    expect(result.post).toBeNull();
    expect(result.errors).toEqual([
      'Directory name "Bad_Slug" must be lowercase words separated by hyphens.',
      'Missing `title`.',
      'Missing `description`.',
      '`published` must be a date in YYYY-MM-DD form, optionally followed by a UTC time as HH:MM.',
      '`updated` must be a date in YYYY-MM-DD form.',
      '`hero` needs a `heroAlt` description.',
      'The post has no body.',
    ]);
  });

  it('rejects updated before published', () => {
    expect(parsePost('a', post(`${VALID}\nupdated: 2026-09-01`)).errors).toEqual(['`updated` is earlier than `published`.']);
  });

  it('reports body errors with file line numbers', () => {
    const result = parsePost('a', post(VALID, 'Intro.\n\n# Title'));
    expect(result.errors).toEqual(['Line 8: use `## ` or deeper; the page title comes from `title`.']);
  });

  it('warns about search-unfriendly lengths', () => {
    const result = parsePost('a', post(`title: ${'T'.repeat(70)}\ndescription: Too short.\npublished: 2026-10-01`));
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      '`title` is 70 characters; search results truncate after ~60.',
      '`description` is 10 characters; aim for 50–160.',
    ]);
  });

  it('requires a frontmatter block', () => {
    expect(parsePost('a', 'Just text').errors).toEqual(['Missing `---` frontmatter block at the top.']);
  });
});
