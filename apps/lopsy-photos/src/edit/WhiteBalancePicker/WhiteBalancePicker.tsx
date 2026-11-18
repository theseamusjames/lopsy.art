import { useEffect, useRef } from 'react';
import styles from './WhiteBalancePicker.module.css';

export interface WhiteBalancePickerProps {
  /** Where the document is on the stage, in CSS pixels. */
  readonly imageBox: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
  /** The document's size in engine pixels. */
  readonly documentSize: { readonly width: number; readonly height: number };
  /** The clicked document pixel (pixel centres at +0.5). */
  readonly onPick: (x: number, y: number) => void;
  readonly onCancel: () => void;
}

/** White balance picker: click something that should be neutral grey. Esc cancels. */
export function WhiteBalancePicker({ imageBox, documentSize, onPick, onCancel }: WhiteBalancePickerProps) {
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel.current();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  return (
    <div
      className={styles.picker}
      data-testid="white-balance-picker"
      role="button"
      tabIndex={-1}
      aria-label="Click something that should be neutral grey"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const stage = e.currentTarget.getBoundingClientRect();
        const cssX = e.clientX - stage.left - imageBox.left;
        const cssY = e.clientY - stage.top - imageBox.top;
        if (cssX < 0 || cssY < 0 || cssX > imageBox.width || cssY > imageBox.height) return;
        onPick((cssX / imageBox.width) * documentSize.width, (cssY / imageBox.height) * documentSize.height);
      }}
    >
      <span className={styles.hint} role="status" data-testid="white-balance-hint">
        Click something neutral · Esc to cancel
      </span>
    </div>
  );
}
