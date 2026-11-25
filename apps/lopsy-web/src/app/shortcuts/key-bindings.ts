import { invokeFromUi } from '../../commands/invoke-from-ui';

/**
 * A keyboard handler runs a command, or is exempt: it calls the stores
 * directly, for the reason given. A command binding runs once per key press;
 * `repeats` lets it run again on each keydown auto-repeat while the key is
 * held (#1823).
 */
export type KeyBinding =
  | { readonly command: string; readonly params?: Readonly<Record<string, unknown>>; readonly repeats?: true }
  | { readonly exempt: string };

/**
 * Every handler in the global keyboard shortcuts (useKeyboardShortcuts.ts,
 * edit-, tool- and zoom-shortcuts.ts, delete-key.ts) and what it runs. A
 * command entry is the only way those handlers start a command
 * (runKeyCommand), so this table cannot drift from them.
 */
export const KEY_BINDINGS = {
  // Guards and text editing (useKeyboardShortcuts.ts)
  escapeDismissPopover: { exempt: 'closes the topmost popover or menu dropdown: UI state, no command' },
  textEditingKeys: { exempt: 'Escape, Shift+Enter, Tab, Cmd+C/X/V, arrows and typing edit the text buffer or commit/cancel it: no command' },
  spaceHeld: { exempt: 'Space down/up sets the canvas pan pointer mode: no command' },
  escapePenDraft: { exempt: 'Escape with a Pen draft drops the unfinished path: no command' },
  escapeDeselect: { command: 'select.none', params: { commit: true } },
  enterPenStroke: { exempt: 'Enter with the Pen tool commits the draft or strokes the selected path once (D17): path.stroke does neither' },
  // Delete / Backspace (delete-key.ts)
  deleteMaskClear: { command: 'mask.clear' },
  deleteSelectedPixels: { command: 'paint.clear' },
  deleteLayer: { command: 'layer.remove' },
  // Unmodified keys (tool-shortcuts.ts)
  toolLetter: { command: 'tool.select' },
  swapColors: { command: 'color.swap' },
  resetColors: { command: 'color.reset' },
  toggleQuickMask: { command: 'ui.quick-mask.toggle' },
  arrowNudge: { exempt: 'held arrow keys coalesce per frame into one history step per hold and release on keyup: the nudge commands are one burst each' },
  bracketSize: { exempt: '[ and ] step the tool\'s size by one through its setter, without the range checks tool.set applies' },
  // Cmd/Ctrl zoom (zoom-shortcuts.ts)
  zoomIn: { exempt: 'Cmd+= and Cmd++ step from the zoom React last rendered, not the store\'s (D11): ui.view.zoom-in reads the store' },
  zoomOut: { exempt: 'Cmd+- steps from the zoom React last rendered, not the store\'s (D11): ui.view.zoom-out reads the store' },
  zoomFit: { exempt: 'Cmd+0 fits to the canvas element\'s client size, not the measured viewport (D10): ui.view.fit reads the viewport' },
  zoomActualSize: { command: 'ui.view.actual-size' },
  // Cmd/Ctrl edit keys (edit-shortcuts.ts)
  liquify: { command: 'ui.filter.liquify' },
  copy: { command: 'clipboard.copy' },
  copyMerged: { command: 'clipboard.copy-merged' },
  cut: { command: 'clipboard.cut' },
  paste: { exempt: 'Cmd+V schedules a fallback and lets the browser\'s paste event read the system clipboard (D2): no command reads it' },
  mergeDown: { command: 'layer.merge-down' },
  selectAll: { command: 'select.all' },
  invertSelection: { command: 'select.invert' },
  deselect: { command: 'select.none', params: { commit: true } },
  toggleGrid: { command: 'ui.view.grid' },
  toggleGuides: { command: 'ui.view.guides' },
  undo: { command: 'history.undo', repeats: true },
  redo: { command: 'history.redo', repeats: true },
  autoTone: { command: 'image.auto', params: { kind: 'tone' } },
  autoContrast: { command: 'image.auto', params: { kind: 'contrast' } },
  autoColor: { command: 'image.auto', params: { kind: 'color' } },
  // Other listeners (useKeyboardShortcuts.ts)
  keyupRelease: { exempt: 'keyup ends the Space pan and flushes a held arrow nudge: no command' },
  pasteEvent: { exempt: 'the paste event routes text, the internal clipboard or a system clipboard image (D2): no command reads the system clipboard' },
  windowBlur: { exempt: 'window blur drops the internal clipboard\'s priority and releases held arrows: no command' },
} as const satisfies Record<string, KeyBinding>;

type Bindings = typeof KEY_BINDINGS;

export type KeyCommand = { [K in keyof Bindings]: Bindings[K] extends { readonly command: string } ? K : never }[keyof Bindings];

/** Whether the keydown being handled now is an auto-repeat of a held key. */
let handlingRepeat = false;

/**
 * Runs `handle` for one keydown, so that runKeyCommand inside it knows
 * whether the event is an auto-repeat. A held key's repeats run only the
 * bindings marked `repeats`: one-shot document commands (Delete's Clear
 * Selection, Invert, Merge Down, Auto Tone…) would otherwise push a history
 * step, a full-layer snapshot and a mask upload per repeat (#1823).
 */
export function handleKeyEvent<T>(e: KeyboardEvent, handle: () => T): T {
  const outer = handlingRepeat;
  handlingRepeat = e.repeat;
  try {
    return handle();
  } finally {
    handlingRepeat = outer;
  }
}

/**
 * Runs the command bound to a key handler, in the key's tick; `params`
 * replaces the table's own. Does nothing on an auto-repeat unless the
 * binding `repeats`.
 */
export function runKeyCommand(key: KeyCommand, params?: Readonly<Record<string, unknown>>): void {
  const binding: KeyBinding = KEY_BINDINGS[key];
  if (!('command' in binding)) return;
  if (handlingRepeat && !binding.repeats) return;
  invokeFromUi(binding.command, params ?? binding.params);
}
