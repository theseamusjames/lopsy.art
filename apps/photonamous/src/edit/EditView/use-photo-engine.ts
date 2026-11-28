import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Asset } from '@lopsy/photos-core/library/types';
import {
  createDevelopEngine,
  DecodeAbortedError,
  RendererChangedError,
  type DevelopEngine,
  type LoadProgress,
} from '../../engine/develop-engine';
import { showErrorToast, showToast } from '../../app/toasts';
import type { View } from '../../engine/viewport';
import { developSource } from '../../library/develop-source';
import { RawPrepareError, RawRefusedError } from '../../engine/raw/raw-decode';
import { openFailureFileError } from '../../app/file-error-events';
import { track } from '../../app/track';

export type EngineStatus =
  | { readonly kind: 'starting' }
  | { readonly kind: 'loading'; readonly progress: LoadProgress | null }
  | { readonly kind: 'ready' }
  | { readonly kind: 'error'; readonly message: string };

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Reports a photo the engine could not open, as a `file_error` event: the engine's sentence only when it refused the file. */
function reportOpenFailure(err: unknown, asset: Asset): void {
  const engineSentence = err instanceof RawPrepareError || err instanceof RawRefusedError ? err.message : null;
  track.error(openFailureFileError(describe(err), engineSentence, asset.format, asset.fileName));
}

/** How long a lost WebGL context is waited for before the engine is made again on a new canvas. */
const CONTEXT_RESTORE_MS = 3000;

/**
 * Starts a develop engine on the canvas and loads the asset's original into
 * it, again whenever the asset changes. The engine lives as long as the
 * component; StrictMode's second mount gets a fresh one.
 *
 * A lost GPU (a WebGPU device, or a WebGL context) makes a new engine and
 * loads the photo again; the edit is in the library, not the engine, so
 * nothing is lost. WebGL is waited for until the browser restores the
 * context. When WebGPU fails to start and the page changes to WebGL, the
 * engine starts again on a new canvas: `canvasKey` changes, and the caller
 * keys its canvas element by it.
 */
export function usePhotoEngine(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  asset: Asset,
  loadOriginal: (asset: Asset) => Promise<Blob>,
): { engine: DevelopEngine | null; status: EngineStatus; view: View | null; canvasKey: number } {
  const [engine, setEngine] = useState<DevelopEngine | null>(null);
  const [status, setStatus] = useState<EngineStatus>({ kind: 'starting' });
  const [view, setView] = useState<View | null>(null);
  /** A new value makes a new engine: after a lost GPU. */
  const [attempt, setAttempt] = useState(0);
  /** A new value makes a new canvas, and a new engine on it: after WebGPU failed to start. */
  const [canvasKey, setCanvasKey] = useState(0);
  const loadOriginalRef = useRef(loadOriginal);
  loadOriginalRef.current = loadOriginal;
  const assetRef = useRef(asset);
  assetRef.current = asset;
  /** Set when the GPU was lost: the next load into a new engine is a recovery, and says so. */
  const isRecovering = useRef(false);
  /** The photos (id and content) whose failure to open has been reported, so it is reported once. */
  const reportedFailures = useRef(new Set<string>());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let isCancelled = false;
    let created: DevelopEngine | null = null;
    let unsubscribe: (() => void) | null = null;
    let unsubscribeLost: (() => void) | null = null;
    let stopWaiting: (() => void) | null = null;
    setStatus({ kind: 'starting' });

    const handleLost = (lost: DevelopEngine) => {
      if (isCancelled) return;
      console.warn(`Photonamous: the GPU was lost (${lost.rendererName()}); starting the engine again`);
      const isWebgl = lost.rendererName() === 'webgl';
      isRecovering.current = true;
      unsubscribe?.();
      lost.dispose();
      created = null;
      setEngine(null);
      setStatus({ kind: 'starting' });
      if (!isWebgl) {
        setAttempt((n) => n + 1);
        return;
      }
      // A restored context is the browser's word that the GPU is back. A
      // context that never comes back is given up on for a new canvas.
      const onRestored = () => {
        stopWaiting?.();
        setAttempt((n) => n + 1);
      };
      const timer = setTimeout(() => {
        stopWaiting?.();
        setCanvasKey((n) => n + 1);
        setAttempt((n) => n + 1);
      }, CONTEXT_RESTORE_MS);
      canvas.addEventListener('webglcontextrestored', onRestored);
      stopWaiting = () => {
        clearTimeout(timer);
        canvas.removeEventListener('webglcontextrestored', onRestored);
        stopWaiting = null;
      };
    };

    createDevelopEngine(canvas, { isScreen: true })
      .then((e) => {
        if (isCancelled) {
          e.dispose();
          return;
        }
        created = e;
        unsubscribe = e.onViewChange(setView);
        unsubscribeLost = e.onLost(() => handleLost(e));
        setView(e.getView());
        setEngine(e);
      })
      .catch((err: unknown) => {
        if (isCancelled) return;
        if (err instanceof RendererChangedError) {
          console.warn(`Photonamous: ${err.message}`);
          setCanvasKey((n) => n + 1);
          setAttempt((n) => n + 1);
          return;
        }
        const message = `The editing engine could not start: ${describe(err)}`;
        if (isRecovering.current) showErrorToast(`The graphics processor stopped, and the editor could not start again: ${describe(err)}`);
        setStatus({ kind: 'error', message });
      });
    return () => {
      isCancelled = true;
      stopWaiting?.();
      unsubscribe?.();
      unsubscribeLost?.();
      created?.dispose();
      setEngine(null);
    };
  }, [canvasRef, attempt, canvasKey]);

  useEffect(() => {
    if (!engine) return;
    let isCancelled = false;
    const isReload = isRecovering.current;
    isRecovering.current = false;
    const current = developSource(assetRef.current);
    setStatus({ kind: 'loading', progress: null });
    /** Set once the original is read: a failure after it is the file's, before it the storage's. */
    let isDecoding = false;
    loadOriginalRef
      .current(current)
      .then((blob) => {
        if (isCancelled) return null;
        isDecoding = true;
        return engine.load(blob, current.format, (progress) => {
          if (!isCancelled) setStatus({ kind: 'loading', progress });
        });
      })
      .then((size) => {
        if (isCancelled || !size) return;
        setStatus({ kind: 'ready' });
        if (isReload) showToast('The graphics processor was reset. The photo has been loaded again.');
      })
      .catch((err: unknown) => {
        if (isCancelled || err instanceof DecodeAbortedError) return;
        setStatus({ kind: 'error', message: describe(err) });
        // Once per photo opened here: a new engine after a lost GPU loads it again, and may fail again.
        const key = `${current.id}|${current.sha256}`;
        if (isDecoding && !reportedFailures.current.has(key)) {
          reportedFailures.current.add(key);
          reportOpenFailure(err, current);
        }
      });
    return () => {
      isCancelled = true;
    };
    // A Lopsy document saved again from Lopsy keeps its id and gets a new render, and a new sha256.
  }, [engine, asset.id, asset.sha256]);

  return { engine, status, view, canvasKey };
}
