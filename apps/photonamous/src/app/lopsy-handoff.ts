/**
 * The app's side of the Lopsy round trip (spec 5.6, 6.12): "Edit in Lopsy"
 * for the selected photo, and receiving saves on a page Lopsy opened with
 * `?receive=`. The protocol is in src/handoff/; this file wires it to the
 * library, the export renderer and the toasts.
 */

import type { Asset, AssetId, LibrarySession } from '@lopsy/photos-core/library/types';
import { DEFAULT_EXPORT_SETTINGS } from '@lopsy/photos-core/export/types';
import { createBrowserPreviewRenderer } from '@lopsy/photos-core/import/browser-preview-renderer';
import { HandoffError } from '@lopsy/handoff/channel';
import { editInLopsy, lopsyUrl } from '../handoff/send-to-lopsy';
import { startHandoffReceiver, type HandoffReceiver, type ReceiverState } from '../handoff/receiver';
import type { StoredLopsySave } from '../handoff/store-lopsy-save';
import { getExportRenderer } from './export-renderer-registry';
import { getBackend } from './backend-registry';
import { unguarded } from './guard-session';
import { dismissToast, showErrorToast, showToast } from './toasts';
import { editableLimit } from '../engine/full-size';
import { textureLimit } from '../engine/texture-limit';
import { lopsyRefusalFileError } from './file-error-events';
import { track } from './track';

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

interface LopsyPhoto {
  readonly kind: 'original' | 'document';
  readonly width: number | null;
  readonly height: number | null;
}

/** The longest side Lopsy can open on a GPU of `gpuTextureLimit` when `photo` is larger than it, else null (as `lopsyRefusal`). */
export function lopsyRefusalLimit(photo: LopsyPhoto, gpuTextureLimit: number | null): number | null {
  if (photo.kind === 'document' || gpuTextureLimit === null || !photo.width || !photo.height) return null;
  const limit = editableLimit(gpuTextureLimit);
  return Math.max(photo.width, photo.height) > limit ? limit : null;
}

/**
 * Why this photo cannot go to Lopsy on this device, or null when it can.
 * Lopsy keeps each layer as one texture on the same GPU, so a photo larger
 * than the GPU can edit (`editableLimit`, the one threshold for oversized
 * photos) would not open there; handing it over smaller would hide that it
 * was reduced. An unknown size or limit is let through, and a Lopsy
 * document goes as its .lopsy (Lopsy says itself if it cannot open it).
 */
export function lopsyRefusal(photo: LopsyPhoto, gpuTextureLimit: number | null): string | null {
  const limit = lopsyRefusalLimit(photo, gpuTextureLimit);
  if (limit === null) return null;
  return `This photo is ${photo.width} × ${photo.height} pixels, larger than Lopsy can open on this device (${limit} on a side).`;
}

/** `lopsyRefusal` on this page's GPU. */
export function lopsyRefusalHere(photo: LopsyPhoto): string | null {
  return lopsyRefusal(photo, textureLimit());
}

/** The photos whose refusal has been reported on this page: a press again is the same failure. */
const reportedRefusals = new Set<AssetId>();

/**
 * Reports Edit in Lopsy refused for `asset` on this page's GPU (a press of
 * the unavailable control, or `openInLopsy`'s refusal), once a photo.
 * Nothing for a photo Lopsy can take.
 */
export function reportLopsyRefusal(asset: Asset): void {
  const limit = lopsyRefusalLimit(asset, textureLimit());
  if (limit === null || reportedRefusals.has(asset.id)) return;
  reportedRefusals.add(asset.id);
  track.error(lopsyRefusalFileError(limit, asset.format));
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

/**
 * "Edit in Lopsy" for one photo. Call from a click: Lopsy's tab opens
 * before this returns. A photo Lopsy cannot open on this device
 * (`lopsyRefusal`) is not handed over; the reason is shown instead.
 */
export function openInLopsy(session: LibrarySession, assetId: AssetId, chosenVersion: string | null = null): void {
  const asset = session.getView().assets.get(assetId);
  if (!asset) return;
  const refusal = lopsyRefusalHere(asset);
  if (refusal !== null) {
    showErrorToast(refusal);
    reportLopsyRefusal(asset);
    return;
  }
  const versionId = chosenVersion ?? asset.primaryVersionId;
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
    showErrorToast(handoffFailureMessage(error));
    return;
  }
  handoffs.push(handoff);
  let opening = showToast('Opening Lopsy…', null);
  // The photo is read from Drive on the way: while that waits for sign-in, the message says so, with Reconnect.
  const backend = getBackend();
  const onSignIn = () => {
    if (backend.signInState(session) !== 'needed') return;
    dismissToast(opening);
    opening = showToast('Reconnect Google Drive to send this photo to Lopsy.', null, {
      label: 'Reconnect Google Drive',
      run: () => void backend.reauthorize(session).catch((error: unknown) => console.warn('Google Drive was not reconnected', error)),
    });
  };
  const stopWatching = backend.subscribeSignIn(session, onSignIn);
  onSignIn();
  handoff.delivered.then(
    () => {
      stopWatching();
      dismissToast(opening);
    },
    (error: unknown) => {
      stopWatching();
      dismissToast(opening);
      showErrorToast(handoffFailureMessage(error));
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
