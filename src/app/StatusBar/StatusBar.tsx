import { useCallback, useEffect, useRef, useState } from 'react';
import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { canvasColorSpace } from '../../engine/color-space';
import { getWasmMemoryBytes } from '../../engine-wasm/wasm-bridge';
import styles from './StatusBar.module.css';

const colorSpaceLabel = canvasColorSpace === 'display-p3' ? 'Display P3' : 'sRGB';

// #671 zoom-scrub bounds: horizontal drag sweeps [10%, 400%] at ~1%/pixel.
const ZOOM_SCRUB_MIN = 0.1;
const ZOOM_SCRUB_MAX = 4.0;
const ZOOM_SCRUB_PIXELS_PER_PERCENT = 1;

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

export function StatusBar() {
  const zoom = useEditorStore((s) => s.viewport.zoom);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const cursorX = useUIStore((s) => s.cursorPosition.x);
  const cursorY = useUIStore((s) => s.cursorPosition.y);
  const [memoryUsage, setMemoryUsage] = useState('');

  useEffect(() => {
    const update = () => {
      const wasmBytes = getWasmMemoryBytes();
      const jsHeap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
      const total = wasmBytes + jsHeap;
      setMemoryUsage(total > 0 ? formatBytes(total) : '');
    };
    update();
    const id = setInterval(update, 2000);
    return () => clearInterval(id);
  }, []);

  // #670: double-click resets zoom AND recenters the canvas.
  const handleZoomDoubleClick = useCallback(() => {
    const store = useEditorStore.getState();
    store.setZoom(1);
    store.setPan(0, 0);
  }, []);

  // #671: click-drag on the zoom label scrubs the zoom horizontally at
  // roughly 1%/pixel, clamped to [10%, 400%]. Uses a global listener set
  // that we tear down unconditionally on pointer-up, blur, visibility
  // change, or unmount — so alt-tab / focus loss can't leave it stuck
  // reacting to mouse movement.
  const scrubStateRef = useRef<{ startX: number; startZoom: number; active: boolean; pointerId: number } | null>(null);
  const tearDownScrubRef = useRef<(() => void) | null>(null);

  const endScrub = useCallback(() => {
    const teardown = tearDownScrubRef.current;
    if (teardown) teardown();
  }, []);

  useEffect(() => {
    return () => endScrub();
  }, [endScrub]);

  const handleZoomPointerDown = useCallback((e: React.PointerEvent) => {
    // Only respond to primary-button drags.
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startZoom = useEditorStore.getState().viewport.zoom;
    scrubStateRef.current = { startX, startZoom, active: false, pointerId: e.pointerId };

    const move = (ev: PointerEvent) => {
      const scrub = scrubStateRef.current;
      if (!scrub || ev.pointerId !== scrub.pointerId) return;
      const deltaPx = ev.clientX - scrub.startX;
      // Once we cross a small dead-zone, mark this as an active scrub so
      // pointer-up doesn't also fire the click / double-click handler.
      if (!scrub.active && Math.abs(deltaPx) < 2) return;
      scrub.active = true;
      const deltaPercent = deltaPx / ZOOM_SCRUB_PIXELS_PER_PERCENT; // 1% per pixel
      const nextZoom = Math.max(
        ZOOM_SCRUB_MIN,
        Math.min(ZOOM_SCRUB_MAX, scrub.startZoom + deltaPercent / 100),
      );
      useEditorStore.getState().setZoom(nextZoom);
    };
    const up = () => {
      endScrub();
    };
    const blur = () => {
      endScrub();
    };
    const visibility = () => {
      if (document.visibilityState !== 'visible') endScrub();
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);

    tearDownScrubRef.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
      tearDownScrubRef.current = null;
      scrubStateRef.current = null;
    };
  }, [endScrub]);

  return (
    <footer className={styles.bar} role="status" aria-label="Status bar">
      <span
        className={`${styles.item} ${styles.zoom}`}
        onDoubleClick={handleZoomDoubleClick}
        onPointerDown={handleZoomPointerDown}
        role="button"
        tabIndex={0}
        aria-label={`Zoom ${Math.round(zoom * 100)}%, drag to scrub or double-click to reset and recenter`}
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
      <span className={styles.spacer} />
      {memoryUsage && (
        <>
          <span className={styles.item}>{memoryUsage}</span>
          <span className={styles.divider} />
        </>
      )}
      <span className={styles.item}>{colorSpaceLabel}</span>
    </footer>
  );
}
