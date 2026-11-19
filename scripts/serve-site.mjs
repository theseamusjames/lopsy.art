#!/usr/bin/env node
/**
 * Serves a built site the way Cloudflare Pages does, for local previews and
 * Photonamous' site smoke test: static files win; otherwise the first
 * matching `_redirects` rule applies (200 rewrites, 301/302 redirects);
 * `_headers` blocks whose path matches add their headers; a directory
 * serves its index.html; nothing found is a 404. The directory defaults to
 * Photonamous' build; `--dir apps/lopsy-web/dist` serves Lopsy's.
 *
 *   node scripts/serve-site.mjs [--dir apps/photonamous/dist] [--port 4180] [--host 127.0.0.1]
 *
 * Listens on the loopback interface only, unless --host or SITE_HOST says
 * otherwise (0.0.0.0 to reach it from another device on the network).
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, createReadStream } from 'node:fs';
import { extname, join, normalize, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const dir = resolve(root, arg('--dir', 'apps/photonamous/dist'));
const port = Number(arg('--port', process.env.PORT ?? '4180'));
const host = arg('--host', process.env.SITE_HOST ?? '127.0.0.1');
if (!existsSync(join(dir, 'index.html')) && !existsSync(join(dir, '_redirects'))) {
  console.error(`serve-site: ${dir} has no site in it. Build it first (npm run build:photos, or npm run build for Lopsy).`);
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

/** A Pages path pattern as a RegExp: `*` matches anything, `:name` one segment. */
function pattern(path) {
  const source = path
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z]\w*/g, '[^/]+'))
    .join('.*');
  return new RegExp(`^${source}$`);
}

function readRules(file, parse) {
  return existsSync(file) ? parse(readFileSync(file, 'utf8')) : [];
}

const redirects = readRules(join(dir, '_redirects'), (text) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [from, to, status = '302'] = line.split(/\s+/);
      return { match: pattern(from), to, status: Number(status) };
    }),
);

const headerBlocks = readRules(join(dir, '_headers'), (text) => {
  const blocks = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      blocks.push({ match: pattern(line.trim()), headers: [] });
      continue;
    }
    const colon = line.indexOf(':');
    if (colon > 0 && blocks.length > 0) blocks[blocks.length - 1].headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return blocks;
});

/** The file a URL path names, if any: the file itself, or a directory's index.html. */
function staticFile(path) {
  const full = normalize(join(dir, path));
  if (full !== dir && !full.startsWith(dir + sep)) return null;
  if (existsSync(full) && statSync(full).isFile()) return full;
  const index = join(full, 'index.html');
  return existsSync(index) ? index : null;
}

function send(response, status, file, path) {
  const headers = { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' };
  for (const block of headerBlocks) if (block.match.test(path)) for (const [name, value] of block.headers) headers[name] = value;
  response.writeHead(status, headers);
  createReadStream(file).pipe(response);
}

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  let path;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }
  // Pages' pretty URLs: an .html file is served without its extension, and
  // asking for it by name redirects there (`/x/index.html` to `/x/`, `/x.html` to `/x`).
  if (path.endsWith('.html') && staticFile(path)) {
    const pretty = path.endsWith('/index.html') ? path.slice(0, -'index.html'.length) : path.slice(0, -'.html'.length);
    response.writeHead(308, { Location: `${pretty}${url.search}` }).end();
    return;
  }
  const file = staticFile(path) ?? (path.endsWith('/') ? null : staticFile(`${path}.html`));
  if (file) {
    // Pages serves a directory at its slash URL.
    if (file.endsWith(`${sep}index.html`) && !path.endsWith('/') && !path.endsWith('index.html')) {
      response.writeHead(308, { Location: `${path}/${url.search}` }).end();
      return;
    }
    send(response, 200, file, path);
    return;
  }
  for (const rule of redirects) {
    if (!rule.match.test(path)) continue;
    if (rule.status === 200) {
      const target = staticFile(rule.to);
      if (target) {
        send(response, 200, target, path);
        return;
      }
      continue;
    }
    response.writeHead(rule.status, { Location: rule.to }).end();
    return;
  }
  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
}).listen(port, host, () => {
  console.log(`serve-site: ${dir} at http://${host}:${port}/`);
});
