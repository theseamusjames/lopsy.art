import { canvasColorSpace } from '../../engine/color-space';
import styles from './StatusBar.module.css';

interface StatusBarProps {
  zoom: number;
  cursorX: number;
  cursorY: number;
  docWidth: number;
  docHeight: number;
}

const colorSpaceLabel = canvasColorSpace === 'display-p3' ? 'Display P3' : 'sRGB';

export function StatusBar({ zoom, cursorX, cursorY, docWidth, docHeight }: StatusBarProps) {
  return (
    <div className={styles.bar}>
      <span className={styles.item}>{Math.round(zoom * 100)}%</span>
      <span className={styles.divider} />
      <span className={styles.item}>
        X: <span className={styles.number}>{cursorX}</span> Y:{' '}
        <span className={styles.number}>{cursorY}</span>
      </span>
      <span className={styles.divider} />
      <span className={styles.item}>
        <span className={styles.number}>{docWidth}</span> x{' '}
        <span className={styles.number}>{docHeight}</span> px
      </span>
      <span className={styles.spacer} />
      <span className={styles.item}>{colorSpaceLabel}</span>
    </div>
  );
}
