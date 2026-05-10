import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { getEngine } from '../../engine-wasm/engine-state';
import { readCompositeThumbnail } from '../../engine-wasm/wasm-bridge';
import { PanelContainer } from '../PanelContainer/PanelContainer';
import { usePanelCollapse } from '../usePanelCollapse';
import { computeViewportRect, thumbnailPointToDocPoint, docPointToPan } from './navigator-math';
import { createNavigatorScheduler } from './navigator-scheduler';
import styles from './NavigatorPanel.module.css';

const THUMBNAIL_UPDATE_INTERVAL_MS = 200;

export function NavigatorPanel() {
  const [collapsed, setCollapsed] = usePanelCollapse('navigator');

  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const viewport = useEditorStore((s) => s.viewport);
  const setZoom = useEditorStore((s) => s.setZoom);
  const setPan = useEditorStore((s) => s.setPan);

  const thumbnailCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [thumbnailSize, setThumbnailSize] = useState({ width: 0, height: 0 });
  const isDraggingRef = useRef(false);

  // Compute display dimensions for the thumbnail canvas preserving aspect ratio
  useEffect(() => {
    const container = containerRef.current;
    if (!container || docWidth <= 0 || docHeight <= 0) return;

    const maxW = container.clientWidth;
    const maxH = 300;
    const aspect = docWidth / docHeight;
    let w = maxW;
    let h = maxW / aspect;
    if (h > maxH) {
      h = maxH;
      w = maxH * aspect;
    }
    setThumbnailSize({ width: Math.round(w), height: Math.round(h) });
  }, [docWidth, docHeight]);

  // Throttled thumbnail update by reading the composite texture from the engine.
  // The scheduler skips ticks while a paint stroke is in progress so the GPU
  // readback doesn't stall the brush hot path (issue #380).
  useEffect(() => {
    if (collapsed) return;

    const update = () => {
      const thumbCanvas = thumbnailCanvasRef.current;
      if (!thumbCanvas) return;
      const engine = getEngine();
      if (!engine) return;

      const maxDim = Math.max(thumbnailSize.width, thumbnailSize.height);
      if (maxDim === 0) return;

      const data = readCompositeThumbnail(engine, maxDim);
      if (data.length < 8) return;

      const tw = data[0]! | (data[1]! << 8) | (data[2]! << 16) | (data[3]! << 24);
      const th = data[4]! | (data[5]! << 8) | (data[6]! << 16) | (data[7]! << 24);
      if (tw === 0 || th === 0) return;

      const pixels = new Uint8ClampedArray(tw * th * 4);
      pixels.set(new Uint8Array(data.buffer, data.byteOffset + 8, tw * th * 4));
      const imageData = new ImageData(pixels, tw, th);

      thumbCanvas.width = tw;
      thumbCanvas.height = th;
      const ctx = thumbCanvas.getContext('2d');
      if (!ctx) return;
      ctx.putImageData(imageData, 0, 0);
    };

    if (!useUIStore.getState().isStroking) update();
    const scheduler = createNavigatorScheduler({
      read: update,
      intervalMs: THUMBNAIL_UPDATE_INTERVAL_MS,
    });
    const unsubscribe = useUIStore.subscribe((state, prev) => {
      if (state.isStroking !== prev.isStroking) {
        scheduler.setStroking(state.isStroking);
      }
    });
    return () => {
      unsubscribe();
      scheduler.stop();
    };
  }, [collapsed, thumbnailSize]);

  // Compute viewport indicator rect in thumbnail space
  const vpRect = computeViewportRect(
    docWidth,
    docHeight,
    viewport.width,
    viewport.height,
    viewport.zoom,
    viewport.panX,
    viewport.panY,
    thumbnailSize.width,
    thumbnailSize.height,
  );

  const handlePointerOnMinimap = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      const thumbX = e.clientX - rect.left;
      const thumbY = e.clientY - rect.top;

      const { docX, docY } = thumbnailPointToDocPoint(
        thumbX,
        thumbY,
        docWidth,
        docHeight,
        thumbnailSize.width,
        thumbnailSize.height,
      );
      const { panX, panY } = docPointToPan(docX, docY, docWidth, docHeight, viewport.zoom);
      setPan(panX, panY);
    },
    [docWidth, docHeight, thumbnailSize, viewport.zoom, setPan],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      isDraggingRef.current = true;
      handlePointerOnMinimap(e);
    },
    [handlePointerOnMinimap],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return;
      handlePointerOnMinimap(e);
    },
    [handlePointerOnMinimap],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      isDraggingRef.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    [],
  );

  const zoomPercent = Math.round(viewport.zoom * 100);

  const ZOOM_MIN = 0.1;
  const ZOOM_MAX = 6.0;

  const handleZoomSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const rawPercent = Number(e.target.value);
      // Log-scale: map [0,100] → [10%, 500%]
      const zoom = ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, rawPercent / 100);
      setZoom(zoom);
    },
    [setZoom],
  );

  const handleZoomSliderDoubleClick = useCallback(() => {
    setZoom(1);
  }, [setZoom]);

  const sliderValue = Math.log(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, viewport.zoom)) / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN) * 100;

  return (
    <PanelContainer title="Navigator" collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)}>
      <div className={styles.panel}>
        {!collapsed && (
          <div
            ref={containerRef}
            className={styles.minimapContainer}
            data-testid="navigator-minimap-container"
          >
            {thumbnailSize.width > 0 && thumbnailSize.height > 0 && (
              <div
                className={styles.minimapWrapper}
                style={{
                  width: thumbnailSize.width,
                  height: thumbnailSize.height,
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                role="presentation"
              >
                <canvas
                  ref={thumbnailCanvasRef}
                  className={styles.thumbnail}
                  width={thumbnailSize.width}
                  height={thumbnailSize.height}
                  aria-hidden="true"
                  data-testid="navigator-thumbnail"
                />
                <div
                  className={styles.viewportIndicator}
                  data-testid="navigator-viewport-indicator"
                  style={{
                    left: vpRect.x,
                    top: vpRect.y,
                    width: Math.max(4, vpRect.width),
                    height: Math.max(4, vpRect.height),
                  }}
                />
              </div>
            )}
          </div>
        )}
        <div className={styles.zoomRow}>
          <input
            type="range"
            className={styles.zoomSlider}
            min={0}
            max={100}
            step={0.5}
            value={sliderValue}
            onChange={handleZoomSliderChange}
            onDoubleClick={handleZoomSliderDoubleClick}
            aria-label="Zoom level"
          />
          <span className={styles.zoomValue} data-testid="navigator-zoom-value">
            {zoomPercent}%
          </span>
        </div>
      </div>
    </PanelContainer>
  );
}
