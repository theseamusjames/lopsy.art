import { imageMimeType, readImageSize } from './image-size';
import { parseTutorial } from './parse-tutorial';
import { byNewest, pickRelated } from './related';
import { type RenderContext, coverImage } from './render-layout';
import { renderTutorialIndex } from './render-index';
import { renderTutorialPage } from './render-tutorial';
import { RELATED_LIMIT, TUTORIALS_PATH, absoluteUrl, tutorialPath } from './site-config';
import type { ImageSize, SourceTutorial, Tutorial } from './types';

export interface BuildOptions {
  sources: readonly SourceTutorial[];
  css: string;
  /** Drafts render in dev so authors can preview them; production builds leave them out. */
  shouldIncludeDrafts: boolean;
}

export interface BuildResult {
  /** Output files keyed by path relative to the site root, e.g. `tutorials/index.html`. */
  files: Map<string, string | Uint8Array>;
  errors: string[];
  warnings: string[];
}

function referencedImages(tutorial: Tutorial): string[] {
  const images = tutorial.steps.map((step) => step.image.src);
  if (tutorial.cover) images.push(tutorial.cover.src);
  return images;
}

function measureImages(
  tutorial: Tutorial,
  source: SourceTutorial,
  sizes: Map<string, ImageSize>,
  errors: string[],
): void {
  for (const file of new Set(referencedImages(tutorial))) {
    const where = `tutorials/${tutorial.slug}: image "${file}"`;
    if (file.includes('/')) {
      errors.push(`${where} must sit next to index.md (no sub-directories or URLs).`);
      continue;
    }
    const bytes = source.assets.get(file);
    if (!bytes) {
      errors.push(`${where} does not exist.`);
      continue;
    }
    const size = imageMimeType(file) ? readImageSize(bytes) : null;
    if (!size) {
      errors.push(`${where} is not a readable PNG, JPEG, WebP or GIF.`);
      continue;
    }
    sizes.set(`${tutorial.slug}/${file}`, size);
  }
}

export function renderSitemap(tutorials: readonly Tutorial[]): string {
  const latest = tutorials.reduce((max, t) => (t.updated > max ? t.updated : max), '');
  const entries = [
    { loc: absoluteUrl('/'), lastmod: '' },
    { loc: absoluteUrl(TUTORIALS_PATH), lastmod: latest },
    ...tutorials.map((t) => ({ loc: absoluteUrl(tutorialPath(t.slug)), lastmod: t.updated })),
  ];
  const urls = entries.map(({ loc, lastmod }) =>
    `  <url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}

export function buildTutorialSite(options: BuildOptions): BuildResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parsed: Array<{ tutorial: Tutorial; source: SourceTutorial }> = [];

  for (const source of options.sources) {
    const result = parseTutorial(source.slug, source.source);
    errors.push(...result.errors.map((e) => `tutorials/${source.slug}: ${e}`));
    warnings.push(...result.warnings.map((w) => `tutorials/${source.slug}: ${w}`));
    if (!result.tutorial) continue;
    if (result.tutorial.isDraft && !options.shouldIncludeDrafts) continue;
    parsed.push({ tutorial: result.tutorial, source });
  }

  const knownSlugs = new Set(options.sources.map((s) => s.slug));
  const sizes = new Map<string, ImageSize>();
  for (const { tutorial, source } of parsed) {
    for (const slug of tutorial.related) {
      if (!knownSlugs.has(slug)) errors.push(`tutorials/${tutorial.slug}: related tutorial "${slug}" does not exist.`);
    }
    measureImages(tutorial, source, sizes, errors);
  }

  const files = new Map<string, string | Uint8Array>();
  if (errors.length > 0) return { files, errors, warnings };

  const ctx: RenderContext = {
    css: options.css,
    imageSize: (slug, file) => sizes.get(`${slug}/${file}`) ?? null,
  };
  const tutorials = parsed.map((p) => p.tutorial).sort(byNewest);

  files.set('tutorials/index.html', renderTutorialIndex(ctx, tutorials));
  for (const { tutorial, source } of parsed) {
    const related = pickRelated(tutorial, tutorials, RELATED_LIMIT);
    files.set(`tutorials/${tutorial.slug}/index.html`, renderTutorialPage(ctx, tutorial, related));
    const used = new Set(referencedImages(tutorial));
    for (const file of used) {
      const bytes = source.assets.get(file);
      if (bytes) files.set(`tutorials/${tutorial.slug}/${file}`, bytes);
    }
    for (const file of source.assets.keys()) {
      if (!used.has(file)) warnings.push(`tutorials/${tutorial.slug}: "${file}" is not used and won't be published.`);
    }
    const cover = coverImage(tutorial).src;
    if (imageMimeType(cover) === 'image/webp') {
      warnings.push(
        `tutorials/${tutorial.slug}: the social share image "${cover}" is WebP, which some networks won't preview. Set \`cover\` to a JPEG.`,
      );
    }
  }
  files.set('sitemap.xml', renderSitemap(tutorials));

  return { files, errors, warnings };
}
