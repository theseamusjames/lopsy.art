/**
 * Per-engine tracked state used by engine-sync and its submodules.
 *
 * Tracked state is keyed by Engine instance via a WeakMap so it lives and
 * dies with the engine — no module-level singleton, no HMR pollution, no
 * test cross-talk.
 */

import type { Engine } from './wasm-bridge';
import type { Layer } from '../types';
import type { SparseLayerEntry } from '../app/store/types';
import type { BrushTipData } from '../types/brush';

export interface TrackedState {
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
  /** Layer reference that produced the cached descriptor. If the reference
   *  and the effective visibility are both unchanged, the descriptor is
   *  also unchanged and we can skip JSON.stringify entirely. */
  layerRefs: Map<string, Layer>;
  layerEffectiveVisible: Map<string, boolean>;
  /** Layer ids currently known to have a mask on the engine side. Used to
   *  decide whether a removeLayerMask call is needed — previously done by
   *  substring-sniffing the cached descriptor JSON, which was fragile. */
  masksOnEngine: Set<string>;
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
  /** Reference equality on the active Levels object so we only re-upload
   *  the LUT texture when the user actually edited a control point. */
  levelsRef: unknown;
  /** True when the engine is in "no levels" mode; null on first frame. */
  levelsIdentity: boolean | null;
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
    layerRefs: new Map(),
    layerEffectiveVisible: new Map(),
    masksOnEngine: new Set(),
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
    levelsRef: null,
    levelsIdentity: null,
  };
}

const trackedByEngine = new WeakMap<Engine, TrackedState>();

export function getTracked(engine: Engine): TrackedState {
  let t = trackedByEngine.get(engine);
  if (!t) {
    t = createTrackedState();
    trackedByEngine.set(engine, t);
  }
  return t;
}

export function resetTrackedState(engine: Engine): void {
  trackedByEngine.set(engine, createTrackedState());
}

/**
 * Mark a layer's pixel data as already synced to the GPU.
 * Use this when uploading via a non-standard path (e.g. canvas upload)
 * to prevent syncLayers from re-uploading stale byte data.
 */
export function markPixelDataSynced(engine: Engine, layerId: string, data: ImageData): void {
  getTracked(engine).pixelDataVersions.set(layerId, data);
}
