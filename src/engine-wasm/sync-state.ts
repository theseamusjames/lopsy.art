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
import type { AdjustmentNode } from '../types/adjustment-nodes';
import type { BrushTipData, BrushTextureData, BrushTextureBlendMode } from '../types/brush';

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
  /** Cached pass-through opacity multiplier per layer. When a pass-through
   *  group's opacity changes, children must be re-synced even though their
   *  own references haven't changed. */
  layerPassThroughOpacity: Map<string, number>;
  /** Layer ids currently known to have a mask on the engine side. Used to
   *  decide whether a removeLayerMask call is needed — previously done by
   *  substring-sniffing the cached descriptor JSON, which was fragile. */
  masksOnEngine: Set<string>;
  maskDataRefs: Map<string, Uint8ClampedArray>;
  pixelDataVersions: Map<string, ImageData | undefined>;
  sparseVersions: Map<string, SparseLayerEntry | undefined>;
  layerOrder: string;
  selectionActive: boolean;
  selectionMask: Uint8ClampedArray | null;
  showGrid: boolean;
  gridSize: number;
  showRulers: boolean;
  showSeamlessPattern: boolean;
  dimSeamlessPattern: boolean;
  wrapSeamlessPattern: boolean;
  /** Last channel mask pushed to the engine as an "r,g,b,a" key.
   *  Empty string = unknown (first frame / after reset), forces a push. */
  channelMask: string;
  /** Layer id the engine has in mask-edit mode; null = cleared.
   *  undefined = unknown (first frame / after reset), forces a push. */
  maskEditLayerId: string | null | undefined;
  /** Reference equality on the whole ImageAdjustments object — the UI store
   *  replaces it wholesale on every edit, so an unchanged reference means no
   *  setter needs to run this frame. */
  adjustmentsRef: unknown;
  /** True when the engine is in cleared-adjustments mode, false when
   *  adjustments are applied; null = unknown (first frame / after reset). */
  adjustmentsCleared: boolean | null;
  brushTipData: BrushTipData | null;
  brushAngle: number;
  brushHasTip: boolean;
  brushTipIsColor: boolean;
  brushTipHardness: number;
  brushTextureData: BrushTextureData | null;
  brushHasTexture: boolean;
  brushTextureScale: number;
  brushTextureBlendMode: BrushTextureBlendMode;
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
  /**
   * Cache keys for path-text layers so we only re-upload when content or
   * path geometry actually changes. Maps layerId → last-rendered key string.
   */
  pathTextKeys: Map<string, string> | null;
  /**
   * Consecutive upload-failure bookkeeping, keyed by `${layerId}:{kind}`
   * (kind: pixels | sparse | mask). A persistently failing upload retries on
   * every dirty frame; once the count for an unchanged data reference reaches
   * the cap, further attempts are skipped until the data reference changes
   * or an upload succeeds.
   */
  uploadFailures: Map<string, UploadFailureEntry>;
  /** Per-group tracked refs for incremental syncGroupAdjustments.
   *  Maps groupId → the references last sent to the engine. */
  groupAdjTracked: Map<string, GroupAdjTrackedEntry>;
  /** True when the engine's group adjustments may be stale (e.g. after
   *  undo/redo reset). Forces a full clear + rebuild on next sync. */
  groupAdjNeedsFullSync: boolean;
}

export interface UploadFailureEntry {
  /** Consecutive failures for this data reference. */
  count: number;
  /** The data reference that failed — a new reference resets the count. */
  dataRef: unknown;
}

export interface GroupAdjTrackedEntry {
  adjustments: readonly AdjustmentNode[];
  adjustmentsEnabled: boolean;
  children: readonly string[];
  maskEnabled: boolean;
  childrenJson?: string;
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
    layerPassThroughOpacity: new Map(),
    masksOnEngine: new Set(),
    maskDataRefs: new Map(),
    pixelDataVersions: new Map(),
    sparseVersions: new Map(),
    layerOrder: '',
    selectionActive: false,
    selectionMask: null,
    showGrid: false,
    gridSize: 0,
    showRulers: false,
    showSeamlessPattern: false,
    dimSeamlessPattern: true,
    wrapSeamlessPattern: false,
    channelMask: '',
    maskEditLayerId: undefined,
    adjustmentsRef: null,
    adjustmentsCleared: null,
    brushTipData: null,
    brushAngle: 0,
    brushHasTip: false,
    brushTipIsColor: false,
    brushTipHardness: 100,
    brushTextureData: null,
    brushHasTexture: false,
    brushTextureScale: 1,
    brushTextureBlendMode: 'multiply',
    curvesRef: null,
    curvesIdentity: null,
    levelsRef: null,
    levelsIdentity: null,
    pathTextKeys: null,
    uploadFailures: new Map(),
    groupAdjTracked: new Map(),
    groupAdjNeedsFullSync: true,
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

