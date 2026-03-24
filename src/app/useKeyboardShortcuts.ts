import { useEffect, type RefObject } from 'react';
import { useUIStore } from './ui-store';
import { useEditorStore } from './editor-store';
import { strokeCurrentPath } from './useCanvasInteraction';
import { getEngine } from '../engine-wasm/engine-state';
import { clipboardCut } from '../engine-wasm/wasm-bridge';
import { handleToolShortcut, handleSizeShortcut, handleNudgeShortcut } from './shortcuts/tool-shortcuts';
import { handleEditShortcut } from './shortcuts/edit-shortcuts';
import { handleZoomShortcut } from './shortcuts/zoom-shortcuts';

interface KeyboardShortcutDeps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  setIsSpaceDown: (v: boolean) => void;
  setIsPanning: (v: boolean) => void;
  clearPersistentTransform: () => void;
  nudgeMove: (dx: number, dy: number) => void;
}

export function useKeyboardShortcuts({
  canvasRef,
  setIsSpaceDown,
  setIsPanning,
  clearPersistentTransform,
  nudgeMove,
}: KeyboardShortcutDeps): void {
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

      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        handleDeleteKey();
        return;
      }

      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        if (handleToolShortcut(e)) return;
        if (handleNudgeShortcut(e, nudgeMove)) return;
        if (handleSizeShortcut(e)) return;
      }

      if (e.metaKey || e.ctrlKey) {
        if (handleZoomShortcut(e, viewport.zoom, setZoom, setPan, canvasRef, docWidth, docHeight)) return;
        handleEditShortcut(e, clearPersistentTransform);
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
  }, [setZoom, setPan, viewport.zoom, docWidth, docHeight, canvasRef, setIsSpaceDown, setIsPanning, clearPersistentTransform, nudgeMove]);
}

function handleDeleteKey(): void {
  const editor = useEditorStore.getState();
  const sel = editor.selection;
  const activeId = editor.document.activeLayerId;
  if (!activeId) return;

  if (sel.active && sel.mask) {
    const engine = getEngine();
    if (!engine) return;
    editor.pushHistory();
    const bx = sel.bounds ? Math.round(sel.bounds.x) : 0;
    const by = sel.bounds ? Math.round(sel.bounds.y) : 0;
    const bw = sel.bounds ? Math.round(sel.bounds.width) : 0;
    const bh = sel.bounds ? Math.round(sel.bounds.height) : 0;
    // GPU-side clear: uses clipboardCut which copies then clears.
    // We discard the clipboard result — we just want the clear.
    clipboardCut(engine, activeId, true, bx, by, bw, bh);
    // Clear stale JS pixel data
    const pixelDataMap = new Map(editor.layerPixelData);
    pixelDataMap.delete(activeId);
    const sparseMap = new Map(editor.sparseLayerData);
    sparseMap.delete(activeId);
    const dirtyIds = new Set(editor.dirtyLayerIds);
    dirtyIds.add(activeId);
    useEditorStore.setState({ layerPixelData: pixelDataMap, sparseLayerData: sparseMap, dirtyLayerIds: dirtyIds });
    editor.notifyRender();
  } else {
    editor.removeLayer(activeId);
  }
}
