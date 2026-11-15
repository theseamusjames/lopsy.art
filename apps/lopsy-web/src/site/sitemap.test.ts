import { describe, expect, it } from 'vitest';
import { latestDate, renderSitemap } from './sitemap';

describe('renderSitemap', () => {
  it('lists the home page and every entry, with lastmod only when known', () => {
    const sitemap = renderSitemap([
      { path: '/tutorials/', lastmod: '2026-04-02' },
      { path: '/blog/', lastmod: '' },
    ]);
    expect(sitemap).toContain('<url><loc>https://lopsy.art/</loc></url>');
    expect(sitemap).toContain('<url><loc>https://lopsy.art/tutorials/</loc><lastmod>2026-04-02</lastmod></url>');
    expect(sitemap).toContain('<url><loc>https://lopsy.art/blog/</loc></url>');
  });
});

describe('latestDate', () => {
  it('picks the newest ISO date, or an empty string for none', () => {
    expect(latestDate(['2026-01-02', '2026-03-01', '2025-12-31'])).toBe('2026-03-01');
    expect(latestDate([])).toBe('');
  });
});
