/**
 * The page Google sends the Picker's pop-up back to (Add from Google
 * Drive). It is this app at its own path: it tells the window that asked
 * what was picked, and closes.
 */

import { announceDrivePick } from '@lopsy/photos-core/storage/google-drive/picker-window';

/**
 * The path, under the app's base. With the origin in front it is listed
 * under the OAuth client's Authorized redirect URIs
 * (docs/photonamous-setup.md, section 3): changing it here means changing
 * it there.
 */
export const DRIVE_PICK_PATH = 'drive-picked';

interface Place {
  readonly origin: string;
  readonly pathname: string;
}

export function drivePickRedirectUri(place: Place = window.location, base: string = import.meta.env.BASE_URL): string {
  return new URL(DRIVE_PICK_PATH, new URL(base, place.origin)).href;
}

/** Whether this window is the pop-up, back from Google. */
export function isDrivePickReturn(place: Place = window.location, base: string = import.meta.env.BASE_URL): boolean {
  return place.pathname === new URL(drivePickRedirectUri(place, base)).pathname;
}

/** Hands Google's answer to the window that asked and closes this one. */
export function finishDrivePick(win: Window = window): void {
  announceDrivePick(win.location.search);
  // The address carries Google's one-use code. Nothing uses it, and it does not stay in this window's history.
  win.history.replaceState(null, '', win.location.pathname);
  win.close();
  // Only reached in a window the browser will not let a script close.
  const root = win.document.getElementById('root');
  if (root) {
    const words = win.document.createElement('p');
    words.textContent = 'Done. You can close this window.';
    words.style.padding = '24px';
    root.replaceChildren(words);
  }
}
