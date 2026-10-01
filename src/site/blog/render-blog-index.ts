import { escapeHtml, renderInline } from '../tutorials/markdown';
import {
  type Breadcrumb,
  type RenderContext,
  breadcrumbJsonLd,
  renderBreadcrumbs,
  renderDocument,
  renderImage,
} from '../tutorials/render-layout';
import { BLOG_PATH, DEFAULT_OG_IMAGE, SITE_NAME, absoluteUrl } from '../tutorials/site-config';
import { BLOG_DESCRIPTION, BLOG_HEADING, BLOG_TITLE, FEED_LINK, postPath } from './blog-config';
import { renderDotRule } from './dot-rule';
import { renderByline } from './render-post';
import type { Post } from './types';

function renderSummary(ctx: RenderContext, post: Post): string {
  const href = escapeHtml(postPath(post.slug));
  // The wide share crop suits a list row better than a square hero.
  const image = post.share ?? post.hero;
  // The title link already leads to the post, so the thumbnail is hidden from assistive tech.
  const thumbnail = image
    ? `<a class="post-summary-image" href="${href}" tabindex="-1" aria-hidden="true">${renderImage(ctx, post.slug, image, {
      basePath: BLOG_PATH,
      sizes: '(min-width: 1121px) 540px, (min-width: 721px) 50vw, 100vw',
    })}</a>`
    : '';
  return `<li class="post-summary${image ? ' has-image' : ''}">
  ${thumbnail}
  <div class="post-summary-text">
    <h2><a href="${href}">${escapeHtml(post.title)}</a></h2>
    ${renderByline(post)}
    <p>${renderInline(post.summary)} <a class="read-more" href="${href}" aria-label="Read more: ${escapeHtml(post.title)}">Read more...</a></p>
  </div>
</li>`;
}

/** `posts` must already be in display order. */
export function renderBlogIndex(ctx: RenderContext, posts: readonly Post[]): string {
  const crumbs: Breadcrumb[] = [
    { name: SITE_NAME, path: '/' },
    { name: BLOG_HEADING, path: BLOG_PATH },
  ];

  const list = posts.length > 0
    ? `<ol class="post-list">${posts.map((post) => renderSummary(ctx, post)).join('\n')}</ol>`
    : '<p class="empty">The first post is on its way. In the meantime, <a href="/">open Lopsy</a> and explore.</p>';

  const body = `${renderBreadcrumbs(crumbs)}
<header class="index-header blog-header">
  <h1>${escapeHtml(BLOG_HEADING)}</h1>
  ${renderDotRule()}
</header>
${list}`;

  const url = absoluteUrl(BLOG_PATH);
  return renderDocument(ctx, {
    title: BLOG_TITLE,
    description: BLOG_DESCRIPTION,
    canonicalPath: BLOG_PATH,
    ogImagePath: DEFAULT_OG_IMAGE,
    ogImageAlt: `${SITE_NAME}, a free image editor in the browser`,
    ogType: 'website',
    extraMeta: [FEED_LINK],
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Blog',
          '@id': `${url}#blog`,
          name: `${SITE_NAME} ${BLOG_HEADING}`,
          description: BLOG_DESCRIPTION,
          url,
          inLanguage: 'en',
          publisher: { '@type': 'Organization', name: SITE_NAME, url: absoluteUrl('/') },
          blogPost: posts.map((post) => ({
            '@type': 'BlogPosting',
            headline: post.title,
            url: absoluteUrl(postPath(post.slug)),
            datePublished: post.published,
          })),
        },
        breadcrumbJsonLd(crumbs),
      ],
    },
    body,
  });
}
