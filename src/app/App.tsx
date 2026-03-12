import { useCallback, useEffect, useRef, useState } from 'react';
import { Toolbox } from '../toolbox/Toolbox';
import { LayerPanel } from '../panels/LayerPanel/LayerPanel';
import { ColorPanel } from '../panels/ColorPanel/ColorPanel';
import { ToolSettingsPanel } from '../panels/ToolSettingsPanel/ToolSettingsPanel';
import { PanelContainer } from '../panels/PanelContainer/PanelContainer';
import { MenuBar } from './MenuBar/MenuBar';
import { StatusBar } from './StatusBar/StatusBar';
import { NewDocumentModal } from '../components/NewDocumentModal/NewDocumentModal';
import { useUIStore } from './ui-store';
import { useEditorStore } from './editor-store';
import { useCanvasInteraction, strokeCurrentPath } from './useCanvasInteraction';
import { getHandlePositions } from '../tools/transform/transform';
import type { TransformHandle } from '../tools/transform/transform';
import styles from './App.module.css';

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const foregroundColor = useUIStore((s) => s.foregroundColor);
  const backgroundColor = useUIStore((s) => s.backgroundColor);
  const setForegroundColor = useUIStore((s) => s.setForegroundColor);
  const setBackgroundColor = useUIStore((s) => s.setBackgroundColor);
  const activeTool = useUIStore((s) => s.activeTool);
  const swapColors = useUIStore((s) => s.swapColors);
  const resetColors = useUIStore((s) => s.resetColors);
  const setActiveTool = useUIStore((s) => s.setActiveTool);

  const doc = useEditorStore((s) => s.document);
  const viewport = useEditorStore((s) => s.viewport);
  const layers = useEditorStore((s) => s.document.layers);
  const activeLayerId = useEditorStore((s) => s.document.activeLayerId);
  const addLayer = useEditorStore((s) => s.addLayer);
  const removeLayer = useEditorStore((s) => s.removeLayer);
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);
  const toggleLayerVisibility = useEditorStore((s) => s.toggleLayerVisibility);
  const moveLayer = useEditorStore((s) => s.moveLayer);
  const setZoom = useEditorStore((s) => s.setZoom);
  const setPan = useEditorStore((s) => s.setPan);
  const renderVersion = useEditorStore((s) => s.renderVersion);
  const selection = useEditorStore((s) => s.selection);
  const pathAnchors = useUIStore((s) => s.pathAnchors);
  const lassoPoints = useUIStore((s) => s.lassoPoints);
  const cropRect = useUIStore((s) => s.cropRect);
  const transform = useUIStore((s) => s.transform);

  const documentReady = useEditorStore((s) => s.documentReady);
  const createDocument = useEditorStore((s) => s.createDocument);
  const openImageAsDocument = useEditorStore((s) => s.openImageAsDocument);
  const showNewDocumentModal = useUIStore((s) => s.showNewDocumentModal);
  const setShowNewDocumentModal = useUIStore((s) => s.setShowNewDocumentModal);

  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
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
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const name = file.name.replace(/\.[^.]+$/, '');
        openImageAsDocument(imageData, name);
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
    setShowNewDocumentModal(false);
  }, [openImageAsDocument, setShowNewDocumentModal]);

  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    // Clear
    ctx.fillStyle = '#3c3c3c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw document area
    ctx.save();
    ctx.translate(viewport.panX + canvas.width / 2, viewport.panY + canvas.height / 2);
    ctx.scale(viewport.zoom, viewport.zoom);
    ctx.translate(-doc.width / 2, -doc.height / 2);

    // Checkerboard for transparency
    const checkSize = 8;
    for (let y = 0; y < doc.height; y += checkSize) {
      for (let x = 0; x < doc.width; x += checkSize) {
        const isLight = ((x / checkSize) + (y / checkSize)) % 2 === 0;
        ctx.fillStyle = isLight ? '#ffffff' : '#cccccc';
        ctx.fillRect(x, y, checkSize, checkSize);
      }
    }

    // Draw layer pixel data
    const pixelData = useEditorStore.getState().layerPixelData;
    for (const layer of layers) {
      if (!layer.visible) continue;
      const data = pixelData.get(layer.id);
      if (!data) continue;

      ctx.globalAlpha = layer.opacity;
      // putImageData ignores transforms, so use createImageBitmap workaround
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = data.width;
      tempCanvas.height = data.height;
      const tempCtx = tempCanvas.getContext('2d');
      if (tempCtx) {
        tempCtx.putImageData(data, 0, 0);
        ctx.drawImage(tempCanvas, layer.x, layer.y);
      }
    }

    ctx.globalAlpha = 1;

    // Document border
    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 1 / viewport.zoom;
    ctx.strokeRect(0, 0, doc.width, doc.height);

    // Draw selection (marching ants)
    if (selection.active && selection.bounds) {
      ctx.save();
      ctx.lineWidth = 1 / viewport.zoom;
      ctx.setLineDash([4 / viewport.zoom, 4 / viewport.zoom]);

      if (transform) {
        // Draw marching ants along the rotated bounding box
        const handles = getHandlePositions(transform);
        const corners: TransformHandle[] = [
          'top-left', 'top-right', 'bottom-right', 'bottom-left',
        ];
        const drawRotatedRect = () => {
          ctx.beginPath();
          for (let i = 0; i < corners.length; i++) {
            const pos = handles[corners[i] as TransformHandle];
            if (i === 0) ctx.moveTo(pos.x, pos.y);
            else ctx.lineTo(pos.x, pos.y);
          }
          ctx.closePath();
          ctx.stroke();
        };
        ctx.strokeStyle = '#ffffff';
        drawRotatedRect();
        ctx.strokeStyle = '#000000';
        ctx.lineDashOffset = 4 / viewport.zoom;
        drawRotatedRect();
      } else {
        const b = selection.bounds;
        ctx.strokeStyle = '#ffffff';
        ctx.strokeRect(b.x, b.y, b.width, b.height);
        ctx.strokeStyle = '#000000';
        ctx.lineDashOffset = 4 / viewport.zoom;
        ctx.strokeRect(b.x, b.y, b.width, b.height);
      }

      ctx.restore();
    }

    // Draw transform handles
    if (selection.active && transform) {
      const handles = getHandlePositions(transform);
      const handleSize = 6 / viewport.zoom;
      const rotHandleSize = 5 / viewport.zoom;

      ctx.save();
      ctx.setLineDash([]);

      // Draw bounding box outline
      const scaleHandleKeys: TransformHandle[] = [
        'top-left', 'top-right', 'bottom-right', 'bottom-left',
      ];
      ctx.strokeStyle = '#00aaff';
      ctx.lineWidth = 1 / viewport.zoom;
      ctx.beginPath();
      for (let i = 0; i < scaleHandleKeys.length; i++) {
        const key = scaleHandleKeys[i] as TransformHandle;
        const pos = handles[key];
        if (i === 0) ctx.moveTo(pos.x, pos.y);
        else ctx.lineTo(pos.x, pos.y);
      }
      ctx.closePath();
      ctx.stroke();

      // Draw scale handles (filled squares)
      const allScaleHandles: TransformHandle[] = [
        'top-left', 'top', 'top-right', 'right',
        'bottom-right', 'bottom', 'bottom-left', 'left',
      ];
      for (const key of allScaleHandles) {
        const pos = handles[key];
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#00aaff';
        ctx.lineWidth = 1 / viewport.zoom;
        ctx.fillRect(
          pos.x - handleSize / 2,
          pos.y - handleSize / 2,
          handleSize,
          handleSize,
        );
        ctx.strokeRect(
          pos.x - handleSize / 2,
          pos.y - handleSize / 2,
          handleSize,
          handleSize,
        );
      }

      // Draw rotation handles (circles outside corners)
      const rotHandleKeys: TransformHandle[] = [
        'rotate-top-left', 'rotate-top-right',
        'rotate-bottom-right', 'rotate-bottom-left',
      ];
      // Draw lines from corner to rotation handle
      const cornerForRot: Record<string, TransformHandle> = {
        'rotate-top-left': 'top-left',
        'rotate-top-right': 'top-right',
        'rotate-bottom-right': 'bottom-right',
        'rotate-bottom-left': 'bottom-left',
      };
      for (const key of rotHandleKeys) {
        const pos = handles[key];
        const cornerKey = cornerForRot[key] as TransformHandle;
        const cornerPos = handles[cornerKey];

        // Line from corner to rotation handle
        ctx.strokeStyle = '#00aaff';
        ctx.lineWidth = 1 / viewport.zoom;
        ctx.beginPath();
        ctx.moveTo(cornerPos.x, cornerPos.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();

        // Circle at rotation handle
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#00aaff';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, rotHandleSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      ctx.restore();
    }

    // Draw path overlay
    if (pathAnchors.length > 0) {
      const activeLayer = layers.find((l) => l.id === doc.activeLayerId);
      const offsetX = activeLayer?.x ?? 0;
      const offsetY = activeLayer?.y ?? 0;

      ctx.save();
      ctx.translate(offsetX, offsetY);

      // Draw path curve
      ctx.strokeStyle = '#00aaff';
      ctx.lineWidth = 1.5 / viewport.zoom;
      ctx.setLineDash([]);
      ctx.beginPath();
      for (let i = 0; i < pathAnchors.length; i++) {
        const anchor = pathAnchors[i];
        if (!anchor) continue;
        if (i === 0) {
          ctx.moveTo(anchor.point.x, anchor.point.y);
        } else {
          const prev = pathAnchors[i - 1];
          if (!prev) continue;
          const cp1 = prev.handleOut ?? prev.point;
          const cp2 = anchor.handleIn ?? anchor.point;
          ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, anchor.point.x, anchor.point.y);
        }
      }
      ctx.stroke();

      // Draw control handles
      ctx.strokeStyle = '#888888';
      ctx.lineWidth = 1 / viewport.zoom;
      for (const anchor of pathAnchors) {
        if (anchor.handleIn) {
          ctx.beginPath();
          ctx.moveTo(anchor.point.x, anchor.point.y);
          ctx.lineTo(anchor.handleIn.x, anchor.handleIn.y);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(anchor.handleIn.x, anchor.handleIn.y, 3 / viewport.zoom, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.stroke();
        }
        if (anchor.handleOut) {
          ctx.beginPath();
          ctx.moveTo(anchor.point.x, anchor.point.y);
          ctx.lineTo(anchor.handleOut.x, anchor.handleOut.y);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(anchor.handleOut.x, anchor.handleOut.y, 3 / viewport.zoom, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.stroke();
        }
      }

      // Draw anchor points
      const anchorSize = 4 / viewport.zoom;
      for (let i = 0; i < pathAnchors.length; i++) {
        const anchor = pathAnchors[i];
        if (!anchor) continue;
        ctx.fillStyle = i === 0 ? '#00aaff' : '#ffffff';
        ctx.strokeStyle = '#00aaff';
        ctx.lineWidth = 1 / viewport.zoom;
        ctx.fillRect(
          anchor.point.x - anchorSize / 2,
          anchor.point.y - anchorSize / 2,
          anchorSize,
          anchorSize,
        );
        ctx.strokeRect(
          anchor.point.x - anchorSize / 2,
          anchor.point.y - anchorSize / 2,
          anchorSize,
          anchorSize,
        );
      }

      ctx.restore();
    }

    // Draw lasso preview
    if (lassoPoints.length > 1) {
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1 / viewport.zoom;
      ctx.setLineDash([4 / viewport.zoom, 4 / viewport.zoom]);
      ctx.beginPath();
      const firstLasso = lassoPoints[0];
      if (firstLasso) {
        ctx.moveTo(firstLasso.x, firstLasso.y);
        for (let i = 1; i < lassoPoints.length; i++) {
          const lp = lassoPoints[i];
          if (lp) ctx.lineTo(lp.x, lp.y);
        }
      }
      ctx.closePath();
      ctx.stroke();
      ctx.strokeStyle = '#000000';
      ctx.lineDashOffset = 4 / viewport.zoom;
      ctx.stroke();
      ctx.restore();
    }

    // Draw crop preview
    if (cropRect) {
      ctx.save();
      // Dim area outside crop
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, 0, doc.width, cropRect.y);
      ctx.fillRect(0, cropRect.y, cropRect.x, cropRect.height);
      ctx.fillRect(cropRect.x + cropRect.width, cropRect.y, doc.width - cropRect.x - cropRect.width, cropRect.height);
      ctx.fillRect(0, cropRect.y + cropRect.height, doc.width, doc.height - cropRect.y - cropRect.height);
      // Crop border
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1 / viewport.zoom;
      ctx.setLineDash([]);
      ctx.strokeRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
      ctx.restore();
    }

    ctx.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, viewport, layers, renderVersion, selection, pathAnchors, lassoPoints, cropRect, transform]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      // Trigger re-render
      useEditorStore.getState().setViewportSize(rect.width, rect.height);
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

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
  const { handleToolDown, handleToolMove, handleToolUp, clearPersistentTransform } = useCanvasInteraction(screenToCanvas, containerRef);

  // Mouse handlers
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const canvasPos = screenToCanvas(screenX, screenY);
      setCursorPos(canvasPos);

      if (isPanning) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        setPan(panStartRef.current.panX + dx, panStartRef.current.panY + dy);
      } else {
        handleToolMove(e);
      }
    },
    [isPanning, screenToCanvas, setPan, handleToolMove],
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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpaceDown(true);
        return;
      }

      if (e.key === 'Escape') {
        const uiState = useUIStore.getState();
        if (uiState.activeTool === 'path' && uiState.pathAnchors.length > 0) {
          uiState.clearPath();
        } else {
          useEditorStore.getState().clearSelection();
          uiState.setTransform(null);
          clearPersistentTransform();
        }
        return;
      }

      if (e.key === 'Enter') {
        const uiState = useUIStore.getState();
        if (uiState.activeTool === 'path' && uiState.pathAnchors.length >= 2) {
          strokeCurrentPath();
        }
        return;
      }

      // Tool shortcuts
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const toolMap: Record<string, () => void> = {
          v: () => setActiveTool('move'),
          b: () => setActiveTool('brush'),
          n: () => setActiveTool('pencil'),
          e: () => setActiveTool('eraser'),
          g: () => setActiveTool('fill'),
          i: () => setActiveTool('eyedropper'),
          t: () => setActiveTool('text'),
          u: () => setActiveTool('shape'),
          m: () => setActiveTool('marquee-rect'),
          l: () => setActiveTool('lasso'),
          w: () => setActiveTool('wand'),
          c: () => setActiveTool('crop'),
          p: () => setActiveTool('path'),
          s: () => setActiveTool('stamp'),
          o: () => setActiveTool('dodge'),
          x: () => swapColors(),
          d: () => resetColors(),
        };

        const handler = toolMap[e.key.toLowerCase()];
        if (handler) {
          handler();
          return;
        }
      }

      // Zoom shortcuts
      if (e.metaKey || e.ctrlKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          setZoom(Math.min(64, viewport.zoom * 1.5));
        } else if (e.key === '-') {
          e.preventDefault();
          setZoom(Math.max(0.01, viewport.zoom / 1.5));
        } else if (e.key === '0') {
          e.preventDefault();
          // Fit to screen
          const canvas = canvasRef.current;
          if (canvas) {
            const scaleX = canvas.width / doc.width;
            const scaleY = canvas.height / doc.height;
            setZoom(Math.min(scaleX, scaleY) * 0.9);
            setPan(0, 0);
          }
        } else if (e.key === '1') {
          e.preventDefault();
          setZoom(1);
          setPan(0, 0);
        } else if (e.key === 'd') {
          e.preventDefault();
          useEditorStore.getState().clearSelection();
          useUIStore.getState().setTransform(null);
          clearPersistentTransform();
        } else if (e.key === 'z') {
          e.preventDefault();
          if (e.shiftKey) {
            useEditorStore.getState().redo();
          } else {
            useEditorStore.getState().undo();
          }
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpaceDown(false);
        setIsPanning(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [setActiveTool, swapColors, resetColors, setZoom, setPan, viewport.zoom, doc.width, doc.height]);

  const [toolSettingsCollapsed, setToolSettingsCollapsed] = useState(false);
  const [colorPanelCollapsed, setColorPanelCollapsed] = useState(false);

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
      {showModal && (
        <NewDocumentModal
          onCreateDocument={handleCreateDocument}
          onOpenFile={handleOpenFile}
          onCancel={() => setShowNewDocumentModal(false)}
        />
      )}
      <div className={styles.header}>
        <MenuBar />
      </div>
      <div className={styles.body}>
        <Toolbox />
        <div
          ref={containerRef}
          data-testid="canvas-container"
          className={`${styles.canvas} ${isPanning || isSpaceDown ? styles.canvasGrab : styles.canvasCrosshair}`}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          <canvas ref={canvasRef} />
        </div>
        <div className={styles.sidebar}>
          <div className={styles.sidebarTop}>
            <PanelContainer
              title="Tool Settings"
              collapsed={toolSettingsCollapsed}
              onToggle={() => setToolSettingsCollapsed(!toolSettingsCollapsed)}
            >
              <ToolSettingsPanel />
            </PanelContainer>
            <PanelContainer
              title="Color"
              collapsed={colorPanelCollapsed}
              onToggle={() => setColorPanelCollapsed(!colorPanelCollapsed)}
            >
              <ColorPanel
                foregroundColor={foregroundColor}
                backgroundColor={backgroundColor}
                onForegroundChange={setForegroundColor}
                onBackgroundChange={setBackgroundColor}
                onSwap={swapColors}
              />
            </PanelContainer>
          </div>
          <div className={styles.sidebarBottom}>
            <PanelContainer title="Layers">
              <LayerPanel
                layers={[...layers]}
                activeLayerId={activeLayerId}
                onSelectLayer={setActiveLayer}
                onToggleVisibility={toggleLayerVisibility}
                onAddLayer={addLayer}
                onRemoveLayer={removeLayer}
                onReorderLayer={moveLayer}
              />
            </PanelContainer>
          </div>
        </div>
      </div>
      <StatusBar
        zoom={viewport.zoom}
        cursorX={cursorPos.x}
        cursorY={cursorPos.y}
        docWidth={doc.width}
        docHeight={doc.height}
        activeTool={activeTool}
      />
    </div>
  );
}
