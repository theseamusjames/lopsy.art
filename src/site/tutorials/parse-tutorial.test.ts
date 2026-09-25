import { describe, expect, it } from 'vitest';
import { parseFrontmatterBlock, parseTutorial } from './parse-tutorial';

const VALID = `---
title: Paint a Sunset
description: Blend three brush colors into a glowing sunset sky using layers and the soft round brush.
published: 2026-03-01
updated: 2026-03-04
level: beginner
duration: 12 min
tags: Painting, brushes
related: [make-clouds, glow-effects]
---

Intro text.

## Create a new canvas

![The New Document dialog](01-new.webp)

Choose **File → New**.

## Paint the sky

Pick a warm orange.

![A half-painted sky](02-sky.png)
`;

describe('parseFrontmatterBlock', () => {
  it('reads key/value pairs, skipping comments and blank lines', () => {
    const fields = parseFrontmatterBlock('# comment\ntitle: A: B\n\ndescription: "quoted"');
    expect(fields.get('title')).toBe('A: B');
    expect(fields.get('description')).toBe('quoted');
    expect(fields.has('# comment')).toBe(false);
  });
});

describe('parseTutorial', () => {
  it('parses frontmatter, intro and steps', () => {
    const { tutorial, errors, warnings } = parseTutorial('paint-a-sunset', VALID);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(tutorial).toMatchObject({
      slug: 'paint-a-sunset',
      title: 'Paint a Sunset',
      published: '2026-03-01',
      updated: '2026-03-04',
      level: 'Beginner',
      duration: 12,
      tags: ['painting', 'brushes'],
      related: ['make-clouds', 'glow-effects'],
      cover: null,
      isDraft: false,
      intro: 'Intro text.',
    });
    expect(tutorial?.steps).toEqual([
      {
        title: 'Create a new canvas',
        id: 'step-1',
        image: { src: '01-new.webp', alt: 'The New Document dialog' },
        body: 'Choose **File → New**.',
      },
      {
        title: 'Paint the sky',
        id: 'step-2',
        image: { src: '02-sky.png', alt: 'A half-painted sky' },
        body: 'Pick a warm orange.',
      },
    ]);
  });

  it('defaults updated to published and reads drafts', () => {
    const source = VALID.replace('updated: 2026-03-04\n', '').replace('level: beginner', 'draft: true');
    const { tutorial } = parseTutorial('paint-a-sunset', source);
    expect(tutorial?.updated).toBe('2026-03-01');
    expect(tutorial?.isDraft).toBe(true);
    expect(tutorial?.level).toBeNull();
  });

  it('handles Windows line endings', () => {
    const { tutorial, errors } = parseTutorial('paint-a-sunset', VALID.replace(/\n/g, '\r\n'));
    expect(errors).toEqual([]);
    expect(tutorial?.steps).toHaveLength(2);
  });

  it('requires a frontmatter block', () => {
    const { tutorial, errors } = parseTutorial('x', '## Step\n![a](b.png)\ntext');
    expect(tutorial).toBeNull();
    expect(errors).toContain('Missing `---` frontmatter block at the top.');
  });

  it('reports missing fields and bad values', () => {
    const source = `---
published: March 1st
level: expert
duration: soon
cover: c.webp
---
## Step
![a](a.png)
text`;
    const { tutorial, errors } = parseTutorial('x', source);
    expect(tutorial).toBeNull();
    expect(errors).toEqual(
      expect.arrayContaining([
        'Missing `title`.',
        'Missing `description`.',
        '`published` must be a date in YYYY-MM-DD form.',
        '`level` must be one of: Beginner, Intermediate, Advanced.',
        '`duration` must be a whole number of minutes.',
        '`cover` needs a `coverAlt` description.',
      ]),
    );
  });

  it('rejects updated dates before published', () => {
    const { errors } = parseTutorial('paint-a-sunset', VALID.replace('updated: 2026-03-04', 'updated: 2026-02-01'));
    expect(errors).toContain('`updated` is earlier than `published`.');
  });

  it('requires exactly one image with alt text and some text per step', () => {
    const source = VALID.replace('![A half-painted sky](02-sky.png)', '![](02-sky.png)\n![more](03.png)');
    const { errors } = parseTutorial('paint-a-sunset', source);
    expect(errors).toContain('Step 2 ("Paint the sky") needs exactly one image, found 2.');
    expect(errors).toContain('Step 2 ("Paint the sky") image is missing alt text.');

    const noText = parseTutorial('paint-a-sunset', VALID.replace('Pick a warm orange.', ''));
    expect(noText.errors).toContain('Step 2 ("Paint the sky") has no text.');
  });

  it('requires at least one step and forbids h1 headings', () => {
    const source = VALID.replace(/## [\s\S]*$/, '# Big heading\n');
    const { errors } = parseTutorial('paint-a-sunset', source);
    expect(errors).toContain('A tutorial needs at least one `## ` step.');
    expect(errors).toContain('Use `## ` for step headings only; the page title comes from `title`.');
  });

  it('rejects slugs that are not lowercase-hyphenated', () => {
    const { errors } = parseTutorial('Paint_Sunset', VALID);
    expect(errors[0]).toMatch(/must be lowercase words separated by hyphens/);
  });

  it('warns about search-unfriendly lengths and missing tags', () => {
    const source = VALID.replace('title: Paint a Sunset', `title: ${'Long '.repeat(15)}`)
      .replace(/description: .*/, 'description: Too short.')
      .replace('tags: Painting, brushes', 'tags:');
    const { tutorial, warnings } = parseTutorial('paint-a-sunset', source);
    expect(tutorial).not.toBeNull();
    expect(warnings).toHaveLength(3);
  });
});
