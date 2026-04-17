import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { WebGL2Warning, checkWebGL2Support } from '../components/WebGL2Warning/WebGL2Warning';
import { Toolbox } from '../toolbox/Toolbox';
import { LayerPanel } from '../panels/LayerPanel/LayerPanel';
import { LayerEffectsPanel } from '../panels/LayerEffectsPanel/LayerEffectsPanel';
import { ColorPanel } from '../panels/ColorPanel/ColorPanel';
import { HistoryPanel } from '../panels/HistoryPanel/HistoryPanel';
import { InfoPanel } from '../panels/InfoPanel/InfoPanel';
import { AdjustmentsPanel } from '../panels/AdjustmentsPanel/AdjustmentsPanel';
import { PathsPanel } from '../panels/PathsPanel/PathsPanel';
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
import { pasteOrOpenBlob } from './paste-or-open';
import { importPsdFile } from '../io/psd';
import { useCanvasRendering } from './useCanvasRendering';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { useCanvasCursor } from './useCanvasCursor';
import { useContextMenu } from './useContextMenu';
import { ContextMenu } from '../components/ContextMenu/ContextMenu';
import { TextActionButtons } from '../components/TextActionButtons/TextActionButtons';
import { commitTextEditing } from '../tools/text/text-interaction';
import { POINTER_IDLE, isPanning, type PointerMode } from './pointer-mode';
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
  const sidebarBottomRef = useRef<HTMLDivElement>(null);
  const effectsDrawerRef = useRef<HTMLDivElement>(null);

  const doc = useEditorStore((s) => s.document);
  const viewport = useEditorStore((s) => s.viewport);
  const layers = useEditorStore((s) => s.document.layers);
  const activeLayerId = useEditorStore((s) => s.document.activeLayerId);
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);
  const setZoom = useEditorStore((s) => s.setZoom);
  const setPan = useEditorStore((s) => s.setPan);

  const documentReady = useEditorStore((s) => s.documentReady);
  const openModal = useUIStore((s) => s.openModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const closeModalOfKind = useUIStore((s) => s.closeModalOfKind);

  const showRulers = useUIStore((s) => s.showRulers);
  const showGuides = useUIStore((s) => s.showGuides);
  const guides = useUIStore((s) => s.guides);
  const addGuide = useUIStore((s) => s.addGuide);
  const setHoveredGuide = useUIStore((s) => s.setHoveredGuide);
  const setRulerHover = useUIStore((s) => s.setRulerHover);

  const [pointerMode, setPointerMode] = useState<PointerMode>(POINTER_IDLE);

  // Touch gesture state for pinch-to-zoom and two-finger pan
  const touchRef = useRef<{
    active: boolean;
    mode: 'none' | 'draw' | 'gesture';
    startTouches: Array<{ x: number; y: number }>;
    startZoom: number;
    startPanX: number;
    startPanY: number;
    startDist: number;
  }>({
    active: false,
    mode: 'none',
    startTouches: [],
    startZoom: 1,
    startPanX: 0,
    startPanY: 0,
    startDist: 0,
  });

  // ModalHost owns the post-document NewDocumentModal + ShapeSizeModal +
  // BrushModal + StrokePathModal. App only needs the pre-document fallback
  // below and the drag/drop handlers that feed into both paths.

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;

    const name = file.name.replace(/\.[^.]+$/, '');
    // Dropping an image while the new-document modal is open should dismiss
    // it — the drop is effectively the answer to "what do you want to open?"
    pasteOrOpenBlob(file, name).then(() => closeModalOfKind('newDocument'));
  }, [closeModalOfKind]);

  // Pre-document fallback for NewDocumentModal — see render below.
  const handlePreDocCreate = useCallback(
    (width: number, height: number, background: 'white' | 'transparent') => {
      useEditorStore.getState().createDocument(width, height, background === 'transparent');
      closeModal();
    },
    [closeModal],
  );
  const handlePreDocOpenFile = useCallback((file: File) => {
    const name = file.name.replace(/\.[^.]+$/, '');
    if (/\.psd$/i.test(file.name)) {
      file.arrayBuffer().then(async (buffer) => {
        await importPsdFile(new Uint8Array(buffer), name);
        closeModal();
      });
      return;
    }
    pasteOrOpenBlob(file, name).then(() => closeModal());
  }, [closeModal]);
  const handlePreDocPasteClipboard = useCallback(
    (blob: Blob) => {
      pasteOrOpenBlob(blob, 'Copied File').then(() => closeModal());
    },
    [closeModal],
  );

  // Warn before navigating away with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useEditorStore.getState().isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Commit text editing when active layer changes
  useEffect(() => {
    let prevActiveLayerId = useEditorStore.getState().document.activeLayerId;
    const unsub = useEditorStore.subscribe((state) => {
      const currentId = state.document.activeLayerId;
      if (currentId !== prevActiveLayerId) {
        const editing = useUIStore.getState().textEditing;
        if (editing && editing.layerId !== currentId) {
          commitTextEditing();
        }
        prevActiveLayerId = currentId;
      }
    });
    return unsub;
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
  const { updateHoveredHandle } = useCanvasCursor(containerRef, pointerMode);

  // Context menu
  const { contextMenu, handleContextMenu, handleClose: handleContextMenuClose } = useContextMenu();

  // Keyboard shortcuts (extracted to useKeyboardShortcuts)
  useKeyboardShortcuts({
    canvasRef,
    setPointerMode,
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

  const findGuideAtCursor = useCallback(
    (docX: number, docY: number): string | null => {
      for (const guide of guides) {
        if (guide.orientation === 'vertical' && Math.abs(guide.position - docX) <= 1) return guide.id;
        if (guide.orientation === 'horizontal' && Math.abs(guide.position - docY) <= 1) return guide.id;
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

      const panning = isPanning(pointerMode);

      // Ruler hover for guide placement — always runs so playhead updates,
      // but suppressed during a pan so guides don't twitch with the canvas.
      if (showGuides && !panning) {
        setHoveredGuide(findGuideAtCursor(canvasPos.x, canvasPos.y));
      }

      if (showRulers && showGuides && !panning) {
        const isOnHorizontalRuler = screenY < RULER_SIZE && screenX > RULER_SIZE;
        const isOnVerticalRuler = screenX < RULER_SIZE && screenY > RULER_SIZE;

        if (isOnHorizontalRuler) {
          setRulerHover({ orientation: 'vertical', position: canvasPos.x, screenX, screenY });
          return;
        } else if (isOnVerticalRuler) {
          setRulerHover({ orientation: 'horizontal', position: canvasPos.y, screenX, screenY });
          return;
        } else {
          setRulerHover(null);
        }
      }

      if (pointerMode.kind === 'panning') {
        const dx = e.clientX - pointerMode.startScreenX;
        const dy = e.clientY - pointerMode.startScreenY;
        setPan(pointerMode.startPanX + dx, pointerMode.startPanY + dy);
      } else {
        updateHoveredHandle(canvasPos);
        handleToolMove(e);
      }
    },
    [pointerMode, screenToCanvas, setPan, handleToolMove, updateHoveredHandle, flushCursorPosition, showRulers, showGuides, setRulerHover, setHoveredGuide, findGuideAtCursor],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Space-held + click, or middle-click anywhere, starts a pan.
      if (pointerMode.kind === 'spaceHeld' || e.button === 1) {
        setPointerMode({
          kind: 'panning',
          startScreenX: e.clientX,
          startScreenY: e.clientY,
          startPanX: viewport.panX,
          startPanY: viewport.panY,
        });
        e.preventDefault();
        return;
      }

      const rect = containerRef.current?.getBoundingClientRect();
      if (rect && showRulers && e.button === 0) {
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;

        // Click on the ruler corner swatch to toggle the guide color picker.
        if (showGuides && screenX < RULER_SIZE && screenY < RULER_SIZE) {
          const modalNow = useUIStore.getState().modal;
          if (modalNow?.kind === 'guideColor') closeModal();
          else openModal({ kind: 'guideColor' });
          return;
        }
      }

      // Any click outside the corner dismisses the picker.
      if (useUIStore.getState().modal?.kind === 'guideColor') {
        closeModalOfKind('guideColor');
      }

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
    [pointerMode, viewport.panX, viewport.panY, handleToolDown, showRulers, showGuides, screenToCanvas, addGuide, setRulerHover, findGuideAtCursor, openModal, closeModal, closeModalOfKind],
  );

  const endPan = useCallback(() => {
    // End pan but don't drop spaceHeld — releasing space is what does that.
    setPointerMode((prev) => prev.kind === 'panning' ? POINTER_IDLE : prev);
  }, []);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    endPan();
    handleToolUp(e);
  }, [endPan, handleToolUp]);

  const handleMouseLeave = useCallback((e: React.MouseEvent) => {
    endPan();
    handleToolUp(e);
    setRulerHover(null);
    setHoveredGuide(null);
  }, [endPan, handleToolUp, setRulerHover, setHoveredGuide]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = Math.pow(1.002, -e.deltaY);
        const newZoom = Math.max(0.01, Math.min(64, viewport.zoom * factor));
        setZoom(newZoom);
      } else {
        setPan(viewport.panX - e.deltaX, viewport.panY - e.deltaY);
      }
    },
    [viewport.zoom, viewport.panX, viewport.panY, setZoom, setPan],
  );

  // Synthesize a mouse-like event from a Touch for tool handlers
  const touchToMouse = useCallback(
    (t: React.Touch, type: 'mousedown' | 'mousemove' | 'mouseup'): React.MouseEvent => {
      return {
        clientX: t.clientX,
        clientY: t.clientY,
        button: 0,
        buttons: type === 'mouseup' ? 0 : 1,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        ctrlKey: false,
        preventDefault: () => {},
        stopPropagation: () => {},
        nativeEvent: new MouseEvent(type),
      } as unknown as React.MouseEvent;
    },
    [],
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 1) {
        // Single finger: draw with active tool
        const t = e.touches.item(0);
        if (!t) return;
        touchRef.current = {
          active: true,
          mode: 'draw',
          startTouches: [{ x: t.clientX, y: t.clientY }],
          startZoom: viewport.zoom,
          startPanX: viewport.panX,
          startPanY: viewport.panY,
          startDist: 0,
        };
        handleToolDown(touchToMouse(t, 'mousedown'));
      } else if (e.touches.length === 2) {
        // Second finger arrived: cancel any in-progress draw, switch to gesture
        if (touchRef.current.mode === 'draw') {
          const prev = touchRef.current.startTouches[0];
          if (prev) {
            handleToolUp(touchToMouse({ clientX: prev.x, clientY: prev.y } as React.Touch, 'mouseup'));
          }
        }
        const t0 = e.touches.item(0);
        const t1 = e.touches.item(1);
        if (!t0 || !t1) return;
        const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        const midX = (t0.clientX + t1.clientX) / 2;
        const midY = (t0.clientY + t1.clientY) / 2;
        touchRef.current = {
          active: true,
          mode: 'gesture',
          startTouches: [{ x: midX, y: midY }],
          startZoom: viewport.zoom,
          startPanX: viewport.panX,
          startPanY: viewport.panY,
          startDist: dist,
        };
      }
    },
    [viewport.zoom, viewport.panX, viewport.panY, handleToolDown, handleToolUp, touchToMouse],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!touchRef.current.active) return;
      const tr = touchRef.current;

      if (e.touches.length === 1 && tr.mode === 'draw') {
        // Single finger drawing
        const t = e.touches.item(0);
        if (!t) return;
        handleToolMove(touchToMouse(t, 'mousemove'));
      } else if (e.touches.length === 2 && tr.mode === 'gesture' && tr.startDist > 0) {
        // Two-finger pan + zoom
        const t0 = e.touches.item(0);
        const t1 = e.touches.item(1);
        const start = tr.startTouches[0];
        if (!t0 || !t1 || !start) return;
        const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        const scale = dist / tr.startDist;
        const newZoom = Math.max(0.01, Math.min(64, tr.startZoom * scale));
        setZoom(newZoom);

        const midX = (t0.clientX + t1.clientX) / 2;
        const midY = (t0.clientY + t1.clientY) / 2;
        const dx = midX - start.x;
        const dy = midY - start.y;
        setPan(tr.startPanX + dx, tr.startPanY + dy);
      }
    },
    [setZoom, setPan, handleToolMove, touchToMouse],
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (touchRef.current.mode === 'draw' && e.touches.length === 0) {
        const changed = e.changedTouches.item(0);
        if (changed) {
          handleToolUp(touchToMouse(changed, 'mouseup'));
        }
      }
      if (e.touches.length === 0) {
        touchRef.current = { ...touchRef.current, active: false, mode: 'none' };
      }
    },
    [handleToolUp, touchToMouse],
  );

  const showEffectsDrawer = useUIStore((s) => s.showEffectsDrawer);
  const visiblePanels = useUIStore((s) => s.visiblePanels);

  // Effects drawer hangs off the bottom panel block. Subscribe to the block's
  // size via ResizeObserver instead of pinning to a specific panel's collapse
  // state — works regardless of which panels are open or collapsed.
  useLayoutEffect(() => {
    const bottom = sidebarBottomRef.current;
    const drawer = effectsDrawerRef.current;
    if (!bottom || !drawer || !showEffectsDrawer) return;
    const update = () => {
      const parentRect = bottom.offsetParent?.getBoundingClientRect();
      const bottomRect = bottom.getBoundingClientRect();
      if (!parentRect) return;
      drawer.style.top = `${bottomRect.top - parentRect.top}px`;
      drawer.style.height = `${bottom.offsetHeight}px`;
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(bottom);
    return () => ro.disconnect();
  }, [showEffectsDrawer]);

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
        <div
          ref={containerRef}
          data-testid="canvas-container"
          className={styles.canvas}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          onContextMenu={handleContextMenu}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <canvas ref={canvasRef} />
          <canvas ref={overlayCanvasRef} className={styles.overlayCanvas} />
          <TextActionButtons containerRef={containerRef} />
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
        <GuideColorPicker />
        <div className={styles.sidebarArea}>
          {showEffectsDrawer && (
            <div className={styles.effectsDrawer} ref={effectsDrawerRef}>
              {activeLayerId && layers.find((l) => l.id === activeLayerId)?.type === 'group'
                ? <AdjustmentsPanel showHeader />
                : <LayerEffectsPanel />
              }
            </div>
          )}
          {visiblePanels.size > 0 && (
            <div className={styles.sidebar}>
              <div className={styles.sidebarScroll}>
                {visiblePanels.has('info') && <InfoPanel />}
                {visiblePanels.has('color') && <ColorPanel />}
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
    </div>
  );
}
