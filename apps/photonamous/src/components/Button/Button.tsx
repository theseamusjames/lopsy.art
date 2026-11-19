import type { ButtonHTMLAttributes, KeyboardEvent, Ref } from 'react';
import styles from './Button.module.css';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  ref?: Ref<HTMLButtonElement>;
}

/** Enter and Space press a focused button; the page's single-key shortcuts for them (open, look large) must not run as well. */
export function keepPressKeys(e: KeyboardEvent<HTMLElement>): void {
  if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
}

/**
 * A button. `aria-disabled` (rather than `disabled`) turns it off but keeps
 * it focusable, for a button that is busy while it has focus: a disabled
 * one would drop focus to the page. It looks the same and does nothing.
 */
export function Button({ variant = 'secondary', size = 'md', className, children, onClick, onKeyDown, ...rest }: ButtonProps) {
  const cls = [styles.button, styles[variant], styles[size], className].filter(Boolean).join(' ');
  const isOff = rest['aria-disabled'] === true || rest['aria-disabled'] === 'true';
  return (
    <button
      type="button"
      className={cls}
      onClick={isOff ? undefined : onClick}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        keepPressKeys(e);
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
