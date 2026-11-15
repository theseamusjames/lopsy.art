import { escapeHtml } from './markdown';
import {
  AUTHOR_NAME,
  AUTHOR_URL,
  BLOG_FEED_PATH,
  BLOG_PATH,
  COPYRIGHT_YEAR,
  SITE_NAME,
  SOURCE_URL,
  TUTORIALS_PATH,
  absoluteUrl,
} from './site-config';
import type { ImageSize, Tutorial, TutorialImage } from './types';

export interface RenderContext {
  /** Stylesheet inlined into every page so first paint needs no extra request. */
  css: string;
  imageSize: (slug: string, file: string) => ImageSize | null;
}

export interface Breadcrumb {
  name: string;
  path: string;
}

export interface DocumentOptions {
  title: string;
  description: string;
  canonicalPath: string;
  ogImagePath: string;
  ogImageAlt: string;
  ogImageSize?: ImageSize | null;
  ogType: 'website' | 'article';
  /** Extra `<meta>` / `<link>` tags, already escaped. */
  extraMeta?: string[];
  jsonLd: unknown;
  body: string;
}

export function formatDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function coverImage(tutorial: Tutorial): TutorialImage {
  const lastStep = tutorial.steps[tutorial.steps.length - 1];
  return tutorial.cover ?? lastStep?.image ?? { src: '', alt: '' };
}

export function finishedImage(tutorial: Tutorial): TutorialImage | null {
  return tutorial.finished ?? tutorial.steps[tutorial.steps.length - 1]?.image ?? null;
}

/** `<script>` content ends at the first `</script`, so `<` must never appear raw. */
function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export function renderImage(
  ctx: RenderContext,
  slug: string,
  image: TutorialImage,
  options: { isEager?: boolean; sizes?: string; className?: string; basePath?: string } = {},
): string {
  const size = ctx.imageSize(slug, image.src);
  const attrs = [
    `src="${escapeHtml(`${options.basePath ?? TUTORIALS_PATH}${slug}/${image.src}`)}"`,
    `alt="${escapeHtml(image.alt)}"`,
    size ? `width="${size.width}" height="${size.height}"` : '',
    options.isEager ? 'fetchpriority="high"' : 'loading="lazy"',
    'decoding="async"',
    options.sizes ? `sizes="${options.sizes}"` : '',
    options.className ? `class="${options.className}"` : '',
  ];
  return `<img ${attrs.filter(Boolean).join(' ')}>`;
}

export function renderMetaList(tutorial: Tutorial, options: { showStepCount?: boolean } = {}): string {
  const items = [
    tutorial.level ? `<li>${tutorial.level}</li>` : '',
    tutorial.duration ? `<li>${tutorial.duration} min</li>` : '',
    options.showStepCount ? `<li>${tutorial.steps.length} steps</li>` : '',
  ].filter(Boolean);
  return items.length > 0 ? `<ul class="meta">${items.join('')}</ul>` : '';
}

export function renderTutorialCard(ctx: RenderContext, tutorial: Tutorial, headingLevel: 2 | 3): string {
  const href = escapeHtml(`${TUTORIALS_PATH}${tutorial.slug}/`);
  const heading = `h${headingLevel}`;
  return `<article class="card">
  <div class="card-image">${renderImage(ctx, tutorial.slug, coverImage(tutorial), { sizes: '(min-width: 1160px) 540px, (min-width: 721px) 50vw, 100vw' })}</div>
  <div class="card-body">
    <${heading} class="card-title"><a href="${href}">${escapeHtml(tutorial.title)}</a></${heading}>
    <p class="card-description">${escapeHtml(tutorial.description)}</p>
    ${renderMetaList(tutorial)}
  </div>
</article>`;
}

export function renderBreadcrumbs(crumbs: Breadcrumb[]): string {
  const items = crumbs.map((crumb, index) => {
    const isCurrent = index === crumbs.length - 1;
    const name = escapeHtml(crumb.name);
    return isCurrent
      ? `<li><span aria-current="page">${name}</span></li>`
      : `<li><a href="${escapeHtml(crumb.path)}">${name}</a></li>`;
  });
  return `<nav class="breadcrumbs" aria-label="Breadcrumb"><ol>${items.join('')}</ol></nav>`;
}

export function breadcrumbJsonLd(crumbs: Breadcrumb[]): Record<string, unknown> {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}

function renderSiteHeader(): string {
  return `<header class="site-header">
  <div class="site-header-inner">
    <a class="brand" href="/" aria-label="${SITE_NAME} home">LOPSY</a>
    <nav class="site-nav" aria-label="Site">
      <a href="${TUTORIALS_PATH}">Tutorials</a>
      <a href="${BLOG_PATH}">Blog</a>
      <a class="button" href="/">Open Lopsy</a>
    </nav>
  </div>
</header>`;
}

/** Lucide's `rss` icon, inline so the footer needs no extra request. */
const RSS_ICON = '<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>';

function renderSiteFooter(): string {
  return `<footer class="site-footer">
  <div class="site-footer-inner">
    <div class="footer-about">
      <a class="brand" href="/" aria-label="${SITE_NAME} home">LOPSY</a>
      <p>${SITE_NAME} is a free image editor that runs entirely in your browser — no install, no account.</p>
    </div>
    <nav class="footer-links" aria-label="Footer">
      <div>
        <p class="footer-heading">Learn</p>
        <ul>
          <li><a href="${TUTORIALS_PATH}">Tutorials</a></li>
          <li><a href="${BLOG_PATH}">Blog</a></li>
        </ul>
      </div>
      <div>
        <p class="footer-heading">${SITE_NAME}</p>
        <ul>
          <li><a href="/">Open the editor</a></li>
          <li><a href="${SOURCE_URL}" rel="noopener">Source code</a></li>
        </ul>
      </div>
    </nav>
  </div>
  <div class="footer-bottom">
    <p>© ${COPYRIGHT_YEAR} <a href="${AUTHOR_URL}" rel="noopener">${AUTHOR_NAME}</a></p>
    <a class="footer-rss" href="${BLOG_FEED_PATH}">${RSS_ICON}Subscribe via RSS</a>
  </div>
</footer>`;
}

export function renderDocument(ctx: RenderContext, options: DocumentOptions): string {
  const title = escapeHtml(options.title);
  const description = escapeHtml(options.description);
  const canonical = escapeHtml(absoluteUrl(options.canonicalPath));
  const ogImage = escapeHtml(absoluteUrl(options.ogImagePath));
  const ogImageAlt = escapeHtml(options.ogImageAlt);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${canonical}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#1e1e1e">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="preload" href="/fonts/inter-normal-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/jersey-10-normal-latin.woff2" as="font" type="font/woff2" crossorigin>
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:type" content="${options.ogType}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:alt" content="${ogImageAlt}">
${options.ogImageSize ? `<meta property="og:image:width" content="${options.ogImageSize.width}">\n<meta property="og:image:height" content="${options.ogImageSize.height}">\n` : ''}<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${ogImage}">
<meta name="twitter:image:alt" content="${ogImageAlt}">
${(options.extraMeta ?? []).join('\n')}
<script type="application/ld+json">${serializeJsonLd(options.jsonLd)}</script>
<style>${ctx.css}</style>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
${renderSiteHeader()}
<main id="main" class="page">
${options.body}
</main>
${renderSiteFooter()}
</body>
</html>
`;
}
