import { describe, expect, it } from 'vitest';
import {
  AUTHOR_NAME,
  AUTHOR_URL,
  BLOG_PATH,
  DEFAULT_OG_IMAGE,
  SITE_NAME,
  SITE_TAGLINE,
  SOURCE_URL,
  TUTORIALS_PATH,
  absoluteUrl,
} from './tutorials/site-config';

const html = Object.values(
  import.meta.glob('/index.html', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>,
)[0]!;

const llms = Object.values(
  import.meta.glob('/public/llms.txt', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>,
)[0]!;

/** The tagline opens a sentence in some places, so its first letter's case varies. */
function saysTagline(text: string): boolean {
  return text.toLowerCase().includes(SITE_TAGLINE.toLowerCase());
}

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

  it('says the site tagline in every description, in the fallback and in llms.txt, but in no title', () => {
    const descriptions = [...html.matchAll(/<meta (?:name|property)="(?:og:|twitter:)?description" content="([^"]*)"/g)];
    expect(descriptions).toHaveLength(3);
    for (const description of descriptions) expect(saysTagline(description[1] ?? '')).toBe(true);

    const app = JSON.parse(only(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) as { description: string };
    expect(saysTagline(app.description)).toBe(true);
    expect(saysTagline(only(/<body>[\s\S]*?<noscript>([\s\S]*?)<\/noscript>\s*<div id="root">/g).replace(/\s+/g, ' '))).toBe(true);
    expect(saysTagline(llms)).toBe(true);

    const titles = [...html.matchAll(/<title>([^<]*)<\/title>|<meta (?:name|property)="(?:og:|twitter:)title" content="([^"]*)"/g)];
    expect(titles).toHaveLength(3);
    for (const title of titles) expect(saysTagline(title[1] ?? title[2] ?? '')).toBe(false);
  });

  it('names its canonical URL', () => {
    expect(only(/<link rel="canonical" href="([^"]*)"/g)).toBe(absoluteUrl('/'));
  });

  it('points agents at llms.txt in a link and at SKILL.md in text a browser exposes', () => {
    expect(only(/<link rel="describedby" href="([^"]*)"/g)).toBe('/llms.txt');

    const note = only(/<p class="agent-note">([\s\S]*?)<\/p>/g);
    expect(note).toContain('window.lopsy');
    expect(note).toContain('/SKILL.md');
    expect(note).toContain('Agents are welcome to sign our guestbook! Use lopsy.describe() for more information.');
    expect(note).not.toContain('<');

    const withoutNoscript = html.replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
    expect(withoutNoscript).toContain('<p class="agent-note">');
    const rule = /\.agent-note \{([^}]*)\}/.exec(withoutNoscript)?.[1] ?? '';
    expect(rule).toContain('clip-path');
    expect(rule).not.toMatch(/display:\s*none|visibility:\s*hidden/);
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
