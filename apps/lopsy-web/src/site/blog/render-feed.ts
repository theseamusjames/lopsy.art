import { escapeHtml } from '../tutorials/markdown';
import { type RenderContext, renderImage } from '../tutorials/render-layout';
import { BLOG_FEED_PATH, BLOG_PATH, SITE_NAME, absoluteUrl } from '../tutorials/site-config';
import { BLOG_DESCRIPTION, BLOG_FEED_TITLE, postPath } from './blog-config';
import { renderPostBody } from './post-body';
import type { Post } from './types';

/** Atom wants full timestamps; `publishedAt` carries the optional UTC time. */
function publishedStamp(post: Post): string {
  return `${post.publishedAt}:00Z`;
}

function updatedStamp(post: Post): string {
  return post.updated === post.published ? publishedStamp(post) : `${post.updated}T00:00:00Z`;
}

function renderEntry(ctx: RenderContext, post: Post): string {
  const url = absoluteUrl(postPath(post.slug));
  // Feed readers resolve relative URLs unreliably, so images point at the live site.
  const content = renderPostBody(post.blocks, (image) =>
    renderImage(ctx, post.slug, image, { basePath: absoluteUrl(BLOG_PATH) }),
  );
  return `  <entry>
    <title>${escapeHtml(post.title)}</title>
    <link href="${url}"/>
    <id>${url}</id>
    <published>${publishedStamp(post)}</published>
    <updated>${updatedStamp(post)}</updated>
    <author><name>${escapeHtml(post.author ?? SITE_NAME)}</name></author>
${post.tags.map((tag) => `    <category term="${escapeHtml(tag)}"/>`).join('\n')}
    <summary>${escapeHtml(post.description)}</summary>
    <content type="html" xml:base="${url}">${escapeHtml(content)}</content>
  </entry>`;
}

/** Atom feed of every published post, newest first. `posts` must already be in that order. */
export function renderFeed(ctx: RenderContext, posts: readonly Post[]): string {
  const updated = posts.map(updatedStamp).reduce((max, stamp) => (stamp > max ? stamp : max), '1970-01-01T00:00:00Z');
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeHtml(BLOG_FEED_TITLE)}</title>
  <subtitle>${escapeHtml(BLOG_DESCRIPTION)}</subtitle>
  <link href="${absoluteUrl(BLOG_FEED_PATH)}" rel="self"/>
  <link href="${absoluteUrl(BLOG_PATH)}"/>
  <id>${absoluteUrl(BLOG_PATH)}</id>
  <updated>${updated}</updated>
${posts.map((post) => renderEntry(ctx, post)).join('\n')}
</feed>
`;
}
