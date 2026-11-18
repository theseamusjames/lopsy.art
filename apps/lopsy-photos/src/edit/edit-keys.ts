/** Keyboard shortcuts of the Edit view. */

export type EditShortcut = 'undo' | 'redo' | 'fit' | 'actualSize' | 'before';

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
    if (key === 'y' && !e.shiftKey) return 'redo';
    if (key === '0') return 'fit';
    if (key === '1') return 'actualSize';
    return null;
  }
  if (!e.altKey && !e.shiftKey && e.key === '\\') return 'before';
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
