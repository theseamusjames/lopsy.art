import { useEffect, type RefObject } from 'react';
import { useUIStore } from './ui-store';
import { useEditorStore } from './editor-store';
import { strokeCurrentPath } from './useCanvasInteraction';
import { getSelectionMaskValue } from '../selection/selection';
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
    editor.pushHistory();
    const layerData = editor.getOrCreateLayerPixelData(activeId);
    const layer = editor.document.layers.find((l) => l.id === activeId);
    if (!layer) return;
    const result = new ImageData(layerData.width, layerData.height);
    result.data.set(layerData.data);
    for (let y = 0; y < sel.maskHeight; y++) {
      for (let x = 0; x < sel.maskWidth; x++) {
        if (getSelectionMaskValue(sel, x, y) < 128) continue;
        const srcX = x - layer.x;
        const srcY = y - layer.y;
        if (srcX < 0 || srcX >= result.width || srcY < 0 || srcY >= result.height) continue;
        const idx = (srcY * result.width + srcX) * 4;
        result.data[idx] = 0;
        result.data[idx + 1] = 0;
        result.data[idx + 2] = 0;
        result.data[idx + 3] = 0;
      }
    }
    editor.updateLayerPixelData(activeId, result);
  } else {
    editor.removeLayer(activeId);
  }
}
