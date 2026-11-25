/**
 * Google Tag Manager, which loads Google Analytics: the usage statistics
 * the Privacy Policy describes (privacy.html, "Usage statistics"), and
 * nothing else. What the container holds is set in Google's own pages, so
 * the page's Content-Security-Policy (public/_headers) is what keeps it to
 * that here: it allows Tag Manager's and Analytics' hosts and no
 * advertising ones.
 *
 * The tag is on only in a build given a container ID
 * (`VITE_TAG_MANAGER_ID`), which the deploy sets. Development builds and
 * the tests' builds have none, so they never talk to Google.
 */

/** Where Tag Manager's loader lives; the container ID is its only parameter. */
export const TAG_MANAGER_URL = 'https://www.googletagmanager.com/gtm.js';

const CONTAINER_ID = /^GTM-[A-Z0-9]{4,12}$/;

/** A container ID as Google writes them, or null for anything else: it goes into a script URL. */
export function tagManagerId(raw: string | undefined): string | null {
  const id = raw?.trim() ?? '';
  return CONTAINER_ID.test(id) ? id : null;
}

/**
 * Starts the tag as Google's snippet does: the data layer, the `js`
 * command with the time the page started, and the loader script. Does
 * nothing without a container ID, or a second time. Answers whether it
 * started.
 */
export function startTagManager(rawId: string | undefined, doc: Document = document, win: Window = window): boolean {
  const id = tagManagerId(rawId);
  if (id === null) return false;
  if (doc.querySelector('script[data-tag-manager]')) return false;

  const existing: unknown = Reflect.get(win, 'dataLayer');
  const dataLayer: unknown[] = Array.isArray(existing) ? existing : [];
  Reflect.set(win, 'dataLayer', dataLayer);
  // Google's tag tells a command from plain data by its being an `arguments`
  // object, so a rest parameter, which is an array, would be ignored.
  function gtag(..._command: unknown[]): void {
    // eslint-disable-next-line prefer-rest-params
    dataLayer.push(arguments);
  }
  gtag('js', new Date());

  const script = doc.createElement('script');
  script.async = true;
  script.src = `${TAG_MANAGER_URL}?id=${id}`;
  script.dataset.tagManager = id;
  doc.head.appendChild(script);
  return true;
}
