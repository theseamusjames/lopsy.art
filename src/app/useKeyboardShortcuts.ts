import { useEffect, type RefObject } from 'react';
import { useUIStore } from './ui-store';
import { useEditorStore } from './editor-store';
import { clearJsPixelData } from './store/clear-js-pixel-data';
import { strokeCurrentPath } from './useCanvasInteraction';
import { getEngine } from '../engine-wasm/engine-state';
import { clipboardCut, hasFloat, setSelectionMask } from '../engine-wasm/wasm-bridge';
import { selectLayerAlpha } from '../panels/LayerPanel/layer-selection';
import { handleToolShortcut, handleSizeShortcut, handleNudgeShortcut } from './shortcuts/tool-shortcuts';
import { handleEditShortcut } from './shortcuts/edit-shortcuts';
import { handleZoomShortcut } from './shortcuts/zoom-shortcuts';
import { pasteOrOpenBlob } from './paste-or-open';
import { describeError, notifyError } from './notifications-store';
import { processTextKey } from '../tools/text/text-input';
import { commitTextEditing } from '../tools/text/text-interaction';
import { POINTER_IDLE, POINTER_SPACE_HELD, type PointerMode } from './pointer-mode';

// Fallback timer for browsers where the paste event may not fire on non-editable
// elements (e.g. Firefox with canvas focus). The keydown handler schedules a
// deferred internal paste; if the paste event fires, it cancels the timer.
let fallbackPasteTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleFallbackPaste(): void {
  cancelFallbackPaste();
  fallbackPasteTimer = setTimeout(() => {
    fallbackPasteTimer = null;
    useEditorStore.getState().paste();
  }, 200);
}

function cancelFallbackPaste(): void {
  if (fallbackPasteTimer !== null) {
    clearTimeout(fallbackPasteTimer);
    fallbackPasteTimer = null;
  }
}

interface KeyboardShortcutDeps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /**
   * Update the pointer mode in response to space being held / released.
   * Receives the current mode so it can transition out of `panning` cleanly
   * when space comes up mid-drag.
   */
  setPointerMode: (next: PointerMode | ((prev: PointerMode) => PointerMode)) => void;
  clearPersistentTransform: () => void;
  nudgeMove: (dx: number, dy: number) => void;
  nudgeSelection: (dx: number, dy: number) => void;
}

export function useKeyboardShortcuts({
  canvasRef,
  setPointerMode,
  clearPersistentTransform,
  nudgeMove,
  nudgeSelection,
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
        // Don't override an in-progress pan; only signal "ready to pan".
        setPointerMode((prev) => prev.kind === 'panning' ? prev : POINTER_SPACE_HELD);
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
        if (handleNudgeShortcut(e, nudgeMove, nudgeSelection)) return;
        if (handleSizeShortcut(e)) return;
      }

      if (e.metaKey || e.ctrlKey) {
        if (handleZoomShortcut(e, viewport.zoom, setZoom, setPan, canvasRef, docWidth, docHeight)) return;
        handleEditShortcut(e, clearPersistentTransform);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        // Releasing space ends both the "ready to pan" state and any
        // pan-in-progress; both collapse back to idle.
        setPointerMode(POINTER_IDLE);
      }
    };

    // Unified paste handler — handles image data, file copies, and internal clipboard.
    // Fired by the browser's native paste event (Cmd+V keydown does NOT preventDefault,
    // so the paste event always fires).
    const handlePaste = (e: ClipboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Cancel the fallback timer — the paste event fired as expected.
      cancelFallbackPaste();

      const files = e.clipboardData?.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (file && file.type.startsWith('image/')) {
          e.preventDefault();
          const name = file.name.replace(/\.[^.]+$/, '') || 'Copied File';
          pasteOrOpenBlob(file, name).catch((err) =>
            notifyError(`Failed to paste image: ${describeError(err)}`),
          );
          return;
        }
      }

      // Check clipboardData.items for image data (synchronous, works across browsers
      // including Firefox which may not support navigator.clipboard.read()).
      const items = e.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i] as DataTransferItem | undefined;
          if (item && item.type.startsWith('image/')) {
            const blob = item.getAsFile();
            if (blob) {
              e.preventDefault();
              pasteOrOpenBlob(blob, 'Copied File').catch((err) =>
                notifyError(`Failed to paste image: ${describeError(err)}`),
              );
              return;
            }
          }
        }
      }

      // Try the async clipboard API for image data (e.g. copied pixels from another app).
      // Not all browsers support this (Firefox added it in v127), so guard the call.
      e.preventDefault();
      if (typeof navigator.clipboard?.read === 'function') {
        navigator.clipboard.read().then(async (clipboardItems) => {
          for (const clipboardItem of clipboardItems) {
            const imageType = clipboardItem.types.find((t: string) => t.startsWith('image/'));
            if (imageType) {
              const blob = await clipboardItem.getType(imageType);
              await pasteOrOpenBlob(blob, 'Copied File');
              return;
            }
          }
          // No external image — fall back to internal clipboard
          useEditorStore.getState().paste();
        }).catch(() => {
          useEditorStore.getState().paste();
        });
      } else {
        // Browser doesn't support clipboard.read() — use internal clipboard
        useEditorStore.getState().paste();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('paste', handlePaste);
    };
  }, [setZoom, setPan, viewport.zoom, docWidth, docHeight, canvasRef, setPointerMode, clearPersistentTransform, nudgeMove, nudgeSelection]);
}

function handleDeleteKey(): void {
  const editor = useEditorStore.getState();
  const sel = editor.selection;
  const activeId = editor.document.activeLayerId;
  if (!activeId) return;

  if (sel.active && sel.mask) {
    const engine = getEngine();
    if (!engine) return;

    // Commit any active transform/move float and rebuild the selection
    // mask from actual pixel alpha before clearing.
    if (hasFloat(engine)) {
      selectLayerAlpha(activeId);
      // Force-sync mask to GPU
      const selAfter = useEditorStore.getState().selection;
      if (selAfter.active && selAfter.mask) {
        const maskBytes = new Uint8Array(selAfter.mask.buffer, selAfter.mask.byteOffset, selAfter.mask.byteLength);
        setSelectionMask(engine, maskBytes, selAfter.maskWidth, selAfter.maskHeight);
      }
    }

    // Re-read selection after potential mask rebuild
    const selNow = useEditorStore.getState().selection;
    if (!selNow.active || !selNow.mask) return;

    editor.pushHistory();
    const bx = selNow.bounds ? Math.round(selNow.bounds.x) : 0;
    const by = selNow.bounds ? Math.round(selNow.bounds.y) : 0;
    const bw = selNow.bounds ? Math.round(selNow.bounds.width) : 0;
    const bh = selNow.bounds ? Math.round(selNow.bounds.height) : 0;
    // GPU-side clear: uses clipboardCut which copies then clears.
    // We discard the clipboard result — we just want the clear.
    clipboardCut(engine, activeId, true, bx, by, bw, bh);
    clearJsPixelData(activeId);
    editor.notifyRender();
  } else {
    editor.removeLayer(activeId);
  }
}
