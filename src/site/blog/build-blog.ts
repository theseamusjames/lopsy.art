import { type SitemapEntry, latestDate } from '../sitemap';
import { imageMimeType, readImageSize } from '../tutorials/image-size';
import { byNewest } from '../tutorials/related';
import type { RenderContext } from '../tutorials/render-layout';
import { BLOG_FEED_PATH, BLOG_PATH } from '../tutorials/site-config';
import type { ImageSize } from '../tutorials/types';
import { MORE_POSTS_LIMIT, postPath } from './blog-config';
import { parsePost } from './parse-post';
import { postImages } from './post-body';
import { renderBlogIndex } from './render-blog-index';
import { renderFeed } from './render-feed';
import { renderPostPage } from './render-post';
import type { Post, SourcePost } from './types';

export interface BlogBuildOptions {
  sources: readonly SourcePost[];
  css: string;
  /** Drafts render in dev so authors can preview them; production builds leave them out. */
  shouldIncludeDrafts: boolean;
}

export interface BlogBuildResult {
  /** Output files keyed by path relative to the site root, e.g. `blog/index.html`. */
  files: Map<string, string | Uint8Array>;
  sitemapEntries: SitemapEntry[];
  errors: string[];
  warnings: string[];
}

function referencedImages(post: Post): string[] {
  const images = postImages(post.blocks).map((image) => image.src);
  if (post.hero) images.push(post.hero.src);
  if (post.share) images.push(post.share.src);
  return [...new Set(images)];
}

function measureImages(post: Post, source: SourcePost, sizes: Map<string, ImageSize>, errors: string[]): void {
  for (const file of referencedImages(post)) {
    const where = `blog/${post.slug}: image "${file}"`;
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
    sizes.set(`${post.slug}/${file}`, size);
  }
}

export function blogSitemapEntries(posts: readonly Post[]): SitemapEntry[] {
  return [
    { path: BLOG_PATH, lastmod: latestDate(posts.map((p) => p.updated)) },
    ...posts.map((p) => ({ path: postPath(p.slug), lastmod: p.updated })),
  ];
}

export function buildBlog(options: BlogBuildOptions): BlogBuildResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parsed: Array<{ post: Post; source: SourcePost }> = [];

  for (const source of options.sources) {
    const result = parsePost(source.slug, source.source);
    errors.push(...result.errors.map((e) => `blog/${source.slug}: ${e}`));
    warnings.push(...result.warnings.map((w) => `blog/${source.slug}: ${w}`));
    if (!result.post) continue;
    if (result.post.isDraft && !options.shouldIncludeDrafts) continue;
    parsed.push({ post: result.post, source });
  }

  const sizes = new Map<string, ImageSize>();
  for (const { post, source } of parsed) measureImages(post, source, sizes, errors);

  const files = new Map<string, string | Uint8Array>();
  if (errors.length > 0) return { files, sitemapEntries: [], errors, warnings };

  const ctx: RenderContext = {
    css: options.css,
    imageSize: (slug, file) => sizes.get(`${slug}/${file}`) ?? null,
  };
  const posts = parsed.map((p) => p.post).sort(byNewest);

  files.set('blog/index.html', renderBlogIndex(ctx, posts));
  files.set(BLOG_FEED_PATH.slice(1), renderFeed(ctx, posts));
  for (const { post, source } of parsed) {
    const more = posts.filter((p) => p.slug !== post.slug).slice(0, MORE_POSTS_LIMIT);
    files.set(`blog/${post.slug}/index.html`, renderPostPage(ctx, post, more));
    const used = new Set(referencedImages(post));
    for (const file of used) {
      const bytes = source.assets.get(file);
      if (bytes) files.set(`blog/${post.slug}/${file}`, bytes);
    }
    for (const file of source.assets.keys()) {
      if (!used.has(file)) warnings.push(`blog/${post.slug}: "${file}" is not used and won't be published.`);
    }
    const shareImage = post.share ?? post.hero;
    if (shareImage && imageMimeType(shareImage.src) === 'image/webp') {
      warnings.push(
        `blog/${post.slug}: the share image "${shareImage.src}" is WebP, which some networks won't preview. Use a JPEG.`,
      );
    }
  }

  return { files, sitemapEntries: blogSitemapEntries(posts), errors, warnings };
}
