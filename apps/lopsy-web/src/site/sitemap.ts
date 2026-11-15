import { absoluteUrl } from './tutorials/site-config';

export interface SitemapEntry {
  /** Site-relative path, e.g. `/tutorials/alpha/`. */
  path: string;
  /** ISO date, YYYY-MM-DD. Empty when unknown. */
  lastmod: string;
}

/** Newest of `dates` (ISO, so they sort as strings), or `''` when there are none. */
export function latestDate(dates: readonly string[]): string {
  return dates.reduce((max, date) => (date > max ? date : max), '');
}

/** One sitemap for the whole site; every static section contributes its entries. */
export function renderSitemap(entries: readonly SitemapEntry[]): string {
  const urls = [{ path: '/', lastmod: '' }, ...entries].map(({ path, lastmod }) =>
    `  <url><loc>${absoluteUrl(path)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}
