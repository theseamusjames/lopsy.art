/**
 * The app's side of the Lopsy round trip (spec 5.6, 6.12): "Edit in Lopsy"
 * for the selected photo, and receiving saves on a page Lopsy opened with
 * `?receive=`. The protocol is in src/handoff/; this file wires it to the
 * library, the export renderer and the toasts.
 */

import type { AssetId, LibrarySession } from '@lopsy/photos-core/library/types';
import { DEFAULT_EXPORT_SETTINGS } from '@lopsy/photos-core/export/types';
import { createBrowserPreviewRenderer } from '@lopsy/photos-core/import/browser-preview-renderer';
import { HandoffError } from '@lopsy/handoff/channel';
import { editInLopsy, lopsyUrl } from '../handoff/send-to-lopsy';
import { startHandoffReceiver, type HandoffReceiver, type ReceiverState } from '../handoff/receiver';
import type { StoredLopsySave } from '../handoff/store-lopsy-save';
import { getExportRenderer } from './export-renderer-registry';
import { unguarded } from './guard-session';
import { dismissToast, showToast } from './toasts';

const previewRenderer = createBrowserPreviewRenderer();

/** Open handoffs: saves keep arriving through them for the page's life. */
const handoffs: { close(): void }[] = [];

/** The words for a save Lopsy sent back. */
export function savedMessage(name: string, stored: StoredLopsySave): string {
  return stored.outcome === 'copied' ? `Saved from Lopsy as a copy: ${name}` : `Saved from Lopsy: ${name}`;
}

/** The words for a handoff that did not reach Lopsy. */
export function handoffFailureMessage(error: unknown): string {
  if (error instanceof HandoffError) {
    switch (error.code) {
      case 'popup-blocked':
        return 'The browser blocked opening Lopsy. Allow pop-ups for this site and try again.';
      case 'timeout':
        return 'Lopsy did not answer in time. Try again once it has loaded.';
      default:
        return `Lopsy could not open the photo: ${error.message}`;
    }
  }
  return `Lopsy could not open the photo: ${error instanceof Error ? error.message : String(error)}`;
}

/** The words for the receiver's state, or null when there is nothing to say. */
export function receiverMessage(state: ReceiverState): string | null {
  switch (state.kind) {
    case 'waiting':
      return 'Receiving from Lopsy…';
    case 'saving':
      return `Saving “${state.name}” from Lopsy…`;
    case 'saved':
      return savedMessage(state.name, state.stored);
    case 'failed':
      return `Saving from Lopsy failed: ${state.error}`;
  }
}

/** The full-size 16-bit PNG of a version, through the export renderer (the engine). */
async function renderPng16(session: LibrarySession, assetId: AssetId, versionId: string): Promise<ArrayBuffer> {
  const view = session.getView();
  const asset = view.assets.get(assetId);
  const version = view.versions.get(versionId);
  if (!asset || !version) throw new Error('The photo is no longer in the library.');
  if (asset.kind === 'document') throw new Error('Documents go to Lopsy as their .lopsy file.');
  const renderer = await getExportRenderer();
  const blob = await renderer.render(
    asset,
    version,
    { ...DEFAULT_EXPORT_SETTINGS, format: 'png', quality: 1, maxLongEdge: null, metadata: 'none' },
    new AbortController().signal,
  );
  return blob.arrayBuffer();
}

/** "Edit in Lopsy" for one photo. Call from a click: Lopsy's tab opens before this returns. */
export function openInLopsy(session: LibrarySession, assetId: AssetId): void {
  const asset = session.getView().assets.get(assetId);
  if (!asset) return;
  const versionId = asset.primaryVersionId;
  let handoff;
  try {
    handoff = editInLopsy({
      // Saves coming back are stored by backend code: refusals must throw, not toast and vanish.
      session: unguarded(session),
      assetId,
      versionId,
      renderPng16: () => renderPng16(session, assetId, versionId),
      lopsyUrl: lopsyUrl(),
      previewRenderer,
      onSaved: (stored, save) => showToast(savedMessage(save.name, stored)),
    });
  } catch (error) {
    showToast(handoffFailureMessage(error));
    return;
  }
  handoffs.push(handoff);
  const opening = showToast('Opening Lopsy…', null);
  handoff.delivered.then(
    () => dismissToast(opening),
    (error: unknown) => {
      dismissToast(opening);
      showToast(handoffFailureMessage(error), 10_000);
    },
  );
}

let receiver: HandoffReceiver | null = null;

/**
 * Starts receiving when this page was opened by Lopsy with `?receive=`
 * (once per page); shows its state as a toast that stays until it is done.
 */
export function startReceiving(session: LibrarySession): void {
  if (receiver !== null) return;
  receiver = startHandoffReceiver({
    session: unguarded(session),
    lopsyUrl: lopsyUrl(),
    previewRenderer,
    location: window.location,
    history: window.history,
  });
  const r = receiver;
  if (r === null) return;
  let shown: number | null = null;
  const update = () => {
    const state = r.getState();
    const message = receiverMessage(state);
    if (shown !== null) dismissToast(shown);
    if (message === null) return;
    const lasting = state.kind === 'waiting' || state.kind === 'saving';
    shown = showToast(message, lasting ? null : 10_000);
  };
  r.subscribe(update);
  update();
}

/** Whether this page was opened by Lopsy to receive a save (before the receiver strips the parameter). */
export function isReceivePage(search: string): boolean {
  return new URLSearchParams(search).has('receive');
}
