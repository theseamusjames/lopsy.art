import { escapeHtml, renderInline } from '../tutorials/markdown';
import {
  type Breadcrumb,
  type RenderContext,
  breadcrumbJsonLd,
  formatDate,
  renderBreadcrumbs,
  renderDocument,
  renderImage,
} from '../tutorials/render-layout';
import { BLOG_PATH, DEFAULT_OG_IMAGE, SITE_NAME, absoluteUrl } from '../tutorials/site-config';
import { SWATCH_SCRIPT } from '../tutorials/swatch';
import { BLOG_HEADING, FEED_LINK, postAssetPath, postPath } from './blog-config';
import { renderDotRule } from './dot-rule';
import { renderPostBody } from './post-body';
import type { Post, PostImage } from './types';

const CONTENT_SIZES = '(min-width: 800px) 760px, 100vw';
const HERO_SIZES = '(min-width: 1080px) 1040px, 100vw';

/**
 * Adds a Copy button to each code block. Added by script so pages without
 * JavaScript don't show a button that does nothing.
 */
const CODE_COPY_SCRIPT = `<script>
(function () {
  document.querySelectorAll('.code-block').forEach(function (block) {
    var code = block.querySelector('code');
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy';
    button.textContent = 'Copy';
    button.setAttribute('aria-live', 'polite');
    button.addEventListener('click', function () {
      navigator.clipboard.writeText(code.textContent).then(function () {
        button.textContent = 'Copied';
        setTimeout(function () { button.textContent = 'Copy'; }, 1500);
      }, function () {
        getSelection().selectAllChildren(code);
        button.textContent = 'Press Ctrl+C';
      });
    });
    block.classList.add('has-copy');
    block.appendChild(button);
  });
})();
</script>`;

/**
 * Prev/next buttons for galleries, for mouse users who can't scroll sideways.
 * Touch and trackpad users scroll directly; CSS shows the buttons only on
 * hover-capable pointers.
 */
const GALLERY_SCRIPT = `<script>
(function () {
  var reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function chevron(d) {
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
  }
  document.querySelectorAll('.post-gallery').forEach(function (gallery) {
    var scroller = gallery.querySelector('.post-gallery-scroller');
    function button(direction, label, d) {
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'gallery-nav gallery-' + direction;
      el.setAttribute('aria-label', label);
      el.innerHTML = chevron(d);
      el.addEventListener('click', function () {
        var step = scroller.clientWidth * 0.8 * (direction === 'next' ? 1 : -1);
        scroller.scrollBy({ left: step, behavior: reduceMotion ? 'auto' : 'smooth' });
      });
      gallery.appendChild(el);
      return el;
    }
    var prev = button('prev', 'Previous images', 'm15 18-6-6 6-6');
    var next = button('next', 'Next images', 'm9 18 6-6-6-6');
    function update() {
      prev.hidden = scroller.scrollLeft <= 1;
      next.hidden = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1;
    }
    scroller.addEventListener('scroll', update, { passive: true });
    addEventListener('resize', update);
    update();
  });
})();
</script>`;

export function renderPostImage(ctx: RenderContext, post: Post, image: PostImage): string {
  return renderImage(ctx, post.slug, image, { basePath: BLOG_PATH, sizes: CONTENT_SIZES });
}

/** "September 30, 2026 · 8 min read", with the author first when there is one. */
export function renderByline(post: Post, options: { showUpdated?: boolean } = {}): string {
  const parts = [
    post.author ? `<span>${escapeHtml(post.author)}</span>` : '',
    `<time datetime="${post.published}">${formatDate(post.published)}</time>`,
    `<span>${post.readingMinutes} min read</span>`,
    options.showUpdated && post.updated !== post.published
      ? `<span>Updated <time datetime="${post.updated}">${formatDate(post.updated)}</time></span>`
      : '',
  ].filter(Boolean);
  return `<p class="post-byline">${parts.join('<span aria-hidden="true"> · </span>')}</p>`;
}

function renderMorePosts(more: readonly Post[]): string {
  if (more.length === 0) return '';
  const items = more.map((post) => `<li>
    <a href="${escapeHtml(postPath(post.slug))}">${escapeHtml(post.title)}</a>
    ${renderByline(post)}
  </li>`);
  return `<section class="more-posts" aria-labelledby="more-posts-heading">
  <h2 id="more-posts-heading">More from the blog</h2>
  <ul>${items.join('\n')}</ul>
</section>`;
}

function blogPostingJsonLd(ctx: RenderContext, post: Post): Record<string, unknown> {
  const url = absoluteUrl(postPath(post.slug));
  const author = post.author
    ? { '@type': 'Person', name: post.author }
    : { '@type': 'Organization', name: SITE_NAME, url: absoluteUrl('/') };
  // Google picks from several aspect ratios, so list the hero and the share crop.
  const images = [post.hero, post.share]
    .filter((image): image is PostImage => image !== null)
    .map((image) => ({
      '@type': 'ImageObject',
      url: absoluteUrl(postAssetPath(post.slug, image.src)),
      ...(ctx.imageSize(post.slug, image.src) ?? {}),
    }));
  return {
    '@type': 'BlogPosting',
    '@id': `${url}#post`,
    headline: post.title,
    description: post.description,
    url,
    mainEntityOfPage: url,
    inLanguage: 'en',
    datePublished: post.published,
    dateModified: post.updated,
    ...(images.length > 0 ? { image: images } : {}),
    ...(post.tags.length > 0 ? { keywords: post.tags.join(', ') } : {}),
    author,
    publisher: { '@type': 'Organization', name: SITE_NAME, url: absoluteUrl('/') },
    isPartOf: { '@type': 'Blog', name: `${SITE_NAME} ${BLOG_HEADING}`, url: absoluteUrl(BLOG_PATH) },
  };
}

export function renderPostPage(ctx: RenderContext, post: Post, more: readonly Post[]): string {
  const path = postPath(post.slug);
  const heroSize = post.hero ? ctx.imageSize(post.slug, post.hero.src) : null;
  const shareImage = post.share ?? post.hero;
  const crumbs: Breadcrumb[] = [
    { name: SITE_NAME, path: '/' },
    { name: BLOG_HEADING, path: BLOG_PATH },
    { name: post.title, path },
  ];
  // A square or portrait hero at the wide width would be taller than most screens.
  const isTallHero = heroSize !== null && heroSize.height >= heroSize.width * 0.9;
  const hero = post.hero
    ? `<figure class="post-hero${isTallHero ? ' is-tall' : ''}">${renderImage(ctx, post.slug, post.hero, {
      basePath: BLOG_PATH,
      sizes: HERO_SIZES,
      isEager: true,
    })}</figure>`
    : '';

  const article = `<article class="post">
  <header class="post-header">
    <h1>${escapeHtml(post.title)}</h1>
    <p class="lede">${renderInline(post.summary)}</p>
    ${renderByline(post, { showUpdated: true })}
    ${renderDotRule()}
  </header>
  ${hero}
  <div class="prose">
${renderPostBody(post.blocks, (image) => renderPostImage(ctx, post, image))}
  </div>
</article>`;
  const swatchScript = article.includes('data-copy=') ? SWATCH_SCRIPT : '';
  const codeScript = article.includes('class="code-block') ? CODE_COPY_SCRIPT : '';
  const galleryScript = article.includes('class="post-gallery"') ? GALLERY_SCRIPT : '';
  const body = `${renderBreadcrumbs(crumbs)}
${article}
${renderMorePosts(more)}${swatchScript}${codeScript}${galleryScript}`;

  return renderDocument(ctx, {
    title: `${post.title} | ${SITE_NAME} ${BLOG_HEADING}`,
    description: post.description,
    canonicalPath: path,
    ogImagePath: shareImage ? postAssetPath(post.slug, shareImage.src) : DEFAULT_OG_IMAGE,
    ogImageAlt: shareImage?.alt ?? `${SITE_NAME}, a free image editor in the browser`,
    ogImageSize: shareImage ? ctx.imageSize(post.slug, shareImage.src) : null,
    ogType: 'article',
    extraMeta: [
      FEED_LINK,
      `<meta property="article:published_time" content="${post.published}">`,
      `<meta property="article:modified_time" content="${post.updated}">`,
      ...(post.author ? [`<meta name="author" content="${escapeHtml(post.author)}">`] : []),
      ...post.tags.map((tag) => `<meta property="article:tag" content="${escapeHtml(tag)}">`),
    ],
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [blogPostingJsonLd(ctx, post), breadcrumbJsonLd(crumbs)],
    },
    body,
  });
}

