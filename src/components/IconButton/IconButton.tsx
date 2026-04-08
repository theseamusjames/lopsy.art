import type { ReactNode } from 'react';
import styles from './IconButton.module.css';

interface IconButtonProps {
  icon: ReactNode;
  label: string;
  isActive?: boolean;
  onClick?: () => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
}

export function IconButton({
  icon,
  label,
  isActive = false,
  onClick,
  size = 'sm',
  disabled = false,
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
      title={label}
      disabled={disabled}
      type="button"
    >
      {icon}
    </button>
  );
}
