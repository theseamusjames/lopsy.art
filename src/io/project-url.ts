/**
 * Open a .lopsy project from a URL given in the page's query string:
 *
 *   https://lopsy.art/?open=/tutorials/<slug>/<slug>.lopsy
 *
 * Undocumented on purpose — it exists so the tutorial pages can hand their
 * project files to the editor. There is no UI for it.
 */

import { useUIStore } from '../app/ui-store';
import { describeError, notifyError } from '../app/notifications-store';
import { loadProject } from './project-load';

/** Must match OPEN_PROJECT_PARAM in src/site/tutorials/site-config.ts. */
export const OPEN_PROJECT_PARAM = 'open';

/**
 * Resolves the `open` query parameter against the page's own URL. Relative
 * paths are same-origin; absolute URLs must be http(s). Returns null when the
 * parameter is missing or unusable.
 */
export function resolveOpenProjectUrl(search: string, pageUrl: string): URL | null {
  const raw = new URLSearchParams(search).get(OPEN_PROJECT_PARAM)?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw, pageUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url;
}

/** `search` with the `open` parameter removed, including the leading `?` when anything is left. */
export function searchWithoutOpenParam(search: string): string {
  const rest = search
    .replace(/^\?/, '')
    .split('&')
    .filter((pair) => pair !== '' && pair.split('=')[0] !== OPEN_PROJECT_PARAM)
    .join('&');
  return rest ? `?${rest}` : '';
}

function fileNameFromUrl(url: URL): string {
  const last = url.pathname.split('/').pop() ?? '';
  let name: string;
  try {
    name = decodeURIComponent(last);
  } catch {
    name = last;
  }
  return /\.lopsy$/i.test(name) ? name : 'project.lopsy';
}

/**
 * Opens the project named by `?open=` if there is one. The parameter is
 * stripped from the address bar first, so a reload (or React's dev-mode
 * double effect) doesn't open the file a second time over the user's work.
 */
export async function openProjectFromQuery(): Promise<void> {
  const url = resolveOpenProjectUrl(window.location.search, window.location.href);
  if (!url) return;

  const { pathname, hash } = window.location;
  window.history.replaceState(window.history.state, '', `${pathname}${searchWithoutOpenParam(window.location.search)}${hash}`);

  const ui = useUIStore.getState();
  ui.openModal({ kind: 'loading', message: 'Downloading project…' });
  let blob: Blob;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`the server answered ${response.status}`);
    blob = await response.blob();
  } catch (err) {
    useUIStore.getState().closeModalOfKind('loading');
    notifyError(`Couldn't download the project: ${describeError(err)}`);
    return;
  }

  await loadProject(new File([blob], fileNameFromUrl(url)));
}
