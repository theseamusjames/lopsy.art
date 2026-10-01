import { imageMimeType, readImageSize } from './image-size';
import { parseTutorial } from './parse-tutorial';
import { unparsedPaletteItems } from './swatch';
import { byNewest, pickRelated } from './related';
import { type RenderContext, coverImage } from './render-layout';
import { renderTutorialIndex } from './render-index';
import { renderTutorialPage } from './render-tutorial';
import { RELATED_LIMIT, TUTORIALS_PATH, tutorialPath } from './site-config';
import { type SitemapEntry, latestDate } from '../sitemap';
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
  /** Pages for the site-wide sitemap, which the Vite plugin writes once for every section. */
  sitemapEntries: SitemapEntry[];
  errors: string[];
  warnings: string[];
}

function referencedImages(tutorial: Tutorial): string[] {
  const images = tutorial.steps.map((step) => step.image.src);
  if (tutorial.cover) images.push(tutorial.cover.src);
  if (tutorial.finished) images.push(tutorial.finished.src);
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

function checkProject(tutorial: Tutorial, source: SourceTutorial, errors: string[]): void {
  if (tutorial.project && !source.assets.has(tutorial.project)) {
    errors.push(`tutorials/${tutorial.slug}: project "${tutorial.project}" does not exist.`);
  }
}

export function tutorialSitemapEntries(tutorials: readonly Tutorial[]): SitemapEntry[] {
  return [
    { path: TUTORIALS_PATH, lastmod: latestDate(tutorials.map((t) => t.updated)) },
    ...tutorials.map((t) => ({ path: tutorialPath(t.slug), lastmod: t.updated })),
  ];
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
    for (const item of unparsedPaletteItems(tutorial.intro)) {
      warnings.push(
        `tutorials/${tutorial.slug}: the palette won't render as swatches because of "${item}". Write it as named colour groups (see tutorials/README.md).`,
      );
    }
    checkProject(tutorial, source, errors);
  }

  const files = new Map<string, string | Uint8Array>();
  if (errors.length > 0) return { files, sitemapEntries: [], errors, warnings };

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
    if (tutorial.project) used.add(tutorial.project);
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

  return { files, sitemapEntries: tutorialSitemapEntries(tutorials), errors, warnings };
}
