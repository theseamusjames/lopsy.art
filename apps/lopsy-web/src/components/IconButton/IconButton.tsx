import type { ReactNode, ButtonHTMLAttributes } from 'react';
import styles from './IconButton.module.css';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'type'> {
  icon: ReactNode;
  label: string;
  /** Marks the button as a toggle: sets `aria-pressed` as well as the active style. Omit for plain buttons. */
  isActive?: boolean;
  onClick?: () => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
}

export function IconButton({
  icon,
  label,
  isActive,
  onClick,
  size = 'sm',
  disabled = false,
  ...rest
}: IconButtonProps) {
  const className = [
    styles.button,
    size === 'md' ? styles.md : styles.sm,
    isActive ? styles.active : '',
    disabled ? styles.disabled : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      className={className}
      onClick={onClick}
      aria-label={label}
      aria-pressed={isActive}
      title={label}
      disabled={disabled}
      type="button"
      {...rest}
    >
      {icon}
    </button>
  );
}
