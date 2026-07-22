import { useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import type { FloatingWindow, ResizeDir } from '../dock-layout';
import { applyWindowResize } from '../dock-layout';
import { useDockStore } from '../dock-store';
import { DockTabs } from '../DockTabs/DockTabs';
import styles from './FloatingPanel.module.css';

interface FloatingPanelProps {
  window: FloatingWindow;
  renderPanel: (panelId: string) => ReactNode;
}

const RESIZE_HANDLES: readonly { dir: ResizeDir; className: string }[] = [
  { dir: 'n', className: 'resizeN' },
  { dir: 's', className: 'resizeS' },
  { dir: 'e', className: 'resizeE' },
  { dir: 'w', className: 'resizeW' },
  { dir: 'ne', className: 'resizeNE' },
  { dir: 'nw', className: 'resizeNW' },
  { dir: 'se', className: 'resizeSE' },
  { dir: 'sw', className: 'resizeSW' },
];

export function FloatingPanel({ window: win, renderPanel }: FloatingPanelProps) {
  const focusWindow = useDockStore((s) => s.focusWindow);
  const resizeWindow = useDockStore((s) => s.resizeWindow);
  const resizeRef = useRef<{
    pointerId: number;
    dir: ResizeDir;
    startX: number;
    startY: number;
    rect: { x: number; y: number; width: number; height: number };
  } | null>(null);

  const handleFocus = useCallback(() => focusWindow(win.id), [focusWindow, win.id]);

  const handleResizeDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, dir: ResizeDir) => {
      if (e.button !== 0 || resizeRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      resizeRef.current = {
        pointerId: e.pointerId,
        dir,
        startX: e.clientX,
        startY: e.clientY,
        rect: { x: win.x, y: win.y, width: win.width, height: win.height },
      };
    },
    [win.x, win.y, win.width, win.height],
  );

  const handleResizeMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const resize = resizeRef.current;
      if (!resize || e.pointerId !== resize.pointerId) return;
      const next = applyWindowResize(
        resize.rect,
        resize.dir,
        e.clientX - resize.startX,
        e.clientY - resize.startY,
      );
      resizeWindow(win.id, next);
    },
    [resizeWindow, win.id],
  );

  const handleResizeEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (resizeRef.current?.pointerId !== e.pointerId) return;
    resizeRef.current = null;
  }, []);

  // Capture can be lost if the handle unmounts mid-resize (e.g. the window is
  // docked away); clear the ref so no stale resize state lingers.
  const handleLostCapture = useCallback(() => {
    resizeRef.current = null;
  }, []);

  return (
    <div
      className={styles.window}
      data-testid={`floating-panel-${win.activeTab}`}
      style={
        {
          '--fp-x': `${win.x}px`,
          '--fp-y': `${win.y}px`,
          '--fp-w': `${win.width}px`,
          '--fp-h': `${win.height}px`,
        } as React.CSSProperties
      }
      onPointerDownCapture={handleFocus}
    >
      <DockTabs
        variant="floating"
        groupId={win.id}
        tabs={win.tabs}
        activeTab={win.activeTab}
        renderPanel={renderPanel}
      />
      {RESIZE_HANDLES.map(({ dir, className }) => (
        <div
          key={dir}
          className={styles[className]}
          onPointerDown={(e) => handleResizeDown(e, dir)}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
          onLostPointerCapture={handleLostCapture}
        />
      ))}
    </div>
  );
}
