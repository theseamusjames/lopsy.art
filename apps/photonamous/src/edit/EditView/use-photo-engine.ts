import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Asset } from '@lopsy/photos-core/library/types';
import { createDevelopEngine, DecodeAbortedError, type DevelopEngine, type LoadProgress } from '../../engine/develop-engine';
import type { View } from '../../engine/viewport';
import { developSource } from '../../library/develop-source';

export type EngineStatus =
  | { readonly kind: 'starting' }
  | { readonly kind: 'loading'; readonly progress: LoadProgress | null }
  | { readonly kind: 'ready' }
  | { readonly kind: 'error'; readonly message: string };

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Starts a develop engine on the canvas and loads the asset's original into
 * it, again whenever the asset changes. The engine lives as long as the
 * component; StrictMode's second mount gets a fresh one.
 */
export function usePhotoEngine(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  asset: Asset,
  loadOriginal: (asset: Asset) => Promise<Blob>,
): { engine: DevelopEngine | null; status: EngineStatus; view: View | null } {
  const [engine, setEngine] = useState<DevelopEngine | null>(null);
  const [status, setStatus] = useState<EngineStatus>({ kind: 'starting' });
  const [view, setView] = useState<View | null>(null);
  const loadOriginalRef = useRef(loadOriginal);
  loadOriginalRef.current = loadOriginal;
  const assetRef = useRef(asset);
  assetRef.current = asset;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let isCancelled = false;
    let created: DevelopEngine | null = null;
    let unsubscribe: (() => void) | null = null;
    createDevelopEngine(canvas)
      .then((e) => {
        if (isCancelled) {
          e.dispose();
          return;
        }
        created = e;
        unsubscribe = e.onViewChange(setView);
        setView(e.getView());
        setEngine(e);
      })
      .catch((err: unknown) => {
        if (!isCancelled) setStatus({ kind: 'error', message: `The editing engine could not start: ${describe(err)}` });
      });
    return () => {
      isCancelled = true;
      unsubscribe?.();
      created?.dispose();
      setEngine(null);
    };
  }, [canvasRef]);

  useEffect(() => {
    if (!engine) return;
    let isCancelled = false;
    const current = developSource(assetRef.current);
    setStatus({ kind: 'loading', progress: null });
    loadOriginalRef
      .current(current)
      .then((blob) => {
        if (isCancelled) return null;
        return engine.load(blob, current.format, (progress) => {
          if (!isCancelled) setStatus({ kind: 'loading', progress });
        });
      })
      .then((size) => {
        if (!isCancelled && size) setStatus({ kind: 'ready' });
      })
      .catch((err: unknown) => {
        if (isCancelled || err instanceof DecodeAbortedError) return;
        setStatus({ kind: 'error', message: describe(err) });
      });
    return () => {
      isCancelled = true;
    };
    // A Lopsy document saved again from Lopsy keeps its id and gets a new render, and a new sha256.
  }, [engine, asset.id, asset.sha256]);

  return { engine, status, view };
}
