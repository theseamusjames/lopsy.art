import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { canvasColorSpace } from '../../engine/color-space';
import styles from './StatusBar.module.css';

const colorSpaceLabel = canvasColorSpace === 'display-p3' ? 'Display P3' : 'sRGB';

export function StatusBar() {
  const zoom = useEditorStore((s) => s.viewport.zoom);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const cursorX = useUIStore((s) => s.cursorPosition.x);
  const cursorY = useUIStore((s) => s.cursorPosition.y);
  const canvasRotation = useUIStore((s) => s.canvasRotation);
  const resetCanvasRotation = useUIStore((s) => s.resetCanvasRotation);

  const rotationDeg = Math.round((canvasRotation * 180) / Math.PI);

  return (
    <footer className={styles.bar} role="status" aria-label="Status bar">
      <span
        className={styles.item}
        onDoubleClick={() => useEditorStore.getState().setZoom(1)}
        role="button"
        tabIndex={0}
        aria-label={`Zoom ${Math.round(zoom * 100)}%, double-click to reset`}
      >
        {Math.round(zoom * 100)}%
      </span>
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
      {canvasRotation !== 0 && (
        <>
          <span className={styles.divider} />
          <span
            className={styles.rotationItem}
            role="button"
            tabIndex={0}
            onClick={resetCanvasRotation}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') resetCanvasRotation(); }}
            aria-label={`Canvas rotated ${rotationDeg}°, click to reset`}
            data-testid="rotation-indicator"
          >
            <span className={styles.number}>{rotationDeg}°</span> ↺
          </span>
        </>
      )}
      <span className={styles.spacer} />
      <span className={styles.item}>{colorSpaceLabel}</span>
    </footer>
  );
}
