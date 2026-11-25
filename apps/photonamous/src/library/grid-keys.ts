/**
 * The photo grid's own keys, on a focused tile. The shortcut registry
 * already moves focus with the arrows and grows the selection with
 * Shift+Left and Shift+Right; these are the grid keys it has no command
 * for: Home and End, Page Up and Page Down, Shift with Up and Down, Ctrl
 * (Cmd on macOS) with an arrow to move focus without selecting,
 * Ctrl/Cmd+Space to add or remove the focused photo, and Shift+F10 or the
 * Menu key for its context menu. Pure.
 */

export interface GridKeyInput {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
}

export interface GridPosition {
  /** The focused photo's index, or -1 when none is focused. */
  readonly index: number;
  readonly count: number;
  readonly columns: number;
  /** Rows that fit in the viewport: how far Page Up and Page Down go. */
  readonly pageRows: number;
}

/** select: only the photo moved to; extend: the range from the anchor; keep: move focus, leave the selection. */
export type FocusMove = 'select' | 'extend' | 'keep';

export type GridKeyAction =
  | { readonly kind: 'focus'; readonly index: number; readonly how: FocusMove }
  | { readonly kind: 'toggle' }
  | { readonly kind: 'menu' };

/** What a key press on a tile does, or null when the shortcut registry (or nothing) handles it. */
export function gridKeyAction(input: GridKeyInput, at: GridPosition): GridKeyAction | null {
  if (input.altKey || at.count === 0) return null;
  const mod = input.ctrlKey || input.metaKey;
  const hasFocus = at.index >= 0;
  if (input.key === 'ContextMenu' || (input.key === 'F10' && input.shiftKey && !mod)) return hasFocus ? { kind: 'menu' } : null;
  if (input.key === ' ' && mod && !input.shiftKey) return hasFocus ? { kind: 'toggle' } : null;

  const how: FocusMove = input.shiftKey ? 'extend' : mod ? 'keep' : 'select';
  const last = at.count - 1;
  const columns = Math.max(1, at.columns);
  const page = Math.max(1, at.pageRows) * columns;
  const go = (index: number): GridKeyAction => ({ kind: 'focus', index: Math.max(0, Math.min(last, index)), how });
  // With nothing focused, a step forward lands on the first photo and a step back on the last.
  const step = (delta: number): GridKeyAction => go(hasFocus ? at.index + delta : delta > 0 ? 0 : last);

  switch (input.key) {
    case 'Home':
      return go(0);
    case 'End':
      return go(last);
    case 'PageUp':
      return step(-page);
    case 'PageDown':
      return step(page);
    case 'ArrowUp':
    case 'ArrowDown':
      // Plain Up and Down are the registry's.
      if (!mod && !input.shiftKey) return null;
      return step(input.key === 'ArrowUp' ? -columns : columns);
    case 'ArrowLeft':
    case 'ArrowRight':
      // Plain and Shift+Left/Right are the registry's.
      if (!mod) return null;
      return step(input.key === 'ArrowLeft' ? -1 : 1);
    default:
      return null;
  }
}

/** Whole rows that fit in a viewport: Page Up and Page Down move by this many. */
export function rowsPerPage(viewportHeight: number, rowHeight: number): number {
  if (rowHeight <= 0) return 1;
  return Math.max(1, Math.floor(viewportHeight / rowHeight));
}
