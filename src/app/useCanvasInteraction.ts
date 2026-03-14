import { useCallback, useRef } from 'react';
import { useUIStore } from './ui-store';
import { useEditorStore } from './editor-store';
import { useToolSettingsStore } from './tool-settings-store';
import { PixelBuffer, MaskedPixelBuffer } from '../engine/pixel-data';
import { createMaskSurface, extractMaskFromSurface } from '../engine/mask-utils';

// Shared buffer for the in-progress mask drawing. The renderer reads from
// this during mask edit mode so we don't need to sync mask data every frame.
let activeMaskEditBuffer: { layerId: string; buf: PixelBuffer; maskWidth: number; maskHeight: number } | null = null;
export function getActiveMaskEditBuffer() { return activeMaskEditBuffer; }
import { generateBrushStamp, interpolatePoints, applyBrushDab } from '../tools/brush/brush';
import { drawPencilLine } from '../tools/pencil/pencil';
import { generateBrushStamp as generateEraserStamp } from '../tools/brush/brush';
import { applyEraserDab } from '../tools/eraser/eraser';
import { floodFill, applyFill } from '../tools/fill/fill';
import { sampleColor } from '../tools/eyedropper/eyedropper';
import { createRectSelection, createEllipseSelection, selectionBounds, getSelectionMaskValue } from '../selection/selection';
import { interpolateGradient, computeLinearGradientT, computeRadialGradientT } from '../tools/gradient/gradient';
import { drawShape } from '../tools/shape/shape';
import { applyDodgeBurn } from '../tools/dodge/dodge';
import { applyStampDab } from '../tools/stamp/stamp';
import { renderText } from '../tools/text/text';
import { createPolygonMask } from '../tools/lasso/lasso';
import { rasterizePath } from '../tools/path/path';
import { snapPositionToGrid } from '../tools/move/move';
import {
  hitTestHandle,
  isScaleHandle,
  isRotateHandle,
  computeScale,
  computeRotation,
  createTransformState,
  applyTransformToMask,
} from '../tools/transform/transform';
import type { TransformHandle, TransformState } from '../tools/transform/transform';
import type { Point, ToolId } from '../types';
import type { PathAnchor } from './ui-store';

interface InteractionState {
  drawing: boolean;
  lastPoint: Point | null;
  pixelBuffer: PixelBuffer | null;
  originalPixelBuffer: PixelBuffer | null;
  layerId: string | null;
  tool: ToolId | null;
  startPoint: Point | null;
  layerStartX: number;
  layerStartY: number;
  maskMode: boolean;
  transformHandle: TransformHandle | null;
  transformStartState: TransformState | null;
  transformStartAngle: number;
  originalSelectionMask: Uint8ClampedArray | null;
  originalSelectionMaskWidth: number;
  originalSelectionMaskHeight: number;
  transformCanvas: HTMLCanvasElement | null;
  baseCanvas: HTMLCanvasElement | null;
  moveOriginalMask: Uint8ClampedArray | null;
  moveOriginalBounds: { x: number; y: number; width: number; height: number } | null;
}

const DEFAULT_TRANSFORM_FIELDS = {
  maskMode: false,
  transformHandle: null as TransformHandle | null,
  transformStartState: null as TransformState | null,
  transformStartAngle: 0,
  originalSelectionMask: null as Uint8ClampedArray | null,
  originalSelectionMaskWidth: 0,
  originalSelectionMaskHeight: 0,
  transformCanvas: null as HTMLCanvasElement | null,
  baseCanvas: null as HTMLCanvasElement | null,
  moveOriginalMask: null as Uint8ClampedArray | null,
  moveOriginalBounds: null as { x: number; y: number; width: number; height: number } | null,
};

function wrapWithSelectionMask(buffer: PixelBuffer, layerX: number, layerY: number): PixelBuffer | MaskedPixelBuffer {
  const sel = useEditorStore.getState().selection;
  if (sel.active && sel.mask) {
    return new MaskedPixelBuffer(buffer, sel.mask, sel.maskWidth, sel.maskHeight, layerX, layerY);
  }
  return buffer;
}

function rasterizePathToLayer(
  anchors: PathAnchor[],
  closed: boolean,
  layerId: string,
  editorState: ReturnType<typeof useEditorStore.getState>,
) {
  editorState.pushHistory();
  const imageData = editorState.getOrCreateLayerPixelData(layerId);
  const buf = PixelBuffer.fromImageData(imageData);
  const color = useUIStore.getState().foregroundColor;
  useUIStore.getState().addRecentColor(color);
  const strokeWidth = useToolSettingsStore.getState().pathStrokeWidth;

  rasterizePath(buf, anchors, closed, color, strokeWidth);

  editorState.updateLayerPixelData(layerId, buf.toImageData());
  useUIStore.getState().clearPath();
}

export function strokeCurrentPath() {
  const uiState = useUIStore.getState();
  const editorState = useEditorStore.getState();
  const anchors = uiState.pathAnchors;
  const activeId = editorState.document.activeLayerId;
  if (anchors.length < 2 || !activeId) {
    uiState.clearPath();
    return;
  }
  rasterizePathToLayer(anchors, uiState.pathClosed, activeId, editorState);
}

export function useCanvasInteraction(
  screenToCanvas: (screenX: number, screenY: number) => Point,
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  const stateRef = useRef<InteractionState>({
    drawing: false,
    lastPoint: null,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: null,
    tool: null,
    startPoint: null,
    layerStartX: 0,
    layerStartY: 0,
    maskMode: false,
    transformHandle: null,
    transformStartState: null,
    transformStartAngle: 0,
    originalSelectionMask: null,
    originalSelectionMaskWidth: 0,
    originalSelectionMaskHeight: 0,
    transformCanvas: null,
    baseCanvas: null,
    moveOriginalMask: null,
    moveOriginalBounds: null,
  });

  // Persistent transform canvases — survive across handle grabs so we always
  // transform from the original cut pixels (no re-extraction degradation)
  const persistentTransformRef = useRef<{
    transformCanvas: HTMLCanvasElement;
    baseCanvas: HTMLCanvasElement;
    originalMask: Uint8ClampedArray;
    maskWidth: number;
    maskHeight: number;
  } | null>(null);

  // Persistent floating selection — survives across move tool grabs so we don't
  // re-cut pixels on each mousedown (which would leave cumulative holes)
  const floatingSelectionRef = useRef<{
    floated: PixelBuffer;
    base: PixelBuffer;
    offsetX: number;
    offsetY: number;
    originalMask: Uint8ClampedArray;
    originalBounds: { x: number; y: number; width: number; height: number };
  } | null>(null);

  // Clone stamp: source point persists across strokes, offset is computed on first stroke
  const stampSourceRef = useRef<Point | null>(null);
  const stampOffsetRef = useRef<Point | null>(null);

  // Last paint endpoint for shift-click line drawing (layer-local coords)
  const lastPaintPointRef = useRef<{ point: Point; layerId: string } | null>(null);

  const handleToolDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;

      const activeTool = useUIStore.getState().activeTool;
      const editorState = useEditorStore.getState();
      const activeLayerId = editorState.document.activeLayerId;

      if (!activeLayerId) return;

      const activeLayer = editorState.document.layers.find((l) => l.id === activeLayerId);
      if (!activeLayer || activeLayer.locked) return;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const canvasPos = screenToCanvas(screenX, screenY);

      const toolSettings = useToolSettingsStore.getState();

      // Check for transform handle interaction on selection
      const uiState = useUIStore.getState();
      const currentTransform = uiState.transform;
      if (currentTransform && editorState.selection.active) {
        const handleRadius = 8 / editorState.viewport.zoom;
        const hit = hitTestHandle(canvasPos, currentTransform, handleRadius);

        if (hit) {
          const startAngle = isRotateHandle(hit)
            ? computeRotation(canvasPos, currentTransform) - currentTransform.rotation
            : 0;

          const sel = editorState.selection;
          editorState.pushHistory();

          // Clear floating selection when entering transform mode.
          // The persistent transform canvases should already be built
          // from the move mouseup (with correctly separated content).
          floatingSelectionRef.current = null;

          // On first grab: cut pixels into persistent offscreen canvases.
          // On subsequent grabs: reuse them so we always transform from the
          // original unmodified pixels (no re-extraction degradation).
          if (!persistentTransformRef.current && sel.active && sel.mask) {
            const imageData = editorState.getOrCreateLayerPixelData(activeLayerId);
            const w = imageData.width;
            const h = imageData.height;

            const txCanvas = document.createElement('canvas');
            txCanvas.width = w;
            txCanvas.height = h;
            const txCtx = txCanvas.getContext('2d');

            const bCanvas = document.createElement('canvas');
            bCanvas.width = w;
            bCanvas.height = h;
            const bCtx = bCanvas.getContext('2d');

            if (txCtx && bCtx) {
              const floatedData = new ImageData(new Uint8ClampedArray(imageData.data), w, h);
              const baseData = new ImageData(new Uint8ClampedArray(imageData.data), w, h);

              for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                  const idx = (y * w + x) * 4;
                  if (getSelectionMaskValue(sel, x + activeLayer.x, y + activeLayer.y) > 0) {
                    baseData.data[idx] = 0;
                    baseData.data[idx + 1] = 0;
                    baseData.data[idx + 2] = 0;
                    baseData.data[idx + 3] = 0;
                  } else {
                    floatedData.data[idx] = 0;
                    floatedData.data[idx + 1] = 0;
                    floatedData.data[idx + 2] = 0;
                    floatedData.data[idx + 3] = 0;
                  }
                }
              }
              txCtx.putImageData(floatedData, 0, 0);
              bCtx.putImageData(baseData, 0, 0);

              persistentTransformRef.current = {
                transformCanvas: txCanvas,
                baseCanvas: bCanvas,
                originalMask: new Uint8ClampedArray(sel.mask),
                maskWidth: sel.maskWidth,
                maskHeight: sel.maskHeight,
              };
            }
          }

          const persistent = persistentTransformRef.current;

          stateRef.current = {
            drawing: true,
            lastPoint: canvasPos,
            pixelBuffer: null,
            originalPixelBuffer: null,
            layerId: activeLayerId,
            tool: activeTool,
            startPoint: canvasPos,
            layerStartX: 0,
            layerStartY: 0,
            maskMode: false,
            transformHandle: hit,
            transformStartState: { ...currentTransform },
            transformStartAngle: startAngle,
            originalSelectionMask: persistent?.originalMask ?? null,
            originalSelectionMaskWidth: persistent?.maskWidth ?? 0,
            originalSelectionMaskHeight: persistent?.maskHeight ?? 0,
            transformCanvas: persistent?.transformCanvas ?? null,
            baseCanvas: persistent?.baseCanvas ?? null,
            moveOriginalMask: null,
            moveOriginalBounds: null,
          };
          uiState.setActiveTransformHandle(hit);
          return;
        }
      }

      // Get or create pixel data for this layer
      const imageData = editorState.getOrCreateLayerPixelData(activeLayerId);
      const pixelBuffer = PixelBuffer.fromImageData(imageData);

      // Wrap buffer so painting tools respect the active selection
      const paintSurface = wrapWithSelectionMask(pixelBuffer, activeLayer.x, activeLayer.y);

      // Convert canvas coords to layer-local coords for painting tools
      const layerPos: Point = {
        x: canvasPos.x - activeLayer.x,
        y: canvasPos.y - activeLayer.y,
      };

      switch (activeTool) {
        case 'move': {
          editorState.pushHistory();
          const sel = editorState.selection;
          if (sel.active && sel.mask) {
            let floated: PixelBuffer;
            let base: PixelBuffer;
            const existing = floatingSelectionRef.current;

            if (existing) {
              // Reuse the persistent floating selection (don't re-cut)
              floated = existing.floated;
              base = existing.base;
            } else if (persistentTransformRef.current) {
              // After a rotate/scale, derive floating selection from
              // the already-separated transform canvases so we never
              // re-cut from the composited layer data.
              // We must render the transform canvas WITH the current
              // rotation/scale applied so the floated pixels reflect
              // the transformed state (not the original orientation).
              const ptRef = persistentTransformRef.current;
              const bCtx = ptRef.baseCanvas.getContext('2d');
              const w = ptRef.transformCanvas.width;
              const h = ptRef.transformCanvas.height;
              const currentXform = useUIStore.getState().transform;
              if (bCtx) {
                // Render the transform canvas with current rotation/scale
                const renderedCanvas = document.createElement('canvas');
                renderedCanvas.width = w;
                renderedCanvas.height = h;
                const rCtx = renderedCanvas.getContext('2d')!;
                if (currentXform && currentXform.rotation !== 0 || currentXform && (currentXform.scaleX !== 1 || currentXform.scaleY !== 1)) {
                  const origBounds = sel.bounds!;
                  const cx = origBounds.x + origBounds.width / 2;
                  const cy = origBounds.y + origBounds.height / 2;
                  rCtx.save();
                  rCtx.translate(cx + currentXform.translateX, cy + currentXform.translateY);
                  rCtx.rotate(currentXform.rotation);
                  rCtx.scale(currentXform.scaleX, currentXform.scaleY);
                  rCtx.translate(-cx, -cy);
                  rCtx.drawImage(ptRef.transformCanvas, 0, 0);
                  rCtx.restore();
                } else {
                  rCtx.drawImage(ptRef.transformCanvas, 0, 0);
                }
                const renderedImg = rCtx.getImageData(0, 0, w, h);
                const bImg = bCtx.getImageData(0, 0, w, h);
                floated = PixelBuffer.fromImageData(renderedImg);
                base = PixelBuffer.fromImageData(bImg);

                // Build a new mask from the rendered (rotated) pixels so
                // the marching ants track the actual content, not the
                // pre-rotation selection shape.
                const edState = useEditorStore.getState();
                const { width: docW, height: docH } = edState.document;
                const newMask = new Uint8ClampedArray(docW * docH);
                let minX = docW, minY = docH, maxX = 0, maxY = 0;
                for (let py = 0; py < h && py < docH; py++) {
                  for (let px = 0; px < w && px < docW; px++) {
                    const alpha = renderedImg.data[(py * w + px) * 4 + 3] ?? 0;
                    if (alpha > 0) {
                      newMask[py * docW + px] = 255;
                      if (px < minX) minX = px;
                      if (px > maxX) maxX = px;
                      if (py < minY) minY = py;
                      if (py > maxY) maxY = py;
                    }
                  }
                }
                const newBounds = minX <= maxX
                  ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
                  : { ...sel.bounds! };
                edState.setSelection(newBounds, newMask, docW, docH);
                useUIStore.getState().setTransform(createTransformState(newBounds));

                floatingSelectionRef.current = {
                  floated, base, offsetX: 0, offsetY: 0,
                  originalMask: newMask,
                  originalBounds: newBounds,
                };
              } else {
                // Fallback: cut from layer (shouldn't happen)
                base = pixelBuffer.clone();
                floated = new PixelBuffer(pixelBuffer.width, pixelBuffer.height);
                for (let y = 0; y < pixelBuffer.height; y++) {
                  for (let x = 0; x < pixelBuffer.width; x++) {
                    if (getSelectionMaskValue(sel, x + activeLayer.x, y + activeLayer.y) > 0) {
                      floated.setPixel(x, y, pixelBuffer.getPixel(x, y));
                      base.setPixel(x, y, { r: 0, g: 0, b: 0, a: 0 });
                    }
                  }
                }
                floatingSelectionRef.current = {
                  floated, base, offsetX: 0, offsetY: 0,
                  originalMask: new Uint8ClampedArray(sel.mask),
                  originalBounds: { ...sel.bounds! },
                };
              }
            } else {
              // First move: cut selected pixels out of the layer
              base = pixelBuffer.clone();
              floated = new PixelBuffer(pixelBuffer.width, pixelBuffer.height);
              for (let y = 0; y < pixelBuffer.height; y++) {
                for (let x = 0; x < pixelBuffer.width; x++) {
                  if (getSelectionMaskValue(sel, x + activeLayer.x, y + activeLayer.y) > 0) {
                    floated.setPixel(x, y, pixelBuffer.getPixel(x, y));
                    base.setPixel(x, y, { r: 0, g: 0, b: 0, a: 0 });
                  }
                }
              }
              floatingSelectionRef.current = {
                floated, base, offsetX: 0, offsetY: 0,
                originalMask: new Uint8ClampedArray(sel.mask),
                originalBounds: { ...sel.bounds! },
              };
            }
            // Clear transform canvases — they'll be rebuilt at move mouseup
            persistentTransformRef.current = null;
            const floatRef = floatingSelectionRef.current!;
            stateRef.current = {
              drawing: true,
              lastPoint: canvasPos,
              pixelBuffer: floated,
              originalPixelBuffer: base,
              layerId: activeLayerId,
              tool: 'move',
              startPoint: canvasPos,
              layerStartX: 0,
              layerStartY: 0,
              ...DEFAULT_TRANSFORM_FIELDS,
              moveOriginalMask: floatRef.originalMask,
              moveOriginalBounds: floatRef.originalBounds,
            };
          } else {
            stateRef.current = {
              drawing: true,
              lastPoint: canvasPos,
              pixelBuffer: null,
              originalPixelBuffer: null,
              layerId: activeLayerId,
              tool: 'move',
              startPoint: canvasPos,
              layerStartX: activeLayer.x,
              layerStartY: activeLayer.y,
              ...DEFAULT_TRANSFORM_FIELDS,
            };
          }
          break;
        }

        case 'marquee-rect':
        case 'marquee-ellipse': {
          useUIStore.getState().setTransform(null);
          persistentTransformRef.current = null;
          floatingSelectionRef.current = null;
          stateRef.current = {
            drawing: true,
            lastPoint: canvasPos,
            pixelBuffer: null,
            originalPixelBuffer: null,
            layerId: activeLayerId,
            tool: activeTool,
            startPoint: canvasPos,
            layerStartX: 0,
            layerStartY: 0,
            ...DEFAULT_TRANSFORM_FIELDS,
          };
          break;
        }

        case 'brush':
        case 'pencil':
        case 'eraser': {
          // Shift+click: draw a line from the last paint point to here
          const shiftLine = e.shiftKey
            && lastPaintPointRef.current
            && lastPaintPointRef.current.layerId === activeLayerId;
          const lineFrom = shiftLine ? lastPaintPointRef.current!.point : layerPos;

          const maskEditMode = useUIStore.getState().maskEditMode;
          if (maskEditMode && activeLayer.mask) {
            editorState.pushHistory();
            const maskBuf = createMaskSurface(activeLayer.mask.data, activeLayer.mask.width, activeLayer.mask.height);
            // Paint tools hide (0), eraser reveals (255)
            const maskColor = activeTool === 'eraser'
              ? { r: 255, g: 255, b: 255, a: 1 }
              : { r: 0, g: 0, b: 0, a: 1 };

            stateRef.current = {
              drawing: true,
              lastPoint: layerPos,
              pixelBuffer: maskBuf,
              originalPixelBuffer: null,
              layerId: activeLayerId,
              tool: activeTool,
              startPoint: null,
              layerStartX: activeLayer.x,
              layerStartY: activeLayer.y,
              ...DEFAULT_TRANSFORM_FIELDS,
              maskMode: true,
            };

            if (activeTool === 'brush') {
              const size = toolSettings.brushSize;
              const hardness = toolSettings.brushHardness / 100;
              const opacity = toolSettings.brushOpacity / 100;
              const stamp = generateBrushStamp(size, hardness);
              if (shiftLine) {
                const spacing = Math.max(1, size * 0.25);
                const pts = interpolatePoints(lineFrom, layerPos, spacing);
                for (const pt of pts) {
                  applyBrushDab(maskBuf, pt, stamp, size, maskColor, opacity, 1);
                }
              } else {
                applyBrushDab(maskBuf, layerPos, stamp, size, maskColor, opacity, 1);
              }
            } else if (activeTool === 'pencil') {
              const size = toolSettings.pencilSize;
              drawPencilLine(maskBuf, lineFrom, layerPos, maskColor, size);
            } else {
              const size = toolSettings.eraserSize;
              const hardness = 0.8;
              const opacity = toolSettings.eraserOpacity / 100;
              const stamp = generateEraserStamp(size, hardness);
              if (shiftLine) {
                const spacing = Math.max(1, size * 0.25);
                const pts = interpolatePoints(lineFrom, layerPos, spacing);
                for (const pt of pts) {
                  applyBrushDab(maskBuf, pt, stamp, size, maskColor, opacity, 1);
                }
              } else {
                applyBrushDab(maskBuf, layerPos, stamp, size, maskColor, opacity, 1);
              }
            }

            activeMaskEditBuffer = { layerId: activeLayerId, buf: maskBuf, maskWidth: activeLayer.mask.width, maskHeight: activeLayer.mask.height };
            editorState.notifyRender();
            break;
          }

          editorState.pushHistory();
          stateRef.current = {
            drawing: true,
            lastPoint: layerPos,
            pixelBuffer: pixelBuffer,
            originalPixelBuffer: null,
            layerId: activeLayerId,
            tool: activeTool,
            startPoint: null,
            layerStartX: activeLayer.x,
            layerStartY: activeLayer.y,
            ...DEFAULT_TRANSFORM_FIELDS,
          };

          if (activeTool === 'brush') {
            const size = toolSettings.brushSize;
            const hardness = toolSettings.brushHardness / 100;
            const opacity = toolSettings.brushOpacity / 100;
            const stamp = generateBrushStamp(size, hardness);
            const color = useUIStore.getState().foregroundColor;
            useUIStore.getState().addRecentColor(color);
            if (shiftLine) {
              const spacing = Math.max(1, size * 0.25);
              const pts = interpolatePoints(lineFrom, layerPos, spacing);
              for (const pt of pts) {
                applyBrushDab(paintSurface, pt, stamp, size, color, opacity, 1);
              }
            } else {
              applyBrushDab(paintSurface, layerPos, stamp, size, color, opacity, 1);
            }
          } else if (activeTool === 'pencil') {
            const color = useUIStore.getState().foregroundColor;
            useUIStore.getState().addRecentColor(color);
            const size = toolSettings.pencilSize;
            drawPencilLine(paintSurface, lineFrom, layerPos, color, size);
          } else {
            const size = toolSettings.eraserSize;
            const hardness = 0.8;
            const opacity = toolSettings.eraserOpacity / 100;
            const stamp = generateEraserStamp(size, hardness);
            if (shiftLine) {
              const spacing = Math.max(1, size * 0.25);
              const pts = interpolatePoints(lineFrom, layerPos, spacing);
              for (const pt of pts) {
                applyEraserDab(paintSurface, pt, stamp, size, opacity);
              }
            } else {
              applyEraserDab(paintSurface, layerPos, stamp, size, opacity);
            }
          }

          editorState.updateLayerPixelData(activeLayerId, pixelBuffer.toImageData());
          break;
        }

        case 'fill': {
          editorState.pushHistory();
          const color = useUIStore.getState().foregroundColor;
          useUIStore.getState().addRecentColor(color);
          const tolerance = toolSettings.fillTolerance;
          const contiguous = toolSettings.fillContiguous;
          const pixels = floodFill(pixelBuffer, layerPos.x, layerPos.y, color, tolerance, contiguous);
          applyFill(paintSurface, pixels, color);
          editorState.updateLayerPixelData(activeLayerId, pixelBuffer.toImageData());
          break;
        }

        case 'eyedropper': {
          const color = sampleColor(pixelBuffer, layerPos.x, layerPos.y, 'point');
          useUIStore.getState().setForegroundColor(color);
          stateRef.current = {
            drawing: true,
            lastPoint: layerPos,
            pixelBuffer: pixelBuffer,
            originalPixelBuffer: null,
            layerId: activeLayerId,
            tool: 'eyedropper',
            startPoint: null,
            layerStartX: activeLayer.x,
            layerStartY: activeLayer.y,
            ...DEFAULT_TRANSFORM_FIELDS,
          };
          break;
        }

        case 'wand': {
          const wandTolerance = toolSettings.wandTolerance;
          const wandContiguous = toolSettings.wandContiguous;
          const { width: docW, height: docH } = editorState.document;
          const wandPixels = floodFill(pixelBuffer, layerPos.x, layerPos.y, { r: 0, g: 0, b: 0, a: 0 }, wandTolerance, wandContiguous);
          const wandMask = new Uint8ClampedArray(docW * docH);
          for (const pt of wandPixels) {
            const mx = pt.x + activeLayer.x;
            const my = pt.y + activeLayer.y;
            if (mx >= 0 && mx < docW && my >= 0 && my < docH) {
              wandMask[my * docW + mx] = 255;
            }
          }
          const wandBounds = selectionBounds(wandMask, docW, docH);
          if (wandBounds) {
            editorState.setSelection(wandBounds, wandMask, docW, docH);
            useUIStore.getState().setTransform(createTransformState(wandBounds));
          }
          break;
        }

        case 'lasso': {
          useUIStore.getState().setLassoPoints([canvasPos]);
          stateRef.current = {
            drawing: true,
            lastPoint: canvasPos,
            pixelBuffer: null,
            originalPixelBuffer: null,
            layerId: activeLayerId,
            tool: 'lasso',
            startPoint: canvasPos,
            layerStartX: 0,
            layerStartY: 0,
            ...DEFAULT_TRANSFORM_FIELDS,
          };
          break;
        }

        case 'dodge': {
          editorState.pushHistory();
          const dodgeMode = toolSettings.dodgeMode;
          const exposure = toolSettings.dodgeExposure / 100;
          const dodgeSize = toolSettings.brushSize;
          const dodgeShiftLine = e.shiftKey
            && lastPaintPointRef.current
            && lastPaintPointRef.current.layerId === activeLayerId;
          if (dodgeShiftLine) {
            const spacing = Math.max(1, dodgeSize * 0.25);
            const pts = interpolatePoints(lastPaintPointRef.current!.point, layerPos, spacing);
            for (const pt of pts) {
              applyDodgeBurn(paintSurface, pt, dodgeSize, dodgeMode, exposure);
            }
          } else {
            applyDodgeBurn(paintSurface, layerPos, dodgeSize, dodgeMode, exposure);
          }
          editorState.updateLayerPixelData(activeLayerId, pixelBuffer.toImageData());
          stateRef.current = {
            drawing: true,
            lastPoint: layerPos,
            pixelBuffer: pixelBuffer,
            originalPixelBuffer: null,
            layerId: activeLayerId,
            tool: 'dodge',
            startPoint: null,
            layerStartX: activeLayer.x,
            layerStartY: activeLayer.y,
            ...DEFAULT_TRANSFORM_FIELDS,
          };
          break;
        }

        case 'crop': {
          useUIStore.getState().setCropRect(null);
          stateRef.current = {
            drawing: true,
            lastPoint: canvasPos,
            pixelBuffer: null,
            originalPixelBuffer: null,
            layerId: activeLayerId,
            tool: 'crop',
            startPoint: canvasPos,
            layerStartX: 0,
            layerStartY: 0,
            ...DEFAULT_TRANSFORM_FIELDS,
          };
          break;
        }

        case 'text': {
          editorState.pushHistory();
          const textContent = toolSettings.textContent;
          const fontSize = toolSettings.textFontSize;
          const fontFamily = toolSettings.textFontFamily;
          const fontWeight = toolSettings.textFontWeight;
          const fontStyle = toolSettings.textFontStyle;
          const textColor = useUIStore.getState().foregroundColor;
          useUIStore.getState().addRecentColor(textColor);
          renderText(paintSurface, layerPos, textContent, fontSize, fontFamily, textColor, fontWeight, fontStyle);
          editorState.updateLayerPixelData(activeLayerId, pixelBuffer.toImageData());
          break;
        }

        case 'stamp': {
          if (e.altKey) {
            // Set clone source point
            stampSourceRef.current = layerPos;
            stampOffsetRef.current = null;
            break;
          }
          if (!stampSourceRef.current) break; // No source set yet
          editorState.pushHistory();
          // Compute offset on first stroke from this source
          if (!stampOffsetRef.current) {
            stampOffsetRef.current = {
              x: stampSourceRef.current.x - layerPos.x,
              y: stampSourceRef.current.y - layerPos.y,
            };
          }
          stateRef.current = {
            drawing: true,
            lastPoint: layerPos,
            pixelBuffer: pixelBuffer,
            originalPixelBuffer: pixelBuffer.clone(),
            layerId: activeLayerId,
            tool: 'stamp',
            startPoint: layerPos,
            layerStartX: activeLayer.x,
            layerStartY: activeLayer.y,
            ...DEFAULT_TRANSFORM_FIELDS,
          };
          // Shift+click: stamp a line from the last paint point
          const stampShiftLine = e.shiftKey
            && lastPaintPointRef.current
            && lastPaintPointRef.current.layerId === activeLayerId;
          if (stampShiftLine) {
            const spacing = Math.max(1, toolSettings.stampSize * 0.25);
            const pts = interpolatePoints(lastPaintPointRef.current!.point, layerPos, spacing);
            for (const pt of pts) {
              applyStampDab(paintSurface, pixelBuffer, pt, stampOffsetRef.current, toolSettings.stampSize);
            }
          } else {
            applyStampDab(paintSurface, pixelBuffer, layerPos, stampOffsetRef.current, toolSettings.stampSize);
          }
          editorState.updateLayerPixelData(activeLayerId, pixelBuffer.toImageData());
          break;
        }

        case 'path': {
          const uiState = useUIStore.getState();
          const anchors = uiState.pathAnchors;
          // Check if clicking near the first point to close path
          if (anchors.length >= 2) {
            const first = anchors[0];
            if (first) {
              const dx = layerPos.x - first.point.x;
              const dy = layerPos.y - first.point.y;
              if (Math.sqrt(dx * dx + dy * dy) < 8) {
                uiState.closePath();
                // Rasterize the path onto the layer
                rasterizePathToLayer([...anchors], true, activeLayerId, editorState);
                break;
              }
            }
          }
          // Add new anchor point
          const newAnchor = { point: layerPos, handleIn: null, handleOut: null };
          uiState.addPathAnchor(newAnchor);
          stateRef.current = {
            drawing: true,
            lastPoint: layerPos,
            pixelBuffer: null,
            originalPixelBuffer: null,
            layerId: activeLayerId,
            tool: 'path',
            startPoint: layerPos,
            layerStartX: activeLayer.x,
            layerStartY: activeLayer.y,
            ...DEFAULT_TRANSFORM_FIELDS,
          };
          break;
        }

        case 'gradient':
        case 'shape': {
          editorState.pushHistory();
          useUIStore.getState().addRecentColor(useUIStore.getState().foregroundColor);
          if (activeTool === 'gradient') {
            useUIStore.getState().addRecentColor(useUIStore.getState().backgroundColor);
          }
          stateRef.current = {
            drawing: true,
            lastPoint: layerPos,
            pixelBuffer: pixelBuffer,
            originalPixelBuffer: pixelBuffer.clone(),
            layerId: activeLayerId,
            tool: activeTool,
            startPoint: layerPos,
            layerStartX: activeLayer.x,
            layerStartY: activeLayer.y,
            ...DEFAULT_TRANSFORM_FIELDS,
          };
          break;
        }

        default:
          break;
      }
    },
    [screenToCanvas, containerRef],
  );

  const handleToolMove = useCallback(
    (e: React.MouseEvent) => {
      const state = stateRef.current;
      if (!state.drawing || !state.layerId) return;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const canvasPos = screenToCanvas(screenX, screenY);

      // Convert to layer-local coords for painting tools
      const layerLocalPos: Point = {
        x: canvasPos.x - state.layerStartX,
        y: canvasPos.y - state.layerStartY,
      };

      const toolSettings = useToolSettingsStore.getState();

      // Handle transform dragging
      if (state.transformHandle && state.transformStartState && state.startPoint) {
        const handle = state.transformHandle;
        const startState = state.transformStartState;

        let newTransform: TransformState;

        if (isScaleHandle(handle)) {
          const result = computeScale(
            handle,
            state.startPoint,
            canvasPos,
            startState,
            e.shiftKey,
          );
          newTransform = {
            ...startState,
            scaleX: result.scaleX,
            scaleY: result.scaleY,
            translateX: result.translateX,
            translateY: result.translateY,
          };
        } else {
          const currentAngle = computeRotation(canvasPos, startState);
          const newRotation = currentAngle - state.transformStartAngle;
          const snappedRotation = e.shiftKey
            ? Math.round(newRotation / (Math.PI / 12)) * (Math.PI / 12)
            : newRotation;
          newTransform = {
            ...startState,
            rotation: snappedRotation,
          };
        }

        useUIStore.getState().setTransform(newTransform);

        // Update selection mask using the original mask (not the already-transformed one)
        const editorState = useEditorStore.getState();
        const origMask = state.originalSelectionMask;
        let transformedMask: Uint8ClampedArray | null = null;
        let transformedMaskWidth = 0;
        if (origMask) {
          const { mask, bounds } = applyTransformToMask(
            origMask, state.originalSelectionMaskWidth, state.originalSelectionMaskHeight, newTransform,
          );
          transformedMask = mask;
          transformedMaskWidth = state.originalSelectionMaskWidth;
          if (bounds) {
            editorState.setSelection(bounds, mask, state.originalSelectionMaskWidth, state.originalSelectionMaskHeight);
          }
        }

        // Apply full cumulative transform to the original (persistent) pixels
        if (state.transformCanvas && state.baseCanvas && state.layerId) {
          const w = state.baseCanvas.width;
          const h = state.baseCanvas.height;

          const origBounds = newTransform.originalBounds;
          const origCx = origBounds.x + origBounds.width / 2;
          const origCy = origBounds.y + origBounds.height / 2;

          // Render rotated content onto a separate canvas
          const rotatedCanvas = document.createElement('canvas');
          rotatedCanvas.width = w;
          rotatedCanvas.height = h;
          const rotCtx = rotatedCanvas.getContext('2d');
          if (rotCtx) {
            rotCtx.save();
            rotCtx.translate(origCx + newTransform.translateX, origCy + newTransform.translateY);
            rotCtx.rotate(newTransform.rotation);
            rotCtx.scale(newTransform.scaleX, newTransform.scaleY);
            rotCtx.translate(-origCx, -origCy);
            rotCtx.drawImage(state.transformCanvas, 0, 0);
            rotCtx.restore();

            // Composite: base + rotated pixels clipped to selection mask
            const baseData = state.baseCanvas.getContext('2d')!.getImageData(0, 0, w, h);
            const rotData = rotCtx.getImageData(0, 0, w, h);
            const resultData = new ImageData(new Uint8ClampedArray(baseData.data), w, h);

            for (let py = 0; py < h; py++) {
              for (let px = 0; px < w; px++) {
                const idx = (py * w + px) * 4;
                const ra = rotData.data[idx + 3] ?? 0;
                if (ra <= 0) continue;
                // Clip to selection mask so rotated content doesn't bleed outside
                if (transformedMask) {
                  const maskVal = transformedMask[py * transformedMaskWidth + px] ?? 0;
                  if (maskVal <= 0) continue;
                }
                // Alpha-composite rotated over base
                const ba = resultData.data[idx + 3] ?? 0;
                const raNorm = ra / 255;
                const baNorm = ba / 255;
                const outA = raNorm + baNorm * (1 - raNorm);
                if (outA > 0) {
                  resultData.data[idx] = Math.round(
                    ((rotData.data[idx] ?? 0) * raNorm + (resultData.data[idx] ?? 0) * baNorm * (1 - raNorm)) / outA,
                  );
                  resultData.data[idx + 1] = Math.round(
                    ((rotData.data[idx + 1] ?? 0) * raNorm + (resultData.data[idx + 1] ?? 0) * baNorm * (1 - raNorm)) / outA,
                  );
                  resultData.data[idx + 2] = Math.round(
                    ((rotData.data[idx + 2] ?? 0) * raNorm + (resultData.data[idx + 2] ?? 0) * baNorm * (1 - raNorm)) / outA,
                  );
                  resultData.data[idx + 3] = Math.round(outA * 255);
                }
              }
            }

            useEditorStore.getState().updateLayerPixelData(state.layerId, resultData);
          }
        }

        editorState.notifyRender();
        return;
      }

      switch (state.tool) {
        case 'move': {
          if (!state.startPoint) break;
          const dragDx = Math.round(canvasPos.x - state.startPoint.x);
          const dragDy = Math.round(canvasPos.y - state.startPoint.y);
          if (state.pixelBuffer && state.originalPixelBuffer) {
            // Total offset = persistent offset from prior moves + this drag's delta
            const floatState = floatingSelectionRef.current;
            let dx = (floatState?.offsetX ?? 0) + dragDx;
            let dy = (floatState?.offsetY ?? 0) + dragDy;
            const uiSnap = useUIStore.getState();
            if (uiSnap.showGrid && uiSnap.snapToGrid) {
              const snapped = snapPositionToGrid(dx, dy, uiSnap.gridSize);
              dx = snapped.x;
              dy = snapped.y;
            }
            // Moving selected pixels: composite floated pixels at offset onto the base
            const base = state.originalPixelBuffer.clone();
            const floated = state.pixelBuffer;
            for (let y = 0; y < floated.height; y++) {
              for (let x = 0; x < floated.width; x++) {
                const fp = floated.getPixel(x, y);
                if (fp.a <= 0) continue;
                const destX = x + dx;
                const destY = y + dy;
                if (destX < 0 || destX >= base.width || destY < 0 || destY >= base.height) continue;
                const bp = base.getPixel(destX, destY);
                const outA = fp.a + bp.a * (1 - fp.a);
                if (outA > 0) {
                  base.setPixel(destX, destY, {
                    r: Math.round((fp.r * fp.a + bp.r * bp.a * (1 - fp.a)) / outA),
                    g: Math.round((fp.g * fp.a + bp.g * bp.a * (1 - fp.a)) / outA),
                    b: Math.round((fp.b * fp.a + bp.b * bp.a * (1 - fp.a)) / outA),
                    a: outA,
                  });
                }
              }
            }
            useEditorStore.getState().updateLayerPixelData(state.layerId, base.toImageData());

            // Shift selection bounds and mask to follow the moved content
            if (state.moveOriginalMask && state.moveOriginalBounds) {
              const edState = useEditorStore.getState();
              const { width: docW, height: docH } = edState.document;
              const origMask = state.moveOriginalMask;
              const newMask = new Uint8ClampedArray(docW * docH);
              for (let y = 0; y < docH; y++) {
                for (let x = 0; x < docW; x++) {
                  const srcX = x - dx;
                  const srcY = y - dy;
                  if (srcX >= 0 && srcX < docW && srcY >= 0 && srcY < docH) {
                    newMask[y * docW + x] = origMask[srcY * docW + srcX] ?? 0;
                  }
                }
              }
              const newBounds = {
                x: state.moveOriginalBounds.x + dx,
                y: state.moveOriginalBounds.y + dy,
                width: state.moveOriginalBounds.width,
                height: state.moveOriginalBounds.height,
              };
              edState.setSelection(newBounds, newMask, docW, docH);
              useUIStore.getState().setTransform(createTransformState(newBounds));
            }
          } else {
            let newX = state.layerStartX + dragDx;
            let newY = state.layerStartY + dragDy;
            const uiState = useUIStore.getState();
            if (uiState.showGrid && uiState.snapToGrid) {
              const snapped = snapPositionToGrid(newX, newY, uiState.gridSize);
              newX = snapped.x;
              newY = snapped.y;
            }
            useEditorStore.getState().updateLayerPosition(
              state.layerId,
              newX,
              newY,
            );
          }
          break;
        }

        case 'marquee-rect':
        case 'marquee-ellipse': {
          if (!state.startPoint) break;
          const editorState = useEditorStore.getState();
          let mStart = state.startPoint;
          let mEnd = canvasPos;
          const uiMarquee = useUIStore.getState();
          if (uiMarquee.showGrid && uiMarquee.snapToGrid) {
            mStart = snapPositionToGrid(mStart.x, mStart.y, uiMarquee.gridSize);
            mEnd = snapPositionToGrid(mEnd.x, mEnd.y, uiMarquee.gridSize);
          }
          const x = Math.min(mStart.x, mEnd.x);
          const y = Math.min(mStart.y, mEnd.y);
          const w = Math.abs(mEnd.x - mStart.x);
          const h = Math.abs(mEnd.y - mStart.y);

          if (w > 0 && h > 0) {
            const selRect = { x, y, width: w, height: h };
            const mask = state.tool === 'marquee-rect'
              ? createRectSelection(selRect, editorState.document.width, editorState.document.height)
              : createEllipseSelection(selRect, editorState.document.width, editorState.document.height);
            editorState.setSelection(selRect, mask, editorState.document.width, editorState.document.height);
            useUIStore.getState().setTransform(createTransformState(selRect));
          }
          break;
        }

        case 'brush': {
          if (!state.pixelBuffer || !state.lastPoint) break;
          const size = toolSettings.brushSize;
          const hardness = toolSettings.brushHardness / 100;
          const opacity = toolSettings.brushOpacity / 100;
          const spacing = Math.max(1, size * 0.25);
          const stamp = generateBrushStamp(size, hardness);
          const color = state.maskMode
            ? { r: 0, g: 0, b: 0, a: 1 }
            : useUIStore.getState().foregroundColor;
          const brushSurface = state.maskMode ? state.pixelBuffer : wrapWithSelectionMask(state.pixelBuffer, state.layerStartX, state.layerStartY);
          const points = interpolatePoints(state.lastPoint, layerLocalPos, spacing);
          for (const pt of points) {
            applyBrushDab(brushSurface, pt, stamp, size, color, opacity, 1);
          }
          state.lastPoint = layerLocalPos;
          if (state.maskMode) {
            useEditorStore.getState().notifyRender();
          } else {
            useEditorStore.getState().updateLayerPixelData(state.layerId, state.pixelBuffer.toImageData());
          }
          break;
        }

        case 'pencil': {
          if (!state.pixelBuffer || !state.lastPoint) break;
          const color = state.maskMode
            ? { r: 0, g: 0, b: 0, a: 1 }
            : useUIStore.getState().foregroundColor;
          const pencilSurface = state.maskMode ? state.pixelBuffer : wrapWithSelectionMask(state.pixelBuffer, state.layerStartX, state.layerStartY);
          const size = toolSettings.pencilSize;
          drawPencilLine(pencilSurface, state.lastPoint, layerLocalPos, color, size);
          state.lastPoint = layerLocalPos;
          if (state.maskMode) {
            useEditorStore.getState().notifyRender();
          } else {
            useEditorStore.getState().updateLayerPixelData(state.layerId, state.pixelBuffer.toImageData());
          }
          break;
        }

        case 'eraser': {
          if (!state.pixelBuffer || !state.lastPoint) break;
          const size = toolSettings.eraserSize;
          const hardness = 0.8;
          const opacity = toolSettings.eraserOpacity / 100;
          const spacing = Math.max(1, size * 0.25);
          const stamp = generateEraserStamp(size, hardness);
          const points = interpolatePoints(state.lastPoint, layerLocalPos, spacing);
          if (state.maskMode) {
            const maskColor = { r: 255, g: 255, b: 255, a: 1 };
            for (const pt of points) {
              applyBrushDab(state.pixelBuffer, pt, stamp, size, maskColor, opacity, 1);
            }
            state.lastPoint = layerLocalPos;
            useEditorStore.getState().notifyRender();
          } else {
            const eraserSurface = wrapWithSelectionMask(state.pixelBuffer, state.layerStartX, state.layerStartY);
            for (const pt of points) {
              applyEraserDab(eraserSurface, pt, stamp, size, opacity);
            }
            state.lastPoint = layerLocalPos;
            useEditorStore.getState().updateLayerPixelData(state.layerId, state.pixelBuffer.toImageData());
          }
          break;
        }

        case 'stamp': {
          if (!state.pixelBuffer || !state.originalPixelBuffer || !state.lastPoint || !stampOffsetRef.current) break;
          const stampSurface = wrapWithSelectionMask(state.pixelBuffer, state.layerStartX, state.layerStartY);
          const stampSpacing = Math.max(1, toolSettings.stampSize * 0.25);
          const stampPoints = interpolatePoints(state.lastPoint, layerLocalPos, stampSpacing);
          for (const pt of stampPoints) {
            applyStampDab(stampSurface, state.originalPixelBuffer, pt, stampOffsetRef.current, toolSettings.stampSize);
          }
          state.lastPoint = layerLocalPos;
          useEditorStore.getState().updateLayerPixelData(state.layerId, state.pixelBuffer.toImageData());
          break;
        }

        case 'eyedropper': {
          if (!state.pixelBuffer) break;
          const eyeColor = sampleColor(state.pixelBuffer, layerLocalPos.x, layerLocalPos.y, 'point');
          useUIStore.getState().setForegroundColor(eyeColor);
          break;
        }

        case 'lasso': {
          const lassoPoints = useUIStore.getState().lassoPoints;
          useUIStore.getState().setLassoPoints([...lassoPoints, canvasPos]);
          useEditorStore.getState().notifyRender();
          break;
        }

        case 'dodge': {
          if (!state.pixelBuffer || !state.lastPoint) break;
          const dodgeMode = toolSettings.dodgeMode;
          const exposure = toolSettings.dodgeExposure / 100;
          const dodgeSize = toolSettings.brushSize;
          const dodgeSpacing = Math.max(1, dodgeSize * 0.25);
          const dodgeSurface = wrapWithSelectionMask(state.pixelBuffer, state.layerStartX, state.layerStartY);
          const dodgePoints = interpolatePoints(state.lastPoint, layerLocalPos, dodgeSpacing);
          for (const pt of dodgePoints) {
            applyDodgeBurn(dodgeSurface, pt, dodgeSize, dodgeMode, exposure);
          }
          state.lastPoint = layerLocalPos;
          useEditorStore.getState().updateLayerPixelData(state.layerId, state.pixelBuffer.toImageData());
          break;
        }

        case 'crop': {
          if (!state.startPoint) break;
          const edDoc = useEditorStore.getState().document;
          const x1 = Math.max(0, Math.min(state.startPoint.x, canvasPos.x));
          const y1 = Math.max(0, Math.min(state.startPoint.y, canvasPos.y));
          const x2 = Math.min(edDoc.width, Math.max(state.startPoint.x, canvasPos.x));
          const y2 = Math.min(edDoc.height, Math.max(state.startPoint.y, canvasPos.y));
          const cw = x2 - x1;
          const ch = y2 - y1;
          if (cw > 0 && ch > 0) {
            useUIStore.getState().setCropRect({ x: x1, y: y1, width: cw, height: ch });
            useEditorStore.getState().notifyRender();
          }
          break;
        }

        case 'path': {
          if (!state.startPoint) break;
          // Dragging after placing a point creates bezier handles
          const dx = layerLocalPos.x - state.startPoint.x;
          const dy = layerLocalPos.y - state.startPoint.y;
          if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
            const handleOut: Point = { x: state.startPoint.x + dx, y: state.startPoint.y + dy };
            const handleIn: Point = { x: state.startPoint.x - dx, y: state.startPoint.y - dy };
            useUIStore.getState().updateLastPathAnchor({
              point: state.startPoint,
              handleIn,
              handleOut,
            });
            useEditorStore.getState().notifyRender();
          }
          break;
        }

        case 'shape': {
          if (!state.pixelBuffer || !state.originalPixelBuffer || !state.startPoint) break;
          // Restore original pixels, then draw shape preview
          const restored = state.originalPixelBuffer.clone();
          const shapeSurface = wrapWithSelectionMask(restored, state.layerStartX, state.layerStartY);
          const color = useUIStore.getState().foregroundColor;
          drawShape(shapeSurface, state.startPoint, layerLocalPos, color, {
            mode: toolSettings.shapeMode,
            fill: toolSettings.shapeFill,
            strokeWidth: toolSettings.shapeStrokeWidth,
          });
          state.pixelBuffer = restored;
          useEditorStore.getState().updateLayerPixelData(state.layerId, restored.toImageData());
          break;
        }

        case 'gradient': {
          if (!state.pixelBuffer || !state.originalPixelBuffer || !state.startPoint) break;
          // Restore original pixels, then apply gradient preview
          const restored = state.originalPixelBuffer.clone();
          const gradSurface = wrapWithSelectionMask(restored, state.layerStartX, state.layerStartY);
          const fg = useUIStore.getState().foregroundColor;
          const bg = useUIStore.getState().backgroundColor;
          const gradType = toolSettings.gradientType;
          const stops = [
            { position: 0, color: fg },
            { position: 1, color: bg },
          ] as const;

          for (let y = 0; y < restored.height; y++) {
            for (let x = 0; x < restored.width; x++) {
              let t: number;
              if (gradType === 'linear') {
                t = computeLinearGradientT(
                  x, y,
                  state.startPoint.x, state.startPoint.y,
                  layerLocalPos.x, layerLocalPos.y,
                );
              } else {
                const dx = layerLocalPos.x - state.startPoint.x;
                const dy = layerLocalPos.y - state.startPoint.y;
                const radius = Math.sqrt(dx * dx + dy * dy);
                t = computeRadialGradientT(x, y, state.startPoint.x, state.startPoint.y, radius);
              }
              const gradColor = interpolateGradient(stops, t);
              // Alpha-composite gradient over existing pixel
              const existing = restored.getPixel(x, y);
              const ga = gradColor.a;
              const ea = existing.a;
              const outA = ga + ea * (1 - ga);
              if (outA > 0) {
                gradSurface.setPixel(x, y, {
                  r: Math.round((gradColor.r * ga + existing.r * ea * (1 - ga)) / outA),
                  g: Math.round((gradColor.g * ga + existing.g * ea * (1 - ga)) / outA),
                  b: Math.round((gradColor.b * ga + existing.b * ea * (1 - ga)) / outA),
                  a: outA,
                });
              }
            }
          }
          state.pixelBuffer = restored;
          useEditorStore.getState().updateLayerPixelData(state.layerId, restored.toImageData());
          // Show gradient preview line
          useUIStore.getState().setGradientPreview({
            start: { x: state.startPoint.x + state.layerStartX, y: state.startPoint.y + state.layerStartY },
            end: { x: layerLocalPos.x + state.layerStartX, y: layerLocalPos.y + state.layerStartY },
          });
          break;
        }

        default:
          break;
      }
    },
    [screenToCanvas, containerRef],
  );

  const handleToolUp = useCallback((e: React.MouseEvent) => {
    const state = stateRef.current;
    // If marquee tool ended without dragging, clear the selection
    if (
      (state.tool === 'marquee-rect' || state.tool === 'marquee-ellipse') &&
      state.startPoint
    ) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const canvasPos = screenToCanvas(screenX, screenY);
        const dx = Math.abs(canvasPos.x - state.startPoint.x);
        const dy = Math.abs(canvasPos.y - state.startPoint.y);
        if (dx < 2 && dy < 2) {
          useEditorStore.getState().clearSelection();
          useUIStore.getState().setTransform(null);
        }
      }
    }

    // Move: update floating selection offset, build persistent transform
    // canvases so that any subsequent rotation/scale uses the correctly
    // separated content (only the originally selected pixels, not whatever
    // was underneath at the destination).
    if (state.tool === 'move' && state.pixelBuffer && state.startPoint && floatingSelectionRef.current) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const canvasPos = screenToCanvas(screenX, screenY);
        const dragDx = Math.round(canvasPos.x - state.startPoint.x);
        const dragDy = Math.round(canvasPos.y - state.startPoint.y);
        floatingSelectionRef.current.offsetX += dragDx;
        floatingSelectionRef.current.offsetY += dragDy;
      }

      // Build persistent transform canvases from the floating selection so
      // that a subsequent rotation (on any tool) uses the already-separated
      // floated/base pixel data instead of re-cutting from the composited layer.
      const floatRef = floatingSelectionRef.current;
      const sel = useEditorStore.getState().selection;
      if (sel.active && sel.bounds && sel.mask) {
        const baseImg = floatRef.base.toImageData();
        const floatedImg = floatRef.floated.toImageData();
        const w = baseImg.width;
        const h = baseImg.height;
        const txCanvas = document.createElement('canvas');
        txCanvas.width = w;
        txCanvas.height = h;
        const txCtx = txCanvas.getContext('2d');
        const bCanvas = document.createElement('canvas');
        bCanvas.width = w;
        bCanvas.height = h;
        const bCtx = bCanvas.getContext('2d');
        if (txCtx && bCtx) {
          const shifted = new ImageData(w, h);
          const ox = floatRef.offsetX;
          const oy = floatRef.offsetY;
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const srcX = x - ox;
              const srcY = y - oy;
              if (srcX >= 0 && srcX < w && srcY >= 0 && srcY < h) {
                const di = (y * w + x) * 4;
                const si = (srcY * w + srcX) * 4;
                shifted.data[di] = floatedImg.data[si]!;
                shifted.data[di + 1] = floatedImg.data[si + 1]!;
                shifted.data[di + 2] = floatedImg.data[si + 2]!;
                shifted.data[di + 3] = floatedImg.data[si + 3]!;
              }
            }
          }
          txCtx.putImageData(shifted, 0, 0);
          bCtx.putImageData(baseImg, 0, 0);
          persistentTransformRef.current = {
            transformCanvas: txCanvas,
            baseCanvas: bCanvas,
            originalMask: new Uint8ClampedArray(sel.mask),
            maskWidth: sel.maskWidth,
            maskHeight: sel.maskHeight,
          };
        }
        useUIStore.getState().setTransform(createTransformState(sel.bounds));
      }
    }

    // Lasso: create polygon selection from collected points
    if (state.tool === 'lasso') {
      const lassoPoints = useUIStore.getState().lassoPoints;
      if (lassoPoints.length >= 3) {
        const editorState = useEditorStore.getState();
        const { width: docW, height: docH } = editorState.document;
        const lassoMask = createPolygonMask(lassoPoints, docW, docH);
        const lassoBounds = selectionBounds(lassoMask, docW, docH);
        if (lassoBounds) {
          editorState.setSelection(lassoBounds, lassoMask, docW, docH);
          useUIStore.getState().setTransform(createTransformState(lassoBounds));
        }
      }
      useUIStore.getState().clearLassoPoints();
    }

    // Crop: apply the crop
    if (state.tool === 'crop') {
      const cropRect = useUIStore.getState().cropRect;
      if (cropRect && cropRect.width > 1 && cropRect.height > 1) {
        useEditorStore.getState().cropCanvas(cropRect);
      }
      useUIStore.getState().setCropRect(null);
    }

    // Save last paint point for shift+click line drawing
    const paintTools: ReadonlySet<ToolId> = new Set(['brush', 'pencil', 'eraser', 'dodge', 'stamp']);
    if (state.tool && paintTools.has(state.tool) && state.lastPoint && state.layerId) {
      lastPaintPointRef.current = { point: state.lastPoint, layerId: state.layerId };
    }

    // Clear active transform handle
    if (stateRef.current.transformHandle) {
      useUIStore.getState().setActiveTransformHandle(null);
    }

    // Clear gradient preview
    if (stateRef.current.tool === 'gradient') {
      useUIStore.getState().setGradientPreview(null);
    }

    // Sync mask drawing buffer back to mask data
    if (stateRef.current.maskMode && activeMaskEditBuffer && stateRef.current.pixelBuffer) {
      const { layerId, maskWidth, maskHeight } = activeMaskEditBuffer;
      const newMaskData = extractMaskFromSurface(stateRef.current.pixelBuffer, maskWidth, maskHeight);
      useEditorStore.getState().updateLayerMaskData(layerId, newMaskData);
      activeMaskEditBuffer = null;
    }

    stateRef.current = {
      drawing: false,
      lastPoint: null,
      pixelBuffer: null,
      originalPixelBuffer: null,
      layerId: null,
      tool: null,
      startPoint: null,
      layerStartX: 0,
      layerStartY: 0,
      maskMode: false,
      transformHandle: null,
      transformStartState: null,
      transformStartAngle: 0,
      originalSelectionMask: null,
      originalSelectionMaskWidth: 0,
      originalSelectionMaskHeight: 0,
      transformCanvas: null,
      baseCanvas: null,
      moveOriginalMask: null,
      moveOriginalBounds: null,
    };
  }, [screenToCanvas, containerRef]);

  const clearPersistentTransform = useCallback(() => {
    persistentTransformRef.current = null;
    floatingSelectionRef.current = null;
  }, []);

  const nudgeMove = useCallback((dx: number, dy: number) => {
    const editor = useEditorStore.getState();
    const activeId = editor.document.activeLayerId;
    if (!activeId) return;
    const layer = editor.document.layers.find((l) => l.id === activeId);
    if (!layer || layer.locked) return;

    const sel = editor.selection;
    editor.pushHistory();

    if (sel.active && sel.mask) {
      // Cut selected pixels into a floating buffer if not already floating
      const existing = floatingSelectionRef.current;
      let floated: PixelBuffer;
      let base: PixelBuffer;
      let origMask: Uint8ClampedArray;
      let origBounds: { x: number; y: number; width: number; height: number };

      if (existing) {
        floated = existing.floated;
        base = existing.base;
        origMask = existing.originalMask;
        origBounds = existing.originalBounds;
      } else {
        const imageData = editor.getOrCreateLayerPixelData(activeId);
        const pixelBuffer = PixelBuffer.fromImageData(imageData);
        base = pixelBuffer.clone();
        floated = new PixelBuffer(pixelBuffer.width, pixelBuffer.height);
        for (let y = 0; y < pixelBuffer.height; y++) {
          for (let x = 0; x < pixelBuffer.width; x++) {
            if (getSelectionMaskValue(sel, x + layer.x, y + layer.y) > 0) {
              floated.setPixel(x, y, pixelBuffer.getPixel(x, y));
              base.setPixel(x, y, { r: 0, g: 0, b: 0, a: 0 });
            }
          }
        }
        origMask = new Uint8ClampedArray(sel.mask);
        origBounds = { ...sel.bounds! };
        persistentTransformRef.current = null;
      }

      const newOffsetX = (existing?.offsetX ?? 0) + dx;
      const newOffsetY = (existing?.offsetY ?? 0) + dy;

      floatingSelectionRef.current = {
        floated, base, offsetX: newOffsetX, offsetY: newOffsetY,
        originalMask: origMask,
        originalBounds: origBounds,
      };

      // Composite floated onto base at new offset
      const composited = base.clone();
      for (let y = 0; y < floated.height; y++) {
        for (let x = 0; x < floated.width; x++) {
          const fp = floated.getPixel(x, y);
          if (fp.a <= 0) continue;
          const destX = x + newOffsetX;
          const destY = y + newOffsetY;
          if (destX < 0 || destX >= composited.width || destY < 0 || destY >= composited.height) continue;
          const bp = composited.getPixel(destX, destY);
          const outA = fp.a + bp.a * (1 - fp.a);
          if (outA > 0) {
            composited.setPixel(destX, destY, {
              r: Math.round((fp.r * fp.a + bp.r * bp.a * (1 - fp.a)) / outA),
              g: Math.round((fp.g * fp.a + bp.g * bp.a * (1 - fp.a)) / outA),
              b: Math.round((fp.b * fp.a + bp.b * bp.a * (1 - fp.a)) / outA),
              a: outA,
            });
          }
        }
      }
      editor.updateLayerPixelData(activeId, composited.toImageData());

      // Shift selection mask
      const { width: docW, height: docH } = editor.document;
      const newMask = new Uint8ClampedArray(docW * docH);
      for (let y = 0; y < docH; y++) {
        for (let x = 0; x < docW; x++) {
          const srcX = x - newOffsetX;
          const srcY = y - newOffsetY;
          if (srcX >= 0 && srcX < docW && srcY >= 0 && srcY < docH) {
            newMask[y * docW + x] = origMask[srcY * docW + srcX] ?? 0;
          }
        }
      }
      const newBounds = {
        x: origBounds.x + newOffsetX,
        y: origBounds.y + newOffsetY,
        width: origBounds.width,
        height: origBounds.height,
      };
      editor.setSelection(newBounds, newMask, docW, docH);
      useUIStore.getState().setTransform(createTransformState(newBounds));
    } else {
      editor.updateLayerPosition(activeId, layer.x + dx, layer.y + dy);
    }
  }, []);

  return { handleToolDown, handleToolMove, handleToolUp, clearPersistentTransform, nudgeMove };
}
