import { useRef, type FocusEvent, type MouseEvent } from 'react';

export interface SelectOnFocusHandlers {
  readonly onMouseDown: (event: MouseEvent<HTMLInputElement>) => void;
  readonly onMouseUp: (event: MouseEvent<HTMLInputElement>) => void;
  readonly onFocus: (event: FocusEvent<HTMLInputElement>) => void;
}

/**
 * Handlers for a text field whose whole text is selected when it takes
 * focus, so what is typed replaces it (a slider's value, a zoom level).
 * Selecting in `focus` alone is not enough in Safari: the mouseup of the
 * click that focused the field then puts the caret where the click was,
 * the selection is gone, and typed digits land beside the old value
 * ("0" and "30" make "300"). The mouseup that ends a focusing click is
 * cancelled, which keeps the selection; a click in a field that already
 * has focus places the caret as usual. Spread the handlers on the input;
 * the `onFocus` given is called first, then the text is selected.
 */
export function useSelectOnFocus(onFocus?: (event: FocusEvent<HTMLInputElement>) => void): SelectOnFocusHandlers {
  const clickFocused = useRef(false);
  return {
    onMouseDown: (event) => {
      clickFocused.current = event.currentTarget !== event.currentTarget.ownerDocument.activeElement;
    },
    onMouseUp: (event) => {
      if (!clickFocused.current) return;
      clickFocused.current = false;
      event.preventDefault();
    },
    onFocus: (event) => {
      onFocus?.(event);
      event.currentTarget.select();
    },
  };
}
