import { useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import { focusedElement, returnFocus } from './focus-trap';

const ITEMS = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';

export function menuItems(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>(ITEMS)];
}

/**
 * The item a key moves to among `labels` from `index` (-1: none has focus):
 * the arrows wrap, Home and End go to the ends, and a letter goes to the
 * next item that starts with it. Null for keys that do not move.
 */
export function menuMove(key: string, index: number, labels: readonly string[]): number | null {
  const count = labels.length;
  if (count === 0) return null;
  switch (key) {
    case 'ArrowDown':
      return index < 0 ? 0 : (index + 1) % count;
    case 'ArrowUp':
      return index < 0 ? count - 1 : (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
  }
  if (key.length !== 1 || key === ' ') return null;
  const letter = key.toLowerCase();
  for (let step = 1; step <= count; step++) {
    const at = (index + step + count) % count;
    if (labels[at]?.trim().toLowerCase().startsWith(letter)) return at;
  }
  return null;
}

interface MenuKeysOptions {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** Opens the menu; with it, ArrowDown and ArrowUp on the trigger open it too. */
  readonly onOpen?: () => void;
  /** Where focus goes back to. Without one, wherever focus was when the menu opened. */
  readonly triggerRef?: RefObject<HTMLElement | null>;
}

export interface MenuKeys {
  /** On the element that holds the items (role="menu" or around it). */
  readonly menuRef: RefObject<HTMLDivElement | null>;
  readonly onMenuKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  readonly onTriggerKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}

/**
 * A menu's keyboard: focus on the first item when it opens; ArrowDown and
 * ArrowUp move (wrapping), Home and End, a letter jumps; Enter and Space
 * choose (not a disabled item); Escape closes and puts focus back on the
 * trigger; Tab closes and moves on from the trigger. A click outside closes
 * it and leaves focus where the click put it. Items are tabIndex -1 and
 * aria-disabled rather than disabled, so every one can take focus.
 */
export function useMenuKeys({ isOpen, onClose, onOpen, triggerRef }: MenuKeysOptions): MenuKeys {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const returnTo = useRef<HTMLElement | null>(null);
  const startAt = useRef<'first' | 'last'>('first');

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!isOpen || !menu) return;
    const previous = triggerRef?.current ?? focusedElement();
    returnTo.current = previous;
    let isClickedAway = false;
    const items = menuItems(menu);
    const start = startAt.current === 'last' ? items[items.length - 1] : items[0];
    startAt.current = 'first';
    (start ?? menu).focus();

    const onDown = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Node) || menu.contains(target) || triggerRef?.current?.contains(target)) return;
      isClickedAway = true;
      onCloseRef.current();
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      if (!isClickedAway) returnFocus(previous, menu);
    };
  }, [isOpen, triggerRef]);

  const onMenuKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const menu = menuRef.current;
    if (!menu || e.ctrlKey || e.metaKey || e.altKey) return;
    // A key pressed in a menu is the menu's: the page's shortcuts must not act on it as well.
    e.stopPropagation();
    const items = menuItems(menu);
    const index = items.findIndex((item) => item === document.activeElement);
    const move = menuMove(
      e.key,
      index,
      items.map((item) => item.textContent ?? ''),
    );
    if (move !== null) {
      e.preventDefault();
      items[move]?.focus();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      returnTo.current?.focus();
      onCloseRef.current();
      return;
    }
    if (e.key === 'Tab') {
      // Focus on the trigger first, so the browser moves on from there.
      if (returnTo.current) returnTo.current.focus();
      else e.preventDefault();
      onCloseRef.current();
      return;
    }
    const item = items[index];
    if ((e.key === 'Enter' || e.key === ' ') && item) {
      if (item.getAttribute('aria-disabled') === 'true') e.preventDefault();
      else if (!(item instanceof HTMLButtonElement)) {
        e.preventDefault();
        item.click();
      }
    }
  };

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // Enter and Space press the trigger; the page's shortcuts for them must not run as well.
    if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
    if (!onOpen || isOpen || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    e.stopPropagation();
    startAt.current = e.key === 'ArrowUp' ? 'last' : 'first';
    onOpen();
  };

  return { menuRef, onMenuKeyDown, onTriggerKeyDown };
}
