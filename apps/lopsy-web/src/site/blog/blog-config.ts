import { BLOG_FEED_PATH, BLOG_PATH, SITE_NAME } from '../tutorials/site-config';

export const BLOG_TITLE = `The ${SITE_NAME} Blog — Building an Image Editor for the Web`;
export const BLOG_HEADING = 'Blog';
export const BLOG_DESCRIPTION =
  `Engineering notes from building ${SITE_NAME}: a GPU-first image editor written in Rust, WebAssembly, WebGL2 and TypeScript.`;
export const BLOG_FEED_TITLE = `${SITE_NAME} Blog`;

/** Other recent posts listed under each article. */
export const MORE_POSTS_LIMIT = 3;

/** Roughly how fast people read technical prose. */
export const WORDS_PER_MINUTE = 230;

export function postPath(slug: string): string {
  return `${BLOG_PATH}${slug}/`;
}

export function postAssetPath(slug: string, file: string): string {
  return `${postPath(slug)}${file}`;
}

/** `<link>` that lets browsers and feed readers discover the Atom feed. */
export const FEED_LINK = `<link rel="alternate" type="application/atom+xml" title="${BLOG_FEED_TITLE}" href="${BLOG_FEED_PATH}">`;
