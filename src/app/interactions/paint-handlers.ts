import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { useToolSettingsStore } from '../tool-settings-store';
import { interpolatePoints, interpolatePointsWithScatter, resetScatterSpacingRemainder } from '../../tools/brush/brush';
import type { InteractionContext, InteractionState } from './interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from './interaction-types';
import { getEngine } from '../../engine-wasm/engine-state';
import { swapBrushTip, restorePrimaryBrushTip } from '../../engine-wasm/engine-sync';
import type { Engine } from '../../engine-wasm/wasm-bridge';
import type { SubBrush } from '../../types/brush';
import {
  applyBrushDab as gpuBrushDab,
  applyBrushDabBatch as gpuBrushDabBatch,
  applyEraserDab as gpuEraserDab,
  applyEraserDabBatch as gpuEraserDabBatch,
  drawPencilLine as gpuDrawPencilLine,
  paintQuickMaskDab as gpuQuickMaskDab,
  paintQuickMaskDabBatch as gpuQuickMaskDabBatch,
  drawQuickMaskPencilLine as gpuQuickMaskPencil,
  paintMaskDab as gpuMaskDab,
  paintMaskDabBatch as gpuMaskDabBatch,
  drawMaskPencilLine as gpuMaskPencilLine,
  uploadLayerMask,
} from '../../engine-wasm/wasm-bridge';
import type { SymmetryConfig } from '../../tools/symmetry';
import { getMirroredPoints, mirrorBatchPoints, isSymmetryActive } from '../../tools/symmetry';

type PaintTool = 'brush' | 'pencil' | 'eraser';

function emitSubBrushDabs(
  engine: Engine,
  layerId: string,
  pts: Float64Array,
  baseSize: number,
  r: number, g: number, b: number, a: number,
  opacity: number,
  subBrushes: readonly SubBrush[],
  sym: SymmetryConfig,
): void {
  for (let i = 0; i < subBrushes.length; i++) {
    const sub = subBrushes[i]!;
    swapBrushTip(engine, i, sub.tip, sub.angleOffset);
    const subSize = baseSize * sub.sizeRatio;
    const subOpacity = opacity * sub.opacityRatio;
    const subHardness = sub.hardness / 100;
    const sJ = sub.sizeJitter / 100;
    const subAJ = sub.angleJitter / 100;
    const subOJ = sub.opacityJitter / 100;
    gpuBrushDabBatch(engine, layerId, pts, subSize, subHardness, r, g, b, a, subOpacity, 1, sJ, subAJ, subOJ);
    for (const m of mirrorBatchPoints(pts, sym)) {
      gpuBrushDabBatch(engine, layerId, m, subSize, subHardness, r, g, b, a, subOpacity, 1, sJ, subAJ, subOJ);
    }
  }
  restorePrimaryBrushTip(engine);
}

function getActiveSubBrushes(): readonly SubBrush[] {
  return useToolSettingsStore.getState().activeSubBrushes;
}

function getSymmetryConfig(center: { x: number; y: number }): SymmetryConfig {
  const { symmetryHorizontal, symmetryVertical, symmetryRadialSegments } = useToolSettingsStore.getState();
  return {
    horizontal: symmetryHorizontal,
    vertical: symmetryVertical,
    radialSegments: symmetryRadialSegments,
    centerX: center.x,
    centerY: center.y,
  };
}

export function handlePaintDown(
  ctx: InteractionContext,
  tool: PaintTool,
): InteractionState | undefined {
  const { canvasPos, layerPos, activeLayer, activeLayerId, shiftKey, lastPaintPointRef } = ctx;
  const toolSettings = useToolSettingsStore.getState();

  useUIStore.getState().setIsStroking(true);

  const shiftLine = shiftKey
    && lastPaintPointRef.current
    && lastPaintPointRef.current.layerId === activeLayerId;
  const lineFrom = shiftLine ? lastPaintPointRef.current!.point : layerPos;

  const editorState = useEditorStore.getState();
  const maskMode = useUIStore.getState().maskMode;
  const maskEditMode = maskMode === 'layerMask';
  const isQuickMaskMode = maskMode === 'quickMask';

  // Quick Mask Mode: paint on the GPU quick mask texture in doc-space.
  // Brush paints white (add to selection), eraser paints black (remove).
  if (isQuickMaskMode) {
    editorState.pushHistory(tool === 'eraser' ? 'Quick Mask Erase' : 'Quick Mask Paint');
    const engine = getEngine();

    // Paint in doc-space (canvasPos), not layer-local coords
    const qmShiftFrom = shiftLine ? lastPaintPointRef.current!.point : canvasPos;

    const state: InteractionState = {
      drawing: true,
      lastPoint: canvasPos,
      pixelBuffer: null,
      originalPixelBuffer: null,
      layerId: activeLayerId,
      tool,
      startPoint: null,
      layerStartX: 0,
      layerStartY: 0,
      ...DEFAULT_TRANSFORM_FIELDS,
      maskMode: true,
    };

    if (!engine) {
      editorState.notifyRender();
      return state;
    }

    const mode = tool === 'eraser' ? 1 : 0; // 0 = brush (add), 1 = eraser (remove)

    if (tool === 'brush') {
      const size = toolSettings.brushSize;
      const hardness = toolSettings.brushHardness / 100;
      const opacity = toolSettings.brushOpacity / 100;
      if (shiftLine) {
        const spacing = Math.max(1, size * 0.25);
        const pts = interpolatePoints(qmShiftFrom, canvasPos, spacing);
        const arr = new Float64Array(pts.length * 2);
        for (let i = 0; i < pts.length; i++) {
          arr[i * 2] = pts[i]!.x;
          arr[i * 2 + 1] = pts[i]!.y;
        }
        gpuQuickMaskDabBatch(engine, arr, size, hardness, opacity, mode);
      } else {
        gpuQuickMaskDab(engine, canvasPos.x, canvasPos.y, size, hardness, opacity, mode);
      }
    } else if (tool === 'pencil') {
      const size = toolSettings.pencilSize;
      const color = { r: 255, g: 255, b: 255, a: 1 };
      gpuQuickMaskPencil(
        engine,
        qmShiftFrom.x, qmShiftFrom.y, canvasPos.x, canvasPos.y,
        color.r / 255, color.g / 255, color.b / 255, color.a,
        size,
        mode,
      );
    } else {
      const size = toolSettings.eraserSize;
      const hardness = 0.8;
      const opacity = toolSettings.eraserOpacity / 100;
      if (shiftLine) {
        const spacing = Math.max(1, size * 0.25);
        const pts = interpolatePoints(qmShiftFrom, canvasPos, spacing);
        const arr = new Float64Array(pts.length * 2);
        for (let i = 0; i < pts.length; i++) {
          arr[i * 2] = pts[i]!.x;
          arr[i * 2 + 1] = pts[i]!.y;
        }
        gpuQuickMaskDabBatch(engine, arr, size, hardness, opacity, mode);
      } else {
        gpuQuickMaskDab(engine, canvasPos.x, canvasPos.y, size, hardness, opacity, mode);
      }
    }

    editorState.notifyRender();
    return state;
  }

  // Mask edit mode: GPU painting on the layer mask texture
  if (maskEditMode && activeLayer.mask) {
    editorState.pushHistory(tool === 'eraser' ? 'Mask Erase' : 'Mask Paint');
    const engine = getEngine();

    const state: InteractionState = {
      drawing: true,
      lastPoint: layerPos,
      pixelBuffer: null,
      originalPixelBuffer: null,
      layerId: activeLayerId,
      tool,
      startPoint: null,
      layerStartX: activeLayer.x,
      layerStartY: activeLayer.y,
      ...DEFAULT_TRANSFORM_FIELDS,
      maskMode: true,
    };

    if (!engine) {
      editorState.notifyRender();
      return state;
    }

    // Ensure mask texture is on GPU before painting
    const maskBytes = new Uint8Array(activeLayer.mask.data.buffer, activeLayer.mask.data.byteOffset, activeLayer.mask.data.byteLength);
    uploadLayerMask(engine, activeLayerId, maskBytes, activeLayer.mask.width, activeLayer.mask.height);

    // Inverted from quick mask: brush=1 (subtract/hide), eraser=0 (add/reveal)
    const mode = tool === 'eraser' ? 0 : 1;

    if (tool === 'brush') {
      const size = toolSettings.brushSize;
      const hardness = toolSettings.brushHardness / 100;
      const opacity = toolSettings.brushOpacity / 100;
      if (shiftLine) {
        const spacing = Math.max(1, size * 0.25);
        const pts = interpolatePoints(lineFrom, layerPos, spacing);
        const arr = new Float64Array(pts.length * 2);
        for (let i = 0; i < pts.length; i++) {
          arr[i * 2] = pts[i]!.x;
          arr[i * 2 + 1] = pts[i]!.y;
        }
        gpuMaskDabBatch(engine, activeLayerId, arr, size, hardness, opacity, mode);
      } else {
        gpuMaskDab(engine, activeLayerId, layerPos.x, layerPos.y, size, hardness, opacity, mode);
      }
    } else if (tool === 'pencil') {
      const size = toolSettings.pencilSize;
      gpuMaskPencilLine(
        engine, activeLayerId,
        lineFrom.x, lineFrom.y, layerPos.x, layerPos.y,
        1.0, size, mode,
      );
    } else {
      const size = toolSettings.eraserSize;
      const hardness = 0.8;
      const opacity = toolSettings.eraserOpacity / 100;
      if (shiftLine) {
        const spacing = Math.max(1, size * 0.25);
        const pts = interpolatePoints(lineFrom, layerPos, spacing);
        const arr = new Float64Array(pts.length * 2);
        for (let i = 0; i < pts.length; i++) {
          arr[i * 2] = pts[i]!.x;
          arr[i * 2 + 1] = pts[i]!.y;
        }
        gpuMaskDabBatch(engine, activeLayerId, arr, size, hardness, opacity, mode);
      } else {
        gpuMaskDab(engine, activeLayerId, layerPos.x, layerPos.y, size, hardness, opacity, mode);
      }
    }

    editorState.notifyRender();
    return state;
  }

  if (!ctx.isStrokeContinuation) {
    const toolLabel = tool === 'brush' ? 'Brush' : tool === 'pencil' ? 'Pencil' : 'Eraser';
    editorState.pushHistory(toolLabel);
  }
  resetScatterSpacingRemainder();

  const engine = getEngine();

  const doc = editorState.document;
  const storedCenter = useToolSettingsStore.getState().symmetryCenter;
  const docCenter = {
    x: (storedCenter?.x ?? doc.width / 2) - activeLayer.x,
    y: (storedCenter?.y ?? doc.height / 2) - activeLayer.y,
  };

  const strokeColor = useToolSettingsStore.getState().foregroundColor;

  const state: InteractionState = {
    drawing: true,
    lastPoint: layerPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool,
    startPoint: null,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
    strokeDistance: 0,
    spacingRemainder: 0,
    symmetryCenter: docCenter,
    strokePoints: tool === 'brush' ? [{ x: layerPos.x, y: layerPos.y }] : undefined,
    strokeColor,
    lastPointTime: performance.now(),
    smoothedSpeed: 0,
  };

  if (!engine) return state;

  const sym = getSymmetryConfig(docCenter);

  if (tool === 'brush') {
    const baseSize = toolSettings.brushSize;
    const baseHardness = toolSettings.brushHardness / 100;
    const opacity = toolSettings.brushOpacity / 100;
    const brushSpacing = toolSettings.brushSpacing;
    const brushScatter = toolSettings.brushScatter;
    const brushFade = toolSettings.brushFade;
    const sizeJitter = toolSettings.brushSizeJitter / 100;
    const hardnessJitter = toolSettings.brushHardnessJitter / 100;
    const aJ = toolSettings.brushAngleJitter / 100;
    const oJ = toolSettings.brushOpacityJitter / 100;
    const brushTaper = toolSettings.brushTaper;
    const needsPerDab = sizeJitter > 0 || hardnessJitter > 0 || brushTaper > 0;
    const color = strokeColor;
    useToolSettingsStore.getState().addRecentColor(color);
    const r = color.r / 255;
    const g = color.g / 255;
    const b = color.b / 255;
    const spacing = Math.max(1, baseSize * brushSpacing / 100);

    if (shiftLine) {
      if (needsPerDab || brushScatter > 0) {
        // Walk the line with dynamic spacing. Taper shrinks dabs AND spacing
        // so density increases as the brush tapers — matching drag behaviour.
        // Scatter is applied per-dab as a perpendicular offset.
        const ldx = layerPos.x - lineFrom.x;
        const ldy = layerPos.y - lineFrom.y;
        const lineDist = Math.sqrt(ldx * ldx + ldy * ldy);
        if (lineDist > 0) {
          const nx = ldx / lineDist;
          const ny = ldy / lineDist;
          const perpX = -ny;
          const perpY = nx;
          const baseDist = state.strokeDistance ?? 0;
          let walked = spacing - (state.spacingRemainder ?? 0);
          let prevWalked = 0;
          let seed = 12345;
          while (walked <= lineDist) {
            const step = walked - prevWalked;
            prevWalked = walked;
            const cumDist = baseDist + walked;
            const { size: jS, hardness: jH } = advanceJitterWalk(state, step, baseSize, baseHardness, sizeJitter, hardnessJitter);
            let dabSize = jS;
            if (brushTaper > 0) {
              dabSize *= Math.max(0, 1 - cumDist / brushTaper);
              if (dabSize < 0.5) break;
            }
            let px = lineFrom.x + nx * walked;
            let py = lineFrom.y + ny * walked;
            if (brushScatter > 0) {
              seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5;
              const r01 = ((seed >>> 0) % 10000) / 10000;
              const offset = (r01 - 0.5) * 2 * (brushScatter / 100) * dabSize * 2;
              px += perpX * offset;
              py += perpY * offset;
            }
            gpuBrushDab(engine, activeLayerId, px, py, dabSize, jH, r, g, b, color.a, opacity, 1, 0, aJ, oJ);
            for (const mp of getMirroredPoints(px, py, sym)) {
              gpuBrushDab(engine, activeLayerId, mp.x, mp.y, dabSize, jH, r, g, b, color.a, opacity, 1, 0, aJ, oJ);
            }
            const curSpacing = Math.max(1, dabSize * brushSpacing / 100);
            walked += curSpacing;
          }
          state.spacingRemainder = walked - lineDist;
          state.strokeDistance = baseDist + prevWalked;
        }
      } else {
        const { points: pts, remainder: spacingRem } = interpolateWithSpacing(lineFrom, layerPos, spacing, state.spacingRemainder ?? 0);
        state.spacingRemainder = spacingRem;
        if (brushFade > 0) {
          emitFlatDabsWithFade(engine, activeLayerId, pts, baseSize, baseHardness, r, g, b, color.a, opacity, brushFade, state, sym, 0, aJ, oJ);
        } else {
          gpuBrushDabBatch(engine, activeLayerId, pts, baseSize, baseHardness, r, g, b, color.a, opacity, 1, 0, aJ, oJ);
          for (const m of mirrorBatchPoints(pts, sym)) {
            gpuBrushDabBatch(engine, activeLayerId, m, baseSize, baseHardness, r, g, b, color.a, opacity, 1, 0, aJ, oJ);
          }
          const subs = getActiveSubBrushes();
          if (subs.length > 0) emitSubBrushDabs(engine, activeLayerId, pts, baseSize, r, g, b, color.a, opacity, subs, sym);
        }
      }
    } else {
      const fadedOpacity = brushFade > 0 ? opacity * Math.max(0, 1 - (state.strokeDistance ?? 0) / brushFade) : opacity;
      if (fadedOpacity > 0) {
        gpuBrushDab(engine, activeLayerId, layerPos.x, layerPos.y, baseSize, baseHardness, r, g, b, color.a, fadedOpacity, 1, 0, aJ, oJ);
        for (const mp of getMirroredPoints(layerPos.x, layerPos.y, sym)) {
          gpuBrushDab(engine, activeLayerId, mp.x, mp.y, baseSize, baseHardness, r, g, b, color.a, fadedOpacity, 1, 0, aJ, oJ);
        }
        const subs = getActiveSubBrushes();
        if (subs.length > 0) {
          const pts = new Float64Array([layerPos.x, layerPos.y]);
          emitSubBrushDabs(engine, activeLayerId, pts, baseSize, r, g, b, color.a, fadedOpacity, subs, sym);
        }
      }
    }
  } else if (tool === 'pencil') {
    const color = strokeColor;
    useToolSettingsStore.getState().addRecentColor(color);
    const size = toolSettings.pencilSize;
    gpuDrawPencilLine(engine, activeLayerId,
      lineFrom.x, lineFrom.y, layerPos.x, layerPos.y,
      color.r / 255, color.g / 255, color.b / 255, color.a, size);
    if (isSymmetryActive(sym)) {
      const mFrom = getMirroredPoints(lineFrom.x, lineFrom.y, sym);
      const mTo = getMirroredPoints(layerPos.x, layerPos.y, sym);
      for (let i = 0; i < mFrom.length; i++) {
        gpuDrawPencilLine(engine, activeLayerId,
          mFrom[i]!.x, mFrom[i]!.y, mTo[i]!.x, mTo[i]!.y,
          color.r / 255, color.g / 255, color.b / 255, color.a, size);
      }
    }
  } else {
    const size = toolSettings.eraserSize;
    const hardness = 0.8;
    const opacity = toolSettings.eraserOpacity / 100;

    if (shiftLine) {
      const spacing = Math.max(1, size * 0.25);
      const { points: pts, remainder: spacingRem } = interpolateWithSpacing(lineFrom, layerPos, spacing, state.spacingRemainder ?? 0);
      state.spacingRemainder = spacingRem;
      gpuEraserDabBatch(engine, activeLayerId, pts, size, hardness, opacity);
      for (const m of mirrorBatchPoints(pts, sym)) {
        gpuEraserDabBatch(engine, activeLayerId, m, size, hardness, opacity);
      }
    } else {
      gpuEraserDab(engine, activeLayerId, layerPos.x, layerPos.y, size, hardness, opacity);
      for (const mp of getMirroredPoints(layerPos.x, layerPos.y, sym)) {
        gpuEraserDab(engine, activeLayerId, mp.x, mp.y, size, hardness, opacity);
      }
    }
  }

  editorState.notifyRender();
  return state;
}

interface InterpolateResult {
  points: Float64Array;
  remainder: number;
}

/**
 * Flatten two Points into a flat [x,y,...] array for the WASM batch API.
 * Tracks spacing remainder across move events via the returned value.
 * Returns empty points when no dabs are due.
 */
function interpolateWithSpacing(
  from: { x: number; y: number },
  to: { x: number; y: number },
  spacing: number,
  prevRemainder: number,
): InterpolateResult {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1e-6) return { points: new Float64Array(0), remainder: prevRemainder };

  const startOffset = spacing - prevRemainder;
  if (startOffset > dist) {
    return { points: new Float64Array(0), remainder: prevRemainder + dist };
  }

  const pts: number[] = [];
  let d = startOffset;
  while (d <= dist) {
    const t = d / dist;
    pts.push(from.x + dx * t, from.y + dy * t);
    d += spacing;
  }
  return { points: new Float64Array(pts), remainder: dist - (d - spacing) };
}

/**
 * Emit individual brush dabs from a flat [x,y,...] array, applying per-dab
 * fade based on cumulative stroke distance. Updates state.strokeDistance.
 */
function emitFlatDabsWithFade(
  engine: ReturnType<typeof getEngine>,
  layerId: string,
  pts: Float64Array,
  size: number,
  hardness: number,
  r: number, g: number, b: number, a: number,
  baseOpacity: number,
  fadeDistance: number,
  state: InteractionState,
  sym: SymmetryConfig,
  sJ = 0, aJ = 0, oJ = 0,
): void {
  if (!engine) return;
  let dist = state.strokeDistance ?? 0;
  let prevX = state.lastPoint?.x ?? 0;
  let prevY = state.lastPoint?.y ?? 0;

  for (let i = 0; i < pts.length; i += 2) {
    const px = pts[i]!;
    const py = pts[i + 1]!;
    const dx = px - prevX;
    const dy = py - prevY;
    dist += Math.sqrt(dx * dx + dy * dy);
    prevX = px;
    prevY = py;

    if (dist >= fadeDistance) {
      state.strokeDistance = dist;
      return;
    }

    const fadeFactor = Math.max(0, 1 - dist / fadeDistance);
    const fadedOp = baseOpacity * fadeFactor;
    gpuBrushDab(engine, layerId, px, py, size, hardness, r, g, b, a, fadedOp, 1, sJ, aJ, oJ);
    for (const mp of getMirroredPoints(px, py, sym)) {
      gpuBrushDab(engine, layerId, mp.x, mp.y, size, hardness, r, g, b, a, fadedOp, 1, sJ, aJ, oJ);
    }
  }
  state.strokeDistance = dist;
}

/**
 * Emit individual brush dabs from a Point array (scatter path), applying
 * per-dab fade. Uses approximate distance along the original from→to segment.
 */
function emitDabsWithFade(
  engine: ReturnType<typeof getEngine>,
  layerId: string,
  points: Array<{ x: number; y: number }>,
  from: { x: number; y: number },
  size: number,
  hardness: number,
  r: number, g: number, b: number, a: number,
  baseOpacity: number,
  fadeDistance: number,
  state: InteractionState,
  sym: SymmetryConfig,
  sJ = 0, aJ = 0, oJ = 0,
): void {
  if (!engine) return;
  let dist = state.strokeDistance ?? 0;
  let prevX = from.x;
  let prevY = from.y;

  for (const pt of points) {
    const dx = pt.x - prevX;
    const dy = pt.y - prevY;
    dist += Math.sqrt(dx * dx + dy * dy);
    prevX = pt.x;
    prevY = pt.y;

    if (dist >= fadeDistance) {
      state.strokeDistance = dist;
      return;
    }

    const fadeFactor = Math.max(0, 1 - dist / fadeDistance);
    const fadedOp = baseOpacity * fadeFactor;
    gpuBrushDab(engine, layerId, pt.x, pt.y, size, hardness, r, g, b, a, fadedOp, 1, sJ, aJ, oJ);
    for (const mp of getMirroredPoints(pt.x, pt.y, sym)) {
      gpuBrushDab(engine, layerId, mp.x, mp.y, size, hardness, r, g, b, a, fadedOp, 1, sJ, aJ, oJ);
    }
  }
  state.strokeDistance = dist;
}

function advanceJitterWalk(
  state: InteractionState,
  dist: number,
  baseSize: number,
  baseHardness: number,
  sizeJitter: number,
  hardnessJitter: number,
): { size: number; hardness: number } {
  let size = baseSize;
  if (sizeJitter > 0) {
    if (state.sizeJitterTarget === undefined || (state.sizeJitterDistTraveled ?? 0) >= (state.sizeJitterTransitionDist ?? 0)) {
      state.sizeJitterPrevTarget = state.sizeJitterCurrent ?? 1;
      state.sizeJitterTarget = Math.random();
      state.sizeJitterTransitionDist = 30 + Math.random() * 90;
      state.sizeJitterDistTraveled = 0;
    }
    state.sizeJitterDistTraveled = (state.sizeJitterDistTraveled ?? 0) + dist;
    const t = Math.min((state.sizeJitterDistTraveled ?? 0) / (state.sizeJitterTransitionDist ?? 1), 1);
    const smoothT = t * t * (3 - 2 * t);
    const current = (state.sizeJitterPrevTarget ?? 1) + ((state.sizeJitterTarget ?? 1) - (state.sizeJitterPrevTarget ?? 1)) * smoothT;
    state.sizeJitterCurrent = current;
    size = Math.max(1, baseSize * (1 - sizeJitter * (1 - current)));
  }

  let hardness = baseHardness;
  if (hardnessJitter > 0) {
    if (state.hardnessJitterTarget === undefined || (state.hardnessJitterDistTraveled ?? 0) >= (state.hardnessJitterTransitionDist ?? 0)) {
      state.hardnessJitterPrevTarget = state.hardnessJitterCurrent ?? 1;
      state.hardnessJitterTarget = Math.random();
      state.hardnessJitterTransitionDist = 80 + Math.random() * 200;
      state.hardnessJitterDistTraveled = 0;
    }
    state.hardnessJitterDistTraveled = (state.hardnessJitterDistTraveled ?? 0) + dist;
    const t = Math.min((state.hardnessJitterDistTraveled ?? 0) / (state.hardnessJitterTransitionDist ?? 1), 1);
    const smoothT = t * t * (3 - 2 * t);
    const current = (state.hardnessJitterPrevTarget ?? 1) + ((state.hardnessJitterTarget ?? 1) - (state.hardnessJitterPrevTarget ?? 1)) * smoothT;
    state.hardnessJitterCurrent = current;
    hardness = Math.max(0, baseHardness * (1 - hardnessJitter * (1 - current)));
  }

  return { size, hardness };
}

export function handlePaintMove(
  ctx: InteractionContext,
  state: InteractionState,
): void {
  if (!state.lastPoint || !state.layerId) return;

  const toolSettings = useToolSettingsStore.getState();
  const layerLocalPos = ctx.layerPos;

  // Mask modes: quick mask and layer mask both route to GPU
  if (state.maskMode) {
    const maskTarget: MaskTarget = useUIStore.getState().maskMode === 'quickMask' ? 'quickMask' : 'layerMask';
    const engine = getEngine();
    if (!engine) return;
    const maskPos = maskTarget === 'quickMask' ? ctx.canvasPos : layerLocalPos;
    handleMaskPaintMoveUnified(engine, state, maskPos, toolSettings, maskTarget);
    return;
  }

  const engine = getEngine();
  if (!engine) return;

  const symCenter = state.symmetryCenter ?? ctx.layerPos;
  const sym = getSymmetryConfig(symCenter);

  switch (state.tool) {
    case 'brush': {
      const baseSize = toolSettings.brushSize;
      const baseHardness = toolSettings.brushHardness / 100;
      const opacity = toolSettings.brushOpacity / 100;
      const brushScatter = toolSettings.brushScatter;
      const brushFade = toolSettings.brushFade;
      const sizeJitter = toolSettings.brushSizeJitter / 100;
      const hardnessJitter = toolSettings.brushHardnessJitter / 100;
      const aJ = toolSettings.brushAngleJitter / 100;
      const oJ = toolSettings.brushOpacityJitter / 100;
      const speedSize = toolSettings.brushSpeedSize / 100;
      const color = state.strokeColor ?? useToolSettingsStore.getState().foregroundColor;
      const r = color.r / 255;
      const g = color.g / 255;
      const b = color.b / 255;

      const dx = layerLocalPos.x - state.lastPoint.x;
      const dy = layerLocalPos.y - state.lastPoint.y;
      const segDist = Math.sqrt(dx * dx + dy * dy);

      let size = baseSize;

      // Speed-based size: moving-average speed → smoothed size transition
      if (speedSize > 0) {
        const now = performance.now();
        const dt = now - (state.lastPointTime ?? now);
        const rawSpeed = dt > 0 ? segDist / dt : 0;
        const maxSpeed = 5;
        const normalizedSpeed = Math.min(rawSpeed / maxSpeed, 1);

        const maWindow = toolSettings.brushSpeedSensitivity === 'high' ? 2
          : toolSettings.brushSpeedSensitivity === 'low' ? 6 : 3;
        if (!state.speedHistory) state.speedHistory = [];
        state.speedHistory.push(normalizedSpeed);
        if (state.speedHistory.length > maWindow) state.speedHistory.shift();

        const avgSpeed = state.speedHistory.reduce((a, b) => a + b, 0) / state.speedHistory.length;

        const invert = toolSettings.brushSpeedSizeInvert;
        const targetScale = invert
          ? 1 + speedSize * avgSpeed
          : 1 - speedSize * avgSpeed;

        const prev = state.speedSizeCurrent ?? 1;
        const blend = 0.25;
        const current = prev + (targetScale - prev) * blend;
        state.speedSizeCurrent = current;
        state.lastPointTime = now;

        size = Math.max(1, size * current);
      }

      const jittered = advanceJitterWalk(state, segDist, size, baseHardness, sizeJitter, hardnessJitter);
      size = jittered.size;
      const hardness = jittered.hardness;

      // Taper: shrink brush size to zero over taperDistance
      const brushTaper = toolSettings.brushTaper;
      if (brushTaper > 0) {
        const taperFactor = Math.max(0, 1 - (state.strokeDistance ?? 0) / brushTaper);
        size = size * taperFactor;
        if (size < 0.5) {
          state.lastPoint = layerLocalPos;
          break;
        }
      }

      const spacing = Math.max(1, size * toolSettings.brushSpacing / 100);

      if (brushFade > 0 && (state.strokeDistance ?? 0) >= brushFade) {
        state.lastPoint = layerLocalPos;
        break;
      }

      if (brushScatter > 0) {
        const scatterPts = interpolatePointsWithScatter(state.lastPoint, layerLocalPos, spacing, brushScatter, size);
        if (brushFade > 0) {
          emitDabsWithFade(engine, state.layerId, scatterPts, state.lastPoint, size, hardness, r, g, b, color.a, opacity, brushFade, state, sym, 0, aJ, oJ);
        } else {
          const pts = new Float64Array(scatterPts.length * 2);
          for (let i = 0; i < scatterPts.length; i++) {
            pts[i * 2] = scatterPts[i]!.x;
            pts[i * 2 + 1] = scatterPts[i]!.y;
          }
          gpuBrushDabBatch(engine, state.layerId, pts, size, hardness, r, g, b, color.a, opacity, 1, 0, aJ, oJ);
          for (const m of mirrorBatchPoints(pts, sym)) {
            gpuBrushDabBatch(engine, state.layerId, m, size, hardness, r, g, b, color.a, opacity, 1, 0, aJ, oJ);
          }
          const subs = getActiveSubBrushes();
          if (subs.length > 0) emitSubBrushDabs(engine, state.layerId, pts, size, r, g, b, color.a, opacity, subs, sym);
        }
      } else {
        const { points: pts, remainder: spacingRem } = interpolateWithSpacing(state.lastPoint, layerLocalPos, spacing, state.spacingRemainder ?? 0);
        state.spacingRemainder = spacingRem;
        if (brushFade > 0) {
          emitFlatDabsWithFade(engine, state.layerId, pts, size, hardness, r, g, b, color.a, opacity, brushFade, state, sym, 0, aJ, oJ);
        } else {
          gpuBrushDabBatch(engine, state.layerId, pts, size, hardness, r, g, b, color.a, opacity, 1, 0, aJ, oJ);
          for (const m of mirrorBatchPoints(pts, sym)) {
            gpuBrushDabBatch(engine, state.layerId, m, size, hardness, r, g, b, color.a, opacity, 1, 0, aJ, oJ);
          }
          const subs2 = getActiveSubBrushes();
          if (subs2.length > 0) emitSubBrushDabs(engine, state.layerId, pts, size, r, g, b, color.a, opacity, subs2, sym);
        }
      }

      // Update stroke distance for non-fade path (fade helpers update it internally)
      if (brushFade <= 0) {
        const sdx = layerLocalPos.x - state.lastPoint.x;
        const sdy = layerLocalPos.y - state.lastPoint.y;
        state.strokeDistance = (state.strokeDistance ?? 0) + Math.sqrt(sdx * sdx + sdy * sdy);
      }
      // Record point for hold-to-smooth
      if (state.strokePoints) {
        state.strokePoints.push({ x: layerLocalPos.x, y: layerLocalPos.y });
      }
      state.lastPoint = layerLocalPos;
      useEditorStore.getState().notifyRender();
      break;
    }

    case 'pencil': {
      const color = state.strokeColor ?? useToolSettingsStore.getState().foregroundColor;
      const size = toolSettings.pencilSize;
      gpuDrawPencilLine(engine, state.layerId,
        state.lastPoint.x, state.lastPoint.y, layerLocalPos.x, layerLocalPos.y,
        color.r / 255, color.g / 255, color.b / 255, color.a, size);
      if (isSymmetryActive(sym)) {
        const mFrom = getMirroredPoints(state.lastPoint.x, state.lastPoint.y, sym);
        const mTo = getMirroredPoints(layerLocalPos.x, layerLocalPos.y, sym);
        for (let i = 0; i < mFrom.length; i++) {
          gpuDrawPencilLine(engine, state.layerId,
            mFrom[i]!.x, mFrom[i]!.y, mTo[i]!.x, mTo[i]!.y,
            color.r / 255, color.g / 255, color.b / 255, color.a, size);
        }
      }
      state.lastPoint = layerLocalPos;
      useEditorStore.getState().notifyRender();
      break;
    }

    case 'eraser': {
      const size = toolSettings.eraserSize;
      const hardness = 0.8;
      const opacity = toolSettings.eraserOpacity / 100;
      const spacing = Math.max(1, size * 0.25);
      const { points: pts, remainder: spacingRem } = interpolateWithSpacing(state.lastPoint, layerLocalPos, spacing, state.spacingRemainder ?? 0);
      state.spacingRemainder = spacingRem;
      gpuEraserDabBatch(engine, state.layerId, pts, size, hardness, opacity);
      for (const m of mirrorBatchPoints(pts, sym)) {
        gpuEraserDabBatch(engine, state.layerId, m, size, hardness, opacity);
      }
      state.lastPoint = layerLocalPos;
      useEditorStore.getState().notifyRender();
      break;
    }

    default:
      break;
  }
}

/** GPU mask painting — brush/eraser/pencil on the layer mask texture. */
type MaskTarget = 'layerMask' | 'quickMask';

function handleMaskPaintMoveUnified(
  engine: Engine,
  state: InteractionState,
  pos: { x: number; y: number },
  toolSettings: ReturnType<typeof useToolSettingsStore.getState>,
  target: MaskTarget,
): void {
  if (!state.lastPoint) return;

  const isQuickMask = target === 'quickMask';
  const mode = isQuickMask
    ? (state.tool === 'eraser' ? 1 : 0)
    : (state.tool === 'eraser' ? 0 : 1);

  const emitDabs = (size: number, hardness: number, opacity: number) => {
    const spacing = Math.max(1, size * 0.25);
    const pts = interpolatePoints(state.lastPoint!, pos, spacing);
    const arr = new Float64Array(pts.length * 2);
    for (let i = 0; i < pts.length; i++) {
      arr[i * 2] = pts[i]!.x;
      arr[i * 2 + 1] = pts[i]!.y;
    }
    if (isQuickMask) {
      gpuQuickMaskDabBatch(engine, arr, size, hardness, opacity, mode);
    } else {
      gpuMaskDabBatch(engine, state.layerId!, arr, size, hardness, opacity, mode);
    }
  };

  switch (state.tool) {
    case 'brush':
      emitDabs(toolSettings.brushSize, toolSettings.brushHardness / 100, toolSettings.brushOpacity / 100);
      break;
    case 'pencil': {
      const size = toolSettings.pencilSize;
      if (isQuickMask) {
        gpuQuickMaskPencil(engine, state.lastPoint.x, state.lastPoint.y, pos.x, pos.y, 1, 1, 1, 1, size, mode);
      } else {
        gpuMaskPencilLine(engine, state.layerId!, state.lastPoint.x, state.lastPoint.y, pos.x, pos.y, 1.0, size, mode);
      }
      break;
    }
    case 'eraser':
      emitDabs(toolSettings.eraserSize, 0.8, toolSettings.eraserOpacity / 100);
      break;
    default:
      break;
  }

  state.lastPoint = pos;
  useEditorStore.getState().notifyRender();
}
