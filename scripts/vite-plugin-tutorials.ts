/**
 * Generates the static tutorial pages under /tutorials/ from the Markdown
 * sources in tutorials/<slug>/index.md.
 *
 *   dev:   pages render on request (drafts included) and live-reload on save.
 *   build: pages, images and sitemap.xml are emitted into dist/. Content
 *          errors fail the build; SEO guideline misses print as warnings.
 *
 * All parsing and rendering lives in src/site/tutorials/ — this file only
 * touches the filesystem and Vite.
 */
import type { Plugin, ViteDevServer } from 'vite';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { buildTutorialSite, type BuildResult } from '../src/site/tutorials/build-site';
import { imageMimeType } from '../src/site/tutorials/image-size';
import type { SourceTutorial } from '../src/site/tutorials/types';

interface TutorialsPluginOptions {
  contentDir: string;
  cssFile: string;
}

function loadSources(contentDir: string): SourceTutorial[] {
  if (!existsSync(contentDir)) return [];
  return readdirSync(contentDir)
    .filter((name) => !name.startsWith('_') && !name.startsWith('.'))
    .filter((name) => existsSync(join(contentDir, name, 'index.md')))
    .map((slug) => {
      const dir = join(contentDir, slug);
      const assets = new Map<string, Uint8Array>();
      for (const file of readdirSync(dir)) {
        const path = join(dir, file);
        if (file === 'index.md' || file.startsWith('.') || !statSync(path).isFile()) continue;
        assets.set(file, readFileSync(path));
      }
      return { slug, source: readFileSync(join(dir, 'index.md'), 'utf8'), assets };
    });
}

function minifyCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

function build(options: TutorialsPluginOptions, isDev: boolean): BuildResult {
  return buildTutorialSite({
    sources: loadSources(options.contentDir),
    css: isDev ? readFileSync(options.cssFile, 'utf8') : minifyCss(readFileSync(options.cssFile, 'utf8')),
    shouldIncludeDrafts: isDev,
  });
}

function escapeForHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function renderErrorPage(errors: string[]): string {
  const items = errors.map((e) => `<li>${escapeForHtml(e)}</li>`).join('');
  return `<!DOCTYPE html><meta charset="utf-8"><title>Tutorial errors</title>
<script type="module" src="/@vite/client"></script>
<body style="font:15px/1.5 system-ui;padding:24px;background:#1e1e1e;color:#e0e0e0">
<h1 style="color:#f44336">Tutorial content errors</h1><ul>${items}</ul></body>`;
}

function contentType(path: string): string {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.xml')) return 'application/xml; charset=utf-8';
  return imageMimeType(path) ?? 'application/octet-stream';
}

function serveTutorials(server: ViteDevServer, options: TutorialsPluginOptions): void {
  server.watcher.add([options.contentDir, options.cssFile]);
  server.watcher.on('all', (_event, file) => {
    const isContent = !relative(options.contentDir, file).startsWith('..') || file === options.cssFile;
    if (isContent) server.ws.send({ type: 'full-reload', path: '*' });
  });

  server.middlewares.use((req, res, next) => {
    const rawPath = (req.url ?? '').split('?')[0] ?? '';
    let path: string;
    try {
      path = decodeURIComponent(rawPath);
    } catch {
      return next();
    }
    const isTutorialRoute = path === '/tutorials' || path.startsWith('/tutorials/');
    if (!isTutorialRoute && path !== '/sitemap.xml') return next();

    // Mirror Cloudflare Pages, which redirects directory URLs to their trailing-slash form.
    if (isTutorialRoute && !path.endsWith('/') && !path.split('/').pop()?.includes('.')) {
      res.writeHead(301, { Location: `${path}/` }).end();
      return;
    }

    const result = build(options, true);
    for (const warning of result.warnings) server.config.logger.warn(`[tutorials] ${warning}`);
    if (result.errors.length > 0) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderErrorPage(result.errors));
      return;
    }

    const file = path.endsWith('/') ? `${path.slice(1)}index.html` : path.slice(1);
    const body = result.files.get(file);
    if (body === undefined) return next();

    const payload = typeof body === 'string' && file.endsWith('.html')
      ? body.replace('</head>', '<script type="module" src="/@vite/client"></script>\n</head>')
      : body;
    res.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-store' }).end(payload);
  });
}

export function tutorialsPlugin(options: TutorialsPluginOptions): Plugin {
  let isBuild = false;
  return {
    name: 'lopsy-tutorials',
    configResolved(config) {
      isBuild = config.command === 'build';
    },
    configureServer(server) {
      serveTutorials(server, options);
    },
    generateBundle() {
      if (!isBuild) return;
      const result = build(options, false);
      for (const warning of result.warnings) this.warn(warning);
      if (result.errors.length > 0) {
        this.error(`Tutorial content errors:\n  - ${result.errors.join('\n  - ')}`);
      }
      for (const [fileName, source] of result.files) {
        this.emitFile({ type: 'asset', fileName, source });
      }
    },
  };
}
