/**
 * Engine sync — bridges Zustand store state to the WASM/WebGL engine.
 *
 * Tracks what has already been sent to the engine and only pushes
 * deltas each frame to avoid redundant GPU uploads.
 */

import type { Engine } from './wasm-bridge';
import { getEngine } from './engine-state';
import type { Layer, BlendMode } from '../types';
import type { SparseLayerEntry } from '../app/store/types';
import type { ImageAdjustments } from '../filters/image-adjustments';
import { isIdentityColorBalance } from '../filters/image-adjustments';
import { buildCurvesLutRgba, isIdentityCurves } from '../filters/curves';
import {
  setDocumentSize,
  setViewport,
  setBackgroundColor,
  addLayer,
  removeLayer,
  updateLayer,
  setLayerOrder,
  uploadLayerPixels,
  uploadLayerSparsePixels,
  uploadLayerMask,
  removeLayerMask,
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
  setImageColorBalance,
  clearImageAdjustments,
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

// ---------------------------------------------------------------------------
// Blend mode mapping: TypeScript union → Rust serde enum variant
// ---------------------------------------------------------------------------

const BLEND_MODE_MAP: Record<BlendMode, string> = {
  'normal': 'Normal',
  'multiply': 'Multiply',
  'screen': 'Screen',
  'overlay': 'Overlay',
  'darken': 'Darken',
  'lighten': 'Lighten',
  'color-dodge': 'ColorDodge',
  'color-burn': 'ColorBurn',
  'hard-light': 'HardLight',
  'soft-light': 'SoftLight',
  'difference': 'Difference',
  'exclusion': 'Exclusion',
  'hue': 'Hue',
  'saturation': 'Saturation',
  'color': 'Color',
  'luminosity': 'Luminosity',
};

const LAYER_TYPE_MAP: Record<string, string> = {
  'raster': 'Raster',
  'text': 'Text',
  'shape': 'Shape',
  'group': 'Group',
  'adjustment': 'Adjustment',
};

function isEffectivelyVisible(layer: Layer, allLayers: readonly Layer[]): boolean {
  if (!layer.visible) return false;
  // Walk up the group hierarchy — if any ancestor is hidden, this layer is hidden
  let currentId = layer.id;
  for (;;) {
    let parentFound = false;
    for (const l of allLayers) {
      if (l.type === 'group' && 'children' in l && (l as import('../types').GroupLayer).children.includes(currentId)) {
        if (!l.visible) return false;
        currentId = l.id;
        parentFound = true;
        break;
      }
    }
    if (!parentFound) break;
  }
  return true;
}

function layerToDescJson(layer: Layer, allLayers?: readonly Layer[]): string {
  const effects: Record<string, unknown> = {};

  const eff = layer.effects;

  if (eff.outerGlow.enabled) {
    const c = eff.outerGlow.color;
    effects.outer_glow = {
      enabled: true,
      color: [c.r / 255, c.g / 255, c.b / 255, c.a],
      size: eff.outerGlow.size,
      spread: eff.outerGlow.spread,
      opacity: eff.outerGlow.opacity,
    };
  }
  if (eff.innerGlow.enabled) {
    const c = eff.innerGlow.color;
    effects.inner_glow = {
      enabled: true,
      color: [c.r / 255, c.g / 255, c.b / 255, c.a],
      size: eff.innerGlow.size,
      spread: eff.innerGlow.spread,
      opacity: eff.innerGlow.opacity,
    };
  }
  if (eff.dropShadow.enabled) {
    const c = eff.dropShadow.color;
    effects.drop_shadow = {
      enabled: true,
      color: [c.r / 255, c.g / 255, c.b / 255, c.a],
      offset_x: eff.dropShadow.offsetX,
      offset_y: eff.dropShadow.offsetY,
      blur: eff.dropShadow.blur,
      spread: eff.dropShadow.spread,
      opacity: eff.dropShadow.opacity ?? c.a,
    };
  }
  if (eff.stroke.enabled) {
    const c = eff.stroke.color;
    const posMap: Record<string, string> = {
      'outside': 'Outside',
      'inside': 'Inside',
      'center': 'Center',
    };
    effects.stroke = {
      enabled: true,
      color: [c.r / 255, c.g / 255, c.b / 255, c.a],
      width: eff.stroke.width,
      position: posMap[eff.stroke.position] ?? 'Outside',
      opacity: 1.0,
    };
  }
  if (eff.colorOverlay.enabled) {
    const c = eff.colorOverlay.color;
    effects.color_overlay = {
      enabled: true,
      color: [c.r / 255, c.g / 255, c.b / 255, c.a],
      opacity: 1.0,
    };
  }

  const width = 'width' in layer ? (layer.width ?? 0) : 0;
  const height = 'height' in layer ? (layer.height ?? 0) : 0;

  const desc: Record<string, unknown> = {
    id: layer.id,
    name: layer.name,
    layer_type: LAYER_TYPE_MAP[layer.type] ?? 'Raster',
    visible: allLayers ? isEffectivelyVisible(layer, allLayers) : layer.visible,
    locked: layer.locked,
    opacity: layer.opacity,
    blend_mode: BLEND_MODE_MAP[layer.blendMode] ?? 'Normal',
    x: layer.x,
    y: layer.y,
    width,
    height,
    clip_to_below: layer.clipToBelow,
    effects,
    mask: layer.mask ? {
      enabled: layer.mask.enabled,
      linked: true,
      width: layer.mask.width,
      height: layer.mask.height,
    } : null,
  };

  if (layer.type === 'group' && 'children' in layer) {
    desc.children = (layer as import('../types').GroupLayer).children;
  }

  return JSON.stringify(desc);
}

// ---------------------------------------------------------------------------
// Tracked state — what the engine currently knows
// ---------------------------------------------------------------------------

interface TrackedState {
  docWidth: number;
  docHeight: number;
  bgColor: string;
  viewportZoom: number;
  viewportPanX: number;
  viewportPanY: number;
  viewportWidth: number;
  viewportHeight: number;
  layerIds: Set<string>;
  layerVersions: Map<string, string>;
  pixelDataVersions: Map<string, ImageData | undefined>;
  sparseVersions: Map<string, SparseLayerEntry | undefined>;
  layerOrder: string;
  selectionActive: boolean;
  selectionMask: Uint8ClampedArray | null;
  showGrid: boolean;
  gridSize: number;
  showRulers: boolean;
  brushTipData: BrushTipData | null;
  brushAngle: number;
  brushHasTip: boolean;
  /** Reference equality on the active Curves object so we only re-upload
   *  the LUT texture when the user actually edited a control point. */
  curvesRef: unknown;
  /** True when the engine is in "no curves" mode; null on first frame. */
  curvesIdentity: boolean | null;
}

function createTrackedState(): TrackedState {
  return {
    docWidth: 0,
    docHeight: 0,
    bgColor: '',
    viewportZoom: 0,
    viewportPanX: 0,
    viewportPanY: 0,
    viewportWidth: 0,
    viewportHeight: 0,
    layerIds: new Set(),
    layerVersions: new Map(),
    pixelDataVersions: new Map(),
    sparseVersions: new Map(),
    layerOrder: '',
    selectionActive: false,
    selectionMask: null,
    showGrid: false,
    gridSize: 0,
    showRulers: false,
    brushTipData: null,
    brushAngle: 0,
    brushHasTip: false,
    curvesRef: null,
    curvesIdentity: null,
  };
}

let tracked: TrackedState = createTrackedState();

export function resetTrackedState(): void {
  tracked = createTrackedState();
}

/**
 * Mark a layer's pixel data as already synced to the GPU.
 * Use this when uploading via a non-standard path (e.g. canvas upload)
 * to prevent syncLayers from re-uploading stale byte data.
 */
export function markPixelDataSynced(layerId: string, data: ImageData): void {
  tracked.pixelDataVersions.set(layerId, data);
}

// ---------------------------------------------------------------------------
// Sync functions — called before each render
// ---------------------------------------------------------------------------

export function syncDocumentSize(engine: Engine, width: number, height: number): void {
  if (tracked.docWidth === width && tracked.docHeight === height) return;
  setDocumentSize(engine, width, height);
  tracked.docWidth = width;
  tracked.docHeight = height;
}

export function syncBackgroundColor(engine: Engine, r: number, g: number, b: number, a: number): void {
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

export function syncLayers(
  engine: Engine,
  layers: readonly Layer[],
  layerOrder: readonly string[],
  pixelData: Map<string, ImageData>,
  sparseData: Map<string, SparseLayerEntry>,
  dirtyLayerIds: Set<string>,
): void {
  const currentIds = new Set(layers.map((l) => l.id));

  // Remove layers no longer present
  for (const id of tracked.layerIds) {
    if (!currentIds.has(id)) {
      try {
        removeLayer(engine, id);
      } catch (e) {
        console.error('[syncLayers] removeLayer failed:', id, e);
      }
      tracked.layerVersions.delete(id);
      tracked.pixelDataVersions.delete(id);
      tracked.sparseVersions.delete(id);
    }
  }

  // Track which layers were successfully added so we don't mark failed
  // adds as tracked (which would prevent retry on the next frame).
  const failedAdds = new Set<string>();

  // Add or update layers
  for (const layer of layers) {
    const descJson = layerToDescJson(layer, layers);

    if (!tracked.layerIds.has(layer.id)) {
      try {
        addLayer(engine, descJson);
        tracked.layerVersions.set(layer.id, descJson);
      } catch (e) {
        console.error('[syncLayers] addLayer failed:', layer.id, e);
        failedAdds.add(layer.id);
      }
    } else if (tracked.layerVersions.get(layer.id) !== descJson) {
      try {
        updateLayer(engine, descJson);
        tracked.layerVersions.set(layer.id, descJson);
      } catch (e) {
        console.error('[syncLayers] updateLayer failed:', layer.id, e);
      }
    }

    // Upload pixel data if changed or marked dirty (including GPU paint dirty).
    // When no JS data exists AND no sparse data, the GPU texture is source of truth
    // (e.g. after a GPU paint stroke or undo restore) — skip upload.
    const data = pixelData.get(layer.id);
    const sparseEntry = sparseData.get(layer.id);
    const isDirty = dirtyLayerIds.has(layer.id);
    const pixelChanged = tracked.pixelDataVersions.get(layer.id) !== data;
    const sparseChanged = tracked.sparseVersions.get(layer.id) !== sparseEntry;

    if (data && (pixelChanged || isDirty)) {
      const rawBytes = new Uint8Array(data.data.buffer, data.data.byteOffset, data.data.byteLength);
      uploadLayerPixels(engine, layer.id, rawBytes, data.width, data.height, layer.x, layer.y);
      tracked.pixelDataVersions.set(layer.id, data);
      tracked.sparseVersions.set(layer.id, undefined);
    } else if (!data && sparseEntry && (sparseChanged || isDirty)) {
      const indices = new Uint32Array(sparseEntry.sparse.indices);
      const rgba = new Uint8Array(sparseEntry.sparse.rgba.buffer, sparseEntry.sparse.rgba.byteOffset, sparseEntry.sparse.rgba.byteLength);
      // Use layer.x/y as authoritative position — sparse offsets may be
      // stale after updateLayerPosition() (move tool).
      uploadLayerSparsePixels(
        engine,
        layer.id,
        indices,
        rgba,
        sparseEntry.sparse.width,
        sparseEntry.sparse.height,
        layer.x,
        layer.y,
      );
      tracked.sparseVersions.set(layer.id, sparseEntry);
      tracked.pixelDataVersions.set(layer.id, undefined);
    } else if (!data && !sparseEntry) {
      // No JS data — GPU texture is source of truth (GPU paint or undo restore).
      // Only clear the GPU texture if we previously had JS data AND the layer is dirty
      // (meaning JS data was explicitly removed, not just never set).
      if (isDirty && (tracked.pixelDataVersions.get(layer.id) !== undefined || tracked.sparseVersions.get(layer.id) !== undefined)) {
        // JS data was cleared but layer is dirty — GPU already has the correct data
        // from uploadCompressed or GPU stroke. Just update tracking.
        tracked.pixelDataVersions.set(layer.id, undefined);
        tracked.sparseVersions.set(layer.id, undefined);
      }
    }

    // Upload mask
    if (layer.mask) {
      const maskBytes = new Uint8Array(layer.mask.data.buffer, layer.mask.data.byteOffset, layer.mask.data.byteLength);
      uploadLayerMask(engine, layer.id, maskBytes, layer.mask.width, layer.mask.height);
    } else if (tracked.layerIds.has(layer.id)) {
      // Only remove mask if layer existed before — new layers start with no mask
      const prevDesc = tracked.layerVersions.get(layer.id);
      if (prevDesc && prevDesc.includes('"mask"') && !prevDesc.includes('"mask":null')) {
        removeLayerMask(engine, layer.id);
      }
    }
  }

  // Exclude layers that failed to add — they stay out of tracking so
  // syncLayers retries addLayer on the next frame.
  for (const id of failedAdds) {
    currentIds.delete(id);
  }
  tracked.layerIds = currentIds;

  // Sync layer order
  const orderJson = JSON.stringify(layerOrder);
  if (tracked.layerOrder !== orderJson) {
    setLayerOrder(engine, orderJson);
    tracked.layerOrder = orderJson;
  }
}

export function syncSelection(engine: Engine, selection: SelectionData): void {
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
  if (tracked.showRulers !== showRulers) {
    setRulersVisible(engine, showRulers);
    tracked.showRulers = showRulers;
  }
}

export function syncAdjustments(engine: Engine, adjustments: ImageAdjustments, enabled: boolean): void {
  if (!enabled) {
    clearImageAdjustments(engine);
    tracked.curvesIdentity = null;
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

  // Color balance
  const cb = adjustments.colorBalance;
  if (cb && !isIdentityColorBalance(cb)) {
    setImageColorBalance(
      engine,
      cb.shadowsCyanRed, cb.shadowsMagentaGreen, cb.shadowsYellowBlue,
      cb.midtonesCyanRed, cb.midtonesMagentaGreen, cb.midtonesYellowBlue,
      cb.highlightsCyanRed, cb.highlightsMagentaGreen, cb.highlightsYellowBlue,
    );
  } else {
    setImageColorBalance(engine, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }

  // Curves: build the 256x4 RGBA LUT and upload only when the points
  // changed (cheap identity check via reference equality on the curves
  // object held in the document model).
  const curves = adjustments.curves;
  if (!curves || isIdentityCurves(curves)) {
    if (tracked.curvesIdentity !== true) {
      clearImageCurves(engine);
      tracked.curvesIdentity = true;
    }
  } else if (tracked.curvesRef !== curves) {
    const lut = buildCurvesLutRgba(curves);
    setImageCurvesLut(engine, lut);
    tracked.curvesRef = curves;
    tracked.curvesIdentity = false;
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
  layerPixelData: Map<string, ImageData>;
  sparseLayerData: Map<string, SparseLayerEntry>;
  dirtyLayerIds: Set<string>;
}): void {
  const engine = getEngine();
  if (!engine) return;
  syncLayers(engine, state.document.layers, state.document.layerOrder, state.layerPixelData, state.sparseLayerData, state.dirtyLayerIds);
}
