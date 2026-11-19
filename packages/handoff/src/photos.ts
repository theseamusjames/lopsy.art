/**
 * The Photonamous end of the handoff (spec 6.12). Photonamous does all Drive work;
 * these helpers only move bytes between the two tabs.
 */

import {
  browserWindow,
  createHandoffId,
  HandoffError,
  listen,
  resolveAppUrl,
  waitForMessage,
  withParam,
  type HandoffPeer,
  type HandoffWindow,
} from './channel.ts';
import {
  HANDOFF_PARAM,
  LOPSY_WINDOW_NAME,
  PROTOCOL_VERSION,
  isHandoffId,
  parseLopsyPing,
  parseLopsyReady,
  parseLopsyReceived,
  parseLopsySave,
  type HandoffDocument,
  type HandoffSource,
  type LopsySaveMessage,
  type PhotosDocumentMessage,
  type PhotosPongMessage,
  type PhotosReadyMessage,
  type PhotosSavedMessage,
} from './messages.ts';

/** A save that arrived from Lopsy, already schema-checked. */
export interface ReceivedSave {
  /** The handoff this save belongs to. */
  readonly id: string;
  readonly name: string;
  /** The `.lopsy` project bytes. */
  readonly lopsy: ArrayBuffer;
  /** The flattened composite, a 16-bit PNG. */
  readonly render: ArrayBuffer;
  /** Absent for Add to Photonamous: file it as a new document. */
  readonly source?: HandoffSource;
  readonly baseRevision?: string;
}

/**
 * What `onSave` may return: the revision it wrote, and the document asset
 * the save was stored as (Lopsy sends it back with later saves).
 */
export type SaveHandlerResult = void | { readonly revision?: string; readonly documentId?: string };

export type SaveHandler = (save: ReceivedSave) => Promise<SaveHandlerResult>;

export interface PhotosHandoffTimeouts {
  /** How long to wait for Lopsy to load and say it is ready. Default 60 s. */
  readonly readyMs?: number;
  /** How long to wait for Lopsy to confirm it has the document. Default 30 s. */
  readonly receivedMs?: number;
}

export interface SendToLopsyOptions {
  /** Lopsy's URL (`VITE_LOPSY_URL`): absolute, or a path on this origin. Its origin is the only one trusted. */
  readonly lopsyUrl: string;
  /**
   * The document, or a promise of it: Lopsy is opened at once, while the
   * click still allows popups, and the document is sent when both it and
   * Lopsy are ready. Its bytes are transferred: detached once sent.
   */
  readonly document: HandoffDocument | Promise<HandoffDocument>;
  /** Called for each save Lopsy sends back; Lopsy is told the outcome once it settles. */
  readonly onSave: SaveHandler;
  readonly timeouts?: PhotosHandoffTimeouts;
  /** Defaults to the page's window. */
  readonly window?: HandoffWindow;
}

export interface LopsyHandoff {
  readonly id: string;
  /** Resolves once Lopsy confirms it has the document; rejects on timeout or a blocked popup. */
  readonly delivered: Promise<void>;
  /** Stops listening for saves from this handoff. */
  close(): void;
}

function toReceivedSave(message: LopsySaveMessage): ReceivedSave {
  return {
    id: message.id,
    name: message.name,
    lopsy: message.lopsy,
    render: message.render,
    ...(message.source ? { source: message.source } : {}),
    ...(message.baseRevision !== undefined ? { baseRevision: message.baseRevision } : {}),
  };
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}

/**
 * Answers every `lopsy:save` for `id` that `peer` sends from `origin`
 * with `photos:saved`, once `onSave` settles. Returns the unsubscribe.
 */
function answerSaves(
  win: HandoffWindow,
  origin: string,
  peer: () => HandoffPeer | null,
  id: string,
  onSave: SaveHandler,
): () => void {
  return listen(win, origin, () => peer() ?? undefined, (data, event) => {
    const ping = parseLopsyPing(data);
    if (ping) {
      if (ping.id !== id) return;
      const pong: PhotosPongMessage = { protocol: PROTOCOL_VERSION, type: 'photos:pong', id };
      (event.source as HandoffPeer | null)?.postMessage(pong, origin);
      return;
    }
    const message = parseLopsySave(data);
    if (!message || message.id !== id) return;
    const reply = event.source as HandoffPeer | null;
    const answer = (saved: PhotosSavedMessage): void => {
      if (reply && !reply.closed) reply.postMessage(saved, origin);
    };
    onSave(toReceivedSave(message)).then(
      (result) => {
        const revision = result && typeof result.revision === 'string' ? result.revision : undefined;
        const documentId = result && typeof result.documentId === 'string' ? result.documentId : undefined;
        answer({
          protocol: PROTOCOL_VERSION,
          type: 'photos:saved',
          id,
          saveId: message.saveId,
          ok: true,
          ...(revision !== undefined ? { revision } : {}),
          ...(documentId !== undefined ? { documentId } : {}),
        });
      },
      (err: unknown) => {
        answer({ protocol: PROTOCOL_VERSION, type: 'photos:saved', id, saveId: message.saveId, ok: false, error: describe(err) });
      },
    );
  });
}

/**
 * Opens Lopsy with a document. Call it from a click: it opens the window
 * before returning, so popup blockers allow it.
 */
export function sendToLopsy(options: SendToLopsyOptions): LopsyHandoff {
  const win = options.window ?? browserWindow();
  const lopsyUrl = resolveAppUrl(options.lopsyUrl, win);
  const origin = lopsyUrl.origin;
  const id = createHandoffId();
  const lopsy = win.open(withParam(lopsyUrl, HANDOFF_PARAM, id), LOPSY_WINDOW_NAME);

  let stopSaves: (() => void) | null = null;
  const close = (): void => {
    stopSaves?.();
    stopSaves = null;
  };

  if (!lopsy) {
    return {
      id,
      delivered: Promise.reject(new HandoffError('popup-blocked', 'The browser blocked opening Lopsy.')),
      close,
    };
  }

  stopSaves = answerSaves(win, origin, () => lopsy, id, options.onSave);

  const pending = Promise.resolve(options.document);
  pending.catch(() => {});
  const delivered = (async () => {
    await waitForMessage(win, {
      origin,
      source: () => lopsy,
      parse: (data) => {
        const m = parseLopsyReady(data);
        return m && m.id === id ? m : null;
      },
      timeoutMs: options.timeouts?.readyMs ?? 60_000,
      timeoutMessage: 'Lopsy did not open in time.',
      isClosed: () => lopsy.closed,
    });
    const handoffDocument = await pending;
    const document: PhotosDocumentMessage = {
      protocol: PROTOCOL_VERSION,
      type: 'photos:document',
      id,
      document: handoffDocument,
    };
    const received = waitForMessage(win, {
      origin,
      source: () => lopsy,
      parse: (data) => {
        const m = parseLopsyReceived(data);
        return m && m.id === id ? m : null;
      },
      timeoutMs: options.timeouts?.receivedMs ?? 30_000,
      timeoutMessage: 'Lopsy did not confirm it received the photo.',
      isClosed: () => lopsy.closed,
    });
    lopsy.postMessage(document, origin, [handoffDocument.bytes]);
    await received;
  })();
  delivered.catch(() => {});

  return { id, delivered, close };
}

/** The `?receive=<id>` value of a Photonamous page Lopsy opened, or null. */
export function readReceiveId(search: string, param = 'receive'): string | null {
  const value = new URLSearchParams(search).get(param);
  return isHandoffId(value) ? value : null;
}

export interface ReceiveFromLopsyOptions {
  readonly lopsyUrl: string;
  /** The `?receive=` id this page was opened with (see `readReceiveId`). */
  readonly id: string;
  readonly onSave: SaveHandler;
  /** How long to wait for the first save after saying ready. Default 60 s. */
  readonly timeoutMs?: number;
  readonly window?: HandoffWindow;
}

export interface LopsyReceiver {
  readonly id: string;
  /** Resolves with the first save once `onSave` has settled for it; rejects when none arrives in time. */
  readonly firstSave: Promise<ReceivedSave>;
  /** Stops listening for saves. */
  close(): void;
}

/**
 * For a Photonamous page Lopsy opened with `?receive=<id>` because it had no
 * Photonamous tab to talk to: says ready to the opener and answers its saves.
 * Later saves from the same Lopsy tab keep arriving until `close`.
 */
export function receiveFromLopsy(options: ReceiveFromLopsyOptions): LopsyReceiver {
  const win = options.window ?? browserWindow();
  const origin = resolveAppUrl(options.lopsyUrl, win).origin;
  const { id } = options;
  const opener = win.opener;

  let resolveFirst: (save: ReceivedSave) => void = () => {};
  let rejectFirst: (err: Error) => void = () => {};
  const firstSave = new Promise<ReceivedSave>((resolve, reject) => {
    resolveFirst = resolve;
    rejectFirst = reject;
  });
  firstSave.catch(() => {});

  if (!opener || !isHandoffId(id)) {
    rejectFirst(new HandoffError('no-opener', 'This page was not opened by Lopsy.'));
    return { id, firstSave, close: () => {} };
  }

  let hasArrived = false;
  const onSave: SaveHandler = async (save) => {
    const isFirst = !hasArrived;
    hasArrived = true;
    try {
      const result = await options.onSave(save);
      if (isFirst) resolveFirst(save);
      return result;
    } catch (err) {
      if (isFirst) rejectFirst(err instanceof Error ? err : new Error(describe(err)));
      throw err;
    }
  };
  const stopSaves = answerSaves(win, origin, () => opener, id, onSave);

  const timer = win.setTimeout(() => {
    if (hasArrived) return;
    hasArrived = true;
    rejectFirst(new HandoffError('timeout', 'Lopsy did not send the document in time.'));
  }, options.timeoutMs ?? 60_000);

  const ready: PhotosReadyMessage = { protocol: PROTOCOL_VERSION, type: 'photos:ready', id };
  opener.postMessage(ready, origin);

  return {
    id,
    firstSave,
    close: () => {
      stopSaves();
      win.clearTimeout(timer);
    },
  };
}
