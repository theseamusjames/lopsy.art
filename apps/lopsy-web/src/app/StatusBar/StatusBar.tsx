import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ZoomReadout } from '@lopsy/ui/ZoomReadout';
import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { canvasColorSpace } from '../../engine/color-space';
import { getWasmMemoryBytes } from '../../engine-wasm/wasm-bridge';
import { runningRenderer, type Renderer } from '../../engine-wasm/renderer-choice';
import { isScreenHdr, onScreenHdrChange } from '../../engine-wasm/screen-output';
import { colorModeLabel } from '../../utils/color-mode';
import styles from './StatusBar.module.css';

const colorSpaceLabel = canvasColorSpace === 'display-p3' ? 'Display P3' : 'sRGB';
const RENDERER_LABELS: Record<Renderer, string> = { webgl: 'WebGL', wgpu: 'WebGPU' };

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

export function StatusBar() {
  const zoom = useEditorStore((s) => s.viewport.zoom);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const colorMode = useEditorStore((s) => s.document.colorMode);
  const cursorX = useUIStore((s) => s.cursorPosition.x);
  const cursorY = useUIStore((s) => s.cursorPosition.y);
  const [memoryUsage, setMemoryUsage] = useState('');
  const isHdr = useSyncExternalStore(onScreenHdrChange, isScreenHdr);
  // Chosen once per page load, before any document exists to show this bar.
  const renderer = runningRenderer();

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

  return (
    <footer className={styles.bar} role="status" aria-label="Status bar">
      {/* #671: drag left or right on it to zoom (1 % a pixel, 10 to 400 %); the readout is shared with Photonamous. */}
      <ZoomReadout
        zoom={zoom}
        onZoom={(next) => useEditorStore.getState().setZoom(next)}
        onReset={handleZoomDoubleClick}
        className={styles.item}
        hint="Drag left or right to zoom; double-click for 100% and to centre the canvas"
      />
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
      {colorMode !== 'rgb' && (
        <>
          <span className={`${styles.item} ${styles.colorMode}`}>{colorModeLabel(colorMode)}</span>
          <span className={styles.divider} />
        </>
      )}
      {renderer && (
        <>
          <span className={styles.item}>{RENDERER_LABELS[renderer]}</span>
          <span className={styles.divider} />
        </>
      )}
      <span className={styles.item}>{isHdr ? `${colorSpaceLabel} HDR` : colorSpaceLabel}</span>
    </footer>
  );
}
