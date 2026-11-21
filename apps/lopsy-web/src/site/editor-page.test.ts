import { describe, expect, it } from 'vitest';
import {
  AUTHOR_NAME,
  AUTHOR_URL,
  BLOG_PATH,
  DEFAULT_OG_IMAGE,
  SITE_NAME,
  SOURCE_URL,
  TUTORIALS_PATH,
  absoluteUrl,
} from './tutorials/site-config';

const html = Object.values(
  import.meta.glob('/index.html', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>,
)[0]!;

function only(pattern: RegExp): string {
  const matches = [...html.matchAll(pattern)];
  expect(matches).toHaveLength(1);
  return matches[0]?.[1] ?? '';
}

describe('the editor page, as a crawler that runs no scripts reads it', () => {
  it('describes the app in JSON-LD that parses and names the site as site-config does', () => {
    const app = JSON.parse(only(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) as Record<string, unknown>;

    expect(app['@type']).toBe('WebApplication');
    expect(app.name).toBe(SITE_NAME);
    expect(app.url).toBe(absoluteUrl('/'));
    expect(app.image).toBe(absoluteUrl(DEFAULT_OG_IMAGE));
    expect(app.author).toMatchObject({ name: AUTHOR_NAME, url: AUTHOR_URL });
    expect(app.sameAs).toEqual([SOURCE_URL]);
    expect(app.softwareHelp).toMatchObject({ url: absoluteUrl(TUTORIALS_PATH) });
    expect(app.offers).toMatchObject({ price: '0' });

    const features = app.featureList as string[];
    expect(features.length).toBeGreaterThan(0);
    expect(new Set(features).size).toBe(features.length);
  });

  it('names its canonical URL', () => {
    expect(only(/<link rel="canonical" href="([^"]*)"/g)).toBe(absoluteUrl('/'));
  });

  it('says what Lopsy is and links the rest of the site when scripts are off', () => {
    const fallback = only(/<body>[\s\S]*?<noscript>([\s\S]*?)<\/noscript>\s*<div id="root">/g);

    expect(fallback).toContain('<h1>');
    for (const path of [TUTORIALS_PATH, BLOG_PATH, '/SKILL.md', '/FEATURES.md', '/llms.txt']) {
      expect(fallback).toContain(`href="${path}"`);
    }
    expect(fallback).toContain(`href="${SOURCE_URL}"`);
  });
});
