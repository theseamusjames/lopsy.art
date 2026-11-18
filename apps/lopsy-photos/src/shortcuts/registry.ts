/**
 * Every keyboard shortcut of the library, in one place. The key handler
 * looks commands up here and the help popover lists them from here, so
 * the two never disagree.
 */

export type ShortcutContext = 'grid' | 'single' | 'compare' | 'cull';

export type CommandId =
  | 'rate-0'
  | 'rate-1'
  | 'rate-2'
  | 'rate-3'
  | 'rate-4'
  | 'rate-5'
  | 'set-aside'
  | 'label-red'
  | 'label-yellow'
  | 'label-green'
  | 'label-blue'
  | 'label-purple'
  | 'move-left'
  | 'move-right'
  | 'move-up'
  | 'move-down'
  | 'extend-left'
  | 'extend-right'
  | 'open-edit'
  | 'open-single'
  | 'open-compare'
  | 'open-cull'
  | 'back'
  | 'select-all'
  | 'select-none'
  | 'delete'
  | 'toggle-info'
  | 'copy-edits'
  | 'paste-edits'
  | 'help';

export interface KeyChord {
  /** `KeyboardEvent.key`, compared case-insensitively for letters. */
  readonly key: string;
  /** Cmd on macOS, Ctrl elsewhere. */
  readonly mod?: boolean;
  readonly shift?: boolean;
}

export interface Shortcut {
  readonly id: CommandId;
  readonly chords: readonly KeyChord[];
  readonly description: string;
  readonly group: 'Marks' | 'Moving around' | 'Views' | 'Selection';
  readonly contexts: readonly ShortcutContext[];
}

const ALL: readonly ShortcutContext[] = ['grid', 'single', 'compare', 'cull'];
const VIEWING: readonly ShortcutContext[] = ['grid', 'single', 'cull'];

function rate(n: 0 | 1 | 2 | 3 | 4 | 5): Shortcut {
  return {
    id: `rate-${n}`,
    chords: [{ key: String(n) }],
    description: n === 0 ? 'Clear the rating' : `Rate ${n} star${n === 1 ? '' : 's'}`,
    group: 'Marks',
    contexts: ALL,
  };
}

function label(id: CommandId, key: string, colour: string): Shortcut {
  return { id, chords: [{ key }], description: `${colour} label (press again to remove)`, group: 'Marks', contexts: ALL };
}

export const SHORTCUTS: readonly Shortcut[] = [
  rate(0),
  rate(1),
  rate(2),
  rate(3),
  rate(4),
  rate(5),
  { id: 'set-aside', chords: [{ key: 'x' }], description: 'Set aside, or bring back', group: 'Marks', contexts: ALL },
  label('label-red', 'r', 'Red'),
  label('label-yellow', 'y', 'Yellow'),
  label('label-green', 'g', 'Green'),
  label('label-blue', 'b', 'Blue'),
  label('label-purple', 'p', 'Purple'),
  { id: 'move-left', chords: [{ key: 'ArrowLeft' }], description: 'Previous photo', group: 'Moving around', contexts: VIEWING },
  { id: 'move-right', chords: [{ key: 'ArrowRight' }], description: 'Next photo', group: 'Moving around', contexts: VIEWING },
  { id: 'move-up', chords: [{ key: 'ArrowUp' }], description: 'Photo above', group: 'Moving around', contexts: ['grid'] },
  { id: 'move-down', chords: [{ key: 'ArrowDown' }], description: 'Photo below', group: 'Moving around', contexts: ['grid'] },
  { id: 'extend-left', chords: [{ key: 'ArrowLeft', shift: true }], description: 'Grow the selection left', group: 'Selection', contexts: ['grid'] },
  { id: 'extend-right', chords: [{ key: 'ArrowRight', shift: true }], description: 'Grow the selection right', group: 'Selection', contexts: ['grid'] },
  { id: 'open-edit', chords: [{ key: 'Enter' }], description: 'Edit the photo', group: 'Views', contexts: ['grid', 'single', 'cull'] },
  { id: 'open-single', chords: [{ key: ' ' }], description: 'Look at one photo large, and back', group: 'Views', contexts: ['grid', 'single'] },
  { id: 'open-compare', chords: [{ key: 'c' }], description: 'Compare the selected photos', group: 'Views', contexts: ['grid', 'single'] },
  { id: 'open-cull', chords: [{ key: 'f' }], description: 'Sort through full screen (marking moves on)', group: 'Views', contexts: ['grid', 'single'] },
  { id: 'back', chords: [{ key: 'Escape' }], description: 'Go back', group: 'Views', contexts: ALL },
  { id: 'toggle-info', chords: [{ key: 'i' }], description: 'Show or hide details', group: 'Views', contexts: ['grid', 'single', 'compare'] },
  { id: 'select-all', chords: [{ key: 'a', mod: true }], description: 'Select every photo shown', group: 'Selection', contexts: ['grid'] },
  { id: 'select-none', chords: [{ key: 'd', mod: true }], description: 'Select none', group: 'Selection', contexts: ['grid'] },
  {
    id: 'delete',
    chords: [{ key: 'Delete' }, { key: 'Backspace' }],
    description: 'Move to the trash',
    group: 'Selection',
    contexts: ['grid', 'single'],
  },
  {
    id: 'copy-edits',
    chords: [{ key: 'c', mod: true, shift: true }],
    description: 'Copy edits (choose which)',
    group: 'Marks',
    contexts: ['grid', 'single', 'compare'],
  },
  {
    id: 'paste-edits',
    chords: [{ key: 'v', mod: true, shift: true }],
    description: 'Paste edits onto the selection',
    group: 'Marks',
    contexts: ['grid', 'single', 'compare'],
  },
  { id: 'help', chords: [{ key: '?', shift: true }, { key: '?' }], description: 'Show these shortcuts', group: 'Views', contexts: ALL },
];

export interface KeyInput {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

function chordMatches(chord: KeyChord, input: KeyInput): boolean {
  if (input.altKey) return false;
  const mod = input.metaKey || input.ctrlKey;
  if ((chord.mod ?? false) !== mod) return false;
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  if (key !== chord.key) return false;
  // Shift matters for named keys; for printed characters the key already carries it.
  if (chord.key.length > 1 || chord.shift !== undefined) return (chord.shift ?? false) === input.shiftKey;
  return true;
}

/** The command a key press runs in this context, or null. */
export function matchShortcut(input: KeyInput, context: ShortcutContext): CommandId | null {
  for (const s of SHORTCUTS) {
    if (!s.contexts.includes(context)) continue;
    if (s.chords.some((c) => chordMatches(c, input))) return s.id;
  }
  return null;
}

/** How a chord is written for people. */
export function formatChord(chord: KeyChord, isMac: boolean): string {
  const names: Record<string, string> = {
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ' ': 'Space',
    Escape: 'Esc',
    Backspace: '⌫',
  };
  const key = names[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key);
  const parts: string[] = [];
  if (chord.mod) parts.push(isMac ? '⌘' : 'Ctrl');
  if (chord.shift && chord.key.length > 1) parts.push('Shift');
  parts.push(key);
  return parts.join(isMac ? '' : '+');
}

/** Shortcuts grouped for the help popover, each with its first chord. */
export function shortcutGroups(): ReadonlyArray<{ readonly group: Shortcut['group']; readonly items: readonly Shortcut[] }> {
  const order: Shortcut['group'][] = ['Marks', 'Moving around', 'Selection', 'Views'];
  return order.map((group) => ({ group, items: SHORTCUTS.filter((s) => s.group === group) }));
}

/** Key presses inside text fields are typing, not commands. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (target as HTMLInputElement).type;
  return type !== 'range' && type !== 'checkbox' && type !== 'radio' && type !== 'button';
}
