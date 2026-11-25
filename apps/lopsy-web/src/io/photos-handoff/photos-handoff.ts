/**
 * Lopsy's side of the Photonamous round trip (spec 5.6, 6.12):
 *
 * - `?photos-handoff=<id>` on load: receive a document from the Photonamous tab
 *   that opened this one and open it, with the "From Photonamous" bar.
 * - Save to Photonamous: post the `.lopsy` and a flattened 16-bit PNG back.
 * - Add to Photonamous (File menu): send the current document as new.
 *
 * Lopsy never talks to Google; Photonamous does all Drive work.
 */

import {
  acceptHandoff,
  focusPhotos,
  readHandoffId,
  saveToPhotos,
  searchWithoutHandoffParam,
  type SavePayload,
} from '@lopsy/handoff/lopsy';
import type { CameraSummary, HandoffSource } from '@lopsy/handoff/messages';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { describeError, notifyError, notifyInfo } from '../../app/notifications-store';
import { initWasm, decodeAndUploadImage } from '../../engine-wasm/wasm-bridge';
import { resetTrackedState } from '../../engine-wasm/engine-sync';
import { pixelDataManager } from '../../engine/pixel-data-manager';
import { getEngine } from '../../engine-wasm/engine-state';
import { renderPng16 } from '../export-image';
import { loadProject } from '../project-load';
import { serializeProject } from '../project-save';
import { photosUrl } from './photos-url';
import { activePhotosSession, usePhotosHandoffStore } from './photos-handoff-store';

async function waitForEngine(maxFrames = 300): Promise<ReturnType<typeof getEngine>> {
  for (let i = 0; i < maxFrames; i++) {
    const engine = getEngine();
    if (engine) return engine;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  return getEngine();
}

/**
 * Opens a 16-bit PNG as a new document named after the photo, with one
 * layer of the same name, decoded by the engine at full precision.
 *
 * It follows the RAW imports (io/raf.ts, io/dng.ts): a 1x1 document starts
 * the engine without allocating a full-size placeholder in JS, and the
 * engine's PNG decoder then uploads straight into that layer's texture.
 */
async function openPngDocument(bytes: ArrayBuffer, name: string): Promise<void> {
  await initWasm();
  useEditorStore.getState().createDocument(1, 1, true);
  const engine = await waitForEngine();
  if (!engine) throw new Error('the engine did not start.');
  const layerId = useEditorStore.getState().document.activeLayerId;
  if (!layerId) throw new Error('the new document has no layer.');

  // Let the render loop register the 1x1 layer before its texture is replaced,
  // and drop the placeholder pixels so they are never re-uploaded over it.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  pixelDataManager.remove(layerId);

  const size = decodeAndUploadImage(engine, layerId, new Uint8Array(bytes));
  const width = size[0] ?? 0;
  const height = size[1] ?? 0;
  if (width === 0 || height === 0) throw new Error('the photo could not be decoded.');

  useEditorStore.setState((s) => ({
    document: {
      ...s.document,
      name,
      width,
      height,
      layers: s.document.layers.map((l) => (l.id === layerId && l.type === 'raster' ? { ...l, name, width, height } : l)),
    },
    undoStack: [],
    redoStack: [],
    isDirty: false,
  }));
  pixelDataManager.bumpVersion(layerId);
  resetTrackedState(engine);
  useEditorStore.getState().fitToView();
}

/**
 * Receives the document named by `?photos-handoff=` if there is one. The
 * parameter is stripped from the address bar first, so a reload doesn't
 * ask for the document again.
 */
export async function openPhotosHandoffFromQuery(): Promise<void> {
  const url = photosUrl();
  const id = readHandoffId(window.location.search);
  // A build without Photonamous ignores the parameter entirely.
  if (!id || !url) return;

  const { pathname, search, hash } = window.location;
  window.history.replaceState(window.history.state, '', `${pathname}${searchWithoutHandoffParam(search)}${hash}`);

  useUIStore.getState().openModal({ kind: 'loading', message: 'Receiving from Photonamous…' });
  try {
    const { document, connection } = await acceptHandoff({ photosUrl: url, id });
    const previousDocumentId = useEditorStore.getState().documentReady ? useEditorStore.getState().document.id : null;
    if (document.kind === 'lopsy') {
      await loadProject(new File([document.bytes], `${document.name}.lopsy`));
    } else {
      await openPngDocument(document.bytes, document.name);
    }
    // loadProject reports its own failures; only a document that opened gets the bar.
    const editor = useEditorStore.getState();
    if (!editor.documentReady || editor.document.id === previousDocumentId) return;
    usePhotosHandoffStore.getState().start({
      name: document.name,
      documentId: editor.document.id,
      connection,
      ...(document.camera ? { camera: document.camera } : {}),
    });
  } catch (err) {
    notifyError(`Couldn't receive the photo from Photonamous: ${describeError(err)}`);
  } finally {
    useUIStore.getState().closeModalOfKind('loading');
  }
}

/**
 * The document as Photonamous stores it: the `.lopsy` (carrying the source block
 * when there is one) and a flattened 16-bit PNG.
 */
async function buildSavePayload(source?: HandoffSource, camera?: CameraSummary): Promise<SavePayload> {
  const engine = getEngine();
  if (!engine) throw new Error('engine not ready.');
  // The same v3 file Save Project writes (16-bit layer pixels), with the source block.
  const { bytes } = await serializeProject(source ? { photos: camera ? { ...source, camera } : source } : {});
  // serializeProject's bytes fill their own buffer, which is transferred as is.
  const isWholeBuffer = bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
  const lopsy = isWholeBuffer ? (bytes.buffer as ArrayBuffer) : bytes.slice().buffer;
  const render = await (await renderPng16(engine)).arrayBuffer();
  const name = useEditorStore.getState().document.name || 'Untitled';
  return { name, lopsy, render };
}

/**
 * Save to Photonamous. Call it from a click or key press: when the Photonamous
 * tab is gone it is reopened before the files are built, while the browser
 * still allows popups.
 */
export async function saveDocumentToPhotos(): Promise<void> {
  const handoff = usePhotosHandoffStore.getState();
  const session = activePhotosSession(handoff.session, useEditorStore.getState().document.id);
  const url = photosUrl();
  if (!session || !url || handoff.status.kind === 'saving') return;
  handoff.setStatus({ kind: 'saving' });
  try {
    const outcome = await saveToPhotos({
      photosUrl: url,
      connection: session.connection,
      payload: buildSavePayload(session.connection.source, session.camera),
    });
    if (outcome.ok) {
      useEditorStore.getState().markClean();
      usePhotosHandoffStore.getState().setStatus({ kind: 'saved' });
    } else {
      usePhotosHandoffStore.getState().setStatus({ kind: 'failed', reason: outcome.error });
    }
  } catch (err) {
    usePhotosHandoffStore.getState().setStatus({ kind: 'failed', reason: describeError(err) });
  }
}

/** Back to Photonamous: focuses its tab, or opens it when it was closed. */
export function backToPhotos(): void {
  const session = usePhotosHandoffStore.getState().session;
  const url = photosUrl();
  if (!url) return;
  focusPhotos({ photosUrl: url, connection: session?.connection ?? null });
}

/** File > Add to Photonamous: hands the document to Photonamous as a new document. */
export async function addDocumentToPhotos(): Promise<void> {
  if (!getEngine()) {
    notifyError('Cannot add to Photonamous: engine not ready.');
    return;
  }
  try {
    const url = photosUrl();
    if (!url) return;
    const outcome = await saveToPhotos({ photosUrl: url, connection: null, payload: buildSavePayload() });
    if (outcome.ok) {
      notifyInfo('Added to Photonamous');
    } else {
      notifyError(`Couldn't add to Photonamous: ${outcome.error}`);
    }
  } catch (err) {
    notifyError(`Couldn't add to Photonamous: ${describeError(err)}`);
  }
}
