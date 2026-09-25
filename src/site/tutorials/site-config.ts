export const SITE_ORIGIN = 'https://lopsy.art';
export const SITE_NAME = 'Lopsy';
export const TUTORIALS_PATH = '/tutorials/';

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
