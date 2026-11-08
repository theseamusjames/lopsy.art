import type { HistorySnapshot, MaskSnapshotEntry, SelectionData } from './types';
import type { DocumentState } from '../../types';
import type { StoredPath } from '../../types/paths';
import type { Guide } from '../ui-store';

type PixelSnapshot = Extract<HistorySnapshot, { kind: 'pixels' }>;

/** The live editor state a jump starts from. */
export interface LiveHistoryState {
  document: DocumentState;
  selection: SelectionData;
  paths: readonly StoredPath[];
  selectedPathId: string | null;
  guides?: readonly Guide[];
}

export interface LivePixels {
  gpuSnapshots: Map<string, number>;
  maskSnapshots: ReadonlyMap<string, MaskSnapshotEntry>;
}

export interface HistoryJumpPlan {
  /** Entries for the opposite stack, in push order. */
  additions: HistorySnapshot[];
  /**
   * What to restore. A metadata target keeps the live pixels; a pixel target
   * may be synthesized from a nearer pixel entry when the target itself is a
   * metadata entry whose pixels were captured further along the path.
   */
  target: HistorySnapshot;
  /**
   * Layers the jump removes, mapped to the handle of their content at the last
   * state on the path that still held them. The engine keeps a removed
   * layer's texture and reuses it if a later redo brings the layer back, so
   * it must hold what a step-by-step walk would have left there, not the
   * live content from the far end of the jump.
   */
  removedLayerRestores: Map<string, number>;
}

type MergePositions = (snapshot: DocumentState, pixelsFrom: DocumentState) => DocumentState;

/**
 * Plans a multi-step undo or redo so it ends exactly where `path.length`
 * single steps would (#1543).
 *
 * `path[i]` is the entry for the state `i + 1` steps away from the live one,
 * in the direction of travel, and it carries the label and kind of the action
 * between that state and the one before it on the path. A metadata action
 * leaves pixels alone, so a metadata entry's pixels are the ones of the state
 * before it on the path — the nearest pixel entry back towards live, or the
 * live textures themselves.
 */
export function planHistoryJump(
  path: readonly HistorySnapshot[],
  live: LiveHistoryState,
  captureLivePixels: () => LivePixels,
  mergePositions: MergePositions,
  emptyHandle: number,
): HistoryJumpPlan | null {
  const n = path.length;
  const last = path[n - 1];
  if (!last) return null;

  let livePixels: LivePixels | null = null;
  const getLivePixels = (): LivePixels => {
    livePixels ??= captureLivePixels();
    return livePixels;
  };

  // states[i]: the state i steps along the path (0 = live).
  // pixelSource[i]: the pixel entry holding its textures, or null for live.
  const states: LiveHistoryState[] = [live];
  const pixelSource: (PixelSnapshot | null)[] = [null];
  let source: PixelSnapshot | null = null;
  for (const entry of path) {
    if (entry.kind === 'pixels') source = entry;
    states.push(entry);
    pixelSource.push(source);
  }

  const withPixels = (i: number, label: string): HistorySnapshot => {
    const state = states[i] ?? live;
    const src = pixelSource[i] ?? null;
    if (i > 0 && src !== null && src === state) return { ...src, label };
    const pixels = src ?? getLivePixels();
    const pixelDoc = src ? src.document : live.document;
    const document = i === 0 ? live.document : mergePositions(state.document, pixelDoc);
    return {
      kind: 'pixels',
      document,
      selection: state.selection,
      label,
      gpuSnapshots: handlesFor(document, pixels.gpuSnapshots, emptyHandle),
      maskSnapshots: pixels.maskSnapshots,
      paths: state.paths,
      selectedPathId: state.selectedPathId,
      guides: state.guides,
    };
  };

  const additions = path.map((action, i): HistorySnapshot => {
    if (action.kind === 'pixels') return withPixels(i, action.label);
    const state = states[i] ?? live;
    return {
      kind: 'metadata',
      document: state.document,
      selection: state.selection,
      label: action.label,
      paths: state.paths,
      selectedPathId: state.selectedPathId,
      guides: state.guides,
    };
  });

  const target = source === null || source === last ? last : withPixels(n, last.label);
  return { additions, target, removedLayerRestores: removedLayerRestores(states, pixelSource, emptyHandle) };
}

function removedLayerRestores(
  states: readonly LiveHistoryState[],
  pixelSource: readonly (PixelSnapshot | null)[],
  emptyHandle: number,
): Map<string, number> {
  const out = new Map<string, number>();
  const target = states[states.length - 1];
  if (!target) return out;
  const targetIds = new Set(target.document.layers.map((l) => l.id));
  for (const layer of states[0]?.document.layers ?? []) {
    if (targetIds.has(layer.id)) continue;
    let lastHeld = 0;
    for (let i = 1; i < states.length; i++) {
      if (states[i]?.document.layers.some((l) => l.id === layer.id)) lastHeld = i;
    }
    // Removed by the first step: the live texture is already that content.
    if (lastHeld === 0) continue;
    const src = pixelSource[lastHeld];
    if (!src) continue;
    const handle = src.gpuSnapshots.get(layer.id);
    const heldLayer = states[lastHeld]?.document.layers.find((l) => l.id === layer.id);
    if (handle !== undefined) out.set(layer.id, handle);
    else if (heldLayer?.type === 'raster') out.set(layer.id, emptyHandle);
  }
  return out;
}

/**
 * The handles that rebuild `doc`'s layers from a pixel entry taken across
 * metadata steps. A raster layer the entry lacks was created by one of those
 * steps (Add Layer), and a fresh raster layer is empty.
 */
function handlesFor(
  doc: DocumentState,
  handles: ReadonlyMap<string, number>,
  emptyHandle: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const layer of doc.layers) {
    const handle = handles.get(layer.id);
    if (handle !== undefined) out.set(layer.id, handle);
    else if (layer.type === 'raster') out.set(layer.id, emptyHandle);
  }
  return out;
}
