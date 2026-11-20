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
  | 'help'
  | 'crop'
  | 'linearArea'
  | 'radialArea';

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
  if (e.altKey) return null;
  if (key === 'm') return e.shiftKey ? 'radialArea' : 'linearArea';
  if (e.shiftKey) return null;
  if (key === 'r') return 'crop';
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

const SLIDER_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/**
 * Whether a key press belongs to the focused control rather than to the
 * view: typing in a text field, or a key that moves a slider. A slider is
 * an input but takes no other keys, so ⌘Z, Escape or J pressed on one are
 * still the view's.
 */
export function isFieldKey(key: string, target: EventTarget | null): boolean {
  if (typeof HTMLInputElement !== 'undefined' && target instanceof HTMLInputElement && target.type === 'range') return SLIDER_KEYS.has(key);
  return isTypingTarget(target);
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
  { keys: '⌘1', action: 'Full size (100 %)' },
  { keys: '+ −', action: 'Zoom in or out, with the photo focused' },
  { keys: '← → ↑ ↓', action: 'Move a zoomed photo, with the photo focused' },
  { keys: 'J', action: 'Clipping warnings' },
  { keys: '\\ (hold)', action: 'Before' },
  { keys: 'R', action: 'Crop, and Done' },
  { keys: 'M', action: 'Add a linear mask' },
  { keys: '⇧M', action: 'Add a radial mask' },
  { keys: '← →', action: 'Previous or next photo in the filmstrip' },
  { keys: 'Esc', action: 'Back to the library, or cancel the tool in use' },
  { keys: '?', action: 'These shortcuts' },
];

/** The split divider's step for an arrow key, and for Shift, Page Up and Page Down. */
export const SPLIT_STEP = 0.02;
export const SPLIT_LARGE_STEP = 0.1;

/**
 * Where a key puts the split divider (0 left, 1 right), or null for a key
 * it does not take: arrows step it, Shift and Page Up/Down by more, Home
 * and End to the photo's edges.
 */
export function splitAfterKey(at: number, key: string, isLarge: boolean): number | null {
  const step = isLarge ? SPLIT_LARGE_STEP : SPLIT_STEP;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return clamp(at - step);
    case 'ArrowRight':
    case 'ArrowUp':
      return clamp(at + step);
    case 'PageDown':
      return clamp(at - SPLIT_LARGE_STEP);
    case 'PageUp':
      return clamp(at + SPLIT_LARGE_STEP);
    case 'Home':
      return 0;
    case 'End':
      return 1;
    default:
      return null;
  }
}

/** What the split divider reads out: how much of the photo shows before and after. */
export function splitValueText(at: number): string {
  const before = Math.round(Math.min(1, Math.max(0, at)) * 100);
  return `${before} % before, ${100 - before} % after`;
}

/** How far an arrow key moves the focused photo, in CSS pixels, and with Shift. */
export const PAN_STEP = 40;
export const PAN_LARGE_STEP = 200;
/** How much + and − zoom the focused photo. */
export const ZOOM_STEP = 1.25;

export type StageKeyAction = { readonly kind: 'pan'; readonly dx: number; readonly dy: number } | { readonly kind: 'zoom'; readonly factor: number };

/**
 * What a key does on the focused photo: arrows move the view over it, as
 * scrolling does (Right shows more of the right side), Shift by more;
 * + and − zoom in and out. Null for other keys and for shortcuts.
 */
export function stageKeyAction(e: KeyInfo): StageKeyAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const step = e.shiftKey ? PAN_LARGE_STEP : PAN_STEP;
  switch (e.key) {
    case 'ArrowLeft':
      return { kind: 'pan', dx: step, dy: 0 };
    case 'ArrowRight':
      return { kind: 'pan', dx: -step, dy: 0 };
    case 'ArrowUp':
      return { kind: 'pan', dx: 0, dy: step };
    case 'ArrowDown':
      return { kind: 'pan', dx: 0, dy: -step };
    case '+':
    case '=':
      return { kind: 'zoom', factor: ZOOM_STEP };
    case '-':
    case '_':
      return { kind: 'zoom', factor: 1 / ZOOM_STEP };
    default:
      return null;
  }
}
