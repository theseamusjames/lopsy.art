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
  WELCOME_PARAM,
  absoluteUrl,
  tutorialPath,
} from './site-config';
import type { Tutorial } from './types';

/**
 * Shown once to a phone that index.html sent here instead of the editor. A
 * closed dialog is inert, so every other visitor only pays for the markup.
 */
function renderMobileWelcome(): string {
  return `<dialog class="welcome" id="welcome" aria-labelledby="welcome-title">
  <form method="dialog">
    <h2 id="welcome-title">Welcome!</h2>
    <p>${SITE_NAME} is an image editor that runs in your browser, but it's really made for bigger screens. While you're here, check out some of the things you can do with it. Enjoy!</p>
    <button class="button button-large" autofocus>Let's go</button>
  </form>
</dialog>
<script>
(function () {
  var url = new URL(location.href);
  if (!url.searchParams.has('${WELCOME_PARAM}')) return;
  url.searchParams.delete('${WELCOME_PARAM}');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  var dialog = document.getElementById('welcome');
  dialog.addEventListener('click', function (e) {
    if (e.target === dialog) dialog.close();
  });
  dialog.showModal();
})();
</script>`;
}

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
${list}
${renderMobileWelcome()}`;

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
