/**
 * The Lopsy end of the handoff (spec 6.12). Lopsy never talks to Google:
 * it receives a document from a Photos tab and posts saves back to one,
 * opening Photos itself when there is no Photos tab to talk to.
 */

import {
  browserWindow,
  createHandoffId,
  HandoffError,
  resolveAppUrl,
  waitForMessage,
  withParam,
  type HandoffPeer,
  type HandoffWindow,
} from './channel.ts';
import {
  HANDOFF_PARAM,
  PHOTOS_WINDOW_NAME,
  PROTOCOL_VERSION,
  RECEIVE_PARAM,
  isHandoffId,
  parsePhotosDocument,
  parsePhotosReady,
  parsePhotosSaved,
  type HandoffDocument,
  type HandoffSource,
  type LopsyReadyMessage,
  type LopsyReceivedMessage,
  type LopsySaveMessage,
} from './messages.ts';

export interface LopsyHandoffConfig {
  /** Photos' URL (`VITE_PHOTOS_URL`): absolute, or a path on this origin. Its origin is the only one trusted. */
  readonly photosUrl: string;
  /** Defaults to the page's window. */
  readonly window?: HandoffWindow;
}

/** The `?photos-handoff=<id>` value of this page, or null. */
export function readHandoffId(search: string): string | null {
  const value = new URLSearchParams(search).get(HANDOFF_PARAM);
  return isHandoffId(value) ? value : null;
}

/** `search` without the handoff parameter, including the leading `?` when anything is left. */
export function searchWithoutHandoffParam(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(HANDOFF_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

/** A live connection to a Photos tab, kept for saves. */
export interface PhotosConnection {
  readonly id: string;
  /** The Photos tab; replaced when a save had to reopen Photos. */
  peer: HandoffPeer | null;
  /** The document's place in the library, sent back with each save. */
  readonly source?: HandoffSource;
  /** Updated from each successful save's revision. */
  baseRevision?: string;
}

export interface AcceptedHandoff {
  readonly document: HandoffDocument;
  readonly connection: PhotosConnection;
}

export interface AcceptHandoffOptions extends LopsyHandoffConfig {
  /** The id from `readHandoffId`. */
  readonly id: string;
  /** How long to wait for the document after saying ready. Default 30 s. */
  readonly timeoutMs?: number;
}

/**
 * Says ready to the Photos tab that opened this page and waits for the
 * document. Rejects when there is no opener, it closes, or nothing valid
 * arrives in time.
 */
export async function acceptHandoff(options: AcceptHandoffOptions): Promise<AcceptedHandoff> {
  const win = options.window ?? browserWindow();
  const origin = resolveAppUrl(options.photosUrl, win).origin;
  const { id } = options;
  const opener = win.opener;
  if (!opener || opener.closed) {
    throw new HandoffError('no-opener', 'Lopsy Photos is no longer open.');
  }
  const ready: LopsyReadyMessage = { protocol: PROTOCOL_VERSION, type: 'lopsy:ready', id };
  const { message } = await waitForMessage(win, {
    origin,
    source: () => opener,
    parse: (data) => {
      const m = parsePhotosDocument(data);
      return m && m.id === id ? m : null;
    },
    timeoutMs: options.timeoutMs ?? 30_000,
    timeoutMessage: 'Lopsy Photos did not send the photo in time.',
    isClosed: () => opener.closed,
    repeat: { ms: 1000, run: () => opener.postMessage(ready, origin) },
  });
  const received: LopsyReceivedMessage = { protocol: PROTOCOL_VERSION, type: 'lopsy:received', id };
  opener.postMessage(received, origin);
  const { document } = message;
  return {
    document,
    connection: {
      id,
      peer: opener,
      ...(document.source ? { source: document.source } : {}),
      ...(document.baseRevision !== undefined ? { baseRevision: document.baseRevision } : {}),
    },
  };
}

/** What Lopsy sends with a save. */
export interface SavePayload {
  readonly name: string;
  /** The `.lopsy` bytes. Transferred: detached once sent. */
  readonly lopsy: ArrayBuffer;
  /** The flattened composite as a 16-bit PNG. Transferred. */
  readonly render: ArrayBuffer;
}

export type SaveOutcome = { readonly ok: true; readonly revision?: string } | { readonly ok: false; readonly error: string };

export interface SaveToPhotosOptions extends LopsyHandoffConfig {
  /**
   * The handoff this document came from. Null (Add to Lopsy Photos) opens a
   * new Photos tab and sends no source block. When the connection's tab was
   * closed, Photos is reopened and the connection follows the new tab.
   */
  readonly connection: PhotosConnection | null;
  /**
   * The files, or a promise of them. Pass the promise straight away from a
   * click handler: a Photos tab that must be opened is opened before the
   * files are awaited, while the click still allows popups.
   */
  readonly payload: SavePayload | Promise<SavePayload>;
  readonly timeouts?: {
    /** For a reopened Photos tab to say ready. Default 60 s. */
    readonly readyMs?: number;
    /** For Photos to finish storing the save. Default 10 min. */
    readonly savedMs?: number;
  };
}

/**
 * Posts a save to Photos and waits for its answer. Resolves with the
 * outcome Photos reports; rejects when Photos cannot be reached (popup
 * blocked, closed, timed out).
 */
export async function saveToPhotos(options: SaveToPhotosOptions): Promise<SaveOutcome> {
  const win = options.window ?? browserWindow();
  const photosUrl = resolveAppUrl(options.photosUrl, win);
  const origin = photosUrl.origin;
  const connection = options.connection;
  const id = connection?.id ?? createHandoffId();

  let peer: HandoffPeer | null = connection?.peer && !connection.peer.closed ? connection.peer : null;
  let reopened: Promise<unknown> | null = null;
  if (!peer) {
    const opened = win.open(withParam(photosUrl, RECEIVE_PARAM, id), PHOTOS_WINDOW_NAME);
    if (!opened) throw new HandoffError('popup-blocked', 'The browser blocked opening Lopsy Photos.');
    peer = opened;
    reopened = waitForMessage(win, {
      origin,
      source: () => opened,
      parse: (data) => {
        const m = parsePhotosReady(data);
        return m && m.id === id ? m : null;
      },
      timeoutMs: options.timeouts?.readyMs ?? 60_000,
      timeoutMessage: 'Lopsy Photos did not open in time.',
      isClosed: () => opened.closed,
    });
    reopened.catch(() => {});
    if (connection) connection.peer = opened;
  }

  const payload = await options.payload;
  if (reopened) await reopened;

  const target = peer;
  const saveId = createHandoffId();
  const message: LopsySaveMessage = {
    protocol: PROTOCOL_VERSION,
    type: 'lopsy:save',
    id,
    saveId,
    name: payload.name,
    lopsy: payload.lopsy,
    render: payload.render,
    ...(connection?.source ? { source: connection.source } : {}),
    ...(connection?.baseRevision !== undefined ? { baseRevision: connection.baseRevision } : {}),
  };
  const answer = waitForMessage(win, {
    origin,
    source: () => target,
    parse: (data) => {
      const m = parsePhotosSaved(data);
      return m && m.id === id && m.saveId === saveId ? m : null;
    },
    timeoutMs: options.timeouts?.savedMs ?? 600_000,
    timeoutMessage: 'Lopsy Photos did not confirm the save in time.',
    isClosed: () => target.closed,
  });
  target.postMessage(message, origin, [payload.lopsy, payload.render]);
  const { message: saved } = await answer;
  if (!saved.ok) return { ok: false, error: saved.error };
  if (connection && saved.revision !== undefined) connection.baseRevision = saved.revision;
  return saved.revision !== undefined ? { ok: true, revision: saved.revision } : { ok: true };
}

/**
 * Back to Photos: focuses the Photos tab this document came from, or
 * opens Photos when that tab is gone. Call it from a click.
 */
export function focusPhotos(options: LopsyHandoffConfig & { readonly connection: PhotosConnection | null }): void {
  const win = options.window ?? browserWindow();
  const peer = options.connection?.peer;
  if (peer && !peer.closed) {
    peer.focus();
    return;
  }
  // The new tab is a plain Photos page, not one waiting for a save, so the
  // connection keeps its closed peer and the next save reopens Photos to receive.
  win.open(resolveAppUrl(options.photosUrl, win).href, PHOTOS_WINDOW_NAME);
}
