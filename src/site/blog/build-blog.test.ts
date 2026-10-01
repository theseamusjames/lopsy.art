import { describe, expect, it } from 'vitest';
import { buildBlog } from './build-blog';
import type { SourcePost } from './types';

function png(width: number, height: number): Uint8Array {
  const out = new Uint8Array(32);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(out.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return out;
}

function source(slug: string, frontmatter: string, body = '![A diagram](fig.png "Caption")', extraAssets: string[] = []): SourcePost {
  const assets = new Map<string, Uint8Array>([['fig.png', png(1600, 900)]]);
  for (const name of extraAssets) assets.set(name, png(10, 10));
  return {
    slug,
    source: `---
title: ${slug} title
description: A description long enough to satisfy the search snippet guideline for ${slug}.
published: 2026-09-0${slug.length % 9 + 1}
${frontmatter}
---
Intro paragraph.

${body}
`,
    assets,
  };
}

function build(sources: SourcePost[], shouldIncludeDrafts = false) {
  return buildBlog({ sources, css: '.x{}', shouldIncludeDrafts });
}

function jsonLd(html: string): { '@graph': Array<Record<string, unknown>> } {
  const match = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html);
  return JSON.parse(match?.[1] ?? '{}');
}

describe('buildBlog', () => {
  it('emits the index, the feed, a page per post and used images', () => {
    const result = build([source('alpha', '', undefined, ['unused.png']), source('beta', '')]);
    expect(result.errors).toEqual([]);
    expect([...result.files.keys()].sort()).toEqual([
      'blog/alpha/fig.png',
      'blog/alpha/index.html',
      'blog/beta/fig.png',
      'blog/beta/index.html',
      'blog/feed.xml',
      'blog/index.html',
    ]);
    expect(result.warnings).toContain('blog/alpha: "unused.png" is not used and won\'t be published.');
  });

  it('lists posts newest first and links each to the others', () => {
    const result = build([source('alpha', 'published: 2026-09-01'), source('beta', 'published: 2026-09-03'), source('gamma', 'published: 2026-09-02')]);
    const index = result.files.get('blog/index.html') as string;
    const order = ['beta', 'gamma', 'alpha'].map((slug) => index.indexOf(`/blog/${slug}/`));
    expect(order).toEqual([...order].sort((a, b) => a - b));

    const alpha = result.files.get('blog/alpha/index.html') as string;
    expect(alpha).toContain('More from the blog');
    expect(alpha).toContain('href="/blog/beta/"');
    expect(alpha).toContain('href="/blog/gamma/"');
  });

  it('renders the post with sized images, a byline, the feed link and BlogPosting JSON-LD', () => {
    const html = build([source('alpha', 'author: Seamus\ntags: webgl')]).files.get('blog/alpha/index.html') as string;
    expect(html).toContain('<h1>alpha title</h1>');
    expect(html).toContain('src="/blog/alpha/fig.png"');
    expect(html).toContain('width="1600" height="900"');
    expect(html).toContain('<figcaption>Caption</figcaption>');
    expect(html).toContain('<span>Seamus</span>');
    expect(html).toContain('1 min read');
    expect(html).toContain('<link rel="alternate" type="application/atom+xml"');
    expect(html).toContain('<link rel="canonical" href="https://lopsy.art/blog/alpha/">');
    expect(html).toContain('<a href="/blog/">Blog</a>');

    const posting = jsonLd(html)['@graph'].find((node) => node['@type'] === 'BlogPosting');
    expect(posting).toMatchObject({
      headline: 'alpha title',
      url: 'https://lopsy.art/blog/alpha/',
      author: { '@type': 'Person', name: 'Seamus' },
      keywords: 'webgl',
    });
  });

  it('shows the hero under the header, as the list thumbnail and as the share image', () => {
    const result = build([source('alpha', 'hero: fig.png\nheroAlt: A grid of compositions')]);
    const html = result.files.get('blog/alpha/index.html') as string;
    expect(html).toMatch(/<figure class="post-hero"><img src="\/blog\/alpha\/fig.png" alt="A grid of compositions" width="1600" height="900" fetchpriority="high"/);
    expect(html).toContain('<meta property="og:image" content="https://lopsy.art/blog/alpha/fig.png">');
    expect(html).toContain('<meta property="og:image:width" content="1600">');
    const posting = jsonLd(html)['@graph'].find((node) => node['@type'] === 'BlogPosting');
    expect(posting?.image).toEqual([{ '@type': 'ImageObject', url: 'https://lopsy.art/blog/alpha/fig.png', width: 1600, height: 900 }]);

    const index = result.files.get('blog/index.html') as string;
    expect(index).toContain('<li class="post-summary has-image">');
    expect(index).toMatch(/<a class="post-summary-image" href="\/blog\/alpha\/" tabindex="-1" aria-hidden="true"><img src="\/blog\/alpha\/fig.png"/);
  });

  it('keeps a square hero to the text width', () => {
    const square = source('alpha', 'hero: sq.png\nheroAlt: A square collage', undefined, ['sq.png']);
    const html = buildBlog({ sources: [square], css: '', shouldIncludeDrafts: false }).files.get('blog/alpha/index.html') as string;
    expect(html).toContain('<figure class="post-hero is-tall">');
    expect(build([source('alpha', 'hero: fig.png\nheroAlt: Wide')]).files.get('blog/alpha/index.html')).toContain('<figure class="post-hero">');
  });

  it('uses a separate share image for link previews and lists both in structured data', () => {
    const result = build([source('alpha', 'hero: fig.png\nheroAlt: A square collage\nshare: og.png', undefined, ['og.png'])]);
    expect(result.errors).toEqual([]);
    expect(result.files.has('blog/alpha/og.png')).toBe(true);
    const html = result.files.get('blog/alpha/index.html') as string;
    expect(html).toContain('<meta property="og:image" content="https://lopsy.art/blog/alpha/og.png">');
    expect(html).toContain('<meta name="twitter:image" content="https://lopsy.art/blog/alpha/og.png">');
    expect(html).toContain('<meta property="og:image:alt" content="A square collage">');
    expect(html).toContain('<figure class="post-hero"><img src="/blog/alpha/fig.png"');
    expect(result.files.get('blog/index.html')).toMatch(/<a class="post-summary-image"[^>]*><img src="\/blog\/alpha\/og.png"/);
    const posting = jsonLd(html)['@graph'].find((node) => node['@type'] === 'BlogPosting');
    expect((posting?.image as Array<{ url: string }>).map((image) => image.url)).toEqual([
      'https://lopsy.art/blog/alpha/fig.png',
      'https://lopsy.art/blog/alpha/og.png',
    ]);
  });

  it('falls back to the site share image without a hero', () => {
    const html = build([source('alpha', '')]).files.get('blog/alpha/index.html') as string;
    expect(html).not.toContain('post-hero');
    expect(html).toContain('<meta property="og:image" content="https://lopsy.art/og-image.jpg">');
  });

  it('adds the code copy script only to posts with code blocks', () => {
    const withCode = build([source('alpha', '', '```ts\nconst a = 1;\n```')]).files.get('blog/alpha/index.html') as string;
    expect(withCode).toContain("button.className = 'code-copy'");
    expect(build([source('alpha', '')]).files.get('blog/alpha/index.html')).not.toContain('code-copy');
  });

  it('publishes gallery images and adds the gallery script only when there is a gallery', () => {
    const result = build([source('alpha', '', '![One](fig.png)\n![Two](two.png)', ['two.png'])]);
    expect(result.errors).toEqual([]);
    expect(result.files.has('blog/alpha/two.png')).toBe(true);
    const html = result.files.get('blog/alpha/index.html') as string;
    expect(html).toContain('<figure class="post-gallery-figure"><div class="post-gallery">');
    expect(html).toContain("el.className = 'gallery-nav gallery-' + direction;");
    expect(build([source('alpha', '')]).files.get('blog/alpha/index.html')).not.toContain('gallery-nav');
  });

  it('writes an Atom feed with absolute image URLs', () => {
    const feed = build([source('alpha', 'published: 2026-09-01 08:15\nupdated: 2026-09-04')]).files.get('blog/feed.xml') as string;
    expect(feed).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(feed).toContain('<id>https://lopsy.art/blog/alpha/</id>');
    expect(feed).toContain('<published>2026-09-01T08:15:00Z</published>');
    expect(feed).toContain('<updated>2026-09-04T00:00:00Z</updated>');
    expect(feed).toContain('<author><name>Lopsy</name></author>');
    expect(feed).toContain('src=&quot;https://lopsy.art/blog/alpha/fig.png&quot;');
  });

  it('leaves drafts out of production builds but shows them in dev', () => {
    const sources = [source('alpha', ''), source('beta', 'draft: true')];
    expect(build(sources).files.has('blog/beta/index.html')).toBe(false);
    expect(build(sources).files.get('blog/feed.xml')).not.toContain('beta');
    expect(build(sources, true).files.has('blog/beta/index.html')).toBe(true);
  });

  it('fails on missing, nested and unreadable images', () => {
    const bad = source('alpha', '', '![a](missing.png)\n\n![b](dir/x.png)\n\n![c](notes.txt)', ['notes.txt']);
    bad.assets.set('notes.txt', new TextEncoder().encode('hello'));
    const result = build([bad]);
    expect(result.files.size).toBe(0);
    expect(result.errors).toEqual([
      'blog/alpha: image "missing.png" does not exist.',
      'blog/alpha: image "dir/x.png" must sit next to index.md (no sub-directories or URLs).',
      'blog/alpha: image "notes.txt" is not a readable PNG, JPEG, WebP or GIF.',
    ]);
  });

  it('shows the summary on the list with a Read more link to the post', () => {
    const index = build([source('alpha', 'summary: A *longer* blurb for the list.')]).files.get('blog/index.html') as string;
    expect(index).toContain(
      '<p>A <em>longer</em> blurb for the list. <a class="read-more" href="/blog/alpha/" aria-label="Read more: alpha title">Read more...</a></p>',
    );
    expect(build([source('alpha', '')]).files.get('blog/index.html')).toContain('guideline for alpha. <a class="read-more"');
  });

  it('uses the summary as the article subheadline and keeps the description for search', () => {
    const html = build([source('alpha', 'summary: A *longer* blurb.')]).files.get('blog/alpha/index.html') as string;
    expect(html).toContain('<p class="lede">A <em>longer</em> blurb.</p>');
    expect(html).toContain('<meta name="description" content="A description long enough to satisfy the search snippet guideline for alpha.">');
  });

  it('uses the same dot rule under the post byline', () => {
    const post = build([source('alpha', '')]).files.get('blog/alpha/index.html') as string;
    expect(post).toMatch(/<p class="post-byline">[^]*?<\/p>\s*<svg class="dot-rule"/);
  });

  it('draws a dot rule under the heading that spreads out to the right', () => {
    const index = build([source('alpha', '')]).files.get('blog/index.html') as string;
    const xs = [...index.matchAll(/<circle cx="([\d.]+)%"/g)].map((m) => Number(m[1]));
    expect(xs[0]).toBe(0);
    expect(xs[xs.length - 1]).toBe(100);
    const gaps = xs.slice(1).map((x, i) => x - (xs[i] ?? 0));
    // Positions are rounded to 0.001%, so neighbouring gaps in the solid start can tie.
    expect(gaps.every((gap, i) => i === 0 || gap >= (gaps[i - 1] ?? 0) - 0.002)).toBe(true);
    // Most dots are packed into the first quarter, and the last gap is far wider than the first.
    expect(xs.filter((x) => x < 25).length).toBeGreaterThan(xs.length / 2);
    expect((gaps[gaps.length - 1] ?? 0) / (gaps[0] ?? 1)).toBeGreaterThan(15);
    // At 1080 px the first dots (3 px wide) overlap, so the rule starts as a solid line.
    expect(((gaps[0] ?? 0) / 100) * 1080).toBeLessThan(3);
  });

  it('shows an empty state when there are no posts', () => {
    const result = build([]);
    expect(result.files.get('blog/index.html')).toContain('The first post is on its way');
    expect(result.sitemapEntries).toEqual([{ path: '/blog/', lastmod: '' }]);
  });

  it('reports sitemap entries with lastmod dates', () => {
    expect(build([source('alpha', 'updated: 2026-09-20')]).sitemapEntries).toEqual([
      { path: '/blog/', lastmod: '2026-09-20' },
      { path: '/blog/alpha/', lastmod: '2026-09-20' },
    ]);
  });
});
