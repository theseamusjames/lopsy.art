/**
 * Bursts (spec Phase 5): consecutive shots from one camera, each within N
 * seconds of the one before, shown as one tile in "group bursts" mode.
 */

import type { Asset, AssetId } from '../library/types';
import { captureMs } from './asset-fields';

export interface Burst {
  /** The shown photo: the best rated, then the earliest. */
  readonly coverId: AssetId;
  /** In capture order. A photo outside any burst is a burst of one. */
  readonly assetIds: readonly AssetId[];
}

export interface BurstOptions {
  /** Largest gap between neighbouring shots, in seconds. Default 2. */
  readonly windowSeconds?: number;
}

function cameraKey(asset: Asset): string {
  return `${asset.camera?.make ?? ''}\u0001${asset.camera?.model ?? ''}`;
}

/**
 * Groups `assets` into bursts, returned in the order of `assets` (each at
 * the position of its first member there), so a sorted grid stays sorted.
 */
export function groupBursts(assets: readonly Asset[], options: BurstOptions = {}): Burst[] {
  const windowMs = (options.windowSeconds ?? 2) * 1000;
  const timed: { asset: Asset; ms: number; camera: string; order: number }[] = [];
  assets.forEach((asset, order) => {
    const ms = captureMs(asset);
    if (ms !== null && asset.camera) timed.push({ asset, ms, camera: cameraKey(asset), order });
  });
  timed.sort((a, b) => (a.camera < b.camera ? -1 : a.camera > b.camera ? 1 : a.ms - b.ms || a.order - b.order));

  const groupOf = new Map<AssetId, Asset[]>();
  let current: Asset[] = [];
  let previous: (typeof timed)[number] | null = null;
  for (const t of timed) {
    if (!previous || previous.camera !== t.camera || t.ms - previous.ms > windowMs) current = [];
    current.push(t.asset);
    groupOf.set(t.asset.id, current);
    previous = t;
  }

  const out: Burst[] = [];
  const emitted = new Set<Asset[]>();
  for (const asset of assets) {
    const group = groupOf.get(asset.id);
    if (!group) {
      out.push({ coverId: asset.id, assetIds: [asset.id] });
      continue;
    }
    if (emitted.has(group)) continue;
    emitted.add(group);
    let cover = group[0] ?? asset;
    for (const member of group) if (member.rating > cover.rating) cover = member;
    out.push({ coverId: cover.id, assetIds: group.map((a) => a.id) });
  }
  return out;
}
