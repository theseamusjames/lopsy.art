import { useCallback, useEffect, useRef, useState } from 'react';
import { Toolbox } from '../toolbox/Toolbox';
import { LayerPanel } from '../panels/LayerPanel/LayerPanel';
import { LayerEffectsPanel } from '../panels/LayerEffectsPanel/LayerEffectsPanel';
import { ColorPanel } from '../panels/ColorPanel/ColorPanel';
import { PanelContainer } from '../panels/PanelContainer/PanelContainer';
import { MenuBar } from './MenuBar/MenuBar';
import { OptionsBar } from './OptionsBar/OptionsBar';
import { StatusBar } from './StatusBar/StatusBar';
import { NewDocumentModal } from '../components/NewDocumentModal/NewDocumentModal';
import { useUIStore } from './ui-store';
import { useEditorStore } from './editor-store';
import { useCanvasInteraction, strokeCurrentPath } from './useCanvasInteraction';
import { getHandlePositions } from '../tools/transform/transform';
import type { TransformHandle } from '../tools/transform/transform';
import { getSelectionEdges } from '../selection/selection';
import styles from './App.module.css';

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const foregroundColor = useUIStore((s) => s.foregroundColor);
  const backgroundColor = useUIStore((s) => s.backgroundColor);
  const setForegroundColor = useUIStore((s) => s.setForegroundColor);
  const setBackgroundColor = useUIStore((s) => s.setBackgroundColor);
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
  const updateLayerOpacity = useEditorStore((s) => s.updateLayerOpacity);
  const setZoom = useEditorStore((s) => s.setZoom);
  const setPan = useEditorStore((s) => s.setPan);
  const renderVersion = useEditorStore((s) => s.renderVersion);
  const selection = useEditorStore((s) => s.selection);
  const pathAnchors = useUIStore((s) => s.pathAnchors);
  const lassoPoints = useUIStore((s) => s.lassoPoints);
  const cropRect = useUIStore((s) => s.cropRect);
  const transform = useUIStore((s) => s.transform);
  const gradientPreview = useUIStore((s) => s.gradientPreview);

  const documentReady = useEditorStore((s) => s.documentReady);
  const createDocument = useEditorStore((s) => s.createDocument);
  const openImageAsDocument = useEditorStore((s) => s.openImageAsDocument);
  const maskEditMode = useUIStore((s) => s.maskEditMode);
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

        // --- Outer Glow (behind content) ---
        if (layer.effects.outerGlow) {
          const glow = layer.effects.outerGlow;
          const glowBlur = glow.size + glow.spread;
          const pad = glowBlur * 2;
          const glowCanvas = document.createElement('canvas');
          glowCanvas.width = data.width + pad * 2;
          glowCanvas.height = data.height + pad * 2;
          const glowCtx = glowCanvas.getContext('2d');
          if (glowCtx) {
            glowCtx.filter = `blur(${glowBlur}px)`;
            glowCtx.drawImage(tempCanvas, pad, pad);
            glowCtx.globalCompositeOperation = 'source-in';
            glowCtx.filter = 'none';
            glowCtx.fillStyle = `rgba(${glow.color.r},${glow.color.g},${glow.color.b},${glow.opacity})`;
            glowCtx.fillRect(0, 0, glowCanvas.width, glowCanvas.height);
            ctx.drawImage(glowCanvas, layer.x - pad, layer.y - pad);
          }
        }

        // --- Drop Shadow (behind content) ---
        if (layer.effects.dropShadow) {
          const shadow = layer.effects.dropShadow;
          const pad = shadow.blur * 2;
          const shadowCanvas = document.createElement('canvas');
          shadowCanvas.width = data.width + pad * 2;
          shadowCanvas.height = data.height + pad * 2;
          const shadowCtx = shadowCanvas.getContext('2d');
          if (shadowCtx) {
            if (shadow.spread > 0) {
              const spreadScale = 1 + (shadow.spread / Math.max(data.width, data.height)) * 2;
              const spreadOffsetX = pad + (data.width * (1 - spreadScale)) / 2;
              const spreadOffsetY = pad + (data.height * (1 - spreadScale)) / 2;
              shadowCtx.filter = `blur(${shadow.blur}px)`;
              shadowCtx.drawImage(tempCanvas, spreadOffsetX, spreadOffsetY, data.width * spreadScale, data.height * spreadScale);
            } else {
              shadowCtx.filter = `blur(${shadow.blur}px)`;
              shadowCtx.drawImage(tempCanvas, pad, pad);
            }
            shadowCtx.globalCompositeOperation = 'source-in';
            shadowCtx.filter = 'none';
            shadowCtx.fillStyle = `rgba(${shadow.color.r},${shadow.color.g},${shadow.color.b},${shadow.color.a})`;
            shadowCtx.fillRect(0, 0, shadowCanvas.width, shadowCanvas.height);
            ctx.drawImage(shadowCanvas, layer.x + shadow.offsetX - pad, layer.y + shadow.offsetY - pad);
          }
        }

        // --- Layer content (with mask application) ---
        if (layer.mask && layer.mask.enabled && !maskEditMode) {
          const maskedCanvas = document.createElement('canvas');
          maskedCanvas.width = data.width;
          maskedCanvas.height = data.height;
          const maskedCtx = maskedCanvas.getContext('2d');
          if (maskedCtx) {
            maskedCtx.drawImage(tempCanvas, 0, 0);
            const maskImageData = new ImageData(layer.mask.width, layer.mask.height);
            for (let i = 0; i < layer.mask.data.length; i++) {
              const idx = i * 4;
              const val = layer.mask.data[i] ?? 0;
              maskImageData.data[idx] = val;
              maskImageData.data[idx + 1] = val;
              maskImageData.data[idx + 2] = val;
              maskImageData.data[idx + 3] = 255;
            }
            const maskCanvas = document.createElement('canvas');
            maskCanvas.width = layer.mask.width;
            maskCanvas.height = layer.mask.height;
            const maskCtx = maskCanvas.getContext('2d');
            if (maskCtx) {
              maskCtx.putImageData(maskImageData, 0, 0);
              maskedCtx.globalCompositeOperation = 'destination-in';
              maskedCtx.drawImage(maskCanvas, 0, 0);
            }
            ctx.drawImage(maskedCanvas, layer.x, layer.y);
          }
        } else {
          ctx.drawImage(tempCanvas, layer.x, layer.y);
        }

        // Mask edit mode overlay: show blue on hidden areas
        if (maskEditMode && layer.mask && layer.id === activeLayerId) {
          const overlayCanvas = document.createElement('canvas');
          overlayCanvas.width = layer.mask.width;
          overlayCanvas.height = layer.mask.height;
          const overlayCtx = overlayCanvas.getContext('2d');
          if (overlayCtx) {
            const overlayData = overlayCtx.createImageData(layer.mask.width, layer.mask.height);
            for (let i = 0; i < layer.mask.data.length; i++) {
              const val = layer.mask.data[i] ?? 0;
              const overlayAlpha = Math.round((1 - val / 255) * 128);
              const idx = i * 4;
              overlayData.data[idx] = 0;
              overlayData.data[idx + 1] = 100;
              overlayData.data[idx + 2] = 255;
              overlayData.data[idx + 3] = overlayAlpha;
            }
            overlayCtx.putImageData(overlayData, 0, 0);
            ctx.globalAlpha = 1;
            ctx.drawImage(overlayCanvas, layer.x, layer.y);
            ctx.globalAlpha = layer.opacity;
          }
        }

        // --- Stroke (on top of content) ---
        if (layer.effects.stroke) {
          const stroke = layer.effects.stroke;
          const sw = stroke.width;
          const pad = sw * 2;
          const strokeCanvas = document.createElement('canvas');
          strokeCanvas.width = data.width + pad * 2;
          strokeCanvas.height = data.height + pad * 2;
          const strokeCtx = strokeCanvas.getContext('2d');
          if (strokeCtx) {
            if (stroke.position === 'outside') {
              // Dilated version (blur-threshold approximation)
              strokeCtx.filter = `blur(${sw / 2}px)`;
              strokeCtx.drawImage(tempCanvas, pad, pad);
              strokeCtx.filter = 'none';
              // Strengthen the alpha to create dilation effect
              strokeCtx.globalCompositeOperation = 'source-over';
              for (let i = 0; i < 3; i++) {
                strokeCtx.drawImage(strokeCanvas, 0, 0);
              }
              // Cut out the original shape to leave only the outer stroke
              strokeCtx.globalCompositeOperation = 'destination-out';
              strokeCtx.drawImage(tempCanvas, pad, pad);
              // Color the stroke
              strokeCtx.globalCompositeOperation = 'source-in';
              strokeCtx.fillStyle = `rgba(${stroke.color.r},${stroke.color.g},${stroke.color.b},${stroke.color.a})`;
              strokeCtx.fillRect(0, 0, strokeCanvas.width, strokeCanvas.height);
            } else if (stroke.position === 'inside') {
              // Draw original, then overlay colored version clipped to original
              strokeCtx.drawImage(tempCanvas, pad, pad);
              // Create an eroded version by blurring + thresholding via compositing
              const erodeCanvas = document.createElement('canvas');
              erodeCanvas.width = strokeCanvas.width;
              erodeCanvas.height = strokeCanvas.height;
              const erodeCtx = erodeCanvas.getContext('2d');
              if (erodeCtx) {
                erodeCtx.filter = `blur(${sw / 2}px)`;
                erodeCtx.drawImage(tempCanvas, pad, pad);
                erodeCtx.filter = 'none';
                // Weaken alpha by drawing transparency over it
                erodeCtx.globalCompositeOperation = 'destination-in';
                erodeCtx.filter = `blur(${sw / 2}px)`;
                erodeCtx.drawImage(tempCanvas, pad, pad);
                erodeCtx.filter = 'none';
              }
              // Stroke = original minus eroded
              strokeCtx.globalCompositeOperation = 'destination-out';
              strokeCtx.drawImage(erodeCanvas, 0, 0);
              // Color the remaining
              strokeCtx.globalCompositeOperation = 'source-in';
              strokeCtx.fillStyle = `rgba(${stroke.color.r},${stroke.color.g},${stroke.color.b},${stroke.color.a})`;
              strokeCtx.fillRect(0, 0, strokeCanvas.width, strokeCanvas.height);
            } else {
              // center: half inside, half outside
              const halfW = sw / 2;
              // Dilated
              strokeCtx.filter = `blur(${halfW / 2}px)`;
              strokeCtx.drawImage(tempCanvas, pad, pad);
              strokeCtx.filter = 'none';
              for (let i = 0; i < 3; i++) {
                strokeCtx.drawImage(strokeCanvas, 0, 0);
              }
              // Eroded
              const erodeCanvas = document.createElement('canvas');
              erodeCanvas.width = strokeCanvas.width;
              erodeCanvas.height = strokeCanvas.height;
              const erodeCtx = erodeCanvas.getContext('2d');
              if (erodeCtx) {
                erodeCtx.filter = `blur(${halfW / 2}px)`;
                erodeCtx.drawImage(tempCanvas, pad, pad);
                erodeCtx.filter = 'none';
                erodeCtx.globalCompositeOperation = 'destination-in';
                erodeCtx.filter = `blur(${halfW / 2}px)`;
                erodeCtx.drawImage(tempCanvas, pad, pad);
                erodeCtx.filter = 'none';
              }
              // Stroke = dilated minus eroded
              strokeCtx.globalCompositeOperation = 'destination-out';
              strokeCtx.drawImage(erodeCanvas, 0, 0);
              // Color
              strokeCtx.globalCompositeOperation = 'source-in';
              strokeCtx.fillStyle = `rgba(${stroke.color.r},${stroke.color.g},${stroke.color.b},${stroke.color.a})`;
              strokeCtx.fillRect(0, 0, strokeCanvas.width, strokeCanvas.height);
            }
            ctx.drawImage(strokeCanvas, layer.x - pad, layer.y - pad);
          }
        }
      }
    }

    ctx.globalAlpha = 1;

    // Document border
    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 1 / viewport.zoom;
    ctx.strokeRect(0, 0, doc.width, doc.height);

    // Draw selection marching ants from mask edges
    if (selection.active && selection.mask) {
      ctx.save();
      ctx.lineWidth = 1 / viewport.zoom;
      ctx.setLineDash([4 / viewport.zoom, 4 / viewport.zoom]);

      const edges = getSelectionEdges(selection.mask, selection.maskWidth, selection.maskHeight);

      const drawEdges = () => {
        ctx.beginPath();
        for (let i = 0; i < edges.h.length; i += 4) {
          ctx.moveTo(edges.h[i] as number, edges.h[i + 1] as number);
          ctx.lineTo(edges.h[i + 2] as number, edges.h[i + 3] as number);
        }
        for (let i = 0; i < edges.v.length; i += 4) {
          ctx.moveTo(edges.v[i] as number, edges.v[i + 1] as number);
          ctx.lineTo(edges.v[i + 2] as number, edges.v[i + 3] as number);
        }
        ctx.stroke();
      };

      ctx.strokeStyle = '#ffffff';
      drawEdges();
      ctx.strokeStyle = '#000000';
      ctx.lineDashOffset = 4 / viewport.zoom;
      drawEdges();

      ctx.restore();
    }

    // Draw free transform handles (separate from marching ants)
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

    // Draw gradient preview line
    if (gradientPreview) {
      ctx.save();
      ctx.lineWidth = 1.5 / viewport.zoom;
      ctx.setLineDash([]);

      const { start, end } = gradientPreview;

      // Draw line
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 0.75 / viewport.zoom;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();

      // Draw anchor points
      const pointRadius = 4 / viewport.zoom;
      for (const pt of [start, end]) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pointRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1 / viewport.zoom;
        ctx.stroke();
      }

      ctx.restore();
    }

    ctx.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, viewport, layers, renderVersion, selection, pathAnchors, lassoPoints, cropRect, transform, maskEditMode, activeLayerId, gradientPreview]);

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

  const [colorPanelCollapsed, setColorPanelCollapsed] = useState(false);
  const [effectsPanelCollapsed, setEffectsPanelCollapsed] = useState(false);

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
        <OptionsBar />
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
                onUpdateOpacity={updateLayerOpacity}
              />
            </PanelContainer>
            <PanelContainer
              title="Layer Effects"
              collapsed={effectsPanelCollapsed}
              onToggle={() => setEffectsPanelCollapsed(!effectsPanelCollapsed)}
            >
              <LayerEffectsPanel />
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
      />
    </div>
  );
}
