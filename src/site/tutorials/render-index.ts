import { escapeHtml } from './markdown';
import {
  type Breadcrumb,
  type RenderContext,
  breadcrumbJsonLd,
  renderBreadcrumbs,
  renderDocument,
  renderTutorialCard,
} from './render-layout';
import {
  DEFAULT_OG_IMAGE,
  INDEX_DESCRIPTION,
  INDEX_HEADING,
  INDEX_TITLE,
  SITE_NAME,
  TUTORIALS_PATH,
  absoluteUrl,
  tutorialPath,
} from './site-config';
import type { Tutorial } from './types';

/** `tutorials` must already be in display order. */
export function renderTutorialIndex(ctx: RenderContext, tutorials: readonly Tutorial[]): string {
  const crumbs: Breadcrumb[] = [
    { name: SITE_NAME, path: '/' },
    { name: 'Tutorials', path: TUTORIALS_PATH },
  ];

  const list = tutorials.length > 0
    ? `<div class="card-grid">${tutorials.map((t) => renderTutorialCard(ctx, t, 2)).join('\n')}</div>`
    : '<p class="empty">New tutorials are on the way. In the meantime, <a href="/">open Lopsy</a> and explore.</p>';

  const body = `${renderBreadcrumbs(crumbs)}
<header class="index-header">
  <h1>${escapeHtml(INDEX_HEADING)}</h1>
</header>
${list}`;

  const url = absoluteUrl(TUTORIALS_PATH);
  return renderDocument(ctx, {
    title: INDEX_TITLE,
    description: INDEX_DESCRIPTION,
    canonicalPath: TUTORIALS_PATH,
    ogImagePath: DEFAULT_OG_IMAGE,
    ogImageAlt: `${SITE_NAME}, a free image editor in the browser`,
    ogType: 'website',
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'CollectionPage',
          '@id': `${url}#page`,
          name: INDEX_TITLE,
          description: INDEX_DESCRIPTION,
          url,
          inLanguage: 'en',
          isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: absoluteUrl('/') },
          mainEntity: {
            '@type': 'ItemList',
            numberOfItems: tutorials.length,
            itemListElement: tutorials.map((t, index) => ({
              '@type': 'ListItem',
              position: index + 1,
              url: absoluteUrl(tutorialPath(t.slug)),
              name: t.title,
            })),
          },
        },
        breadcrumbJsonLd(crumbs),
      ],
    },
    body,
  });
}
