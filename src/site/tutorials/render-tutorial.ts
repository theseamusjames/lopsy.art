import { escapeHtml, renderMarkdown, renderInline, stripMarkdown } from './markdown';
import {
  type Breadcrumb,
  type RenderContext,
  breadcrumbJsonLd,
  coverImage,
  formatDate,
  renderBreadcrumbs,
  renderDocument,
  renderImage,
  renderMetaList,
  renderTutorialCard,
} from './render-layout';
import { SITE_NAME, TUTORIALS_PATH, absoluteUrl, tutorialAssetPath, tutorialPath } from './site-config';
import type { Tutorial, TutorialStep } from './types';

function renderStep(ctx: RenderContext, tutorial: Tutorial, step: TutorialStep, index: number): string {
  return `<li class="step" id="${step.id}">
  <h2 class="step-title"><span class="step-number" aria-hidden="true">${index + 1}</span>${renderInline(step.title)}</h2>
  <div class="step-body">${renderMarkdown(step.body)}</div>
  <figure class="step-figure">${renderImage(ctx, tutorial.slug, step.image, {
    isEager: index === 0,
    sizes: '(min-width: 800px) 760px, 100vw',
  })}</figure>
</li>`;
}

function renderRelated(ctx: RenderContext, related: readonly Tutorial[]): string {
  if (related.length === 0) return '';
  return `<section class="related" aria-labelledby="related-heading">
  <h2 id="related-heading">Related tutorials</h2>
  <div class="card-grid">${related.map((t) => renderTutorialCard(ctx, t, 3)).join('\n')}</div>
</section>`;
}

function renderCallToAction(): string {
  return `<aside class="cta">
  <h2>Try it yourself</h2>
  <p>${SITE_NAME} is free and runs in your browser. Nothing to install and no account needed.</p>
  <a class="button button-large" href="/">Open ${SITE_NAME}</a>
</aside>`;
}

function howToJsonLd(ctx: RenderContext, tutorial: Tutorial): Record<string, unknown> {
  const url = absoluteUrl(tutorialPath(tutorial.slug));
  const cover = coverImage(tutorial);
  const coverSize = ctx.imageSize(tutorial.slug, cover.src);
  return {
    '@type': 'HowTo',
    '@id': `${url}#howto`,
    name: tutorial.title,
    description: tutorial.description,
    url,
    inLanguage: 'en',
    datePublished: tutorial.published,
    dateModified: tutorial.updated,
    image: {
      '@type': 'ImageObject',
      url: absoluteUrl(tutorialAssetPath(tutorial.slug, cover.src)),
      ...(coverSize ?? {}),
    },
    ...(tutorial.duration ? { totalTime: `PT${tutorial.duration}M` } : {}),
    ...(tutorial.tags.length > 0 ? { keywords: tutorial.tags.join(', ') } : {}),
    author: { '@type': 'Organization', name: SITE_NAME, url: absoluteUrl('/') },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: absoluteUrl('/') },
    tool: { '@type': 'HowToTool', name: `${SITE_NAME} (free, browser-based image editor)` },
    step: tutorial.steps.map((step, index) => ({
      '@type': 'HowToStep',
      position: index + 1,
      name: stripMarkdown(step.title),
      text: stripMarkdown(step.body),
      url: `${url}#${step.id}`,
      image: absoluteUrl(tutorialAssetPath(tutorial.slug, step.image.src)),
    })),
  };
}

export function renderTutorialPage(
  ctx: RenderContext,
  tutorial: Tutorial,
  related: readonly Tutorial[],
): string {
  const path = tutorialPath(tutorial.slug);
  const crumbs: Breadcrumb[] = [
    { name: SITE_NAME, path: '/' },
    { name: 'Tutorials', path: TUTORIALS_PATH },
    { name: tutorial.title, path },
  ];
  const cover = coverImage(tutorial);
  const wasUpdated = tutorial.updated !== tutorial.published;
  const dateLine = wasUpdated
    ? `Updated <time datetime="${tutorial.updated}">${formatDate(tutorial.updated)}</time>`
    : `Published <time datetime="${tutorial.published}">${formatDate(tutorial.published)}</time>`;

  const body = `${renderBreadcrumbs(crumbs)}
<article class="tutorial">
  <header class="tutorial-header">
    <h1>${escapeHtml(tutorial.title)}</h1>
    <p class="lede">${escapeHtml(tutorial.description)}</p>
    <div class="tutorial-meta">${renderMetaList(tutorial, { showStepCount: true })}<p class="date">${dateLine}</p></div>
  </header>
  ${tutorial.intro ? `<div class="intro">${renderMarkdown(tutorial.intro)}</div>` : ''}
  <ol class="steps">
${tutorial.steps.map((step, index) => renderStep(ctx, tutorial, step, index)).join('\n')}
  </ol>
  ${renderCallToAction()}
</article>
${renderRelated(ctx, related)}`;

  return renderDocument(ctx, {
    title: `${tutorial.title} | ${SITE_NAME} Tutorial`,
    description: tutorial.description,
    canonicalPath: path,
    ogImagePath: tutorialAssetPath(tutorial.slug, cover.src),
    ogImageAlt: cover.alt,
    ogImageSize: ctx.imageSize(tutorial.slug, cover.src),
    ogType: 'article',
    extraMeta: [
      `<meta property="article:published_time" content="${tutorial.published}">`,
      `<meta property="article:modified_time" content="${tutorial.updated}">`,
      ...tutorial.tags.map((tag) => `<meta property="article:tag" content="${escapeHtml(tag)}">`),
    ],
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [howToJsonLd(ctx, tutorial), breadcrumbJsonLd(crumbs)],
    },
    body,
  });
}
