import { useEffect, type RefObject } from 'react';
import { useUIStore } from './ui-store';
import { useEditorStore } from './editor-store';
import { strokeCurrentPath } from './useCanvasInteraction';

interface KeyboardShortcutDeps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  setIsSpaceDown: (v: boolean) => void;
  setIsPanning: (v: boolean) => void;
  clearPersistentTransform: () => void;
}

export function useKeyboardShortcuts({
  canvasRef,
  setIsSpaceDown,
  setIsPanning,
  clearPersistentTransform,
}: KeyboardShortcutDeps): void {
  const setActiveTool = useUIStore((s) => s.setActiveTool);
  const swapColors = useUIStore((s) => s.swapColors);
  const resetColors = useUIStore((s) => s.resetColors);
  const setZoom = useEditorStore((s) => s.setZoom);
  const setPan = useEditorStore((s) => s.setPan);
  const viewport = useEditorStore((s) => s.viewport);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpaceDown(true);
        return;
      }

      if (e.key === 'Escape') {
        const uiState = useUIStore.getState();
        if (uiState.activeTool === 'path' && uiState.pathAnchors.length > 0) {
          uiState.clearPath();
        } else {
          useEditorStore.getState().clearSelection();
          uiState.setTransform(null);
          clearPersistentTransform();
        }
        return;
      }

      if (e.key === 'Enter') {
        const uiState = useUIStore.getState();
        if (uiState.activeTool === 'path' && uiState.pathAnchors.length >= 2) {
          strokeCurrentPath();
        }
        return;
      }

      // Tool shortcuts
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const toolMap: Record<string, () => void> = {
          v: () => setActiveTool('move'),
          b: () => setActiveTool('brush'),
          n: () => setActiveTool('pencil'),
          e: () => setActiveTool('eraser'),
          g: () => setActiveTool('fill'),
          i: () => setActiveTool('eyedropper'),
          t: () => setActiveTool('text'),
          u: () => setActiveTool('shape'),
          m: () => setActiveTool('marquee-rect'),
          l: () => setActiveTool('lasso'),
          w: () => setActiveTool('wand'),
          c: () => setActiveTool('crop'),
          p: () => setActiveTool('path'),
          s: () => setActiveTool('stamp'),
          o: () => setActiveTool('dodge'),
          x: () => swapColors(),
          d: () => resetColors(),
        };

        const handler = toolMap[e.key.toLowerCase()];
        if (handler) {
          handler();
          return;
        }
      }

      // Zoom shortcuts
      if (e.metaKey || e.ctrlKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          setZoom(Math.min(64, viewport.zoom * 1.5));
        } else if (e.key === '-') {
          e.preventDefault();
          setZoom(Math.max(0.01, viewport.zoom / 1.5));
        } else if (e.key === '0') {
          e.preventDefault();
          const canvas = canvasRef.current;
          if (canvas) {
            const scaleX = canvas.width / docWidth;
            const scaleY = canvas.height / docHeight;
            setZoom(Math.min(scaleX, scaleY) * 0.9);
            setPan(0, 0);
          }
        } else if (e.key === '1') {
          e.preventDefault();
          setZoom(1);
          setPan(0, 0);
        } else if (e.key === 'd') {
          e.preventDefault();
          useEditorStore.getState().clearSelection();
          useUIStore.getState().setTransform(null);
          clearPersistentTransform();
        } else if (e.key === 'z') {
          e.preventDefault();
          if (e.shiftKey) {
            useEditorStore.getState().redo();
          } else {
            useEditorStore.getState().undo();
          }
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpaceDown(false);
        setIsPanning(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [setActiveTool, swapColors, resetColors, setZoom, setPan, viewport.zoom, docWidth, docHeight, canvasRef, setIsSpaceDown, setIsPanning, clearPersistentTransform]);
}
