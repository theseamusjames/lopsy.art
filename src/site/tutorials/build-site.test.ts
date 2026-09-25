import { describe, expect, it } from 'vitest';
import { buildTutorialSite } from './build-site';
import type { SourceTutorial } from './types';

function png(width: number, height: number): Uint8Array {
  const out = new Uint8Array(32);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(out.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return out;
}

function webp(width: number, height: number): Uint8Array {
  const out = new Uint8Array(32);
  out.set([...'RIFF'].map((c) => c.charCodeAt(0)));
  out.set([...'WEBPVP8 '].map((c) => c.charCodeAt(0)), 8);
  const view = new DataView(out.buffer);
  view.setUint16(26, width, true);
  view.setUint16(28, height, true);
  return out;
}

function source(slug: string, frontmatter: string, extraAssets: string[] = []): SourceTutorial {
  const assets = new Map<string, Uint8Array>([
    ['01.png', png(1600, 1000)],
    ['02.png', png(1600, 900)],
  ]);
  for (const name of extraAssets) assets.set(name, png(10, 10));
  return {
    slug,
    source: `---
title: ${slug} title
description: A description long enough to satisfy the search snippet guideline for ${slug}.
published: 2026-02-0${slug.length % 9 + 1}
tags: masks
${frontmatter}
---
Intro with <b>markup</b>.

## First step

![First screenshot](01.png)

Press [[B]] for the brush.

## Second "step"

![Second screenshot](02.png)

Done.
`,
    assets,
  };
}

function build(sources: SourceTutorial[], shouldIncludeDrafts = false) {
  return buildTutorialSite({ sources, css: 'body{}', shouldIncludeDrafts });
}

function jsonLd(html: string): { '@graph': Array<Record<string, unknown>> } {
  const match = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html);
  return JSON.parse(match?.[1] ?? '{}');
}

describe('buildTutorialSite', () => {
  it('emits the index, a page per tutorial, used images and a sitemap', () => {
    const result = build([source('alpha', 'related: beta', ['unused.png']), source('beta', '')]);
    expect(result.errors).toEqual([]);
    expect([...result.files.keys()].sort()).toEqual([
      'sitemap.xml',
      'tutorials/alpha/01.png',
      'tutorials/alpha/02.png',
      'tutorials/alpha/index.html',
      'tutorials/beta/01.png',
      'tutorials/beta/02.png',
      'tutorials/beta/index.html',
      'tutorials/index.html',
    ]);
    expect(result.warnings).toContain('tutorials/alpha: "unused.png" is not used and won\'t be published.');
  });

  it('renders SEO metadata and structured data on tutorial pages', () => {
    const { files } = build([source('alpha', 'duration: 5\nupdated: 2026-03-01'), source('beta', '')]);
    const html = files.get('tutorials/alpha/index.html') as string;

    expect(html).toContain('<title>alpha title | Lopsy Tutorial</title>');
    expect(html).toContain('<link rel="canonical" href="https://lopsy.art/tutorials/alpha/">');
    expect(html).toContain('<meta property="og:image" content="https://lopsy.art/tutorials/alpha/02.png">');
    expect(html).toContain('<meta property="og:image:width" content="1600">');
    expect(html).toContain('<meta property="og:image:height" content="900">');
    expect(html).toContain('<meta property="article:modified_time" content="2026-03-01">');
    expect(html).toContain('<h1>alpha title</h1>');
    expect(html).toContain('Updated <time datetime="2026-03-01">March 1, 2026</time>');
    expect(html).toContain('width="1600" height="1000"');
    expect(html).toContain('<kbd>B</kbd>');
    expect(html).toContain('Intro with &lt;b&gt;markup&lt;/b&gt;.');
    expect(html).toContain('Second &quot;step&quot;');
    expect(html).toContain('id="related-heading"');
    expect(html).toContain('href="/tutorials/beta/"');

    const [howTo, breadcrumbs] = jsonLd(html)['@graph'];
    expect(howTo).toMatchObject({
      '@type': 'HowTo',
      name: 'alpha title',
      totalTime: 'PT5M',
      dateModified: '2026-03-01',
      image: { url: 'https://lopsy.art/tutorials/alpha/02.png', width: 1600, height: 900 },
    });
    expect(howTo?.step).toEqual([
      expect.objectContaining({ name: 'First step', text: 'Press B for the brush.', url: 'https://lopsy.art/tutorials/alpha/#step-1' }),
      expect.objectContaining({ name: 'Second "step"', image: 'https://lopsy.art/tutorials/alpha/02.png' }),
    ]);
    expect(breadcrumbs).toMatchObject({ '@type': 'BreadcrumbList' });
  });

  it('warns when the social share image is WebP', () => {
    const tutorial = source('alpha', '');
    tutorial.source = tutorial.source.replace('(02.png)', '(02.webp)');
    tutorial.assets.set('02.webp', webp(1600, 900));
    tutorial.assets.delete('02.png');
    expect(build([tutorial]).warnings).toContain(
      'tutorials/alpha: the social share image "02.webp" is WebP, which some networks won\'t preview. Set `cover` to a JPEG.',
    );
  });

  it('only loads the first step image eagerly', () => {
    const html = build([source('alpha', '')]).files.get('tutorials/alpha/index.html') as string;
    expect(html.match(/fetchpriority="high"/g)).toHaveLength(1);
  });

  it('lists tutorials newest first with an ItemList', () => {
    const { files } = build([source('old', 'published: 2025-01-01'), source('new', 'published: 2026-06-01')]);
    const html = files.get('tutorials/index.html') as string;
    expect(html.indexOf('/tutorials/new/')).toBeLessThan(html.indexOf('/tutorials/old/'));
    const [page] = jsonLd(html)['@graph'];
    expect(page).toMatchObject({ '@type': 'CollectionPage', mainEntity: { numberOfItems: 2 } });
  });

  it('orders same-day tutorials by publish time', () => {
    const { files } = build([
      source('morning', 'published: 2026-06-01 08:00'),
      source('evening', 'published: 2026-06-01 20:30'),
    ]);
    const html = files.get('tutorials/index.html') as string;
    expect(html.indexOf('/tutorials/evening/')).toBeLessThan(html.indexOf('/tutorials/morning/'));
    expect(html).not.toContain('20:30');
  });

  it('renders an empty state when nothing is published', () => {
    const html = build([]).files.get('tutorials/index.html') as string;
    expect(html).toContain('class="empty"');
  });

  it('includes drafts only when asked', () => {
    const sources = [source('draft-one', 'draft: true')];
    expect(build(sources).files.has('tutorials/draft-one/index.html')).toBe(false);
    expect(build(sources, true).files.has('tutorials/draft-one/index.html')).toBe(true);
  });

  it('skips related links to drafts without erroring', () => {
    const result = build([source('alpha', 'related: beta'), source('beta', 'draft: true')]);
    expect(result.errors).toEqual([]);
    expect(result.files.get('tutorials/alpha/index.html')).not.toContain('/tutorials/beta/');
  });

  it('writes a sitemap with lastmod dates', () => {
    const sitemap = build([source('alpha', 'updated: 2026-04-02')]).files.get('sitemap.xml') as string;
    expect(sitemap).toContain('<url><loc>https://lopsy.art/</loc></url>');
    expect(sitemap).toContain('<url><loc>https://lopsy.art/tutorials/</loc><lastmod>2026-04-02</lastmod></url>');
    expect(sitemap).toContain('<url><loc>https://lopsy.art/tutorials/alpha/</loc><lastmod>2026-04-02</lastmod></url>');
  });

  it('fails on missing images, unreadable images and unknown related slugs', () => {
    const broken = source('alpha', 'related: nope');
    broken.assets.delete('01.png');
    broken.assets.set('02.png', new Uint8Array(40));
    const result = build([broken]);
    expect(result.files.size).toBe(0);
    expect(result.errors).toEqual([
      'tutorials/alpha: related tutorial "nope" does not exist.',
      'tutorials/alpha: image "01.png" does not exist.',
      'tutorials/alpha: image "02.png" is not a readable PNG, JPEG, WebP or GIF.',
    ]);
  });

  it('rejects images outside the tutorial folder', () => {
    const escaping = source('alpha', '');
    escaping.source = escaping.source.replace('(01.png)', '(../beta/01.png)');
    expect(build([escaping]).errors[0]).toMatch(/must sit next to index.md/);
  });

  it('prefixes parse errors with the tutorial path', () => {
    const result = build([{ slug: 'bad', source: 'no frontmatter', assets: new Map() }]);
    expect(result.errors).toEqual(['tutorials/bad: Missing `---` frontmatter block at the top.']);
  });
});
