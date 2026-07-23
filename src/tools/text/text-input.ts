/**
 * Pure text editing operations — no DOM, no React, no store dependencies.
 * Returns the new text/cursor/selection after each operation.
 *
 * Offsets are UTF-16 string indices (JS `string` semantics), matching how the
 * store's `cursorPos`/`selectionAnchor` are used. Conversion to the engine's
 * UTF-8 byte offsets happens at the WASM call boundary, not here.
 */

export interface TextEditState {
  text: string;
  cursorPos: number;
  /** Fixed end of an active selection, or null when there is no selection. */
  selectionAnchor: number | null;
  /**
   * Goal x (engine layout space) preserved across consecutive vertical moves so
   * the caret keeps its column through short lines. Null forces a recompute.
   */
  preferredX: number | null;
}

/** Geometry lookups backed by the engine, injected so this module stays pure. */
export interface TextGeometry {
  /** Caret rect for a UTF-16 offset, or null if unavailable. */
  caretRect(pos: number): { x: number; top: number; height: number } | null;
  /** Nearest UTF-16 offset for a layout-space point, or null. */
  hitTest(x: number, y: number): number | null;
}

export interface KeyModifiers {
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

/** True when the state has a non-empty selection. */
export function hasSelection(state: TextEditState): boolean {
  return state.selectionAnchor !== null && state.selectionAnchor !== state.cursorPos;
}

/** The ordered [start, end) of the current selection, or null. */
export function selectionRange(state: TextEditState): [number, number] | null {
  if (state.selectionAnchor === null) return null;
  const a = state.selectionAnchor;
  const b = state.cursorPos;
  return a <= b ? [a, b] : [b, a];
}

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}_]/u.test(ch);
}

/** Line start offset (just after the previous '\n', or 0). */
export function lineStart(text: string, pos: number): number {
  return text.lastIndexOf('\n', pos - 1) + 1;
}

/** Line end offset (the next '\n', or text length). */
export function lineEnd(text: string, pos: number): number {
  const idx = text.indexOf('\n', pos);
  return idx === -1 ? text.length : idx;
}

/** Next word boundary at or after `pos` (skip separators, then word chars). */
export function wordBoundaryAfter(text: string, pos: number): number {
  let i = pos;
  while (i < text.length && !isWordChar(text[i]!)) i++;
  while (i < text.length && isWordChar(text[i]!)) i++;
  return i;
}

/** Previous word boundary at or before `pos`. */
export function wordBoundaryBefore(text: string, pos: number): number {
  let i = pos;
  while (i > 0 && !isWordChar(text[i - 1]!)) i--;
  while (i > 0 && isWordChar(text[i - 1]!)) i--;
  return i;
}

/**
 * The word range containing `pos`, for double-click selection. Falls back to
 * the single character under `pos` when it is not a word char.
 */
export function wordAt(text: string, pos: number): [number, number] {
  if (text.length === 0) return [0, 0];
  // Caret at the very end selects the trailing run.
  const anchor = pos >= text.length ? text.length - 1 : pos;
  const cls = isWordChar(text[anchor]!);
  let start = anchor;
  let end = anchor;
  while (start > 0 && isWordChar(text[start - 1]!) === cls) start--;
  while (end < text.length && isWordChar(text[end]!) === cls) end++;
  return [start, end];
}

function collapsed(text: string, cursorPos: number): TextEditState {
  return { text, cursorPos, selectionAnchor: null, preferredX: null };
}

/** Remove the current selection (no-op collapse if there is none). */
export function deleteSelection(state: TextEditState): TextEditState {
  const range = selectionRange(state);
  if (!range) return { ...state, selectionAnchor: null };
  const [start, end] = range;
  const newText = state.text.slice(0, start) + state.text.slice(end);
  return collapsed(newText, start);
}

/** Insert text at the cursor, replacing any active selection. */
export function insertText(state: TextEditState, chars: string): TextEditState {
  const range = selectionRange(state);
  const [start, end] = range ?? [state.cursorPos, state.cursorPos];
  const newText = state.text.slice(0, start) + chars + state.text.slice(end);
  return collapsed(newText, start + chars.length);
}

export function deleteBackward(state: TextEditState): TextEditState {
  if (hasSelection(state)) return deleteSelection(state);
  const { text, cursorPos } = state;
  if (cursorPos <= 0) return { ...state, selectionAnchor: null };
  const newText = text.slice(0, cursorPos - 1) + text.slice(cursorPos);
  return collapsed(newText, cursorPos - 1);
}

export function deleteForward(state: TextEditState): TextEditState {
  if (hasSelection(state)) return deleteSelection(state);
  const { text, cursorPos } = state;
  if (cursorPos >= text.length) return { ...state, selectionAnchor: null };
  const newText = text.slice(0, cursorPos) + text.slice(cursorPos + 1);
  return collapsed(newText, cursorPos);
}

/**
 * Move the cursor to `target`, either extending the selection (shift) or
 * collapsing it. Resets the vertical goal column.
 */
function moveTo(state: TextEditState, target: number, shift: boolean): TextEditState {
  const clamped = Math.max(0, Math.min(state.text.length, target));
  if (shift) {
    const anchor = state.selectionAnchor ?? state.cursorPos;
    return { text: state.text, cursorPos: clamped, selectionAnchor: anchor, preferredX: null };
  }
  return collapsed(state.text, clamped);
}

function moveLeft(state: TextEditState, shift: boolean): TextEditState {
  // A plain left-arrow with a selection collapses to its start.
  if (!shift && hasSelection(state)) {
    const [start] = selectionRange(state)!;
    return collapsed(state.text, start);
  }
  return moveTo(state, state.cursorPos - 1, shift);
}

function moveRight(state: TextEditState, shift: boolean): TextEditState {
  if (!shift && hasSelection(state)) {
    const [, end] = selectionRange(state)!;
    return collapsed(state.text, end);
  }
  return moveTo(state, state.cursorPos + 1, shift);
}

/**
 * Vertical caret movement. Uses injected geometry to find the offset one line
 * up/down at the preferred column. Preserves the goal column across calls.
 */
export function moveVertical(
  state: TextEditState,
  direction: 'up' | 'down',
  geometry: TextGeometry,
  shift: boolean,
): TextEditState {
  const anchor = shift ? (state.selectionAnchor ?? state.cursorPos) : null;
  const rect = geometry.caretRect(state.cursorPos);
  if (!rect) {
    // No geometry (e.g. empty text) — fall back to horizontal extremes.
    const target = direction === 'up' ? 0 : state.text.length;
    return { text: state.text, cursorPos: target, selectionAnchor: anchor, preferredX: null };
  }

  const preferredX = state.preferredX ?? rect.x;
  const targetY = direction === 'up'
    ? rect.top - rect.height * 0.5
    : rect.top + rect.height * 1.5;
  const hit = geometry.hitTest(preferredX, targetY);

  if (hit !== null) {
    const hitRect = geometry.caretRect(hit);
    const changedLine = !hitRect || Math.abs(hitRect.top - rect.top) > 0.5;
    if (changedLine) {
      return { text: state.text, cursorPos: hit, selectionAnchor: anchor, preferredX };
    }
  }

  // Already on the first/last line — snap to the line boundary.
  const target = direction === 'up'
    ? lineStart(state.text, state.cursorPos)
    : lineEnd(state.text, state.cursorPos);
  return { text: state.text, cursorPos: target, selectionAnchor: anchor, preferredX: null };
}

/**
 * Process a keyboard event and return the new state, or null if the key wasn't
 * handled here (e.g. ArrowUp/ArrowDown, which need geometry — see moveVertical).
 */
export function processTextKey(
  state: TextEditState,
  key: string,
  mods: KeyModifiers,
): TextEditState | null {
  const { meta, shift, alt } = mods;

  if (key === 'Backspace') return deleteBackward(state);
  if (key === 'Delete') return deleteForward(state);
  if (key === 'Enter') return insertText(state, '\n');

  if (key === 'Home') return moveTo(state, lineStart(state.text, state.cursorPos), shift);
  if (key === 'End') return moveTo(state, lineEnd(state.text, state.cursorPos), shift);

  if (key === 'ArrowLeft') {
    if (meta) return moveTo(state, lineStart(state.text, state.cursorPos), shift);
    if (alt) return moveTo(state, wordBoundaryBefore(state.text, state.cursorPos), shift);
    return moveLeft(state, shift);
  }
  if (key === 'ArrowRight') {
    if (meta) return moveTo(state, lineEnd(state.text, state.cursorPos), shift);
    if (alt) return moveTo(state, wordBoundaryAfter(state.text, state.cursorPos), shift);
    return moveRight(state, shift);
  }

  // Select all.
  if (meta && (key === 'a' || key === 'A')) {
    return { text: state.text, cursorPos: state.text.length, selectionAnchor: 0, preferredX: null };
  }

  // Single printable character (ignore other meta/ctrl combos — clipboard etc.
  // are handled by the caller).
  if (key.length === 1 && !meta) {
    return insertText(state, key);
  }

  return null;
}
