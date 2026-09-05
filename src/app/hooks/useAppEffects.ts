import { useEffect, type RefObject } from 'react';
import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { commitTextEditing } from '../../tools/text/text-interaction';
import { getEngine } from '../../engine-wasm/engine-state';
import { markAllLayersDirty } from '../../engine-wasm/engine-sync';
import { installPaintLinePreviewKeyListener } from '../interactions/paint-line-preview';
import { useLocalFontsStore } from '../local-fonts-store';

interface AppEffectsDeps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  documentReady: boolean;
}

export function useAppEffects({
  canvasRef,
  containerRef,
  documentReady,
}: AppEffectsDeps): void {
  // Warn before navigating away with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useEditorStore.getState().isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Commit text editing when active layer changes
  useEffect(() => {
    let prevActiveLayerId = useEditorStore.getState().document.activeLayerId;
    const unsub = useEditorStore.subscribe((state) => {
      const currentId = state.document.activeLayerId;
      if (currentId !== prevActiveLayerId) {
        const editing = useUIStore.getState().textEditing;
        if (editing && editing.layerId !== currentId) {
          commitTextEditing();
        }
        prevActiveLayerId = currentId;
      }
    });
    return unsub;
  }, []);

  // Enumerate the fonts installed on this machine once the editor is up — not
  // at startup, so the New Document modal never triggers the permission
  // prompt. Chromium-only; elsewhere the store just records "unsupported".
  useEffect(() => {
    if (!documentReady) return;
    if (useLocalFontsStore.getState().status !== 'idle') return;
    void useLocalFontsStore.getState().loadLocalFonts();
  }, [documentReady]);

  // #666 — track shift/meta key changes so the paint-line preview updates
  // when the user presses/releases the modifier without moving the mouse.
  useEffect(() => installPaintLinePreviewKeyListener(), []);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let hasInitialFit = false;
    const observer = new ResizeObserver(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = container.getBoundingClientRect();
      const sizeChanged = canvas.width !== rect.width || canvas.height !== rect.height;
      canvas.width = rect.width;
      canvas.height = rect.height;
      useEditorStore.getState().setViewportSize(rect.width, rect.height);
      if (!hasInitialFit && rect.width > 0 && rect.height > 0) {
        hasInitialFit = true;
        useEditorStore.getState().fitToView();
      }
      // Setting canvas.width/height wipes the WebGL drawing buffer. If the
      // engine's tracked viewport already matches the new dimensions (e.g.
      // the render loop had already synced them before this callback), the
      // next frame's `syncViewport` would skip and no recomposite would run,
      // leaving the canvas blank. Force a recomposite here.
      if (sizeChanged) {
        const engine = getEngine();
        if (engine) markAllLayersDirty(engine);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [canvasRef, containerRef, documentReady]);

}
