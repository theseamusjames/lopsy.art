import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../../app/editor-store';
import { contextOptions } from '../../engine/color-space';
import type { Layer } from '../../types';
import styles from './LayerPanel.module.css';

export function LayerThumbnail({ layer }: { layer: Layer }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderVersion = useEditorStore((s) => s.renderVersion);

  // Throttle thumbnail updates to at most once per 500ms to avoid
  // re-rendering on every mouse move during sustained painting
  const [throttledVersion, setThrottledVersion] = useState(renderVersion);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestVersionRef = useRef(renderVersion);
  latestVersionRef.current = renderVersion;

  useEffect(() => {
    if (timerRef.current !== null) return;
    setThrottledVersion(renderVersion);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (latestVersionRef.current !== renderVersion) {
        setThrottledVersion(latestVersionRef.current);
      }
    }, 500);
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [renderVersion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', contextOptions);
    if (!ctx) return;

    const thumbSize = 24;
    canvas.width = thumbSize;
    canvas.height = thumbSize;

    const pixelData = useEditorStore.getState().layerPixelData.get(layer.id);
    if (!pixelData) {
      ctx.clearRect(0, 0, thumbSize, thumbSize);
      return;
    }

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = pixelData.width;
    tempCanvas.height = pixelData.height;
    const tempCtx = tempCanvas.getContext('2d', contextOptions);
    if (!tempCtx) return;
    tempCtx.putImageData(pixelData, 0, 0);

    ctx.clearRect(0, 0, thumbSize, thumbSize);
    const scale = Math.min(thumbSize / pixelData.width, thumbSize / pixelData.height);
    const w = pixelData.width * scale;
    const h = pixelData.height * scale;
    ctx.drawImage(tempCanvas, (thumbSize - w) / 2, (thumbSize - h) / 2, w, h);
  }, [layer.id, throttledVersion]);

  return <canvas ref={canvasRef} className={styles.thumbnailCanvas} />;
}
