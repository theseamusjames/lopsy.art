import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './IconButton.module.css';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Spoken and shown as the tooltip. */
  label: string;
  icon: ReactNode;
  active?: boolean;
  size?: 'sm' | 'md';
}

export function IconButton({ label, icon, active = false, size = 'md', className, ...rest }: IconButtonProps) {
  const cls = [styles.button, styles[size], active ? styles.active : '', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} aria-label={label} title={label} aria-pressed={active || undefined} {...rest}>
      {icon}
    </button>
  );
}
