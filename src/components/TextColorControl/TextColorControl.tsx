import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ColorPicker } from '../ColorPicker/ColorPicker';
import type { Color } from '../../types';
import styles from './TextColorControl.module.css';

interface TextColorControlProps {
  /** The text's colour, or null when it holds several (shown as "–"). */
  color: Color | null;
  /** Where the picker opens; used when `color` is mixed. */
  pickerColor: Color;
  onChange: (color: Color) => void;
  /** Called before the first change of a picking session (one undo step per session). */
  onPickStart?: () => void;
  /** Called when a session that changed something closes. */
  onPickEnd?: () => void;
}

function colorToCSS(c: Color): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`;
}

/**
 * Swatch button that opens a colour picker for text colour (#1154). Shows
 * "–" when the target text is multi-coloured; a pick then recolours it all.
 */
export function TextColorControl({ color, pickerColor, onChange, onPickStart, onPickEnd }: TextColorControlProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hasPickedRef = useRef(false);
  const onPickEndRef = useRef(onPickEnd);
  useLayoutEffect(() => {
    onPickEndRef.current = onPickEnd;
  }, [onPickEnd]);

  const close = useCallback((): void => {
    setIsOpen(false);
    if (!hasPickedRef.current) return;
    hasPickedRef.current = false;
    onPickEndRef.current?.();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen, close]);

  // A session left open when the control unmounts (tool switch) still ends.
  useEffect(() => () => {
    if (hasPickedRef.current) onPickEndRef.current?.();
  }, []);

  const handleToggle = () => {
    if (isOpen) {
      close();
      return;
    }
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left });
    setIsOpen(true);
  };

  const handleChange = (next: Color) => {
    if (!hasPickedRef.current) {
      hasPickedRef.current = true;
      onPickStart?.();
    }
    onChange(next);
  };

  const isMixed = color === null;
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={`${styles.swatch} ${isOpen ? styles.open : ''}`}
        aria-label="Text color"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        data-mixed={isMixed ? 'true' : undefined}
        title={isMixed ? 'Text color (mixed)' : 'Text color'}
        // Keep keyboard focus in the text being edited.
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleToggle}
      >
        {isMixed ? (
          <span className={styles.mixed}>–</span>
        ) : (
          <span className={styles.fill} style={{ '--swatch-color': colorToCSS(color) } as React.CSSProperties} />
        )}
      </button>
      {isOpen && createPortal(
        <div
          ref={popoverRef}
          className={styles.popover}
          role="dialog"
          aria-label="Text color picker"
          style={{ '--popover-top': `${pos.top}px`, '--popover-left': `${pos.left}px` } as React.CSSProperties}
        >
          <ColorPicker color={pickerColor} onChange={handleChange} />
        </div>,
        document.body,
      )}
    </>
  );
}
