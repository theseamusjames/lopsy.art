/**
 * Generates the static pages under /tutorials/ and /blog/ from the Markdown
 * sources in tutorials/<slug>/index.md and blog/<slug>/index.md, plus the
 * site-wide sitemap.xml and the blog's Atom feed.
 *
 *   dev:   pages render on request (drafts included) and live-reload on save.
 *   build: pages, images, the feed and sitemap.xml are emitted into dist/.
 *          Content errors fail the build; SEO guideline misses print as warnings.
 *
 * All parsing and rendering lives in src/site/ — this file only touches the
 * filesystem and Vite.
 */
import type { Plugin, ViteDevServer } from 'vite';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { buildBlog } from '../src/site/blog/build-blog';
import { renderSitemap } from '../src/site/sitemap';
import { buildTutorialSite } from '../src/site/tutorials/build-site';
import { imageMimeType } from '../src/site/tutorials/image-size';

interface SitePluginOptions {
  tutorialsDir: string;
  blogDir: string;
  /** Shared site chrome and the tutorial pages. Every page inlines it. */
  baseCss: string;
  /** Article styles, inlined after `baseCss` on blog pages only. */
  blogCss: string;
}

interface SourceEntry {
  slug: string;
  source: string;
  assets: Map<string, Uint8Array>;
}

interface SiteBuild {
  files: Map<string, string | Uint8Array>;
  errors: string[];
  warnings: string[];
}

const SECTIONS = ['/tutorials', '/blog'];

function loadSources(contentDir: string): SourceEntry[] {
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

function build(options: SitePluginOptions, isDev: boolean): SiteBuild {
  const readCss = (...paths: string[]): string => {
    const css = paths.map((path) => readFileSync(path, 'utf8')).join('\n');
    return isDev ? css : minifyCss(css);
  };
  const tutorials = buildTutorialSite({
    sources: loadSources(options.tutorialsDir),
    css: readCss(options.baseCss),
    shouldIncludeDrafts: isDev,
  });
  const blog = buildBlog({
    sources: loadSources(options.blogDir),
    css: readCss(options.baseCss, options.blogCss),
    shouldIncludeDrafts: isDev,
  });

  const files = new Map([...tutorials.files, ...blog.files]);
  files.set('sitemap.xml', renderSitemap([...tutorials.sitemapEntries, ...blog.sitemapEntries]));
  return {
    files,
    errors: [...tutorials.errors, ...blog.errors],
    warnings: [...tutorials.warnings, ...blog.warnings],
  };
}

function escapeForHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function renderErrorPage(errors: string[]): string {
  const items = errors.map((e) => `<li>${escapeForHtml(e)}</li>`).join('');
  return `<!DOCTYPE html><meta charset="utf-8"><title>Content errors</title>
<script type="module" src="/@vite/client"></script>
<body style="font:15px/1.5 system-ui;padding:24px;background:#1e1e1e;color:#e0e0e0">
<h1 style="color:#f44336">Content errors</h1><ul>${items}</ul></body>`;
}

function contentType(path: string): string {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.xml')) return 'application/xml; charset=utf-8';
  return imageMimeType(path) ?? 'application/octet-stream';
}

function isWatched(options: SitePluginOptions, file: string): boolean {
  const isInside = (dir: string): boolean => !relative(dir, file).startsWith('..');
  return isInside(options.tutorialsDir) || isInside(options.blogDir) || file === options.baseCss || file === options.blogCss;
}

function serveSite(server: ViteDevServer, options: SitePluginOptions): void {
  server.watcher.add([options.tutorialsDir, options.blogDir, options.baseCss, options.blogCss]);
  server.watcher.on('all', (_event, file) => {
    if (isWatched(options, file)) server.ws.send({ type: 'full-reload', path: '*' });
  });

  server.middlewares.use((req, res, next) => {
    const rawPath = (req.url ?? '').split('?')[0] ?? '';
    let path: string;
    try {
      path = decodeURIComponent(rawPath);
    } catch {
      return next();
    }
    const isSectionRoute = SECTIONS.some((section) => path === section || path.startsWith(`${section}/`));
    if (!isSectionRoute && path !== '/sitemap.xml') return next();

    // Mirror Cloudflare Pages, which redirects directory URLs to their trailing-slash form.
    if (isSectionRoute && !path.endsWith('/') && !path.split('/').pop()?.includes('.')) {
      res.writeHead(301, { Location: `${path}/` }).end();
      return;
    }

    const result = build(options, true);
    for (const warning of result.warnings) server.config.logger.warn(`[site] ${warning}`);
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

export function sitePlugin(options: SitePluginOptions): Plugin {
  let isBuild = false;
  return {
    name: 'lopsy-site',
    configResolved(config) {
      isBuild = config.command === 'build';
    },
    configureServer(server) {
      serveSite(server, options);
    },
    generateBundle() {
      if (!isBuild) return;
      const result = build(options, false);
      for (const warning of result.warnings) this.warn(warning);
      if (result.errors.length > 0) {
        this.error(`Content errors:\n  - ${result.errors.join('\n  - ')}`);
      }
      for (const [fileName, source] of result.files) {
        this.emitFile({ type: 'asset', fileName, source });
      }
    },
  };
}
