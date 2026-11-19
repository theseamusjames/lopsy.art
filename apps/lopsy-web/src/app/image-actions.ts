import { useEditorStore } from './editor-store';
import { getEngine } from '../engine-wasm/engine-state';
import { flipLayer, getLayerEngineBounds, rotateLayer90, setDocumentSize } from '../engine-wasm/wasm-bridge';
import { readLayerAsImageData } from '../engine-wasm/gpu-pixel-access';
import { readLayerContentRectLocal, readLayerContentRectsLocal } from './layer-content-rect';
import { pixelDataManager } from '../engine/pixel-data-manager';
import { computeAutoTone, computeAutoContrast, computeAutoColor } from '../filters/auto-enhance';
import type { Layer, GroupLayer, TextLayer } from '../types';
import { measureTextFrame, placeTextLayerAtAnchor, flushLayerSync } from '../engine-wasm/engine-sync';
import { transformTextLayerInDocument, transformableTextLayer } from './text-layer-transform';
import { announceRefusal, type Refusal } from '../commands/refusal';
import {
  applyDocumentLinear,
  FLIP_HORIZONTAL,
  FLIP_VERTICAL,
  placementProps,
  ROTATE_CCW,
  ROTATE_CW,
  textTransformFor,
} from '../tools/text/text-transform';
import type { AdjustmentNode } from '../types/adjustment-nodes';
import type { Engine } from '../engine-wasm/wasm-bridge';
import { planGroupFlip, planLayerFlip, type FlipAxis, type GroupFlipMember } from '../layers/flip';
import { getDescendantIds } from '../layers/group-utils';
import { clearJsPixelData } from './store/clear-js-pixel-data';
import { remapDocumentMasks, remapLayerMaskThrough } from './store/actions/_helpers/remap-layer-masks';
import { documentRotation90, layerFlip, type Affine } from '../layers/mask-remap';
import { rotateGuidesForCanvas, rotatePathsForCanvas } from './store/actions/rotate-image-overlays';
import { useUIStore } from './ui-store';

export const TEXT_FLIP_REFUSAL: Refusal = { reason: 'Rasterize this text layer to flip it.', notice: 'info' };
export const GROUP_TEXT_FLIP_REFUSAL: Refusal = {
  reason: 'Rasterize the text layers in this group before flipping it.',
  notice: 'info',
};

function flipLabel(axis: FlipAxis): string {
  return axis === 'horizontal' ? 'Flip Horizontal' : 'Flip Vertical';
}

function groupLeaves(layers: readonly Layer[], group: GroupLayer): Layer[] {
  const byId = new Map(layers.map((l) => [l.id, l]));
  return getDescendantIds(layers, group.id)
    .map((id) => byId.get(id))
    .filter((l): l is Layer => l !== undefined && l.type !== 'group');
}

/**
 * Why Image > Flip refuses `layer` before it starts, or null: path text
 * cannot take a live flip, and a group flips only when none of its layers
 * is live text.
 */
export function flipRefusal(layer: Layer, layers: readonly Layer[]): Refusal | null {
  if (layer.type === 'text') return transformableTextLayer(layer.id) ? null : TEXT_FLIP_REFUSAL;
  if (layer.type === 'group' && groupLeaves(layers, layer).some((l) => l.type === 'text')) return GROUP_TEXT_FLIP_REFUSAL;
  return null;
}

/** Image > Flip: mirrors the active layer. Resolves once a raster or group flip has finished. */
export function flipActiveLayer(axis: FlipAxis): Promise<void> {
  const state = useEditorStore.getState();
  const activeId = state.document.activeLayerId;
  if (!activeId) return Promise.resolve();

  const engine = getEngine();
  if (!engine) return Promise.resolve();

  const layer = state.document.layers.find((l) => l.id === activeId);
  if (!layer) return Promise.resolve();
  // A text layer flips through its transform, so it stays editable.
  if (layer.type === 'text') {
    const flip = axis === 'horizontal' ? FLIP_HORIZONTAL : FLIP_VERTICAL;
    if (!transformTextLayerInDocument(activeId, flip, flipLabel(axis))) {
      announceRefusal(TEXT_FLIP_REFUSAL);
    }
    return Promise.resolve();
  }
  if (layer.type === 'group') {
    return flipGroup(engine, layer, axis);
  }

  return flipRasterLayer(engine, activeId, axis);
}

/**
 * The engine mirrors a texture within itself, and the active layer's texture
 * is document-sized, so the texture is then moved so the content mirrors
 * about its own bounds instead of jumping across the document.
 */
async function flipRasterLayer(engine: Engine, layerId: string, axis: FlipAxis): Promise<void> {
  // Push pending store positions and JS pixels so the rects read are current.
  flushLayerSync(useEditorStore.getState());
  const content = await readLayerContentRectLocal(engine, layerId);
  if (getEngine() !== engine) return;
  const state = useEditorStore.getState();
  const [x = 0, y = 0, width = 0, height = 0] = getLayerEngineBounds(engine, layerId);
  const origin = planLayerFlip({ x, y, width, height }, content, axis);
  if (!origin) return;

  state.pushHistory(flipLabel(axis));
  flipLayer(engine, layerId, axis === 'horizontal');

  const mirror = axis === 'horizontal'
    ? layerFlip(axis, x, origin.x, width)
    : layerFlip(axis, y, origin.y, height);
  const doc = useEditorStore.getState().document;
  const layers = doc.layers.map((l) => {
    if (l.id !== layerId) return l;
    const moved = { ...l, x: origin.x, y: origin.y } as Layer;
    return remapLayerMaskThrough(engine, l, moved, mirror, doc.width, doc.height);
  });
  useEditorStore.setState((s) => ({
    document: { ...s.document, layers },
    renderVersion: s.renderVersion + 1,
  }));
  // GPU is now source of truth — clear stale JS pixel data.
  clearJsPixelData(layerId);
  useEditorStore.getState().notifyRender();
}

/**
 * A group has no pixels of its own, so it flips as a unit: each descendant
 * texture is mirrored in place and moved to the mirror of its position
 * within the group's combined content bounds.
 */
async function flipGroup(engine: Engine, group: GroupLayer, axis: FlipAxis): Promise<void> {
  const before = useEditorStore.getState();
  const leaves = groupLeaves(before.document.layers, group);
  if (leaves.some((l) => l.type === 'text')) {
    announceRefusal(GROUP_TEXT_FLIP_REFUSAL);
    return;
  }
  if (leaves.length === 0) return;

  // Push pending store positions and JS pixels to the engine so the texture
  // rects and content bounds read below are current.
  flushLayerSync(before);
  const contents = await readLayerContentRectsLocal(engine, leaves.map((l) => l.id));
  if (getEngine() !== engine) return;
  // A layer may have been cropped or moved while the bounds were being
  // read, so where each one is comes from the store as it is now.
  const state = useEditorStore.getState();
  const current = new Map(state.document.layers.map((l) => [l.id, l]));
  const members: GroupFlipMember[] = leaves.map((leaf, i) => {
    const l = current.get(leaf.id) ?? leaf;
    const [, , width = 0, height = 0] = getLayerEngineBounds(engine, l.id);
    return { id: l.id, texture: { x: l.x, y: l.y, width, height }, content: contents[i] ?? null };
  });
  const origins = planGroupFlip(members, axis);
  if (origins.size === 0) return;

  state.pushHistory(flipLabel(axis));
  for (const id of origins.keys()) flipLayer(engine, id, axis === 'horizontal');

  // Every member mirrors about the same line, so any one gives the map that
  // the group's own mask and its descendants' masks follow.
  const mirror = groupMirror(members, origins, axis);
  const maskIds = new Set([group.id, ...getDescendantIds(state.document.layers, group.id)]);
  const doc = useEditorStore.getState().document;
  const layers = doc.layers.map((l) => {
    const origin = origins.get(l.id);
    const moved = origin ? ({ ...l, x: origin.x, y: origin.y } as Layer) : l;
    if (!mirror || !maskIds.has(l.id)) return moved;
    return remapLayerMaskThrough(engine, l, moved, mirror, doc.width, doc.height);
  });
  useEditorStore.setState((s) => ({
    document: { ...s.document, layers },
    renderVersion: s.renderVersion + 1,
  }));
  for (const id of origins.keys()) clearJsPixelData(id);
}

function groupMirror(
  members: readonly GroupFlipMember[],
  origins: ReadonlyMap<string, { x: number; y: number }>,
  axis: FlipAxis,
): Affine | null {
  for (const m of members) {
    const origin = origins.get(m.id);
    if (!origin) continue;
    return axis === 'horizontal'
      ? layerFlip(axis, m.texture.x, origin.x, m.texture.width)
      : layerFlip(axis, m.texture.y, origin.y, m.texture.height);
  }
  return null;
}

/**
 * Turn a live text layer with the canvas: the quarter turn joins its
 * transform and its anchor moves to where the rotated canvas puts it, then
 * the glyphs are re-rendered — the text stays editable.
 */
function rotateTextLayerWithCanvas(
  engine: Engine,
  layer: TextLayer,
  direction: 'cw' | 'ccw',
  docWidth: number,
  docHeight: number,
): Layer {
  if (layer.pathId) return layer;
  const frame = measureTextFrame(engine, layer);
  if (!frame) return layer;
  // CW maps (x, y) → (H − y, x); CCW maps (x, y) → (y, W − x).
  const turn = direction === 'cw' ? ROTATE_CW : ROTATE_CCW;
  const shift = direction === 'cw' ? { x: docHeight, y: 0 } : { x: 0, y: docWidth };
  const turned = applyDocumentLinear(frame, turn, { x: 0, y: 0 });
  const anchor = { x: turned.anchor.x + shift.x, y: turned.anchor.y + shift.y };
  const next: TextLayer = { ...layer, transform: textTransformFor(turned.matrix, anchor, layer.x, layer.y) };
  const pos = placeTextLayerAtAnchor(engine, next, anchor.x, anchor.y);
  if (!pos) return layer;
  pixelDataManager.remove(layer.id);
  return { ...next, ...placementProps(pos) };
}

export function rotateImage(direction: 'cw' | 'ccw'): void {
  const state = useEditorStore.getState();
  const doc = state.document;

  const engine = getEngine();
  if (!engine) return;

  state.pushHistory(direction === 'cw' ? 'Rotate Image 90° CW' : 'Rotate Image 90° CCW');

  const newWidth = doc.height;
  const newHeight = doc.width;
  const newLayers: Layer[] = [];

  // Every layer whose texture changes must be re-snapshotted on the next
  // pushHistory: a full-canvas layer on a square document keeps its
  // position and size, so it would otherwise reuse the pre-rotate handle.
  const rewrittenLayerIds: string[] = [];
  for (const layer of doc.layers) {
    if (layer.type === 'text' && layer.pathId) {
      newLayers.push(turnPathTextOffset(layer, direction));
      continue;
    }
    if (layer.type === 'text') {
      const turned = rotateTextLayerWithCanvas(engine, layer, direction, doc.width, doc.height);
      if (turned !== layer) rewrittenLayerIds.push(layer.id);
      newLayers.push(turned);
      continue;
    }
    if (layer.type !== 'raster') {
      newLayers.push(layer);
      continue;
    }

    // GPU-side rotate
    rotateLayer90(engine, layer.id, direction === 'cw');
    rewrittenLayerIds.push(layer.id);

    // Rotate layer position around document center
    let newX: number;
    let newY: number;
    if (direction === 'cw') {
      newX = doc.height - layer.y - layer.height;
      newY = layer.x;
    } else {
      newX = layer.y;
      newY = doc.width - layer.x - layer.width;
    }

    newLayers.push({
      ...layer,
      x: newX,
      y: newY,
      width: layer.height,
      height: layer.width,
    } as Layer);
  }

  const maskedLayers = remapDocumentMasks(
    engine, doc.layers, newLayers, documentRotation90(direction, doc.width, doc.height), newWidth, newHeight,
  );

  // Update document size on the engine
  setDocumentSize(engine, newWidth, newHeight);

  // GPU-side rotate invalidates every layer's JS cache. clearAll() is a
  // one-shot (see its call sites in history-slice.ts) and would go silent
  // on a second consecutive rotate — use invalidateLayers() instead (#918).
  pixelDataManager.invalidateLayers(maskedLayers.map((l) => l.id));
  useEditorStore.setState({
    dirtyLayerIds: new Set([...useEditorStore.getState().dirtyLayerIds, ...rewrittenLayerIds]),
    document: {
      ...doc,
      width: newWidth,
      height: newHeight,
      layers: maskedLayers,
    },
    paths: rotatePathsForCanvas(state.paths, direction, doc.width, doc.height),
    renderVersion: state.renderVersion + 1,
  });
  const { guides } = useUIStore.getState();
  useUIStore.setState({ guides: rotateGuidesForCanvas(guides, direction, doc.width, doc.height) });
}

/**
 * Path-bound text re-lays itself on its path once the path turns with the
 * canvas; turning the layer's offset off the path keeps a nudged layer the
 * same distance from the path in the rotated frame.
 */
function turnPathTextOffset(layer: TextLayer, direction: 'cw' | 'ccw'): TextLayer {
  if (layer.pathAnchorX === undefined || layer.pathAnchorY === undefined) return layer;
  const dx = layer.x - layer.pathAnchorX;
  const dy = layer.y - layer.pathAnchorY;
  const turned = direction === 'cw' ? { x: -dy, y: dx } : { x: dy, y: -dx };
  return { ...layer, pathAnchorX: layer.x - turned.x, pathAnchorY: layer.y - turned.y };
}

/** The group Image > Auto adds its node to: the active layer when it is a group, else the root group. */
export function getActiveGroupId(): string | null {
  const state = useEditorStore.getState();
  const doc = state.document;
  const activeId = doc.activeLayerId;
  if (activeId) {
    const active = doc.layers.find((l) => l.id === activeId);
    if (active?.type === 'group') return active.id;
  }
  return doc.rootGroupId ?? null;
}

async function getActiveLayerPixels(): Promise<Uint8ClampedArray | null> {
  const state = useEditorStore.getState();
  const activeId = state.document.activeLayerId;
  if (!activeId) return null;
  const imageData = await readLayerAsImageData(activeId);
  return imageData?.data ?? null;
}

function addAdjustmentAndCommit(node: AdjustmentNode, label: string): void {
  const groupId = getActiveGroupId();
  if (!groupId) return;

  const state = useEditorStore.getState();
  state.pushHistory(label);

  const doc = useEditorStore.getState().document;
  const group = doc.layers.find((l) => l.id === groupId) as GroupLayer | undefined;
  if (!group || group.type !== 'group') return;

  const layers = doc.layers.map((l) => {
    if (l.id !== groupId || l.type !== 'group') return l;
    const updated = { ...l, adjustments: [...l.adjustments, node] } as GroupLayer;
    if (updated.blendMode === 'pass-through') {
      return { ...updated, blendMode: 'normal' } as Layer;
    }
    return updated as Layer;
  });
  useEditorStore.setState({ document: { ...doc, layers } });
  state.notifyRender();
}

export async function applyAutoTone(): Promise<void> {
  const pixels = await getActiveLayerPixels();
  if (!pixels) return;

  const levels = computeAutoTone(pixels);
  const node: AdjustmentNode = {
    id: crypto.randomUUID(),
    enabled: true,
    type: 'levels',
    levels,
  };
  addAdjustmentAndCommit(node, 'Auto Tone');
}

export async function applyAutoContrast(): Promise<void> {
  const pixels = await getActiveLayerPixels();
  if (!pixels) return;

  const levels = computeAutoContrast(pixels);
  const node: AdjustmentNode = {
    id: crypto.randomUUID(),
    enabled: true,
    type: 'levels',
    levels,
  };
  addAdjustmentAndCommit(node, 'Auto Contrast');
}

export async function applyAutoColor(): Promise<void> {
  const pixels = await getActiveLayerPixels();
  if (!pixels) return;

  const curves = computeAutoColor(pixels);
  const node: AdjustmentNode = {
    id: crypto.randomUUID(),
    enabled: true,
    type: 'curves',
    curves,
  };
  addAdjustmentAndCommit(node, 'Auto Color');
}
