import { useEffect, useState } from 'react';
import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { canvasColorSpace } from '../../engine/color-space';
import { getWasmMemoryBytes } from '../../engine-wasm/wasm-bridge';
import styles from './StatusBar.module.css';

const colorSpaceLabel = canvasColorSpace === 'display-p3' ? 'Display P3' : 'sRGB';

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
