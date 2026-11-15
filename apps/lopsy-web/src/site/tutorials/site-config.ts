export const SITE_ORIGIN = 'https://lopsy.art';
export const SITE_NAME = 'Lopsy';
export const TUTORIALS_PATH = '/tutorials/';
export const BLOG_PATH = '/blog/';
export const BLOG_FEED_PATH = `${BLOG_PATH}feed.xml`;

export const COPYRIGHT_YEAR = 2026;
export const AUTHOR_NAME = 'Seamus James';
export const AUTHOR_URL = 'https://github.com/theseamusjames';
export const SOURCE_URL = 'https://github.com/theseamusjames/lopsy.art';

/**
 * Query parameter the editor reads on startup to open a `.lopsy` file from a
 * URL. Must match OPEN_PROJECT_PARAM in src/io/project-url.ts.
 */
export const OPEN_PROJECT_PARAM = 'open';

/** Query flag that index.html's first-visit phone redirect lands with. */
export const WELCOME_PARAM = 'welcome';

export const INDEX_TITLE = 'Lopsy Tutorials — Free Photo Editing & Digital Art Guides';
export const INDEX_HEADING = 'Tutorials';
export const INDEX_DESCRIPTION =
  'Step-by-step tutorials for Lopsy, the free image editor that runs in your browser. Learn photo retouching, digital painting, compositing and design.';

export const DEFAULT_OG_IMAGE = '/og-image.jpg';

export const RELATED_LIMIT = 3;

/** Search engines truncate titles and descriptions beyond roughly these lengths. */
export const TITLE_MAX = 60;
export const DESCRIPTION_MIN = 50;
export const DESCRIPTION_MAX = 160;

export function absoluteUrl(path: string): string {
  return `${SITE_ORIGIN}${path}`;
}

export function tutorialPath(slug: string): string {
  return `${TUTORIALS_PATH}${slug}/`;
}

export function tutorialAssetPath(slug: string, file: string): string {
  return `${tutorialPath(slug)}${file}`;
}

/**
 * Tutorial `.lopsy` files live only in this R2 bucket, never in git: they run
 * to tens of MiB each, and Pages rejects any file over 25 MiB. Upload one with
 * `npm run tutorial:upload <slug>`, which records its key in the frontmatter.
 */
export const PROJECT_FILES_ORIGIN = 'https://files.lopsy.art';
export const PROJECT_FILES_BUCKET = 'lopsy-art-projects';

/** A `project` frontmatter value: `tutorials/<slug>/<12 hex digest>/<file>.lopsy`. */
export const PROJECT_KEY_PATTERN = /^tutorials\/[a-z0-9]+(-[a-z0-9]+)*\/[0-9a-f]{12}\/[^/\\]+\.lopsy$/;

/**
 * Bucket key for a project file. The content digest makes every version its
 * own immutable object, so an upload never has to replace (or purge) one.
 */
export function hostedProjectKey(slug: string, digest: string, file: string): string {
  return `tutorials/${slug}/${digest}/${file}`;
}

export function hostedProjectUrl(key: string): string {
  return `${PROJECT_FILES_ORIGIN}/${key}`;
}

/** Editor URL that opens the project at `projectPath` as soon as the app loads. */
export function openProjectHref(projectPath: string): string {
  return `/?${OPEN_PROJECT_PARAM}=${encodeURIComponent(projectPath)}`;
}
