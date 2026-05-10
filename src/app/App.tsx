import { useCallback, useEffect, useRef, useState } from 'react';
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
import { MenuBar } from './MenuBar/MenuBar';
import { OptionsBar } from './OptionsBar/OptionsBar';
import { StatusBar } from './StatusBar/StatusBar';
import { NewDocumentModal } from '../components/NewDocumentModal/NewDocumentModal';
import { ModalHost } from '../components/ModalHost/ModalHost';
import { GuideColorPicker } from '../components/GuideColorPicker/GuideColorPicker';
import { useUIStore } from './ui-store';
import { useEditorStore } from './editor-store';
import { useCanvasInteraction } from './useCanvasInteraction';
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

function LoadingOverlay({ message }: { message: string }) {
  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0, 0, 0, 0.6)', zIndex: 9999,
    }} role="dialog" aria-label={message}>
      <div style={{
        background: 'var(--color-bg-secondary, #1e1e1e)',
        borderRadius: 'var(--radius-lg, 8px)',
        padding: '24px 32px',
        color: 'var(--color-text-primary, #e0e0e0)',
        fontSize: 'var(--font-size-sm, 13px)',
      }}>
        {message}
      </div>
    </div>
  );
}

export function App() {
  const [hasWebGL2] = useState(() => checkWebGL2Support());

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sidebarBottomRef = useRef<HTMLDivElement>(null);
  const effectsDrawerRef = useRef<HTMLDivElement>(null);

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

  const visiblePanels = useUIStore((s) => s.visiblePanels);

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
    sidebarBottomRef,
    effectsDrawerRef,
    documentReady,
    showEffectsDrawer,
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
      <div className={styles.body}>
        <Toolbox />
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
              ref={effectsDrawerRef}
              data-testid="effects-drawer"
              style={{ transform: `translate(${drawerOffset.x}px, ${drawerOffset.y}px)` }}
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
              style={{ transform: `translate(${refDrawerOffset.x}px, ${refDrawerOffset.y}px)` }}
              {...refDrawerDragProps}
            >
              <ReferenceImagePanel />
            </div>
          )}
          {visiblePanels.size > 0 && (
            <div className={styles.sidebar}>
              <div className={styles.sidebarScroll}>
                {visiblePanels.has('navigator') && <NavigatorPanel />}
                {visiblePanels.has('info') && <InfoPanel />}
                {visiblePanels.has('color') && <ColorPanel />}
                {visiblePanels.has('channels') && <ChannelsPanel />}
                {visiblePanels.has('history') && <HistoryPanel />}
                {visiblePanels.has('paths') && <PathsPanel />}
              </div>
              <div className={styles.sidebarBottom} ref={sidebarBottomRef}>
                {visiblePanels.has('layers') && <LayerPanel onSelectLayer={handleSelectLayer} />}
              </div>
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
