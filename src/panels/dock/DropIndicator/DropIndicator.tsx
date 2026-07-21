import { useDockStore } from '../dock-store';
import styles from './DropIndicator.module.css';

/**
 * Drag feedback overlay: the accent-tinted highlight over the current drop
 * target, plus the tab-shaped ghost chip that follows the pointer.
 */
export function DropIndicator() {
  const drag = useDockStore((s) => s.drag);
  if (!drag) return null;

  return (
    <>
      {drag.indicator && (
        <div
          className={styles.indicator}
          data-testid="dock-drop-indicator"
          style={
            {
              '--di-x': `${drag.indicator.x}px`,
              '--di-y': `${drag.indicator.y}px`,
              '--di-w': `${drag.indicator.width}px`,
              '--di-h': `${drag.indicator.height}px`,
            } as React.CSSProperties
          }
        />
      )}
      {drag.showGhost && (
        <div
          className={styles.ghost}
          data-testid="dock-drag-ghost"
          style={
            {
              '--ghost-x': `${drag.pointer.x}px`,
              '--ghost-y': `${drag.pointer.y}px`,
            } as React.CSSProperties
          }
        >
          {drag.title}
        </div>
      )}
    </>
  );
}
