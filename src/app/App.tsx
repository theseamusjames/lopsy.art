import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { WebGL2Warning, checkWebGL2Support } from '../components/WebGL2Warning/WebGL2Warning';
import { LiquifyPanel } from '../components/LiquifyPanel/LiquifyPanel';
import { Toolbox } from '../toolbox/Toolbox';
import { LayerPanel } from '../panels/LayerPanel/LayerPanel';
import { LayerEffectsPanel } from '../panels/LayerEffectsPanel/LayerEffectsPanel';
import { ColorPanel } from '../panels/ColorPanel/ColorPanel';
import { HistoryPanel } from '../panels/HistoryPanel/HistoryPanel';
import { InfoPanel } from '../panels/InfoPanel/InfoPanel';
import { AdjustmentsPanel } from '../panels/AdjustmentsPanel/AdjustmentsPanel';
import { PathsPanel } from '../panels/PathsPanel/PathsPanel';
import { NavigatorPanel } from '../panels/NavigatorPanel/NavigatorPanel';
import { ChannelsPanel } from '../panels/ChannelsPanel/ChannelsPanel';
import { ReferenceImagePanel } from '../panels/ReferenceImagePanel/ReferenceImagePanel';
import { PanelToolbar } from '../panels/PanelToolbar/PanelToolbar';
import { DockHost } from '../panels/dock/DockHost/DockHost';
import { useDockStore } from '../panels/dock/dock-store';
import { MenuBar } from './MenuBar/MenuBar';
import { OptionsBar } from './OptionsBar/OptionsBar';
import { StatusBar } from './StatusBar/StatusBar';
import { NewDocumentModal } from '../components/NewDocumentModal/NewDocumentModal';
import { ModalHost, LoadingOverlay } from '../components/ModalHost/ModalHost';
import { GuideColorPicker } from '../components/GuideColorPicker/GuideColorPicker';
import { useUIStore } from './ui-store';
import { useEditorStore } from './editor-store';
import { useCanvasInteraction } from './useCanvasInteraction';
import { useBrushPrewarm } from './useBrushPrewarm';
import { useCanvasRendering } from './useCanvasRendering';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { useCanvasCursor } from './useCanvasCursor';
import { useContextMenu } from './useContextMenu';
import { ContextMenu } from '../components/ContextMenu/ContextMenu';
import { Toasts } from '../components/Toasts/Toasts';
import { TextActionButtons } from '../components/TextActionButtons/TextActionButtons';
import { PathActionButtons } from '../components/PathActionButtons/PathActionButtons';
import { TiltShiftControls } from './OptionsBar/tool-options/TiltShiftControls';
import { POINTER_IDLE, type PointerMode } from './pointer-mode';
import { useCanvasPointerHandlers } from './hooks/useCanvasPointerHandlers';
import { useAppEffects } from './hooks/useAppEffects';
import { useDocumentOpenHandlers } from './hooks/useDocumentOpenHandlers';
import { useDraggablePanel } from './hooks/useDraggablePanel';
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
  const [hasWebGL2] = useState(() => checkWebGL2Support());

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const doc = useEditorStore((s) => s.document);
  const viewport = useEditorStore((s) => s.viewport);
  const layers = useEditorStore((s) => s.document.layers);
  const activeLayerId = useEditorStore((s) => s.document.activeLayerId);
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);

  const documentReady = useEditorStore((s) => s.documentReady);
  const createDocument = useEditorStore((s) => s.createDocument);
  const showEffectsDrawer = useUIStore((s) => s.showEffectsDrawer);
  const showReferenceModal = useUIStore((s) => s.showReferenceModal);
  const loadingMessage = useUIStore((s) => s.modal?.kind === 'loading' ? s.modal.message : null);
  const isLiquifyOpen = useUIStore((s) => s.liquify !== null);

  useEffect(() => {
    if (documentReady) return;
    const params = new URLSearchParams(window.location.search);
    if (params.has('lighthouse')) {
      createDocument(1080, 1080, false);
    }
  }, [documentReady, createDocument]);
  useEffect(() => {
    const isPWA = window.matchMedia('(display-mode: standalone)').matches;
    if (!isPWA) return;
    const name = doc.name;
    document.title = name === 'lopsy' ? 'Lopsy' : `Lopsy — ${name}`;
  }, [doc.name]);

  // The floating drawers sit immediately left of the right dock; this width
  // feeds a CSS custom property so they track dock resizing.
  const rightDockWidth = useDockStore((s) => (s.layout.docks.right ? s.layout.dockSizes.right : 0));

  const { offset: drawerOffset, reset: resetDrawerOffset, dragProps: drawerDragProps } = useDraggablePanel();
  useEffect(() => {
    if (!showEffectsDrawer) resetDrawerOffset();
  }, [showEffectsDrawer, resetDrawerOffset]);

  const { offset: refDrawerOffset, reset: resetRefDrawerOffset, dragProps: refDrawerDragProps } = useDraggablePanel();
  useEffect(() => {
    if (!showReferenceModal) resetRefDrawerOffset();
  }, [showReferenceModal, resetRefDrawerOffset]);

  const [pointerMode, setPointerMode] = useState<PointerMode>(POINTER_IDLE);

  const {
    handleDragOver,
    handleDrop,
    handlePreDocCreate,
    handlePreDocOpenFile,
    handlePreDocPasteClipboard,
  } = useDocumentOpenHandlers();

  useAppEffects({
    canvasRef,
    containerRef,
    documentReady,
  });

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
  const { handleToolDown, handleToolMove, handleToolUp, clearPersistentTransform, nudgeMove, nudgeSelection } = useCanvasInteraction(screenToCanvas, containerRef);

  // Pre-warm brush GPU resources on paint-tool activation so the first
  // stroke on a large canvas doesn't pay a visible allocation cost.
  useBrushPrewarm();

  // Cursor management
  const { updateHoveredHandle } = useCanvasCursor(containerRef, pointerMode);

  // Context menu
  const { contextMenu, handleContextMenu, handleClose: handleContextMenuClose } = useContextMenu();

  // Keyboard shortcuts
  useKeyboardShortcuts({
    canvasRef,
    setPointerMode,
    clearPersistentTransform,
    nudgeMove,
    nudgeSelection,
  });

  useCanvasPointerHandlers({
    containerRef,
    screenToCanvas,
    pointerMode,
    setPointerMode,
    handleToolDown,
    handleToolMove,
    handleToolUp,
    updateHoveredHandle,
  });

  const handleSelectLayer = useCallback((id: string) => {
    clearPersistentTransform();
    setActiveLayer(id);
  }, [clearPersistentTransform, setActiveLayer]);

  const renderPanel = useCallback((panelId: string): ReactNode => {
    switch (panelId) {
      case 'navigator':
        return <NavigatorPanel />;
      case 'info':
        return <InfoPanel />;
      case 'color':
        return <ColorPanel />;
      case 'channels':
        return <ChannelsPanel />;
      case 'history':
        return <HistoryPanel />;
      case 'paths':
        return <PathsPanel />;
      case 'layers':
        return <LayerPanel onSelectLayer={handleSelectLayer} />;
      default:
        return null;
    }
  }, [handleSelectLayer]);

  if (!hasWebGL2) {
    return <WebGL2Warning />;
  }

  // Pre-document: the whole app is just a non-dismissible NewDocumentModal
  // wrapped in a drag-and-drop target. The post-document modal host below
  // handles user-invoked NewDocumentModal (dismissible) plus every other
  // modal through the ui-store slot.
  if (!documentReady) {
    return (
      <div className={styles.app} onDragOver={handleDragOver} onDrop={handleDrop}>
        <NewDocumentModal
          onCreateDocument={handlePreDocCreate}
          onOpenFile={handlePreDocOpenFile}
          onPasteClipboard={handlePreDocPasteClipboard}
        />
        {loadingMessage && <LoadingOverlay message={loadingMessage} />}
      </div>
    );
  }

  return (
    <div className={styles.app}>
      <ModalHost />
      <div className={styles.header}>
        <MenuBar />
        <OptionsBar />
      </div>
      <div
        className={styles.body}
        style={{ '--right-dock-width': `${rightDockWidth}px` } as React.CSSProperties}
      >
        <Toolbox />
        <DockHost renderPanel={renderPanel}>
          <main
            ref={containerRef}
            data-testid="canvas-container"
            className={styles.canvas}
            onContextMenu={handleContextMenu}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <canvas ref={canvasRef} aria-label="Drawing canvas" />
            <canvas ref={overlayCanvasRef} className={styles.overlayCanvas} aria-hidden="true" />
            <TextActionButtons containerRef={containerRef} />
            <PathActionButtons containerRef={containerRef} />
            <TiltShiftControls />
            <CanvasRenderer canvasRef={canvasRef} containerRef={containerRef} overlayCanvasRef={overlayCanvasRef} />
          </main>
        </DockHost>
        {contextMenu.visible && (
          <ContextMenu
            items={contextMenu.items}
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={handleContextMenuClose}
          />
        )}
        <GuideColorPicker />
        {isLiquifyOpen && <LiquifyPanel />}
        <div className={styles.sidebarArea}>
          {showEffectsDrawer && (
            <div
              className={styles.effectsDrawer}
              data-testid="effects-drawer"
              style={{ '--drag-x': `${drawerOffset.x}px`, '--drag-y': `${drawerOffset.y}px` } as React.CSSProperties}
            >
              {activeLayerId && layers.find((l) => l.id === activeLayerId)?.type === 'group'
                ? <AdjustmentsPanel showHeader dragProps={drawerDragProps} />
                : <LayerEffectsPanel dragProps={drawerDragProps} />
              }
            </div>
          )}
          {showReferenceModal && (
            <div
              className={styles.referenceDrawer}
              data-testid="reference-drawer"
              style={{ '--drag-x': `${refDrawerOffset.x}px`, '--drag-y': `${refDrawerOffset.y}px` } as React.CSSProperties}
              {...refDrawerDragProps}
            >
              <ReferenceImagePanel />
            </div>
          )}
          <PanelToolbar />
        </div>
      </div>
      <StatusBar />
      <Toasts />
    </div>
  );
}
