/**
 * Engine sync — bridges Zustand store state to the WASM/WebGL engine.
 *
 * Tracks what has already been sent to the engine and only pushes
 * deltas each frame to avoid redundant GPU uploads.
 *
 * The hot path (syncLayers + descriptor serialization) lives in
 * ./sync-layers.ts, and the shared per-engine tracked state lives in
 * ./sync-state.ts. This file re-exports their public surface so
 * consumers only need to import from `engine-sync`.
 */

import type { Engine } from './wasm-bridge';
import { getEngine } from './engine-state';
import type { Layer } from '../types';
import type { ImageAdjustments } from '../filters/image-adjustments';
import { buildCurvesLutRgba, isIdentityCurves } from '../filters/curves';
import { buildLevelsLutRgba, isIdentityLevels } from '../filters/levels';
import {
  setDocumentSize,
  setViewport,
  setBackgroundColor,
  render,
  markAllDirty,
  setSelectionMask,
  clearSelection,
  setGridVisible,
  setGridSize,
  setRulersVisible,
  setImageExposure,
  setImageContrast,
  setImageHighlights,
  setImageShadows,
  setImageWhites,
  setImageBlacks,
  setImageVignette,
  setImageSaturation,
  setImageVibrance,
  setImageCurvesLut,
  clearImageCurves,
  setImageLevelsLut,
  clearImageLevels,
  clearImageAdjustments,
  setGroupAdjustments,
  setGroupCurvesLut,
  setGroupLevelsLut,
  clearGroupAdjustments,
  setSeamlessPattern,
  setLassoPreview,
  setPathOverlay,
  setCropPreview,
  clearCropPreview,
  setGradientGuide,
  clearGradientGuide,
  setBrushCursor,
  clearBrushCursor,
  setTransformOverlay,
  setMaskEditLayer,
  clearMaskEditLayer,
  uploadBrushTip,
  clearBrushTip,
  setBrushTipState,
} from './wasm-bridge';
import type { PathAnchor } from '../app/ui-store';
import type { SelectionData } from '../app/store/types';
import type { BrushTipData } from '../types/brush';
import { getTracked } from './sync-state';
import { syncLayers } from './sync-layers';

export { resetTrackedState, markPixelDataSynced } from './sync-state';
export { syncLayers } from './sync-layers';

export function syncDocumentSize(engine: Engine, width: number, height: number): void {
  const tracked = getTracked(engine);
  if (tracked.docWidth === width && tracked.docHeight === height) return;
  setDocumentSize(engine, width, height);
  tracked.docWidth = width;
  tracked.docHeight = height;
}

export function syncBackgroundColor(engine: Engine, r: number, g: number, b: number, a: number): void {
  const tracked = getTracked(engine);
  const key = `${r},${g},${b},${a}`;
  if (tracked.bgColor === key) return;
  setBackgroundColor(engine, r / 255, g / 255, b / 255, a);
  tracked.bgColor = key;
}

export function syncViewport(
  engine: Engine,
  zoom: number,
  panX: number,
  panY: number,
  screenW: number,
  screenH: number,
): void {
  const tracked = getTracked(engine);
  if (
    tracked.viewportZoom === zoom &&
    tracked.viewportPanX === panX &&
    tracked.viewportPanY === panY &&
    tracked.viewportWidth === screenW &&
    tracked.viewportHeight === screenH
  ) return;
  setViewport(engine, zoom, panX, panY, screenW, screenH);
  tracked.viewportZoom = zoom;
  tracked.viewportPanX = panX;
  tracked.viewportPanY = panY;
  tracked.viewportWidth = screenW;
  tracked.viewportHeight = screenH;
}

export function syncSelection(engine: Engine, selection: SelectionData): void {
  const tracked = getTracked(engine);
  if (selection.active && selection.mask) {
    if (tracked.selectionMask !== selection.mask) {
      const bytes = new Uint8Array(selection.mask.buffer, selection.mask.byteOffset, selection.mask.byteLength);
      setSelectionMask(engine, bytes, selection.maskWidth, selection.maskHeight);
      tracked.selectionMask = selection.mask;
      tracked.selectionActive = true;
    }
  } else if (tracked.selectionActive) {
    clearSelection(engine);
    tracked.selectionActive = false;
    tracked.selectionMask = null;
  }
}

export function syncGrid(engine: Engine, showGrid: boolean, gridSize: number): void {
  const tracked = getTracked(engine);
  if (tracked.showGrid !== showGrid) {
    setGridVisible(engine, showGrid);
    tracked.showGrid = showGrid;
  }
  if (tracked.gridSize !== gridSize) {
    setGridSize(engine, gridSize);
    tracked.gridSize = gridSize;
  }
}

export function syncRulers(engine: Engine, showRulers: boolean): void {
  const tracked = getTracked(engine);
  if (tracked.showRulers !== showRulers) {
    setRulersVisible(engine, showRulers);
    tracked.showRulers = showRulers;
  }
}

export function syncSeamlessPattern(engine: Engine, show: boolean, dim: boolean): void {
  const tracked = getTracked(engine);
  if (tracked.showSeamlessPattern !== show || tracked.dimSeamlessPattern !== dim) {
    setSeamlessPattern(engine, show, dim);
    tracked.showSeamlessPattern = show;
    tracked.dimSeamlessPattern = dim;
  }
}

export function syncAdjustments(engine: Engine, adjustments: ImageAdjustments, enabled: boolean): void {
  const tracked = getTracked(engine);
  if (!enabled) {
    clearImageAdjustments(engine);
    tracked.curvesIdentity = null;
    tracked.curvesRef = null;
    tracked.levelsIdentity = null;
    tracked.levelsRef = null;
    return;
  }
  setImageExposure(engine, adjustments.exposure);
  setImageContrast(engine, adjustments.contrast);
  setImageHighlights(engine, adjustments.highlights);
  setImageShadows(engine, adjustments.shadows);
  setImageWhites(engine, adjustments.whites);
  setImageBlacks(engine, adjustments.blacks);
  setImageVignette(engine, adjustments.vignette);
  setImageSaturation(engine, adjustments.saturation);
  setImageVibrance(engine, adjustments.vibrance);

  // Levels: build the 256x4 RGBA LUT and upload only when the values
  // changed (reference equality on the levels object).
  const levels = adjustments.levels;
  if (!levels || isIdentityLevels(levels)) {
    if (tracked.levelsIdentity !== true) {
      clearImageLevels(engine);
      tracked.levelsIdentity = true;
      tracked.levelsRef = null;
    }
  } else if (tracked.levelsRef !== levels) {
    const lut = buildLevelsLutRgba(levels);
    setImageLevelsLut(engine, lut);
    tracked.levelsRef = levels;
    tracked.levelsIdentity = false;
  }

  // Curves: build the 256x4 RGBA LUT and upload only when the points
  // changed (cheap identity check via reference equality on the curves
  // object held in the document model).
  const curves = adjustments.curves;
  if (!curves || isIdentityCurves(curves)) {
    if (tracked.curvesIdentity !== true) {
      clearImageCurves(engine);
      tracked.curvesIdentity = true;
      tracked.curvesRef = null;
    }
  } else if (tracked.curvesRef !== curves) {
    const lut = buildCurvesLutRgba(curves);
    setImageCurvesLut(engine, lut);
    tracked.curvesRef = curves;
    tracked.curvesIdentity = false;
  }
}

export function syncGroupAdjustments(engine: Engine, layers: readonly Layer[]): void {
  clearGroupAdjustments(engine);
  for (const layer of layers) {
    if (layer.type !== 'group') continue;
    const group = layer as import('../types').GroupLayer;
    if (!group.adjustmentsEnabled || !group.adjustments) continue;
    const adj = group.adjustments;
    const hasCurves = adj.curves && !isIdentityCurves(adj.curves);
    const hasLevels = adj.levels && !isIdentityLevels(adj.levels);
    const hasAny =
      Math.abs(adj.exposure) > 1e-6 ||
      Math.abs(adj.contrast) > 1e-6 ||
      Math.abs(adj.highlights) > 1e-6 ||
      Math.abs(adj.shadows) > 1e-6 ||
      Math.abs(adj.whites) > 1e-6 ||
      Math.abs(adj.blacks) > 1e-6 ||
      Math.abs(adj.saturation) > 1e-6 ||
      Math.abs(adj.vibrance) > 1e-6 ||
      hasCurves ||
      hasLevels;
    if (!hasAny) continue;
    setGroupAdjustments(
      engine,
      group.id,
      JSON.stringify(group.children),
      adj.exposure,
      adj.contrast,
      adj.highlights,
      adj.shadows,
      adj.whites,
      adj.blacks,
      adj.saturation,
      adj.vibrance,
    );
    if (hasCurves) {
      const lut = buildCurvesLutRgba(adj.curves!);
      setGroupCurvesLut(engine, group.id, lut);
    }
    if (hasLevels) {
      const lut = buildLevelsLutRgba(adj.levels!);
      setGroupLevelsLut(engine, group.id, lut);
    }
  }
}

export function syncMaskEditMode(engine: Engine, maskEditMode: boolean, activeLayerId: string | null): void {
  if (maskEditMode && activeLayerId) {
    setMaskEditLayer(engine, activeLayerId);
  } else {
    clearMaskEditLayer(engine);
  }
}

export function syncOverlays(
  engine: Engine,
  pathAnchors: PathAnchor[],
  lassoPoints: { x: number; y: number }[],
  cropRect: { x: number; y: number; width: number; height: number } | null,
  gradientPreview: { start: { x: number; y: number }; end: { x: number; y: number } } | null,
  transform: { x: number; y: number; width: number; height: number } | null,
  brushCursor: { x: number; y: number; radius: number } | null,
): void {
  // Path overlay
  if (pathAnchors.length > 0) {
    setPathOverlay(engine, JSON.stringify(pathAnchors));
  } else {
    setPathOverlay(engine, null);
  }

  // Lasso preview
  if (lassoPoints.length > 1) {
    const flat = new Float64Array(lassoPoints.length * 2);
    for (let i = 0; i < lassoPoints.length; i++) {
      const pt = lassoPoints[i];
      if (pt) {
        flat[i * 2] = pt.x;
        flat[i * 2 + 1] = pt.y;
      }
    }
    setLassoPreview(engine, flat);
  } else {
    setLassoPreview(engine, null);
  }

  // Crop preview
  if (cropRect) {
    setCropPreview(engine, cropRect.x, cropRect.y, cropRect.width, cropRect.height);
  } else {
    clearCropPreview(engine);
  }

  // Gradient guide
  if (gradientPreview) {
    setGradientGuide(engine, gradientPreview.start.x, gradientPreview.start.y, gradientPreview.end.x, gradientPreview.end.y);
  } else {
    clearGradientGuide(engine);
  }

  // Transform overlay
  if (transform) {
    setTransformOverlay(engine, JSON.stringify(transform));
  } else {
    setTransformOverlay(engine, null);
  }

  // Brush cursor
  if (brushCursor) {
    setBrushCursor(engine, brushCursor.x, brushCursor.y, brushCursor.radius);
  } else {
    clearBrushCursor(engine);
  }
}

export function syncBrushTip(
  engine: Engine,
  activeBrushTip: BrushTipData | null,
  brushAngle: number,
): void {
  const tracked = getTracked(engine);
  const hasTip = activeBrushTip !== null;
  const tipChanged = tracked.brushTipData !== activeBrushTip;

  if (tipChanged) {
    if (activeBrushTip) {
      const bytes = new Uint8Array(
        activeBrushTip.data.buffer,
        activeBrushTip.data.byteOffset,
        activeBrushTip.data.byteLength,
      );
      uploadBrushTip(engine, bytes, activeBrushTip.width, activeBrushTip.height);
    } else {
      clearBrushTip(engine);
    }
    tracked.brushTipData = activeBrushTip;
  }

  if (tracked.brushHasTip !== hasTip || tracked.brushAngle !== brushAngle) {
    setBrushTipState(engine, hasTip, brushAngle);
    tracked.brushHasTip = hasTip;
    tracked.brushAngle = brushAngle;
  }
}

export function renderEngine(engine: Engine): void {
  render(engine);
}

export function markAllLayersDirty(engine: Engine): void {
  markAllDirty(engine);
}

/**
 * Flush any pending JS pixel data to the GPU immediately.
 * Called before undo snapshots to ensure the GPU (single source of truth)
 * has current data. Without this, pushHistory would read stale GPU textures
 * if JS pixel data hadn't been synced yet via the rAF loop.
 */
export function flushLayerSync(state: {
  document: { layers: readonly Layer[]; layerOrder: readonly string[] };
  dirtyLayerIds: Set<string>;
}): void {
  const engine = getEngine();
  if (!engine) return;
  syncLayers(engine, state.document.layers, state.document.layerOrder, state.dirtyLayerIds);
}
