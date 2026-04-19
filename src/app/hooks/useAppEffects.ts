import { useEffect, useLayoutEffect, type RefObject } from 'react';
import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { commitTextEditing } from '../../tools/text/text-interaction';

interface AppEffectsDeps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  sidebarBottomRef: RefObject<HTMLDivElement | null>;
  effectsDrawerRef: RefObject<HTMLDivElement | null>;
  documentReady: boolean;
  showEffectsDrawer: boolean;
}

export function useAppEffects({
  canvasRef,
  containerRef,
  sidebarBottomRef,
  effectsDrawerRef,
  documentReady,
  showEffectsDrawer,
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

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let hasInitialFit = false;
    const observer = new ResizeObserver(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      useEditorStore.getState().setViewportSize(rect.width, rect.height);
      if (!hasInitialFit && rect.width > 0 && rect.height > 0) {
        hasInitialFit = true;
        useEditorStore.getState().fitToView();
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [canvasRef, containerRef, documentReady]);

  // Effects drawer hangs off the bottom panel block. Subscribe to the block's
  // size via ResizeObserver instead of pinning to a specific panel's collapse
  // state — works regardless of which panels are open or collapsed.
  useLayoutEffect(() => {
    const bottom = sidebarBottomRef.current;
    const drawer = effectsDrawerRef.current;
    if (!bottom || !drawer || !showEffectsDrawer) return;
    const update = () => {
      const parentRect = bottom.offsetParent?.getBoundingClientRect();
      const bottomRect = bottom.getBoundingClientRect();
      if (!parentRect) return;
      drawer.style.top = `${bottomRect.top - parentRect.top}px`;
      drawer.style.height = `${bottom.offsetHeight}px`;
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(bottom);
    return () => ro.disconnect();
  }, [sidebarBottomRef, effectsDrawerRef, showEffectsDrawer]);
}
