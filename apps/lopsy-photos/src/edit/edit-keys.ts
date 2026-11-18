/** Keyboard shortcuts of the Edit view. */

export type EditShortcut =
  | 'undo'
  | 'redo'
  | 'fit'
  | 'actualSize'
  | 'before'
  | 'previous'
  | 'next'
  | 'copyEdits'
  | 'pasteEdits'
  | 'leave'
  | 'help';

export interface KeyInfo {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/** ⌘ on a Mac, Ctrl elsewhere; either is accepted. */
export function shortcutFor(e: KeyInfo): EditShortcut | null {
  const isCommand = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  if (isCommand && !e.altKey) {
    if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
    if (key === 'c' && e.shiftKey) return 'copyEdits';
    if (key === 'v' && e.shiftKey) return 'pasteEdits';
    if (key === 'y' && !e.shiftKey) return 'redo';
    if (key === '0') return 'fit';
    if (key === '1') return 'actualSize';
    return null;
  }
  if (e.key === '?' && !e.altKey) return 'help';
  if (e.key === 'Escape' && !e.altKey && !e.shiftKey) return 'leave';
  if (e.altKey || e.shiftKey) return null;
  if (e.key === '\\') return 'before';
  if (e.key === 'ArrowLeft') return 'previous';
  if (e.key === 'ArrowRight') return 'next';
  return null;
}

/** Whether the key press belongs to a text field rather than to the view. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export interface PreviewState {
  readonly thumbHash: string | null;
  readonly screenHash: string | null;
}

/** Whether the stored previews are behind the edit `hash`. */
export function isPreviewStale(stored: PreviewState, hash: string): boolean {
  return stored.thumbHash !== hash || stored.screenHash !== hash;
}

/** The ID `step` places away from `currentId` in `ids`, or null at either end. */
export function neighbourId(ids: readonly string[], currentId: string, step: -1 | 1): string | null {
  const index = ids.indexOf(currentId);
  if (index < 0) return null;
  return ids[index + step] ?? null;
}

/** The Edit view's shortcuts, as its help lists them. */
export const EDIT_SHORTCUTS: readonly { readonly keys: string; readonly action: string }[] = [
  { keys: '⌘Z', action: 'Undo' },
  { keys: '⇧⌘Z', action: 'Redo' },
  { keys: '⇧⌘C', action: 'Copy edits' },
  { keys: '⇧⌘V', action: 'Paste edits' },
  { keys: '⌘0', action: 'Fit' },
  { keys: '⌘1', action: '100 %' },
  { keys: '\\ (hold)', action: 'Before' },
  { keys: '← →', action: 'Previous or next photo in the filmstrip' },
  { keys: 'Esc', action: 'Back to the library, or cancel the tool in use' },
  { keys: '?', action: 'These shortcuts' },
];
