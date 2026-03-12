import type { Color } from '../../types';
import styles from './ColorSwatch.module.css';

interface ColorSwatchProps {
  color: Color;
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  isActive?: boolean;
}

function colorToCSS(c: Color): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`;
}

export function ColorSwatch({
  color,
  size = 'md',
  onClick,
  isActive = false,
}: ColorSwatchProps) {
  const sizeClass = size === 'sm' ? styles.sm : size === 'lg' ? styles.lg : styles.md;
  const className = [styles.swatch, sizeClass, isActive ? styles.active : '']
    .filter(Boolean)
    .join(' ');

  return (
    <button
      className={className}
      onClick={onClick}
      type="button"
      aria-label={`Color: rgb(${color.r}, ${color.g}, ${color.b})`}
    >
      <div className={styles.color} style={{ backgroundColor: colorToCSS(color) }} />
    </button>
  );
}
