/**
 * Lopsy's side of the Lopsy Photos round trip (spec 5.6, 6.12):
 *
 * - `?photos-handoff=<id>` on load: receive a document from the Photos tab
 *   that opened this one and open it, with the "From Lopsy Photos" bar.
 * - Save to Lopsy Photos: post the `.lopsy` and a flattened 16-bit PNG back.
 * - Add to Lopsy Photos (File menu): send the current document as new.
 *
 * Lopsy never talks to Google; Photos does all Drive work.
 */

import {
  acceptHandoff,
  focusPhotos,
  readHandoffId,
  saveToPhotos,
  searchWithoutHandoffParam,
  type SavePayload,
} from '@lopsy/handoff/lopsy';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { describeError, notifyError, notifyInfo } from '../../app/notifications-store';
import { pasteOrOpenBlob } from '../../app/paste-or-open';
import { getEngine } from '../../engine-wasm/engine-state';
import { renderPng16 } from '../../app/MenuBar/menus/file-menu';
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
 * Opens a 16-bit PNG as a new document through the same path the Open
 * dialog uses, which decodes it in the engine at full precision. That path
 * needs a running engine, and the engine starts with the first document.
 */
async function openPngDocument(bytes: ArrayBuffer, name: string): Promise<void> {
  const store = useEditorStore.getState();
  if (!store.documentReady) store.createDocument(1, 1, true);
  if (!(await waitForEngine())) throw new Error('the engine did not start.');
  await pasteOrOpenBlob(new Blob([bytes], { type: 'image/png' }), name, true);
}

/**
 * Receives the document named by `?photos-handoff=` if there is one. The
 * parameter is stripped from the address bar first, so a reload doesn't
 * ask for the document again.
 */
export async function openPhotosHandoffFromQuery(): Promise<void> {
  const id = readHandoffId(window.location.search);
  if (!id) return;

  const { pathname, search, hash } = window.location;
  window.history.replaceState(window.history.state, '', `${pathname}${searchWithoutHandoffParam(search)}${hash}`);

  useUIStore.getState().openModal({ kind: 'loading', message: 'Receiving from Lopsy Photos…' });
  try {
    const { document, connection } = await acceptHandoff({ photosUrl: photosUrl(), id });
    if (document.kind === 'lopsy') {
      await loadProject(new File([document.bytes], `${document.name}.lopsy`));
    } else {
      await openPngDocument(document.bytes, document.name);
    }
    // loadProject reports its own failures; only a document that opened gets the bar.
    if (!useEditorStore.getState().documentReady) return;
    usePhotosHandoffStore.getState().start({
      name: document.name,
      documentId: useEditorStore.getState().document.id,
      connection,
    });
  } catch (err) {
    notifyError(`Couldn't receive the photo from Lopsy Photos: ${describeError(err)}`);
  } finally {
    useUIStore.getState().closeModalOfKind('loading');
  }
}

/** The document as Photos stores it: the `.lopsy` and a flattened 16-bit PNG. */
async function buildSavePayload(): Promise<SavePayload> {
  const engine = getEngine();
  if (!engine) throw new Error('engine not ready.');
  const lopsy = await serializeProject();
  const render = await (await renderPng16(engine)).arrayBuffer();
  const name = useEditorStore.getState().document.name || 'Untitled';
  return { name, lopsy, render };
}

/**
 * Save to Lopsy Photos. Call it from a click or key press: when the Photos
 * tab is gone it is reopened before the files are built, while the browser
 * still allows popups.
 */
export async function saveDocumentToPhotos(): Promise<void> {
  const handoff = usePhotosHandoffStore.getState();
  const session = activePhotosSession(handoff.session, useEditorStore.getState().document.id);
  if (!session || handoff.status.kind === 'saving') return;
  handoff.setStatus({ kind: 'saving' });
  try {
    const outcome = await saveToPhotos({
      photosUrl: photosUrl(),
      connection: session.connection,
      payload: buildSavePayload(),
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

/** Back to Photos: focuses the Photos tab, or opens Photos when it was closed. */
export function backToPhotos(): void {
  const session = usePhotosHandoffStore.getState().session;
  focusPhotos({ photosUrl: photosUrl(), connection: session?.connection ?? null });
}

/** File > Add to Lopsy Photos: hands the document to Photos as a new document. */
export async function addDocumentToPhotos(): Promise<void> {
  if (!getEngine()) {
    notifyError('Cannot add to Lopsy Photos: engine not ready.');
    return;
  }
  try {
    const outcome = await saveToPhotos({ photosUrl: photosUrl(), connection: null, payload: buildSavePayload() });
    if (outcome.ok) {
      notifyInfo('Added to Lopsy Photos');
    } else {
      notifyError(`Couldn't add to Lopsy Photos: ${outcome.error}`);
    }
  } catch (err) {
    notifyError(`Couldn't add to Lopsy Photos: ${describeError(err)}`);
  }
}
