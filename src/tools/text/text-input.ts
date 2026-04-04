/**
 * Pure text editing operations — no DOM, no React, no store dependencies.
 * Returns the new text and cursor position after each operation.
 */

export interface TextEditState {
  text: string;
  cursorPos: number;
}

export function insertCharacter(state: TextEditState, char: string): TextEditState {
  const { text, cursorPos } = state;
  const newText = text.slice(0, cursorPos) + char + text.slice(cursorPos);
  return { text: newText, cursorPos: cursorPos + char.length };
}

export function deleteBackward(state: TextEditState): TextEditState {
  const { text, cursorPos } = state;
  if (cursorPos <= 0) return state;
  const newText = text.slice(0, cursorPos - 1) + text.slice(cursorPos);
  return { text: newText, cursorPos: cursorPos - 1 };
}

export function deleteForward(state: TextEditState): TextEditState {
  const { text, cursorPos } = state;
  if (cursorPos >= text.length) return state;
  const newText = text.slice(0, cursorPos) + text.slice(cursorPos + 1);
  return { text: newText, cursorPos };
}

export function moveCursorLeft(state: TextEditState): TextEditState {
  return { text: state.text, cursorPos: Math.max(0, state.cursorPos - 1) };
}

export function moveCursorRight(state: TextEditState): TextEditState {
  return { text: state.text, cursorPos: Math.min(state.text.length, state.cursorPos + 1) };
}

export function moveCursorHome(state: TextEditState): TextEditState {
  // Move to the start of the current line
  const { text, cursorPos } = state;
  const lineStart = text.lastIndexOf('\n', cursorPos - 1) + 1;
  return { text, cursorPos: lineStart };
}

export function moveCursorEnd(state: TextEditState): TextEditState {
  // Move to the end of the current line
  const { text, cursorPos } = state;
  const lineEnd = text.indexOf('\n', cursorPos);
  return { text, cursorPos: lineEnd === -1 ? text.length : lineEnd };
}

export function insertNewline(state: TextEditState): TextEditState {
  return insertCharacter(state, '\n');
}

/**
 * Process a keyboard event and return the new state, or null if the key wasn't handled.
 */
export function processTextKey(
  state: TextEditState,
  key: string,
  metaKey: boolean,
): TextEditState | null {
  if (key === 'Backspace') return deleteBackward(state);
  if (key === 'Delete') return deleteForward(state);
  if (key === 'ArrowLeft') return moveCursorLeft(state);
  if (key === 'ArrowRight') return moveCursorRight(state);
  if (key === 'Home') return moveCursorHome(state);
  if (key === 'End') return moveCursorEnd(state);
  if (key === 'Enter') return insertNewline(state);

  // Select all: Cmd+A / Ctrl+A — move cursor to end (simplified, no selection)
  if (metaKey && key === 'a') {
    return { text: state.text, cursorPos: state.text.length };
  }

  // Single printable character
  if (key.length === 1 && !metaKey) {
    return insertCharacter(state, key);
  }

  return null;
}
