import type { Layer } from '../../../../types';
import type { Engine } from '../../../../engine-wasm/wasm-bridge';
import { remapLayerMask } from '../../../../engine-wasm/wasm-bridge';
import { seedMaskDataRef } from '../../../../engine-wasm/sync-state';
import { planMaskRemap, type Affine } from '../../../../layers/mask-remap';
import { markMaskDataFresh, readMask } from '../../../mask-data-sync';

/**
 * Carry `after`'s mask through an operation that moved the layer's content
 * by `forward` (old → new document space). The GPU mask is resampled in
 * place and read straight back, so `mask.data` and its dimensions match
 * the texture and the next sync has nothing to re-upload.
 */
export function remapLayerMaskThrough(
  engine: Engine | null,
  before: Layer,
  after: Layer,
  forward: Affine,
  docWidth: number,
  docHeight: number,
): Layer {
  if (!engine || !after.mask) return after;
  const plan = planMaskRemap(before, after, forward, docWidth, docHeight);
  if (!plan) return after;
  const { a, b, c, d, e, f } = plan.inverse;
  remapLayerMask(engine, after.id, plan.width, plan.height, a, b, c, d, e, f);
  const data = readMask(after.id);
  if (!data || data.length !== plan.width * plan.height) return after;
  seedMaskDataRef(engine, after.id, data);
  markMaskDataFresh(after.id);
  return { ...after, mask: { ...after.mask, data, width: plan.width, height: plan.height } } as Layer;
}

/**
 * `remapLayerMaskThrough` for a whole-document operation. Shape layers are
 * left alone because no document operation moves them, and so is any text
 * layer the operation returned unchanged.
 */
export function remapDocumentMasks(
  engine: Engine | null,
  before: readonly Layer[],
  after: readonly Layer[],
  forward: Affine,
  docWidth: number,
  docHeight: number,
): Layer[] {
  return after.map((layer, i) => {
    const prev = before[i];
    if (!prev || prev.id !== layer.id) return layer;
    if (layer.type === 'shape' || (layer.type === 'text' && layer === prev)) return layer;
    return remapLayerMaskThrough(engine, prev, layer, forward, docWidth, docHeight);
  });
}
