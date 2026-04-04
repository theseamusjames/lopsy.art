import { useEffect, type RefObject } from 'react';
import { useUIStore } from './ui-store';
import { useEditorStore } from './editor-store';
import { strokeCurrentPath } from './useCanvasInteraction';
import { getEngine } from '../engine-wasm/engine-state';
import { clipboardCut } from '../engine-wasm/wasm-bridge';
import { handleToolShortcut, handleSizeShortcut, handleNudgeShortcut } from './shortcuts/tool-shortcuts';
import { handleEditShortcut } from './shortcuts/edit-shortcuts';
import { handleZoomShortcut } from './shortcuts/zoom-shortcuts';
import { pasteOrOpenBlob } from './paste-or-open';
import { processTextKey } from '../tools/text/text-input';
import { commitTextEditing } from './interactions/misc-handlers';

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

      // Text editing mode: route keyboard input to the text editor
      const textEditing = useUIStore.getState().textEditing;
      if (textEditing) {
        if (e.key === 'Escape') {
          e.preventDefault();
          const uiState = useUIStore.getState();
          const editorState = useEditorStore.getState();
          if (textEditing.isNew) {
            editorState.removeLayer(textEditing.layerId);
          }
          uiState.cancelTextEditing();
          editorState.notifyRender();
          return;
        }

        // Shift+Enter commits text
        if (e.key === 'Enter' && e.shiftKey) {
          e.preventDefault();
          commitTextEditing();
          return;
        }

        const metaKey = e.metaKey || e.ctrlKey;
        const result = processTextKey(
          { text: textEditing.text, cursorPos: textEditing.cursorPos },
          e.key,
          metaKey,
        );
        if (result) {
          e.preventDefault();
          useUIStore.getState().updateTextEditingText(result.text, result.cursorPos);
          useEditorStore.getState().notifyRender();
        }
        return;
      }

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

    // Unified paste handler — handles image data, file copies, and internal clipboard.
    // Fired by the browser's native paste event (Cmd+V keydown does NOT preventDefault,
    // so the paste event always fires).
    const handlePaste = (e: ClipboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const files = e.clipboardData?.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (file && file.type.startsWith('image/')) {
          e.preventDefault();
          const name = file.name.replace(/\.[^.]+$/, '') || 'Copied File';
          pasteOrOpenBlob(file, name);
          return;
        }
      }

      // Try the async clipboard API for image data (e.g. copied pixels from another app)
      e.preventDefault();
      navigator.clipboard.read().then(async (items) => {
        for (const item of items) {
          const imageType = item.types.find((t) => t.startsWith('image/'));
          if (imageType) {
            const blob = await item.getType(imageType);
            await pasteOrOpenBlob(blob, 'Copied File');
            return;
          }
        }
        // No external image — fall back to internal clipboard
        useEditorStore.getState().paste();
      }).catch(() => {
        useEditorStore.getState().paste();
      });
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('paste', handlePaste);
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
