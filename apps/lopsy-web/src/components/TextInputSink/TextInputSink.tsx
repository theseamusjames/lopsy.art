import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useUIStore, type TextEditingState } from '../../app/ui-store';
import { useEditorStore } from '../../app/editor-store';
import { TEXT_INPUT_SINK_ATTR } from '../../app/text-input-sink';
import { getEngine } from '../../engine-wasm/engine-state';
import { makeTextGeometry } from '../../tools/text/text-geometry';
import {
  applyComposition,
  insertInputText,
  type TextEditState,
} from '../../tools/text/text-input';
import styles from './TextInputSink.module.css';

interface TextInputSinkProps {
  containerRef: RefObject<HTMLElement | null>;
}

const SINK_ATTRS = { [TEXT_INPUT_SINK_ATTR]: '' };

function toEditState(editing: TextEditingState): TextEditState {
  return {
    text: editing.text,
    cursorPos: editing.cursorPos,
    selectionAnchor: editing.selectionAnchor,
    preferredX: null,
  };
}

function applyEditState(next: TextEditState): void {
  useUIStore.getState().updateTextEditingSelection(next.text, next.cursorPos, next.selectionAnchor);
  useEditorStore.getState().notifyRender();
}

interface SinkPosition {
  x: number;
  y: number;
  height: number;
}

/**
 * Where to dock the sink: under the caret, in container pixels, so the OS
 * places the IME candidate window next to the text being composed. Clamped
 * into the container so typing never scrolls the canvas area.
 */
function sinkPosition(
  editing: TextEditingState,
  container: HTMLElement | null,
  zoom: number,
  panX: number,
  panY: number,
  docWidth: number,
  docHeight: number,
): SinkPosition {
  const engine = getEngine();
  const caret = engine
    ? makeTextGeometry(engine, editing.layerId, editing.text).caretRect(editing.cursorPos)
    : null;
  const docX = editing.bounds.x + (caret?.x ?? 0);
  const docY = editing.bounds.y + (caret?.top ?? 0);
  const height = Math.max(1, (caret?.height ?? 16) * zoom);
  const width = container?.clientWidth ?? 0;
  const containerHeight = container?.clientHeight ?? 0;
  const x = (docX - docWidth / 2) * zoom + panX + width / 2;
  const y = (docY - docHeight / 2) * zoom + panY + containerHeight / 2;
  return {
    x: Math.min(Math.max(0, x), Math.max(0, width - 1)),
    y: Math.min(Math.max(0, y), Math.max(0, containerHeight - height)),
    height,
  };
}

/**
 * A hidden, focused textarea mounted while a text layer is being edited. It
 * gives the browser a real editable target so text that never arrives as a
 * printable keydown — IME commits, emoji and symbol pickers, dictation,
 * `insertText` — reaches the text buffer. Ordinary keys are still handled
 * (and default-prevented) by the global keyboard handler, so they never reach
 * the textarea and are not inserted twice.
 */
export function TextInputSink({ containerRef }: TextInputSinkProps) {
  const textEditing = useUIStore((s) => s.textEditing);
  const zoom = useEditorStore((s) => s.viewport.zoom);
  const panX = useEditorStore((s) => s.viewport.panX);
  const panY = useEditorStore((s) => s.viewport.panY);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const sinkRef = useRef<HTMLTextAreaElement>(null);
  const compositionBaseRef = useRef<TextEditState | null>(null);
  const isEditing = textEditing !== null;

  useEffect(() => {
    if (!isEditing) {
      compositionBaseRef.current = null;
      return;
    }
    const sink = sinkRef.current;
    if (!sink) return;
    sink.focus({ preventScroll: true });
    // The textarea is kept empty, so its native undo history would only
    // resurrect text that has already been moved into the buffer.
    const handleBeforeInput = (e: InputEvent) => {
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') e.preventDefault();
    };
    sink.addEventListener('beforeinput', handleBeforeInput);
    return () => sink.removeEventListener('beforeinput', handleBeforeInput);
  }, [isEditing]);

  const handleBlur = useCallback(() => {
    // A click on the canvas moves focus to <body>; take it back so the next
    // IME session still has a target. Focus that went to a real control (an
    // options-bar field, a menu) is left alone.
    setTimeout(() => {
      const sink = sinkRef.current;
      if (!sink || !useUIStore.getState().textEditing) return;
      const active = document.activeElement;
      if (active === null || active === document.body) sink.focus({ preventScroll: true });
    }, 0);
  }, []);

  const handleCompositionStart = useCallback(() => {
    const editing = useUIStore.getState().textEditing;
    compositionBaseRef.current = editing ? toEditState(editing) : null;
  }, []);

  const handleCompositionUpdate = useCallback((e: React.CompositionEvent<HTMLTextAreaElement>) => {
    const base = compositionBaseRef.current;
    if (!base || !useUIStore.getState().textEditing) return;
    applyEditState(applyComposition(base, e.data));
  }, []);

  const handleCompositionEnd = useCallback((e: React.CompositionEvent<HTMLTextAreaElement>) => {
    const base = compositionBaseRef.current;
    compositionBaseRef.current = null;
    e.currentTarget.value = '';
    if (!base || !useUIStore.getState().textEditing) return;
    applyEditState(applyComposition(base, e.data));
  }, []);

  const handleInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    // Composition text is previewed via compositionupdate and committed on
    // compositionend; only text inserted outside a composition lands here.
    if (compositionBaseRef.current || (e.nativeEvent as InputEvent).isComposing) return;
    const sink = e.currentTarget;
    const value = sink.value;
    sink.value = '';
    const editing = useUIStore.getState().textEditing;
    if (!editing || value === '') return;
    applyEditState(insertInputText(toEditState(editing), value));
  }, []);

  if (!textEditing) return null;

  const pos = sinkPosition(textEditing, containerRef.current, zoom, panX, panY, docWidth, docHeight);

  return (
    <textarea
      ref={sinkRef}
      {...SINK_ATTRS}
      className={styles.sink}
      style={{
        '--sink-x': `${pos.x}px`,
        '--sink-y': `${pos.y}px`,
        '--sink-height': `${pos.height}px`,
      } as React.CSSProperties}
      aria-label="Text input"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      tabIndex={-1}
      onBlur={handleBlur}
      onCompositionStart={handleCompositionStart}
      onCompositionUpdate={handleCompositionUpdate}
      onCompositionEnd={handleCompositionEnd}
      onInput={handleInput}
    />
  );
}
