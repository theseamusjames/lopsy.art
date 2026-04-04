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
import { BrushModal } from '../components/BrushModal/BrushModal';
import { useBrushPresetStore } from './brush-preset-store';
import { useUIStore } from './ui-store';
import { useEditorStore } from './editor-store';
import { useCanvasInteraction } from './useCanvasInteraction';
import { useToolSettingsStore } from './tool-settings-store';
import { drawShape } from '../tools/shape/shape';
import { PixelBuffer } from '../engine/pixel-data';
// color-space contextOptions no longer needed here — sRGB used for image loading
import { seedBitmapFromBlob } from '../engine/bitmap-cache';
import { wrapWithSelectionMask } from './interactions/selection-mask-wrap';
import { useCanvasRendering } from './useCanvasRendering';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { useCanvasCursor } from './useCanvasCursor';
import { useContextMenu } from './useContextMenu';
import { ContextMenu } from '../components/ContextMenu/ContextMenu';
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

  const showRulers = useUIStore((s) => s.showRulers);
  const showGuides = useUIStore((s) => s.showGuides);
  const guides = useUIStore((s) => s.guides);
  const addGuide = useUIStore((s) => s.addGuide);
  const setHoveredGuide = useUIStore((s) => s.setHoveredGuide);
  const setRulerHover = useUIStore((s) => s.setRulerHover);

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
      // Use sRGB context for loading — the internal pipeline (WASM engine)
      // works in sRGB space. Using P3 here would produce P3 values that
      // the engine misinterprets as sRGB, causing color shifts on export.
      const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
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

  // Context menu
  const { contextMenu, handleContextMenu, handleClose: handleContextMenuClose } = useContextMenu();

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

  const RULER_SIZE = 20;

  // Find a guide whose position matches the cursor's document-space coordinate
  const findGuideAtCursor = useCallback(
    (docX: number, docY: number): string | null => {
      for (const guide of guides) {
        if (guide.orientation === 'vertical' && guide.position === docX) return guide.id;
        if (guide.orientation === 'horizontal' && guide.position === docY) return guide.id;
      }
      return null;
    },
    [guides],
  );

  // Mouse handlers
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const canvasPos = screenToCanvas(screenX, screenY);
      flushCursorPosition(canvasPos);

      // Ruler hover for guide placement
      // Guide hover detection — always runs so playhead updates
      if (showGuides && !isPanning) {
        setHoveredGuide(findGuideAtCursor(canvasPos.x, canvasPos.y));
      }

      if (showRulers && showGuides && !isPanning) {
        const isOnHorizontalRuler = screenY < RULER_SIZE && screenX > RULER_SIZE;
        const isOnVerticalRuler = screenX < RULER_SIZE && screenY > RULER_SIZE;

        if (isOnHorizontalRuler) {
          setRulerHover({
            orientation: 'vertical',
            position: canvasPos.x,
            screenX,
            screenY,
          });
          return;
        } else if (isOnVerticalRuler) {
          setRulerHover({
            orientation: 'horizontal',
            position: canvasPos.y,
            screenX,
            screenY,
          });
          return;
        } else {
          setRulerHover(null);
        }
      }

      if (isPanning) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        setPan(panStartRef.current.panX + dx, panStartRef.current.panY + dy);
      } else {
        updateHoveredHandle(canvasPos);
        handleToolMove(e);
      }
    },
    [isPanning, screenToCanvas, setPan, handleToolMove, updateHoveredHandle, flushCursorPosition, showRulers, showGuides, setRulerHover, setHoveredGuide, findGuideAtCursor],
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
        return;
      }

      const rect = containerRef.current?.getBoundingClientRect();
      if (rect && showRulers && showGuides && e.button === 0) {
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const isOnHorizontalRuler = screenY < RULER_SIZE && screenX > RULER_SIZE;
        const isOnVerticalRuler = screenX < RULER_SIZE && screenY > RULER_SIZE;

        const canvasPos = screenToCanvas(screenX, screenY);

        // Clicking on the ruler at an existing guide's position removes it
        if (isOnHorizontalRuler || isOnVerticalRuler) {
          const guideId = findGuideAtCursor(canvasPos.x, canvasPos.y);
          if (guideId) {
            useUIStore.getState().removeGuide(guideId);
          } else if (isOnHorizontalRuler) {
            addGuide('vertical', canvasPos.x);
          } else {
            addGuide('horizontal', canvasPos.y);
          }
          setRulerHover(null);
          return;
        }
      }

      handleToolDown(e);
    },
    [isSpaceDown, viewport.panX, viewport.panY, handleToolDown, showRulers, showGuides, screenToCanvas, addGuide, setRulerHover, findGuideAtCursor],
  );

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    setIsPanning(false);
    handleToolUp(e);
  }, [handleToolUp]);

  const handleMouseLeave = useCallback((e: React.MouseEvent) => {
    setIsPanning(false);
    handleToolUp(e);
    setRulerHover(null);
    setHoveredGuide(null);
  }, [handleToolUp, setRulerHover, setHoveredGuide]);

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
    drawer.style.height = `${bottom.offsetHeight}px`;
  }, [showEffectsDrawer, colorPanelCollapsed]);

  const showBrushModal = useBrushPresetStore((s) => s.showBrushModal);

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
      {showBrushModal && <BrushModal />}
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
          onMouseLeave={handleMouseLeave}
          onWheel={handleWheel}
          onContextMenu={handleContextMenu}
        >
          <canvas ref={canvasRef} />
          <canvas ref={overlayCanvasRef} className={styles.overlayCanvas} />
          <CanvasRenderer canvasRef={canvasRef} containerRef={containerRef} overlayCanvasRef={overlayCanvasRef} />
        </div>
        {contextMenu.visible && (
          <ContextMenu
            items={contextMenu.items}
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={handleContextMenuClose}
          />
        )}
        <div className={styles.sidebarArea}>
          {showEffectsDrawer && (
            <div className={styles.effectsDrawer} ref={effectsDrawerRef}>
              <LayerEffectsPanel />
            </div>
          )}
          {visiblePanels.size > 0 && (
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
          )}
          <PanelToolbar />
        </div>
      </div>
      <StatusBar />
    </div>
  );
}
