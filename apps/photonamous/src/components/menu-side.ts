import { useLayoutEffect, useState, type RefObject } from 'react';

/** Which edge of its button a drop-down menu lines up with: its left ('start') or its right ('end'). */
export type MenuSide = 'start' | 'end';

const MARGIN = 8;

/**
 * A menu starts at its button's left edge, as menus do, and switches to
 * the right edge only when it would otherwise run off the window. The
 * toolbar's buttons move (the row wraps to the left when the details
 * panel is open), so one fixed side is wrong half the time.
 */
export function menuSide(buttonLeft: number, menuWidth: number, windowWidth: number): MenuSide {
  return buttonLeft + menuWidth + MARGIN <= windowWidth ? 'start' : 'end';
}

/** `menuSide` for a button, worked out as its menu opens. `menuWidth` is the menu's width in CSS pixels. */
export function useMenuSide(buttonRef: RefObject<HTMLElement | null>, isOpen: boolean, menuWidth: number): MenuSide {
  const [side, setSide] = useState<MenuSide>('start');
  useLayoutEffect(() => {
    const button = buttonRef.current;
    if (isOpen && button) setSide(menuSide(button.getBoundingClientRect().left, menuWidth, window.innerWidth));
  }, [buttonRef, isOpen, menuWidth]);
  return side;
}
