import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { DockSide } from '../dock-layout';
import { useDockStore } from '../dock-store';
import { setHostElement } from '../dock-element-registry';
import { DockZone } from '../DockZone/DockZone';
import { DockSplitter } from '../DockSplitter/DockSplitter';
import { FloatingPanel } from '../FloatingPanel/FloatingPanel';
import { DropIndicator } from '../DropIndicator/DropIndicator';
import styles from './DockHost.module.css';

interface DockHostProps {
  renderPanel: (panelId: string) => ReactNode;
  /** The canvas area — fills whatever space the docks leave. */
  children: ReactNode;
}

/**
 * Root of the dockable panel system: four edge docks around the canvas
 * slot, floating windows, and the drag-feedback overlay.
 */
export function DockHost({ renderPanel, children }: DockHostProps) {
  const layout = useDockStore((s) => s.layout);
  const resizeDock = useDockStore((s) => s.resizeDock);
  const clampToHost = useDockStore((s) => s.clampToHost);
  const hostRef = useRef<HTMLDivElement>(null);
  const dockResizeStart = useRef(0);

  // useLayoutEffect so the host element is registered before ancestor
  // useLayoutEffects run — hooks in App (e.g. useDockedPanelAnchor) can then
  // measure the host on first mount, not one paint late.
  useLayoutEffect(() => {
    const el = hostRef.current;
    setHostElement(el);
    return () => setHostElement(null);
  }, []);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) clampToHost(rect.width, rect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [clampToHost]);

  const beginDockResize = (side: DockSide) => () => {
    dockResizeStart.current = useDockStore.getState().layout.dockSizes[side];
  };

  // Dragging the divider toward the dock shrinks it; the divider sits on the
  // canvas side, so right/bottom docks grow when the delta is negative.
  const handleDockResize = (side: DockSide) => (deltaPx: number) => {
    const sign = side === 'right' || side === 'bottom' ? -1 : 1;
    resizeDock(side, dockResizeStart.current + sign * deltaPx);
  };

  const dockStyle = (side: DockSide): React.CSSProperties =>
    ({ '--dock-size': `${layout.dockSizes[side]}px` }) as React.CSSProperties;

  return (
    <div ref={hostRef} className={styles.host} data-testid="dock-host">
      {layout.docks.top && (
        <>
          <div className={styles.dockTop} data-testid="dock-top" style={dockStyle('top')}>
            <DockZone node={layout.docks.top} renderPanel={renderPanel} />
          </div>
          <DockSplitter
            orientation="horizontal"
            label="Resize top dock"
            onDragStart={beginDockResize('top')}
            onDrag={handleDockResize('top')}
          />
        </>
      )}
      <div className={styles.middleRow}>
        {layout.docks.left && (
          <>
            <div className={styles.dockLeft} data-testid="dock-left" style={dockStyle('left')}>
              <DockZone node={layout.docks.left} renderPanel={renderPanel} />
            </div>
            <DockSplitter
              orientation="vertical"
              label="Resize left dock"
              onDragStart={beginDockResize('left')}
              onDrag={handleDockResize('left')}
            />
          </>
        )}
        <div className={styles.canvasSlot}>{children}</div>
        {layout.docks.right && (
          <>
            <DockSplitter
              orientation="vertical"
              label="Resize right dock"
              onDragStart={beginDockResize('right')}
              onDrag={handleDockResize('right')}
            />
            <div className={styles.dockRight} data-testid="dock-right" style={dockStyle('right')}>
              <DockZone node={layout.docks.right} renderPanel={renderPanel} />
            </div>
          </>
        )}
      </div>
      {layout.docks.bottom && (
        <>
          <DockSplitter
            orientation="horizontal"
            label="Resize bottom dock"
            onDragStart={beginDockResize('bottom')}
            onDrag={handleDockResize('bottom')}
          />
          <div className={styles.dockBottom} data-testid="dock-bottom" style={dockStyle('bottom')}>
            <DockZone node={layout.docks.bottom} renderPanel={renderPanel} />
          </div>
        </>
      )}
      {layout.floating.map((window) => (
        <FloatingPanel key={window.id} window={window} renderPanel={renderPanel} />
      ))}
      <DropIndicator />
    </div>
  );
}
