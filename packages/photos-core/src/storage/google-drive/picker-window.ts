/**
 * Google's Picker as a page of its own, in a pop-up: the way to pick
 * Drive files where the Picker inside the page (picker.ts) cannot work.
 * Browser only. Resolves with the picked file IDs, or an empty list when
 * the user cancels.
 *
 * The Picker inside the page is a frame on docs.google.com which needs
 * Google's cookies there, and a browser that blocks cross-site cookies
 * (Brave, and others when set so) gives it none: it shows "Sign in to
 * your Google Account" and gets no further. This one is Google's
 * authorization page with `trigger_onepick`, which asks for drive.file,
 * shows the Picker and comes back to `redirectUri` with the picked IDs.
 * A page of its own is first-party, so the user's Google session is there
 * in every browser, and it needs no API key, no app ID and no script from
 * Google. Its price is Google's account chooser and consent screen every
 * time, which is why the Picker inside the page is tried first.
 *
 * Picking is the grant: once a file is picked, the token the library
 * already has can read it. So the authorization code Google sends back is
 * never used (exchanging it would need the client secret, which a static
 * site does not have).
 *
 * The way back: Google's pages cut the pop-up off from the window that
 * opened it, so the page at `redirectUri` calls `announceDrivePick`, which
 * tells every window of this origin over a BroadcastChannel. The window
 * that asked knows its answer by the `state` it sent.
 */

import { StorageError } from '../errors';

export const DRIVE_PICK_CHANNEL = 'photonamous-drive-pick';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
/** What a Drive file ID looks like; anything else in the answer is dropped. */
const FILE_ID = /^[A-Za-z0-9_-]{8,256}$/;
const STATE = /^[A-Za-z0-9_-]{16,128}$/;
/** What Google answers when the user closes or refuses its page. */
const REFUSED = 'access_denied';

/** What the page at `redirectUri` tells the window that asked. */
export interface DrivePickAnswer {
  readonly state: string;
  readonly fileIds: readonly string[];
  /** Google's error code, when it sent one instead of files. */
  readonly error: string | null;
}

/** The part of BroadcastChannel this uses, so tests can stand in for it. */
export interface PickChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  close(): void;
}

export interface PickInWindowOptions {
  /** The OAuth client ID of the Cloud project. */
  readonly clientId: string;
  /**
   * Where Google sends the pop-up back: a page of this origin that calls
   * `announceDrivePick`. It must be listed under the client's Authorized
   * redirect URIs.
   */
  readonly redirectUri: string;
  /** Limit to these MIME types. */
  readonly mimeTypes?: readonly string[];
  readonly multiselect?: boolean;
  /** Opens the pop-up; default `window.open`. Null when the browser blocked it. */
  readonly open?: (url: string) => unknown;
  /** Default: a BroadcastChannel named `DRIVE_PICK_CHANNEL`. */
  readonly channel?: () => PickChannel;
  /** Default: 32 random characters. */
  readonly newState?: () => string;
}

/** Google's page that asks for drive.file and shows the Picker. */
export function drivePickUrl(options: Pick<PickInWindowOptions, 'clientId' | 'redirectUri' | 'mimeTypes' | 'multiselect'>, state: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('response_type', 'code');
  // The Picker comes only with drive.file alone, and only when consent is asked for.
  url.searchParams.set('scope', DRIVE_FILE_SCOPE);
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('trigger_onepick', 'true');
  if (options.multiselect ?? true) url.searchParams.set('allow_multiple', 'true');
  if (options.mimeTypes && options.mimeTypes.length > 0) url.searchParams.set('mimetypes', options.mimeTypes.join(','));
  url.searchParams.set('state', state);
  return url.href;
}

/** Reads Google's answer off the URL it sent the pop-up back to. Null when this is not such a URL. */
export function readDrivePick(search: string): DrivePickAnswer | null {
  const params = new URLSearchParams(search);
  const state = params.get('state');
  if (state === null || !STATE.test(state)) return null;
  const fileIds = (params.get('picked_file_ids') ?? '').split(',').filter((id) => FILE_ID.test(id));
  const error = params.get('error');
  return { state, fileIds, error: error === null ? null : error.slice(0, 80) };
}

/**
 * For the page Google sends the pop-up back to: tells the window that
 * asked what was picked. False when `search` is not Google's answer.
 */
export function announceDrivePick(search: string, channel: PickChannel = new BroadcastChannel(DRIVE_PICK_CHANNEL)): boolean {
  const answer = readDrivePick(search);
  if (answer) channel.postMessage(answer);
  channel.close();
  return answer !== null;
}

function isAnswer(value: unknown): value is DrivePickAnswer {
  if (typeof value !== 'object' || value === null) return false;
  const fileIds: unknown = Reflect.get(value, 'fileIds');
  const error: unknown = Reflect.get(value, 'error');
  return (
    typeof Reflect.get(value, 'state') === 'string' &&
    Array.isArray(fileIds) &&
    fileIds.every((id) => typeof id === 'string' && FILE_ID.test(id)) &&
    (error === null || typeof error === 'string')
  );
}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

function openPopup(url: string): unknown {
  const width = Math.min(1000, window.screen.availWidth);
  const height = Math.min(760, window.screen.availHeight);
  const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
  return window.open(url, 'photonamous-drive-pick', `popup,width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)}`);
}

/** The pick that is waiting for its answer, so a new one can end it. */
let waiting: { end(): void } | null = null;

/**
 * Opens Google's Picker and resolves with what was picked. Call it straight
 * from a click or key press, before anything is awaited: a pop-up is only
 * allowed then.
 *
 * A pop-up closed by its own close button sends no answer, and Google's
 * pages hide from this window whether it is still open. So a pick with no
 * answer simply waits, harmlessly, until the next one starts and ends it
 * (as cancelled).
 */
export function pickDriveFilesInWindow(options: PickInWindowOptions): Promise<string[]> {
  const state = (options.newState ?? randomState)();
  waiting?.end();
  return new Promise<string[]>((resolve, reject) => {
    if (!(options.open ?? openPopup)(drivePickUrl(options, state))) {
      reject(new StorageError('invalid', 'Your browser blocked the Google window. Allow pop-ups for this site, then try again.'));
      return;
    }
    const channel = options.channel ? options.channel() : new BroadcastChannel(DRIVE_PICK_CHANNEL);
    const finish = (settle: () => void): void => {
      if (waiting === mine) waiting = null;
      channel.close();
      settle();
    };
    const mine = { end: () => finish(() => resolve([])) };
    waiting = mine;
    channel.addEventListener('message', (event) => {
      const answer = event.data;
      // Any page of this origin can post here: only the answer to this pick counts.
      if (!isAnswer(answer) || answer.state !== state) return;
      if (answer.error === null) finish(() => resolve([...answer.fileIds]));
      else if (answer.error === REFUSED) finish(() => resolve([]));
      else finish(() => reject(new StorageError('auth', `Google did not open the Picker (${answer.error})`)));
    });
  });
}
