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
import type { GradientStop } from '../tools/gradient/gradient';
import type { ImageAdjustments } from '../filters/image-adjustments';
import { buildCurvesLutRgba, isIdentityCurves } from '../filters/curves';
import { buildLevelsLutRgba, isIdentityLevels } from '../filters/levels';
import { nodesToLegacyAdjustments } from '../filters/adjustment-node-utils';
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
  setImageInvert,
  setImageHueSaturation,
  setImageColorBalance,
  setImagePhotoFilter,
  setImageBlackWhite,
  clearImageBlackWhite,
  setImageChannelMixer,
  clearImageChannelMixer,
  setImageGradientMapLut,
  clearImageGradientMap,
  setGroupAdjustments,
  setGroupCurvesLut,
  setGroupLevelsLut,
  clearGroupAdjustments,
  removeGroupAdjustment,
  setGroupInvert,
  setGroupHueSaturation,
  setGroupColorBalance,
  setGroupPhotoFilter,
  setGroupBlackWhite,
  setGroupChannelMixer,
  setGroupGradientMapLut,
  setSeamlessPattern,
  setChannelMask,
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
  uploadBrushTipRGBA,
  clearBrushTip,
  setBrushTipState,
  cacheSubBrushTip,
  cacheSubBrushTipRGBA,
  activateSubBrushTip as wasmActivateSubBrushTip,
  deactivateSubBrushTip as wasmDeactivateSubBrushTip,
  clearSubBrushTipCache,
  uploadBrushTexture,
  clearBrushTexture,
  setBrushTextureState,
  setTextLayerContent,
  renderTextLayer,
  getRenderedTextPixels,
  uploadLayerPixels,
} from './wasm-bridge';
import type { PathAnchor, TextEditingState, ChannelVisibility } from '../app/ui-store';
import type { SelectionData } from '../app/store/types';
import type { BrushTipData, BrushTextureData, BrushTextureBlendMode, SubBrush } from '../types/brush';
import type { Color } from '../types';
import type { TextLayer } from '../types/layers';
import type { StoredPath } from '../types/paths';
import { renderTextOnPath } from '../tools/text/render-text-on-path';
import { getTracked } from './sync-state';
import { syncLayers } from './sync-layers';

export { resetTrackedState } from './sync-state';
export { syncLayers } from './sync-layers';

function buildGradientMapLut(
  stops: readonly GradientStop[],
): Uint8Array {
  const lut = new Uint8Array(256 * 4);
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let lo = sorted[0]!;
    let hi = sorted[sorted.length - 1]!;
    for (let j = 0; j < sorted.length - 1; j++) {
      if (t >= sorted[j]!.position && t <= sorted[j + 1]!.position) {
        lo = sorted[j]!;
        hi = sorted[j + 1]!;
        break;
      }
    }
    const span = hi.position - lo.position;
    const f = span > 1e-6 ? Math.max(0, Math.min(1, (t - lo.position) / span)) : 0;
    lut[i * 4 + 0] = Math.round(lo.color.r + (hi.color.r - lo.color.r) * f);
    lut[i * 4 + 1] = Math.round(lo.color.g + (hi.color.g - lo.color.g) * f);
    lut[i * 4 + 2] = Math.round(lo.color.b + (hi.color.b - lo.color.b) * f);
    lut[i * 4 + 3] = 255;
  }
  return lut;
}

export function invalidatePathTextCache(layerId: string): void {
  const engine = getEngine();
  if (!engine) return;
  const tracked = getTracked(engine);
  tracked.pathTextKeys?.delete(layerId);
}

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

export function syncSeamlessPattern(engine: Engine, show: boolean, dim: boolean, wrap: boolean): void {
  const tracked = getTracked(engine);
  if (
    tracked.showSeamlessPattern !== show
    || tracked.dimSeamlessPattern !== dim
    || tracked.wrapSeamlessPattern !== wrap
  ) {
    setSeamlessPattern(engine, show, dim, wrap);
    tracked.showSeamlessPattern = show;
    tracked.dimSeamlessPattern = dim;
    tracked.wrapSeamlessPattern = wrap;
  }
}

export function syncChannelVisibility(engine: Engine, channelVisibility: ChannelVisibility): void {
  const tracked = getTracked(engine);
  const r = channelVisibility.r ? 1.0 : 0.0;
  const g = channelVisibility.g ? 1.0 : 0.0;
  const b = channelVisibility.b ? 1.0 : 0.0;
  const a = channelVisibility.a ? 1.0 : 0.0;
  const key = `${r},${g},${b},${a}`;
  if (tracked.channelMask === key) return;
  setChannelMask(engine, r, g, b, a);
  tracked.channelMask = key;
}

export function syncAdjustments(engine: Engine, adjustments: ImageAdjustments, enabled: boolean): void {
  const tracked = getTracked(engine);
  if (!enabled) {
    if (tracked.adjustmentsCleared === true) return;
    clearImageAdjustments(engine);
    tracked.adjustmentsCleared = true;
    tracked.adjustmentsRef = null;
    tracked.curvesIdentity = null;
    tracked.curvesRef = null;
    tracked.levelsIdentity = null;
    tracked.levelsRef = null;
    return;
  }

  // The UI store replaces the adjustments object wholesale on every edit, so
  // an unchanged reference means nothing below can produce a different
  // result — skip all the setters (each one dirties the engine and would
  // defeat the needs_recomposite frame gate on every cursor-move frame).
  if (tracked.adjustmentsCleared === false && tracked.adjustmentsRef === adjustments) return;
  tracked.adjustmentsCleared = false;
  tracked.adjustmentsRef = adjustments;

  setImageExposure(engine, adjustments.exposure);
  setImageContrast(engine, adjustments.contrast);
  setImageHighlights(engine, adjustments.highlights);
  setImageShadows(engine, adjustments.shadows);
  setImageWhites(engine, adjustments.whites);
  setImageBlacks(engine, adjustments.blacks);
  setImageVignette(engine, adjustments.vignette);
  setImageSaturation(engine, adjustments.saturation);
  setImageVibrance(engine, adjustments.vibrance);

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

  // New effects
  setImageInvert(engine, adjustments.invert ?? false);

  const hs = adjustments;
  setImageHueSaturation(engine, hs.hueSatHue ?? 0, hs.hueSatSaturation ?? 0, hs.hueSatLightness ?? 0);

  const cbS = adjustments.colorBalanceShadows    ?? [0, 0, 0];
  const cbM = adjustments.colorBalanceMidtones   ?? [0, 0, 0];
  const cbH = adjustments.colorBalanceHighlights ?? [0, 0, 0];
  setImageColorBalance(engine, cbS[0], cbS[1], cbS[2], cbM[0], cbM[1], cbM[2], cbH[0], cbH[1], cbH[2]);

  const pfc = adjustments.photoFilterColor ?? { r: 255, g: 160, b: 0 };
  setImagePhotoFilter(engine, pfc.r / 255, pfc.g / 255, pfc.b / 255,
    adjustments.photoFilterDensity ?? 0,
    adjustments.photoFilterPreserveLuminosity !== false,
  );

  if (adjustments.bwEnabled) {
    setImageBlackWhite(engine,
      adjustments.bwReds ?? 40, adjustments.bwYellows ?? 60,
      adjustments.bwGreens ?? 40, adjustments.bwCyans ?? 60,
      adjustments.bwBlues ?? 20, adjustments.bwMagentas ?? 80,
    );
  } else {
    clearImageBlackWhite(engine);
  }

  if (adjustments.channelMixerEnabled) {
    const cmR = adjustments.channelMixerR ?? [100, 0, 0, 0];
    const cmG = adjustments.channelMixerG ?? [0, 100, 0, 0];
    const cmB = adjustments.channelMixerB ?? [0, 0, 100, 0];
    setImageChannelMixer(engine,
      cmR[0], cmR[1], cmR[2], cmR[3],
      cmG[0], cmG[1], cmG[2], cmG[3],
      cmB[0], cmB[1], cmB[2], cmB[3],
    );
  } else {
    clearImageChannelMixer(engine);
  }

  const stops = adjustments.gradientMapStops;
  if (stops && stops.length >= 2) {
    const lut = buildGradientMapLut(stops);
    setImageGradientMapLut(engine, lut);
  } else {
    clearImageGradientMap(engine);
  }
}

/**
 * Walk a group's children recursively and collect every descendant layer ID.
 * Sub-groups are included so the compositor sees both the marker and its
 * contents — the WASM side ignores Group-type entries via a strict layer-type
 * check, so the extra IDs are harmless.
 *
 * The compositor's `child_to_group` map needs every descendant of an adjusted
 * group so all descendants get routed into the group scratch FBO. Sending only
 * direct children causes sub-group descendants to bypass the scratch and
 * render directly onto the composite, where the group's normal-blend finalize
 * later covers them up.
 */
export function flattenGroupDescendants(
  layers: readonly Layer[],
  groupId: string,
): string[] {
  const layerMap = new Map<string, Layer>();
  for (const l of layers) layerMap.set(l.id, l);
  const result: string[] = [];
  const walk = (id: string): void => {
    const layer = layerMap.get(id);
    if (!layer || layer.type !== 'group') return;
    const group = layer as import('../types').GroupLayer;
    for (const childId of group.children) {
      result.push(childId);
      walk(childId);
    }
  };
  walk(groupId);
  return result;
}

function pushGroupToEngine(
  engine: Engine,
  group: import('../types').GroupLayer,
  layers: readonly Layer[],
  precomputedAdj: ReturnType<typeof nodesToLegacyAdjustments> | null,
  cachedChildrenJson: string | undefined,
): string {
  const adj = precomputedAdj;
  const hasCurves = adj?.curves != null && !isIdentityCurves(adj.curves);
  const hasLevels = adj?.levels != null && !isIdentityLevels(adj.levels);

  const childrenJson = cachedChildrenJson ?? JSON.stringify(flattenGroupDescendants(layers, group.id));

  setGroupAdjustments(
    engine,
    group.id,
    childrenJson,
    adj?.exposure ?? 0,
    adj?.contrast ?? 0,
    adj?.highlights ?? 0,
    adj?.shadows ?? 0,
    adj?.whites ?? 0,
    adj?.blacks ?? 0,
    adj?.saturation ?? 0,
    adj?.vibrance ?? 0,
    adj?.vignette ?? 0,
  );
  if (hasCurves && adj?.curves) {
    const lut = buildCurvesLutRgba(adj.curves);
    setGroupCurvesLut(engine, group.id, lut);
  }
  if (hasLevels && adj?.levels) {
    const lut = buildLevelsLutRgba(adj.levels);
    setGroupLevelsLut(engine, group.id, lut);
  }
  if (adj?.invert) setGroupInvert(engine, group.id, true);
  const hh = adj?.hueSatHue ?? 0, hs2 = adj?.hueSatSaturation ?? 0, hl = adj?.hueSatLightness ?? 0;
  if (Math.abs(hh) > 1e-6 || Math.abs(hs2) > 1e-6 || Math.abs(hl) > 1e-6) {
    setGroupHueSaturation(engine, group.id, hh, hs2, hl);
  }
  const cbS = adj?.colorBalanceShadows    ?? [0, 0, 0];
  const cbM = adj?.colorBalanceMidtones   ?? [0, 0, 0];
  const cbH = adj?.colorBalanceHighlights ?? [0, 0, 0];
  if ([...cbS, ...cbM, ...cbH].some(v => Math.abs(v) > 1e-6)) {
    setGroupColorBalance(engine, group.id, cbS[0], cbS[1], cbS[2], cbM[0], cbM[1], cbM[2], cbH[0], cbH[1], cbH[2]);
  }
  const pfDensity = adj?.photoFilterDensity ?? 0;
  if (pfDensity > 1e-6) {
    const pfc = adj?.photoFilterColor ?? { r: 255, g: 160, b: 0 };
    setGroupPhotoFilter(engine, group.id, pfc.r / 255, pfc.g / 255, pfc.b / 255, pfDensity, adj?.photoFilterPreserveLuminosity !== false);
  }
  if (adj?.bwEnabled) {
    setGroupBlackWhite(engine, group.id,
      adj.bwReds ?? 40, adj.bwYellows ?? 60, adj.bwGreens ?? 40,
      adj.bwCyans ?? 60, adj.bwBlues ?? 20, adj.bwMagentas ?? 80,
    );
  }
  if (adj?.channelMixerEnabled) {
    const cmR = adj.channelMixerR ?? [100, 0, 0, 0];
    const cmG = adj.channelMixerG ?? [0, 100, 0, 0];
    const cmB = adj.channelMixerB ?? [0, 0, 100, 0];
    setGroupChannelMixer(engine, group.id,
      cmR[0], cmR[1], cmR[2], cmR[3],
      cmG[0], cmG[1], cmG[2], cmG[3],
      cmB[0], cmB[1], cmB[2], cmB[3],
    );
  }
  const gStops = adj?.gradientMapStops;
  if (gStops && gStops.length >= 2) {
    const lut = buildGradientMapLut(gStops);
    setGroupGradientMapLut(engine, group.id, lut);
  }
  return childrenJson;
}

function adjIsNonTrivial(adj: ReturnType<typeof nodesToLegacyAdjustments>): boolean {
  return (
    Math.abs(adj.exposure) > 1e-6 ||
    Math.abs(adj.contrast) > 1e-6 ||
    Math.abs(adj.highlights) > 1e-6 ||
    Math.abs(adj.shadows) > 1e-6 ||
    Math.abs(adj.whites) > 1e-6 ||
    Math.abs(adj.blacks) > 1e-6 ||
    Math.abs(adj.saturation) > 1e-6 ||
    Math.abs(adj.vibrance) > 1e-6 ||
    Math.abs(adj.vignette) > 1e-6 ||
    (adj.curves != null && !isIdentityCurves(adj.curves)) ||
    (adj.levels != null && !isIdentityLevels(adj.levels)) ||
    !!adj.invert ||
    (adj.hueSatHue ?? 0) !== 0 || (adj.hueSatSaturation ?? 0) !== 0 || (adj.hueSatLightness ?? 0) !== 0 ||
    (adj.colorBalanceShadows ?? [0,0,0]).some(v => Math.abs(v) > 1e-6) ||
    (adj.colorBalanceMidtones ?? [0,0,0]).some(v => Math.abs(v) > 1e-6) ||
    (adj.colorBalanceHighlights ?? [0,0,0]).some(v => Math.abs(v) > 1e-6) ||
    (adj.photoFilterDensity ?? 0) > 1e-6 ||
    !!adj.bwEnabled || !!adj.channelMixerEnabled ||
    (adj.gradientMapStops?.length ?? 0) >= 2
  );
}

function groupNeedsRouting(
  group: import('../types').GroupLayer,
  precomputedAdj?: ReturnType<typeof nodesToLegacyAdjustments> | null,
): boolean {
  const hasAdj = group.adjustmentsEnabled && group.adjustments && group.adjustments.length > 0;
  if (hasAdj) {
    const adj = precomputedAdj ?? nodesToLegacyAdjustments(group.adjustments);
    if (adjIsNonTrivial(adj)) return true;
  }
  return group.mask != null && group.mask.enabled;
}

export function syncGroupAdjustments(engine: Engine, layers: readonly Layer[]): void {
  const tracked = getTracked(engine);

  if (tracked.groupAdjNeedsFullSync) {
    clearGroupAdjustments(engine);
    tracked.groupAdjTracked.clear();
    tracked.groupAdjNeedsFullSync = false;

    for (const layer of layers) {
      if (layer.type !== 'group') continue;
      const group = layer as import('../types').GroupLayer;
      const hasAdj = group.adjustmentsEnabled && group.adjustments && group.adjustments.length > 0;
      const adj = hasAdj ? nodesToLegacyAdjustments(group.adjustments) : null;
      if (!groupNeedsRouting(group, adj)) continue;
      const childrenJson = pushGroupToEngine(engine, group, layers, adj, undefined);
      tracked.groupAdjTracked.set(group.id, {
        adjustments: group.adjustments,
        adjustmentsEnabled: group.adjustmentsEnabled,
        children: group.children,
        maskEnabled: group.mask?.enabled ?? false,
        childrenJson,
      });
    }
    return;
  }

  const seenGroupIds = new Set<string>();
  for (const layer of layers) {
    if (layer.type !== 'group') continue;
    const group = layer as import('../types').GroupLayer;
    seenGroupIds.add(group.id);
    const prev = tracked.groupAdjTracked.get(group.id);

    if (
      prev &&
      prev.adjustments === group.adjustments &&
      prev.adjustmentsEnabled === group.adjustmentsEnabled &&
      prev.children === group.children &&
      prev.maskEnabled === (group.mask?.enabled ?? false)
    ) continue;

    const hasAdj = group.adjustmentsEnabled && group.adjustments && group.adjustments.length > 0;
    const adj = hasAdj ? nodesToLegacyAdjustments(group.adjustments) : null;
    const needs = groupNeedsRouting(group, adj);
    if (needs) {
      const cachedJson = prev && prev.children === group.children ? prev.childrenJson : undefined;
      const childrenJson = pushGroupToEngine(engine, group, layers, adj, cachedJson);
      tracked.groupAdjTracked.set(group.id, {
        adjustments: group.adjustments,
        adjustmentsEnabled: group.adjustmentsEnabled,
        children: group.children,
        maskEnabled: group.mask?.enabled ?? false,
        childrenJson,
      });
    } else if (prev) {
      removeGroupAdjustment(engine, group.id);
      tracked.groupAdjTracked.delete(group.id);
    }
  }

  for (const trackedId of tracked.groupAdjTracked.keys()) {
    if (!seenGroupIds.has(trackedId)) {
      removeGroupAdjustment(engine, trackedId);
      tracked.groupAdjTracked.delete(trackedId);
    }
  }
}

export function syncMaskEditMode(engine: Engine, maskEditMode: boolean, activeLayerId: string | null): void {
  const tracked = getTracked(engine);
  const target = maskEditMode && activeLayerId ? activeLayerId : null;
  if (tracked.maskEditLayerId === target) return;
  if (target) {
    setMaskEditLayer(engine, target);
  } else {
    clearMaskEditLayer(engine);
  }
  tracked.maskEditLayerId = target;
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
  brushHardness: number = 100,
): void {
  const tracked = getTracked(engine);
  const hasTip = activeBrushTip !== null;
  const isColor = activeBrushTip?.kind === 'color';
  const tipChanged = tracked.brushTipData !== activeBrushTip;

  if (tipChanged) {
    if (activeBrushTip) {
      const bytes = new Uint8Array(
        activeBrushTip.data.buffer,
        activeBrushTip.data.byteOffset,
        activeBrushTip.data.byteLength,
      );
      if (isColor) {
        uploadBrushTipRGBA(engine, bytes, activeBrushTip.width, activeBrushTip.height);
      } else {
        uploadBrushTip(engine, bytes, activeBrushTip.width, activeBrushTip.height);
      }
    } else {
      clearBrushTip(engine);
    }
    tracked.brushTipData = activeBrushTip;
    tracked.brushTipHardness = brushHardness;
  }

  if (tracked.brushHasTip !== hasTip || tracked.brushAngle !== brushAngle || tracked.brushTipIsColor !== isColor) {
    setBrushTipState(engine, hasTip, brushAngle, isColor);
    tracked.brushHasTip = hasTip;
    tracked.brushAngle = brushAngle;
    tracked.brushTipIsColor = isColor;
  }
}

/**
 * Pre-process and cache all sub-brush tip textures on the GPU.
 * Call once at stroke start so per-dab swaps are just pointer changes.
 */
export function cacheSubBrushTips(engine: Engine, subBrushes: readonly SubBrush[]): void {
  clearSubBrushTipCache(engine);
  for (let i = 0; i < subBrushes.length; i++) {
    const sub = subBrushes[i]!;
    if (sub.tip) {
      const bytes = new Uint8Array(sub.tip.data.buffer, sub.tip.data.byteOffset, sub.tip.data.byteLength);
      if (sub.tip.kind === 'color') {
        cacheSubBrushTipRGBA(engine, i, bytes, sub.tip.width, sub.tip.height);
      } else {
        cacheSubBrushTip(engine, i, bytes, sub.tip.width, sub.tip.height);
      }
    }
  }
}

/**
 * Activate a cached sub-brush tip by index. No texture re-upload or
 * Gaussian blur — just swaps the active GPU texture handle.
 */
export function swapBrushTip(engine: Engine, subIndex: number, tip: BrushTipData | null, angleDeg: number = 0): void {
  const angleRad = -angleDeg * Math.PI / 180;
  if (tip) {
    wasmActivateSubBrushTip(engine, subIndex, angleRad, tip.kind === 'color');
  } else {
    wasmActivateSubBrushTip(engine, subIndex, angleRad, false);
  }
}

/**
 * Restore the primary brush tip after sub-brush rendering.
 * Just swaps the GPU texture handle back — no re-upload.
 */
export function restorePrimaryBrushTip(engine: Engine): void {
  const tracked = getTracked(engine);
  wasmDeactivateSubBrushTip(engine);
  setBrushTipState(engine, tracked.brushHasTip, tracked.brushAngle, tracked.brushTipIsColor);
}

const BLEND_MODE_MAP: Record<BrushTextureBlendMode, number> = {
  multiply: 0,
  subtract: 1,
  overlay: 2,
};

export function syncBrushTexture(
  engine: Engine,
  textureData: BrushTextureData | null,
  scale: number,
  blendMode: BrushTextureBlendMode,
): void {
  const tracked = getTracked(engine);
  const hasTexture = textureData !== null;
  const textureChanged = tracked.brushTextureData !== textureData;

  if (textureChanged) {
    if (textureData) {
      const bytes = new Uint8Array(
        textureData.data.buffer,
        textureData.data.byteOffset,
        textureData.data.byteLength,
      );
      uploadBrushTexture(engine, bytes, textureData.width, textureData.height);
    } else {
      clearBrushTexture(engine);
    }
    tracked.brushTextureData = textureData;
  }

  const normalizedScale = scale / 100;
  if (
    tracked.brushHasTexture !== hasTexture ||
    tracked.brushTextureScale !== normalizedScale ||
    tracked.brushTextureBlendMode !== blendMode
  ) {
    setBrushTextureState(engine, hasTexture, normalizedScale, BLEND_MODE_MAP[blendMode]);
    tracked.brushHasTexture = hasTexture;
    tracked.brushTextureScale = normalizedScale;
    tracked.brushTextureBlendMode = blendMode;
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

/**
 * Re-render path-text layers (TextLayer.pathId is set) using Canvas2D composition.
 * Called each frame; only uploads when the layer's content key has changed
 * (text, font, color, or the path's anchors).
 */
export function syncPathTextLayers(
  engine: Engine,
  layers: readonly TextLayer[],
  paths: readonly StoredPath[],
  docWidth: number,
  docHeight: number,
  textEditing?: TextEditingState | null,
): void {
  const tracked = getTracked(engine);
  if (!tracked.pathTextKeys) {
    tracked.pathTextKeys = new Map<string, string>();
  }

  for (const layer of layers) {
    if (!layer.pathId) continue;

    const path = paths.find((p) => p.id === layer.pathId);
    if (!path) continue;

    // Use live editing text if this layer is being edited
    const liveText = (textEditing && textEditing.layerId === layer.id)
      ? textEditing.text
      : layer.text;

    // Build a cheap cache key from layer content + path anchors + handles
    const anchorSummary = path.anchors.map((a) => {
      const hi = a.handleIn;
      const ho = a.handleOut;
      return `${a.point.x},${a.point.y},${hi ? `${hi.x},${hi.y}` : ''},${ho ? `${ho.x},${ho.y}` : ''}`;
    }).join('|');
    const key = [
      liveText,
      layer.fontFamily,
      layer.fontSize,
      layer.fontWeight,
      layer.fontStyle,
      layer.color.r,
      layer.color.g,
      layer.color.b,
      layer.color.a,
      layer.letterSpacing,
      path.closed,
      anchorSummary,
      docWidth,
      docHeight,
    ].join('\0');

    if (tracked.pathTextKeys.get(layer.id) === key) continue;

    const layerWithLiveText = liveText !== layer.text
      ? { ...layer, text: liveText }
      : layer;
    const result = renderTextOnPath(layerWithLiveText, path.anchors, path.closed, docWidth, docHeight);
    if (result) {
      uploadLayerPixels(engine, layer.id, result.pixels, result.width, result.height, result.x, result.y);
    } else {
      // Empty result — clear the layer texture
      uploadLayerPixels(engine, layer.id, new Uint8Array(4), 1, 1, 0, 0);
    }
    tracked.pathTextKeys.set(layer.id, key);
  }
}

/**
 * Sync the active text editing layer to the WASM engine for live preview.
 * Replaces the JS canvas rasterization path that previously used CanvasRenderingContext2D.
 * Calls setTextLayerContent → renderTextLayer → getRenderedTextPixels → uploadLayerPixels.
 *
 * @param onPositionChange - called when the rendered canvas offset changes so the
 *   caller can update the Zustand layer.x/y to match the GPU texture position.
 */
export function syncTextLayers(
  engine: Engine,
  textEditing: TextEditingState | null,
  fontSize: number,
  fontFamily: string,
  fontWeight: number,
  fontStyle: string,
  textAlign: string,
  color: Color,
  underline: boolean,
  strikethrough: boolean,
  onPositionChange: (layerId: string, x: number, y: number) => void,
): void {
  if (!textEditing) return;

  // When text is empty, replace the layer texture with a 1x1 transparent pixel.
  // fillWithColor can't be used here because it blits from a document-sized
  // scratch FBO into the small layer texture, sampling stale compositor content.
  if (textEditing.text.length === 0) {
    uploadLayerPixels(engine, textEditing.layerId, new Uint8Array(4), 1, 1, 0, 0);
    return;
  }

  const { layerId, bounds, text } = textEditing;

  const propsJson = JSON.stringify({
    text,
    fontFamily,
    fontSize,
    fontWeight,
    fontStyle,
    color: [color.r / 255, color.g / 255, color.b / 255, color.a],
    lineHeight: 1.4,
    letterSpacing: 0,
    textAlign,
    areaWidth: bounds.width ?? null,
    underline,
    strikethrough,
  });

  setTextLayerContent(engine, layerId, propsJson);

  const boundsResult = renderTextLayer(engine, layerId);
  if (boundsResult.length !== 4) return;

  const width = boundsResult[0]!;
  const height = boundsResult[1]!;
  const offsetX = boundsResult[2]!;
  const offsetY = boundsResult[3]!;

  const pixels = getRenderedTextPixels(engine, layerId);
  if (pixels.length === 0) return;

  const desiredX = bounds.x + offsetX;
  const desiredY = bounds.y + offsetY;

  uploadLayerPixels(engine, layerId, pixels, width, height, desiredX, desiredY);
  onPositionChange(layerId, desiredX, desiredY);
}

/**
 * Re-render a committed text layer from its stored properties using the WASM
 * text engine and upload the result. Used when a text layer loses its path
 * binding and needs its texture restored outside of editing mode.
 */
export function rerenderCommittedTextLayer(
  engine: Engine,
  layer: TextLayer,
): { x: number; y: number } | null {
  const propsJson = JSON.stringify({
    text: layer.text,
    fontFamily: layer.fontFamily,
    fontSize: layer.fontSize,
    fontWeight: layer.fontWeight,
    fontStyle: layer.fontStyle,
    color: [layer.color.r / 255, layer.color.g / 255, layer.color.b / 255, layer.color.a],
    lineHeight: layer.lineHeight,
    letterSpacing: layer.letterSpacing,
    textAlign: layer.textAlign,
    areaWidth: layer.width ?? null,
    underline: layer.underline,
    strikethrough: layer.strikethrough,
  });

  setTextLayerContent(engine, layer.id, propsJson);
  const boundsResult = renderTextLayer(engine, layer.id);
  if (boundsResult.length !== 4) return null;

  const width = boundsResult[0]!;
  const height = boundsResult[1]!;
  const offsetX = boundsResult[2]!;
  const offsetY = boundsResult[3]!;

  const pixels = getRenderedTextPixels(engine, layer.id);
  if (pixels.length === 0) return null;

  const x = layer.x + offsetX;
  const y = layer.y + offsetY;
  uploadLayerPixels(engine, layer.id, pixels, width, height, x, y);
  return { x, y };
}
