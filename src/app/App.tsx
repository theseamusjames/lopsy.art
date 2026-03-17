import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Toolbox } from '../toolbox/Toolbox';
import { LayerPanel } from '../panels/LayerPanel/LayerPanel';
import { LayerEffectsPanel } from '../panels/LayerEffectsPanel/LayerEffectsPanel';
import { ColorPanel } from '../panels/ColorPanel/ColorPanel';
import { PanelContainer } from '../panels/PanelContainer/PanelContainer';
import { HistoryPanel } from '../panels/HistoryPanel/HistoryPanel';
import { InfoPanel } from '../panels/InfoPanel/InfoPanel';
import { AdjustmentsPanel } from '../panels/AdjustmentsPanel/AdjustmentsPanel';
import { PanelToolbar } from '../panels/PanelToolbar/PanelToolbar';
import { MenuBar } from './MenuBar/MenuBar';
import { OptionsBar } from './OptionsBar/OptionsBar';
import { StatusBar } from './StatusBar/StatusBar';
import { NewDocumentModal } from '../components/NewDocumentModal/NewDocumentModal';
import { ShapeSizeModal } from '../components/ShapeSizeModal/ShapeSizeModal';
import { useUIStore } from './ui-store';
import { useEditorStore } from './editor-store';
import { useCanvasInteraction } from './useCanvasInteraction';
import { useToolSettingsStore } from './tool-settings-store';
import { drawShape } from '../tools/shape/shape';
import { PixelBuffer } from '../engine/pixel-data';
import { contextOptions } from '../engine/color-space';
import { seedBitmapFromBlob } from '../engine/bitmap-cache';
import { wrapWithSelectionMask } from './interactions/selection-mask-wrap';
import { useCanvasRendering } from './useCanvasRendering';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { useCanvasCursor } from './useCanvasCursor';
import styles from './App.module.css';

// Isolated component for canvas rendering — prevents renderVersion and
// cursorPosition changes from re-rendering the entire App tree.
function CanvasRenderer({ canvasRef, containerRef, overlayCanvasRef }: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  overlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
}) {
  useCanvasRendering(canvasRef, containerRef, overlayCanvasRef);
  return null;
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sidebarBottomRef = useRef<HTMLDivElement>(null);
  const effectsDrawerRef = useRef<HTMLDivElement>(null);

  const foregroundColor = useUIStore((s) => s.foregroundColor);
  const backgroundColor = useUIStore((s) => s.backgroundColor);
  const setForegroundColor = useUIStore((s) => s.setForegroundColor);
  const setBackgroundColor = useUIStore((s) => s.setBackgroundColor);
  const swapColors = useUIStore((s) => s.swapColors);
  const recentColors = useUIStore((s) => s.recentColors);

  const doc = useEditorStore((s) => s.document);
  const viewport = useEditorStore((s) => s.viewport);
  const layers = useEditorStore((s) => s.document.layers);
  const activeLayerId = useEditorStore((s) => s.document.activeLayerId);
  const addLayer = useEditorStore((s) => s.addLayer);
  const removeLayer = useEditorStore((s) => s.removeLayer);
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);
  const toggleLayerVisibility = useEditorStore((s) => s.toggleLayerVisibility);
  const moveLayer = useEditorStore((s) => s.moveLayer);
  const updateLayerOpacity = useEditorStore((s) => s.updateLayerOpacity);
  const setZoom = useEditorStore((s) => s.setZoom);
  const setPan = useEditorStore((s) => s.setPan);

  const documentReady = useEditorStore((s) => s.documentReady);
  const createDocument = useEditorStore((s) => s.createDocument);
  const openImageAsDocument = useEditorStore((s) => s.openImageAsDocument);
  const showNewDocumentModal = useUIStore((s) => s.showNewDocumentModal);
  const setShowNewDocumentModal = useUIStore((s) => s.setShowNewDocumentModal);

  const pendingShapeClick = useUIStore((s) => s.pendingShapeClick);
  const setPendingShapeClick = useUIStore((s) => s.setPendingShapeClick);

  const [isPanning, setIsPanning] = useState(false);
  const [isSpaceDown, setIsSpaceDown] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const handleCreateDocument = useCallback((width: number, height: number, background: 'white' | 'transparent') => {
    createDocument(width, height, background === 'transparent');
    setShowNewDocumentModal(false);
  }, [createDocument, setShowNewDocumentModal]);

  const handleOpenFile = useCallback((file: File) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', contextOptions);
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const name = file.name.replace(/\.[^.]+$/, '');
        openImageAsDocument(imageData, name);
        const layerId = useEditorStore.getState().document.activeLayerId;
        if (layerId) seedBitmapFromBlob(layerId, file);
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
    setShowNewDocumentModal(false);
  }, [openImageAsDocument, setShowNewDocumentModal]);

  const handleShapeSizeConfirm = useCallback((width: number, height: number) => {
    const pending = useUIStore.getState().pendingShapeClick;
    if (!pending) return;
    const editorState = useEditorStore.getState();
    const imageData = editorState.getOrCreateLayerPixelData(pending.layerId);
    const pixelBuffer = PixelBuffer.fromImageData(imageData);
    const surface = wrapWithSelectionMask(pixelBuffer, pending.layerX, pending.layerY);
    const ts = useToolSettingsStore.getState();
    editorState.pushHistory();
    if (ts.shapeFillColor) useUIStore.getState().addRecentColor(ts.shapeFillColor);
    if (ts.shapeStrokeColor) useUIStore.getState().addRecentColor(ts.shapeStrokeColor);
    const edge = { x: pending.center.x + width / 2, y: pending.center.y + height / 2 };
    drawShape(surface, pending.center, edge, {
      mode: ts.shapeMode,
      fillColor: ts.shapeFillColor,
      strokeColor: ts.shapeStrokeColor,
      strokeWidth: ts.shapeStrokeWidth,
      sides: ts.shapePolygonSides,
    });
    editorState.updateLayerPixelData(pending.layerId, pixelBuffer.toImageData());
    setPendingShapeClick(null);
  }, [setPendingShapeClick]);

  // Warn before navigating away with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useEditorStore.getState().isDirty) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Canvas rendering is in a separate component (CanvasRenderer) so that
  // renderVersion / cursorPosition changes don't re-render the full App tree.

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let hasInitialFit = false;
    const observer = new ResizeObserver(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      useEditorStore.getState().setViewportSize(rect.width, rect.height);
      if (!hasInitialFit && rect.width > 0 && rect.height > 0) {
        hasInitialFit = true;
        useEditorStore.getState().fitToView();
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [documentReady]);

  // Screen to canvas coordinate transform
  const screenToCanvas = useCallback(
    (screenX: number, screenY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const x = (screenX - viewport.panX - canvas.width / 2) / viewport.zoom + doc.width / 2;
      const y = (screenY - viewport.panY - canvas.height / 2) / viewport.zoom + doc.height / 2;
      return { x: Math.round(x), y: Math.round(y) };
    },
    [viewport, doc.width, doc.height],
  );

  // Canvas interaction (drawing tools)
  const { handleToolDown, handleToolMove, handleToolUp, clearPersistentTransform, nudgeMove } = useCanvasInteraction(screenToCanvas, containerRef);

  // Cursor management
  const { updateHoveredHandle } = useCanvasCursor(containerRef, isPanning, isSpaceDown);

  // Keyboard shortcuts (extracted to useKeyboardShortcuts)
  useKeyboardShortcuts({
    canvasRef,
    setIsSpaceDown,
    setIsPanning,
    clearPersistentTransform,
    nudgeMove,
  });

  const handleSelectLayer = useCallback((id: string) => {
    clearPersistentTransform();
    setActiveLayer(id);
  }, [clearPersistentTransform, setActiveLayer]);

  // Throttle cursor position updates to once per animation frame.
  // Without this, every mouse move triggers StatusBar + CanvasRenderer
  // re-renders via the cursorPosition subscription.
  const pendingCursorRef = useRef<{ x: number; y: number } | null>(null);
  const cursorRafRef = useRef(0);
  const flushCursorPosition = useCallback((pos: { x: number; y: number }) => {
    pendingCursorRef.current = pos;
    if (cursorRafRef.current) return;
    cursorRafRef.current = requestAnimationFrame(() => {
      cursorRafRef.current = 0;
      if (pendingCursorRef.current) {
        useUIStore.getState().setCursorPosition(pendingCursorRef.current);
        pendingCursorRef.current = null;
      }
    });
  }, []);

  // Mouse handlers
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const canvasPos = screenToCanvas(screenX, screenY);
      flushCursorPosition(canvasPos);

      if (isPanning) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        setPan(panStartRef.current.panX + dx, panStartRef.current.panY + dy);
      } else {
        updateHoveredHandle(canvasPos);
        handleToolMove(e);
      }
    },
    [isPanning, screenToCanvas, setPan, handleToolMove, updateHoveredHandle, flushCursorPosition],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isSpaceDown || e.button === 1) {
        setIsPanning(true);
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          panX: viewport.panX,
          panY: viewport.panY,
        };
        e.preventDefault();
      } else {
        handleToolDown(e);
      }
    },
    [isSpaceDown, viewport.panX, viewport.panY, handleToolDown],
  );

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    setIsPanning(false);
    handleToolUp(e);
  }, [handleToolUp]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = -e.deltaY * 0.01;
        const newZoom = Math.max(0.01, Math.min(64, viewport.zoom * (1 + delta)));
        setZoom(newZoom);
      } else {
        setPan(viewport.panX - e.deltaX, viewport.panY - e.deltaY);
      }
    },
    [viewport.zoom, viewport.panX, viewport.panY, setZoom, setPan],
  );

  const [colorPanelCollapsed, setColorPanelCollapsed] = useState(false);
  const [historyPanelCollapsed, setHistoryPanelCollapsed] = useState(false);
  const [infoPanelCollapsed, setInfoPanelCollapsed] = useState(false);
  const [layersPanelCollapsed, setLayersPanelCollapsed] = useState(false);
  const [adjustmentsPanelCollapsed, setAdjustmentsPanelCollapsed] = useState(false);
  const showEffectsDrawer = useUIStore((s) => s.showEffectsDrawer);
  const visiblePanels = useUIStore((s) => s.visiblePanels);

  useLayoutEffect(() => {
    const bottom = sidebarBottomRef.current;
    const drawer = effectsDrawerRef.current;
    if (!bottom || !drawer) return;
    const parentRect = bottom.offsetParent?.getBoundingClientRect();
    const bottomRect = bottom.getBoundingClientRect();
    if (!parentRect) return;
    const top = bottomRect.top - parentRect.top;
    drawer.style.top = `${top}px`;
    drawer.style.bottom = '0';
  }, [showEffectsDrawer, colorPanelCollapsed]);

  const showModal = !documentReady || showNewDocumentModal;

  if (!documentReady) {
    return (
      <div className={styles.app}>
        <NewDocumentModal
          onCreateDocument={handleCreateDocument}
          onOpenFile={handleOpenFile}
        />
      </div>
    );
  }

  return (
    <div className={styles.app}>
      {pendingShapeClick && (
        <ShapeSizeModal
          onConfirm={handleShapeSizeConfirm}
          onCancel={() => setPendingShapeClick(null)}
        />
      )}
      {showModal && (
        <NewDocumentModal
          onCreateDocument={handleCreateDocument}
          onOpenFile={handleOpenFile}
          onCancel={() => setShowNewDocumentModal(false)}
        />
      )}
      <div className={styles.header}>
        <MenuBar />
        <OptionsBar />
      </div>
      <div className={styles.body}>
        <Toolbox />
        <div
          ref={containerRef}
          data-testid="canvas-container"
          className={styles.canvas}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          <canvas ref={canvasRef} />
          <canvas ref={overlayCanvasRef} className={styles.overlayCanvas} />
          <CanvasRenderer canvasRef={canvasRef} containerRef={containerRef} overlayCanvasRef={overlayCanvasRef} />
        </div>
        <div className={styles.sidebarArea}>
          {showEffectsDrawer && (
            <div className={styles.effectsDrawer} ref={effectsDrawerRef}>
              <LayerEffectsPanel />
            </div>
          )}
          <div className={styles.sidebar}>
            <div className={styles.sidebarScroll}>
              {visiblePanels.has('info') && (
                <PanelContainer
                  title="Info"
                  collapsed={infoPanelCollapsed}
                  onToggle={() => setInfoPanelCollapsed(!infoPanelCollapsed)}
                >
                  <InfoPanel collapsed={infoPanelCollapsed} />
                </PanelContainer>
              )}
              {visiblePanels.has('color') && (
                <PanelContainer
                  title="Color"
                  collapsed={colorPanelCollapsed}
                  onToggle={() => setColorPanelCollapsed(!colorPanelCollapsed)}
                >
                  <ColorPanel
                    foregroundColor={foregroundColor}
                    backgroundColor={backgroundColor}
                    recentColors={recentColors}
                    onForegroundChange={setForegroundColor}
                    onBackgroundChange={setBackgroundColor}
                    onSwap={swapColors}
                    collapsed={colorPanelCollapsed}
                  />
                </PanelContainer>
              )}
              {visiblePanels.has('history') && (
                <PanelContainer
                  title="History"
                  collapsed={historyPanelCollapsed}
                  onToggle={() => setHistoryPanelCollapsed(!historyPanelCollapsed)}
                >
                  <HistoryPanel collapsed={historyPanelCollapsed} />
                </PanelContainer>
              )}
              {visiblePanels.has('adjustments') && (
                <PanelContainer
                  title="Adjustments"
                  collapsed={adjustmentsPanelCollapsed}
                  onToggle={() => setAdjustmentsPanelCollapsed(!adjustmentsPanelCollapsed)}
                >
                  {!adjustmentsPanelCollapsed && <AdjustmentsPanel />}
                </PanelContainer>
              )}
            </div>
            <div className={styles.sidebarBottom} ref={sidebarBottomRef}>
              {visiblePanels.has('layers') && (
                <PanelContainer
                  title="Layers"
                  collapsed={layersPanelCollapsed}
                  onToggle={() => setLayersPanelCollapsed(!layersPanelCollapsed)}
                >
                  <LayerPanel
                    layers={[...layers]}
                    activeLayerId={activeLayerId}
                    onSelectLayer={handleSelectLayer}
                    onToggleVisibility={toggleLayerVisibility}
                    onAddLayer={addLayer}
                    onRemoveLayer={removeLayer}
                    onReorderLayer={moveLayer}
                    onUpdateOpacity={updateLayerOpacity}
                    collapsed={layersPanelCollapsed}
                  />
                </PanelContainer>
              )}
            </div>
          </div>
          <PanelToolbar />
        </div>
      </div>
      <StatusBar />
    </div>
  );
}
