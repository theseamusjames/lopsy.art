/**
 * Add from Google Drive has two ways to show Google's Picker
 * (packages/photos-core/src/storage/google-drive/picker.ts and
 * picker-window.ts):
 *
 * - in the page: straight onto the user's Drive, with nothing to click
 *   through. It needs the browser to let Google's frame see Google's
 *   cookies, which Brave does not, nor any browser set to block
 *   cross-site cookies;
 * - in a window of its own: works in every browser, at the price of
 *   Google's account chooser and consent screen each time.
 *
 * So the page is tried first where it can work, and the user can switch
 * to the window, from a prompt while the Picker is open or in Settings.
 */

export type DrivePicker = 'page' | 'window';

export function chooseDrivePicker(facts: {
  /** Whether this build can show the Picker in the page at all (it has a Picker key). */
  readonly pageAvailable: boolean;
  /** What the user chose on this device, if anything. */
  readonly remembered: DrivePicker | null;
  /** A browser known to block cross-site cookies as it comes. */
  readonly blocksCrossSiteCookies: boolean;
}): DrivePicker {
  if (!facts.pageAvailable) return 'window';
  if (facts.remembered) return facts.remembered;
  return facts.blocksCrossSiteCookies ? 'window' : 'page';
}

/**
 * Brave says so itself (`navigator.brave`), and it is the one browser that
 * blocks cross-site cookies by default and can be told apart. Others that
 * block them reach the window through the prompt.
 */
export function blocksCrossSiteCookies(nav: object = navigator): boolean {
  return 'brave' in nav;
}
