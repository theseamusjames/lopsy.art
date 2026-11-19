/**
 * Shortcuts made of one character key (1–5, X, R, J, ?…) can be turned off,
 * so that speech input or a stray key press never acts on the library
 * (WCAG 2.2, 2.1.4 Character Key Shortcuts). While they are off, a keydown
 * that is a single character with no Ctrl, Cmd or Alt is stopped on its way
 * down, before any of the app's handlers sees it. Text fields still get it,
 * and the browser's own handling still runs (a select's type-ahead, a
 * checkbox), because nothing calls preventDefault. Space is not a character
 * key here: buttons and other controls are operated with it.
 */

import { isTypingTarget } from './registry';

export const CHARACTER_KEYS_KEY = 'photonamous.character-key-shortcuts';

export interface KeyLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
}

/** A shortcut made of one letter, digit, punctuation mark or symbol, without Ctrl, Cmd or Alt. */
export function isCharacterKey(e: KeyLike): boolean {
  return e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey;
}

/** Stored as 'off' when turned off; anything else, or nothing, is on. */
export function parseCharacterKeysEnabled(raw: string | null): boolean {
  return raw !== 'off';
}

/** Whether this keydown is kept from the app's shortcut handlers. */
export function blocksShortcut(e: KeyLike & { readonly target: EventTarget | null }, isEnabled: boolean): boolean {
  return !isEnabled && isCharacterKey(e) && !isTypingTarget(e.target);
}

function load(): boolean {
  try {
    return parseCharacterKeysEnabled(localStorage.getItem(CHARACTER_KEYS_KEY));
  } catch {
    return true;
  }
}

let isEnabled = load();
const listeners = new Set<() => void>();

export function characterKeysEnabled(): boolean {
  return isEnabled;
}

export function setCharacterKeysEnabled(on: boolean): void {
  isEnabled = on;
  try {
    localStorage.setItem(CHARACTER_KEYS_KEY, on ? 'on' : 'off');
  } catch {
    // Blocked storage: the choice lasts for this page only.
  }
  for (const listener of listeners) listener();
}

export function subscribeCharacterKeys(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Installs the guard on `win`, once at start-up, ahead of every other key handler. */
export function installCharacterKeyGuard(win: Window): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (blocksShortcut(e, isEnabled)) e.stopImmediatePropagation();
  };
  win.addEventListener('keydown', onKey, true);
  return () => win.removeEventListener('keydown', onKey, true);
}
