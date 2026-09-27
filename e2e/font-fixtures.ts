/**
 * Serve web-font requests from local fixtures via page.route so font tests are
 * deterministic and work offline: jsDelivr answers 404 (as it does for
 * families with no baked repo path, or files over its size limit), which
 * sends the loader down the Google Fonts css2 → WOFF2 path, and the css2 /
 * gstatic endpoints serve the latin subsets checked in under
 * engine-rs/crates/lopsy-wasm/tests/fixtures.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { Page } from './fixtures';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../engine-rs/crates/lopsy-wasm/tests/fixtures');

/** css2 family name → latin WOFF2 fixture served for it. */
const FONT_FIXTURES: Record<string, string> = {
  'IM Fell English': 'IMFellEnglish-latin.woff2',
  'IM Fell DW Pica SC': 'IMFellDWPicaSC-latin.woff2',
  Montserrat: 'Montserrat-wght-latin.woff2',
};

const CORS = { 'access-control-allow-origin': '*' };

function fixtureSlug(family: string): string {
  return family.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Serve fonts offline. `gstaticDelayMs` holds the WOFF2 responses back so a
 * test can observe what is drawn while the face is still loading.
 */
export async function serveFontsOffline(page: Page, gstaticDelayMs = 0): Promise<void> {
  await page.route('https://cdn.jsdelivr.net/**', (route) =>
    route.fulfill({ status: 404, headers: CORS, body: 'not found' }),
  );
  await page.route('https://fonts.googleapis.com/css2**', (route) => {
    const url = new URL(route.request().url());
    const css = url.searchParams
      .getAll('family')
      .map((spec) => {
        const [family = '', axes = ''] = spec.split(':');
        const weights = axes.startsWith('wght@') ? axes.slice(5).split(';') : ['400'];
        const file = FONT_FIXTURES[family];
        if (!file) return '';
        return weights
          .map(
            (weight) => `/* latin */
@font-face {
  font-family: '${family}';
  font-style: normal;
  font-weight: ${weight};
  src: url(https://fonts.gstatic.com/s/lopsy-test/${fixtureSlug(family)}.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}`,
          )
          .join('\n');
      })
      .join('\n');
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/css' }, body: css });
  });
  await page.route('https://fonts.gstatic.com/s/lopsy-test/**', async (route) => {
    const slug = route.request().url().split('/').pop()?.replace(/\.woff2$/, '') ?? '';
    const family = Object.keys(FONT_FIXTURES).find((f) => fixtureSlug(f) === slug);
    if (!family) return route.fulfill({ status: 404, headers: CORS, body: '' });
    if (gstaticDelayMs > 0) await new Promise((r) => setTimeout(r, gstaticDelayMs));
    return route.fulfill({
      status: 200,
      headers: { ...CORS, 'content-type': 'font/woff2' },
      body: fs.readFileSync(path.join(FIXTURES, FONT_FIXTURES[family]!)),
    });
  });
}
