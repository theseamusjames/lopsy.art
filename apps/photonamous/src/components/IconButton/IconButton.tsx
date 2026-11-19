import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { keepPressKeys } from '../Button/Button';
import styles from './IconButton.module.css';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Spoken and shown as the tooltip. */
  label: string;
  icon: ReactNode;
  /** Drawn as on. Only a look: a menu's or popover's trigger also says aria-expanded, a toggle passes `pressed`. */
  active?: boolean;
  /** A toggle's state, announced as pressed or not (and drawn as on when true). Leave it out on buttons that are not toggles. */
  pressed?: boolean;
  size?: 'sm' | 'md';
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({ label, icon, active, pressed, size = 'md', className, onKeyDown, ...rest }: IconButtonProps) {
  const isOn = active ?? pressed ?? false;
  const cls = [styles.button, styles[size], isOn ? styles.active : '', className].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={cls}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        keepPressKeys(e);
      }}
      {...rest}
    >
      {icon}
    </button>
  );
}
