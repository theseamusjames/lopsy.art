/**
 * A Photos page Lopsy opened with `?receive=<id>` (spec 6.12): Lopsy had no
 * Photos tab to save to (it was closed or reloaded, or the user chose Add
 * to Lopsy Photos). Says ready to Lopsy, stores each save it sends, and
 * reports progress for the app to show.
 */

import { readReceiveId, receiveFromLopsy, type ReceivedSave } from '@lopsy/handoff/photos';
import { RECEIVE_PARAM } from '@lopsy/handoff/messages';
import type { HandoffWindow } from '@lopsy/handoff/channel';
import type { PreviewRenderer } from '@lopsy/photos-core/import/types';
import type { LibrarySession } from '@lopsy/photos-core/library/types';
import { storeLopsySave, type StoredLopsySave } from './store-lopsy-save';

export type ReceiverState =
  | { readonly kind: 'waiting' }
  | { readonly kind: 'saving'; readonly name: string }
  | { readonly kind: 'saved'; readonly name: string; readonly stored: StoredLopsySave }
  | { readonly kind: 'failed'; readonly error: string };

export interface HandoffReceiver {
  readonly id: string;
  getState(): ReceiverState;
  /** Called after every state change. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  close(): void;
}

export interface StartHandoffReceiverOptions {
  readonly session: LibrarySession;
  readonly lopsyUrl: string;
  readonly previewRenderer: PreviewRenderer;
  /** The page's location; its `?receive=` parameter is read, then stripped. */
  readonly location: { readonly href: string };
  readonly history?: { replaceState(data: unknown, unused: string, url?: string | URL | null): void };
  /** How long to wait for Lopsy's first save. Default 60 s. */
  readonly timeoutMs?: number;
  readonly window?: HandoffWindow;
}

/** `href` without the receive parameter, as a path + search + hash for `replaceState`. */
export function hrefWithoutReceive(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(RECEIVE_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Starts receiving when the page was opened with `?receive=<id>`; null
 * otherwise. The parameter is stripped from the address bar at once, so a
 * reload does not wait for Lopsy again.
 */
export function startHandoffReceiver(options: StartHandoffReceiverOptions): HandoffReceiver | null {
  const id = readReceiveId(new URL(options.location.href).search, RECEIVE_PARAM);
  if (!id) return null;
  options.history?.replaceState(null, '', hrefWithoutReceive(options.location.href));

  let state: ReceiverState = { kind: 'waiting' };
  const listeners = new Set<() => void>();
  const setState = (next: ReceiverState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const receiver = receiveFromLopsy({
    lopsyUrl: options.lopsyUrl,
    id,
    onSave: async (save: ReceivedSave) => {
      setState({ kind: 'saving', name: save.name });
      try {
        const stored = await storeLopsySave(options.session, save, { previewRenderer: options.previewRenderer });
        setState({ kind: 'saved', name: save.name, stored });
        return { revision: stored.revision, documentId: stored.documentId };
      } catch (err) {
        setState({ kind: 'failed', error: describe(err) });
        throw err;
      }
    },
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.window ? { window: options.window } : {}),
  });
  receiver.firstSave.catch((err: unknown) => {
    if (state.kind === 'waiting') setState({ kind: 'failed', error: describe(err) });
  });

  return {
    id,
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => receiver.close(),
  };
}
