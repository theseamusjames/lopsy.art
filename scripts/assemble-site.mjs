#!/usr/bin/env node
/**
 * Assembles the lopsy.art site (docs/lopsy-photos-spec.md, 6.2 and 6.3):
 * Lopsy at `/` from apps/lopsy-web/dist and Lopsy Photos at `/photos/`
 * from apps/lopsy-photos/dist (built with PHOTOS_BASE=/photos/), into a
 * root dist/ that Cloudflare Pages publishes.
 *
 * Photos' own _redirects and _headers (written for serving it at `/` on its
 * own domain) are moved under `/photos/` and merged ahead of Lopsy's, so
 * Photos' SPA rule comes before Lopsy's catch-all `/* /index.html 200`.
 *
 * Never writes a root 404.html: Pages treats the site as an SPA only while
 * there is none (MEMORY.md).
 *
 *   node scripts/assemble-site.mjs [--out dist] [--photos-only]
 *
 * --photos-only leaves Lopsy out (Photos at /photos/ and nothing at /), for
 * Photos' own e2e tests without building Lopsy's 900 MB of tutorials.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outArg = process.argv.indexOf('--out');
const out = resolve(root, outArg >= 0 ? process.argv[outArg + 1] : 'dist');
const photosOnly = process.argv.includes('--photos-only');
const lopsyDist = join(root, 'apps/lopsy-web/dist');
const photosDist = join(root, 'apps/lopsy-photos/dist');
const PHOTOS_PATH = '/photos';

function fail(message) {
  console.error(`assemble-site: ${message}`);
  process.exit(1);
}

function requireDist(dir, how) {
  if (!existsSync(join(dir, 'index.html'))) fail(`${dir}/index.html is missing. Build it first: ${how}`);
}

if (!photosOnly) requireDist(lopsyDist, 'npm run build');
requireDist(photosDist, 'PHOTOS_BASE=/photos/ npm run build -w lopsy-photos');
const photosIndex = readFileSync(join(photosDist, 'index.html'), 'utf8');
if (!photosIndex.includes(`${PHOTOS_PATH}/assets/`)) {
  fail(`apps/lopsy-photos/dist was not built for ${PHOTOS_PATH}/ (its index.html does not load ${PHOTOS_PATH}/assets/). Rebuild with PHOTOS_BASE=/photos/.`);
}
if (!photosOnly && existsSync(join(lopsyDist, PHOTOS_PATH.slice(1)))) fail(`apps/lopsy-web/dist already has a ${PHOTOS_PATH}/ folder`);

const readText = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');

/** Moves a Pages path pattern under the Photos path: `/*` becomes `/photos/*`. */
function underPhotos(path) {
  if (/^https?:\/\//.test(path)) return path;
  if (!path.startsWith('/')) fail(`Photos _redirects or _headers has a path that does not start with '/': ${path}`);
  return `${PHOTOS_PATH}${path}`;
}

function photosRedirects(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const [from, to, ...rest] = line.split(/\s+/);
      if (!from || !to) fail(`Bad line in Photos _redirects: ${line}`);
      return [underPhotos(from), underPhotos(to), ...rest].join(' ');
    });
}

function photosHeaders(text) {
  return text.split('\n').map((line) => {
    if (line.trim() === '' || line.trim().startsWith('#') || /^\s/.test(line)) return line;
    return underPhotos(line.trim());
  });
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
if (!photosOnly) cpSync(lopsyDist, out, { recursive: true });
const photosOut = join(out, PHOTOS_PATH.slice(1));
cpSync(photosDist, photosOut, {
  recursive: true,
  filter: (source) => !['_redirects', '_headers'].includes(source.slice(photosDist.length + 1)),
});

const redirects = [
  '# Lopsy Photos, first: Pages applies the first rule that matches.',
  ...photosRedirects(readText(join(photosDist, '_redirects'))),
  '',
  '# Lopsy',
  photosOnly ? '' : readText(join(lopsyDist, '_redirects')).trim(),
  '',
].join('\n');
if (!/^\/photos\/\*\s+\/photos\/index\.html\s+200$/m.test(redirects)) fail('Photos _redirects did not give /photos/* /photos/index.html 200');
writeFileSync(join(out, '_redirects'), redirects);

const headers = [photosOnly ? '' : readText(join(lopsyDist, '_headers')).trimEnd(), '', '# Lopsy Photos', ...photosHeaders(readText(join(photosDist, '_headers')).trim()), ''].join('\n');
if (!headers.includes(`${PHOTOS_PATH}/*`)) fail('Photos _headers has no /* block');
writeFileSync(join(out, '_headers'), headers);

if (existsSync(join(out, '404.html'))) fail('The assembled site has a root 404.html, which would break deep links (MEMORY.md)');

function measure(dir) {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const inner = measure(path);
      files += inner.files;
      bytes += inner.bytes;
    } else {
      files += 1;
      bytes += statSync(path).size;
    }
  }
  return { files, bytes };
}

const all = measure(out);
const photos = measure(photosOut);
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
console.log(`assemble-site: ${out}: ${all.files} files, ${mb(all.bytes)} (Photos: ${photos.files} files, ${mb(photos.bytes)})`);
