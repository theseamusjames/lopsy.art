import { useEffect, useRef, type RefObject } from 'react';
import { useUIStore } from './ui-store';
import { useEditorStore } from './editor-store';
import { clearJsPixelData } from './store/clear-js-pixel-data';
import { strokeCurrentPath } from './useCanvasInteraction';
import { getEngine } from '../engine-wasm/engine-state';
import { clearSelectedPixels, hasFloat, setSelectionMask } from '../engine-wasm/wasm-bridge';
import { selectLayerAlpha } from '../panels/LayerPanel/layer-selection';
import { handleToolShortcut, handleSizeShortcut, handleNudgeShortcut } from './shortcuts/tool-shortcuts';
import { releaseNudgeKey } from './shortcuts/nudge-coalesce';
import { isNativeArrowKeyTarget } from './shortcuts/native-control-keys';
import { handleEditShortcut } from './shortcuts/edit-shortcuts';
import { handleZoomShortcut } from './shortcuts/zoom-shortcuts';
import { pasteOrOpenBlob } from './paste-or-open';
import { describeError, notifyError } from './notifications-store';
import {
  processTextKey,
  moveVertical,
  deleteSelection,
  selectionRange,
  isCompositionKeyEvent,
  insertInputText,
  type TextEditState,
} from '../tools/text/text-input';
import { isTextInputSink } from './text-input-sink';
import { makeTextGeometry } from '../tools/text/text-geometry';
import { commitTextEditing, cancelTextEditing } from '../tools/text/text-interaction';
import { POINTER_IDLE, POINTER_SPACE_HELD, type PointerMode } from './pointer-mode';

// Text-entry input types swallow global shortcuts; other input types
// (range, checkbox, radio, color, button…) do not. Undefined `type`
// defaults to 'text' per the HTML spec.
const TEXT_ENTRY_INPUT_TYPES = new Set([
  'text', 'search', 'url', 'email', 'password', 'tel', 'number',
]);

function isTextEntryInput(el: HTMLInputElement): boolean {
  const t = (el.type || 'text').toLowerCase();
  return TEXT_ENTRY_INPUT_TYPES.has(t);
}

// Fallback timer for browsers where the paste event may not fire on non-editable
// elements (e.g. Firefox with canvas focus). The keydown handler schedules a
// deferred internal paste; if the paste event fires, it cancels the timer.
let fallbackPasteTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleFallbackPaste(): void {
  // Never fall back to an image paste while editing text — the text paste is
  // handled by the paste event (or the keydown path) instead.
  if (useUIStore.getState().textEditing) return;
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

/**
 * Route a pasted image blob, preferring the internal clipboard when the image
 * is a paste-back of content that was copied *inside* the app.
 *
 * `copy()`/`cut()` mirror the copied pixels to the system clipboard as a plain
 * PNG so they can be pasted into other apps. That PNG carries no position, so
 * routing it through `pasteOrOpenBlob` drops the new layer at 0,0 — losing the
 * location the content was copied from. The internal clipboard, by contrast,
 * records the copy offset and pastes in place. `tryPasteInternalCopy` uses it
 * when the incoming image matches the internal clipboard's dimensions and
 * pixels; otherwise this is a genuinely external image and we open it normally.
 */
async function pasteImageBlob(blob: Blob, name: string): Promise<void> {
  const handledInternally = await useEditorStore.getState().tryPasteInternalCopy(blob);
  if (!handledInternally) {
    await pasteOrOpenBlob(blob, name);
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
  // Goal column for vertical caret moves; survives effect re-runs, transient UI
  // state so it lives outside Zustand to avoid re-renders on every arrow press.
  const preferredXRef = useRef<number | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Text editing mode: route keyboard input to the text editor
      const textEditing = useUIStore.getState().textEditing;

      // The text tool's input sink is a textarea too, but keys aimed at it
      // belong to the text editor below, not to the field.
      const isSinkTarget = isTextInputSink(e.target);
      if (!isSinkTarget && (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        // #817 — only swallow shortcuts when a text-entry field has focus.
        // Range sliders, checkboxes, radios etc. must not eat ⌘Z / tool keys.
        const isTextEntry = e.target instanceof HTMLTextAreaElement
          || isTextEntryInput(e.target as HTMLInputElement);
        if (!textEditing) {
          if (isTextEntry) return;
        } else {
          if (isTextEntry) return;
          (e.target as HTMLInputElement).blur();
        }
      }
      if (textEditing) {
        // Keys that drive an IME composition are the IME's; the composed text
        // reaches the buffer through the input sink's composition events.
        if (isCompositionKeyEvent(e)) return;

        if (e.key === 'Escape') {
          e.preventDefault();
          preferredXRef.current = null;
          cancelTextEditing();
          return;
        }

        // Shift+Enter or Tab commits text. Tab also has to swallow the browser
        // default (focus change) so the next single-key shortcut isn't captured
        // by a newly-focused element, and so the textEditing state doesn't
        // outlive the commit and route subsequent letters into the text buffer.
        if ((e.key === 'Enter' && e.shiftKey) || e.key === 'Tab') {
          e.preventDefault();
          preferredXRef.current = null;
          commitTextEditing();
          return;
        }

        const meta = e.metaKey || e.ctrlKey;
        const state: TextEditState = {
          text: textEditing.text,
          cursorPos: textEditing.cursorPos,
          selectionAnchor: textEditing.selectionAnchor,
          preferredX: preferredXRef.current,
        };

        // Clipboard: copy/cut go to the system clipboard; paste is handled by
        // the native paste event (Cmd+V is intentionally not prevented here).
        if (meta && (e.key === 'c' || e.key === 'C')) {
          e.preventDefault();
          preferredXRef.current = null;
          const range = selectionRange(state);
          if (range) {
            navigator.clipboard.writeText(state.text.slice(range[0], range[1])).catch(() => {});
          }
          return;
        }
        if (meta && (e.key === 'x' || e.key === 'X')) {
          e.preventDefault();
          preferredXRef.current = null;
          const range = selectionRange(state);
          if (range) {
            navigator.clipboard.writeText(state.text.slice(range[0], range[1])).catch(() => {});
            const next = deleteSelection(state);
            useUIStore.getState().updateTextEditingSelection(next.text, next.cursorPos, next.selectionAnchor);
            useEditorStore.getState().notifyRender();
          }
          return;
        }
        if (meta && (e.key === 'v' || e.key === 'V')) {
          // Let the browser's paste event fire (see handlePaste below).
          preferredXRef.current = null;
          return;
        }

        // Vertical caret movement needs engine geometry.
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const engine = getEngine();
          if (engine) {
            const geometry = makeTextGeometry(engine, textEditing.layerId, textEditing.text);
            const next = moveVertical(state, e.key === 'ArrowUp' ? 'up' : 'down', geometry, e.shiftKey);
            preferredXRef.current = next.preferredX;
            useUIStore.getState().updateTextEditingSelection(next.text, next.cursorPos, next.selectionAnchor);
            useEditorStore.getState().notifyRender();
          }
          return;
        }

        const result = processTextKey(state, e.key, { meta, shift: e.shiftKey, alt: e.altKey });
        if (result) {
          e.preventDefault();
          preferredXRef.current = null;
          useUIStore.getState().updateTextEditingSelection(result.text, result.cursorPos, result.selectionAnchor);
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
        if (uiState.activeTool === 'path' && (uiState.pathDraft?.anchors.length ?? 0) > 0) {
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
        if (uiState.activeTool === 'path' && (uiState.pathDraft?.anchors.length ?? 0) >= 2) {
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
        // #897 — a focused range/radio/select handles arrow keys itself
        // (slider stepping, radio-group navigation, option cycling); don't
        // let the global nudge shortcut win the race and move the layer
        // instead. Tool-select letters and other shortcuts above/below this
        // check are unaffected, per #817's intent for non-text inputs.
        if (isNativeArrowKeyTarget(e.target, e.key)) return;
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
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // Flush any coalesced nudge and reset the per-hold history latch.
        releaseNudgeKey(e.key);
      }
    };

    // Unified paste handler — handles image data, file copies, and internal clipboard.
    // Fired by the browser's native paste event (Cmd+V keydown does NOT preventDefault,
    // so the paste event always fires).
    const handlePaste = (e: ClipboardEvent) => {
      if (!isTextInputSink(e.target)) {
        if (e.target instanceof HTMLTextAreaElement) return;
        if (e.target instanceof HTMLInputElement && isTextEntryInput(e.target)) return;
      }

      // Cancel the fallback timer — the paste event fired as expected.
      cancelFallbackPaste();

      // While editing text, paste plain text into the buffer (replacing any
      // selection) and never fall through to the image-paste path.
      const activeTextEdit = useUIStore.getState().textEditing;
      if (activeTextEdit) {
        e.preventDefault();
        preferredXRef.current = null;
        const raw = e.clipboardData?.getData('text/plain') ?? '';
        if (raw) {
          const next = insertInputText({
            text: activeTextEdit.text,
            cursorPos: activeTextEdit.cursorPos,
            selectionAnchor: activeTextEdit.selectionAnchor,
            preferredX: null,
          }, raw);
          useUIStore.getState().updateTextEditingSelection(next.text, next.cursorPos, next.selectionAnchor);
          useEditorStore.getState().notifyRender();
        }
        return;
      }

      const files = e.clipboardData?.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (file && file.type.startsWith('image/')) {
          e.preventDefault();
          const name = file.name.replace(/\.[^.]+$/, '') || 'Copied File';
          pasteImageBlob(file, name).catch((err) =>
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
              pasteImageBlob(blob, 'Copied File').catch((err) =>
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
              await pasteImageBlob(blob, 'Copied File');
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
    }

    // Re-read selection after potential mask rebuild
    const selNow = useEditorStore.getState().selection;
    if (!selNow.active || !selNow.mask) return;

    // Force-sync the current selection mask to the GPU before clearing.
    // The GPU mask is otherwise only updated on the next render frame, so a
    // selection that was just nudged with the arrow keys (or floated) would
    // clear using a stale mask — clearing the original area instead of the
    // moved one.
    const maskBytes = new Uint8Array(selNow.mask.buffer, selNow.mask.byteOffset, selNow.mask.byteLength);
    setSelectionMask(engine, maskBytes, selNow.maskWidth, selNow.maskHeight);

    editor.pushHistory('Clear Selection');
    // Clear only — clipboardCut would also re-copy into the retained
    // internal clipboard as a side effect, clobbering a paste-in-place
    // copy made earlier with ⌘C/⌘X (see #870).
    clearSelectedPixels(engine, activeId, true);
    clearJsPixelData(activeId);
    editor.notifyRender();
  } else {
    editor.removeLayer(activeId);
  }
}
