/**
 * What a grid tile stands for. A plain asset id is a photo shown with its
 * primary version; `assetId#versionId` is another version of it, shown
 * when the photo's stack is open. Selection, focus and the viewers work on
 * these item ids; commands turn them back into assets or versions. Pure.
 */

import type { AssetId, LibraryView, Version, VersionId } from '@lopsy/photos-core/library/types';

export type ItemId = string;

const SEP = '#';

export function versionItemId(assetId: AssetId, versionId: VersionId): ItemId {
  return `${assetId}${SEP}${versionId}`;
}

export interface ParsedItem {
  readonly assetId: AssetId;
  /** null: the asset's primary version. */
  readonly versionId: VersionId | null;
}

export function parseItem(id: ItemId): ParsedItem {
  const at = id.indexOf(SEP);
  return at < 0 ? { assetId: id, versionId: null } : { assetId: id.slice(0, at), versionId: id.slice(at + 1) };
}

/** The version a tile shows: its own, else the asset's primary one. */
export function itemVersionId(id: ItemId, view: LibraryView): VersionId | null {
  const { assetId, versionId } = parseItem(id);
  return versionId ?? view.assets.get(assetId)?.primaryVersionId ?? null;
}

/** Distinct asset ids of items, in order. */
export function itemAssets(ids: Iterable<ItemId>): AssetId[] {
  const out: AssetId[] = [];
  const seen = new Set<AssetId>();
  for (const id of ids) {
    const { assetId } = parseItem(id);
    if (seen.has(assetId)) continue;
    seen.add(assetId);
    out.push(assetId);
  }
  return out;
}

/** Live versions by asset, oldest first. */
export function versionsByAsset(view: LibraryView): Map<AssetId, Version[]> {
  const out = new Map<AssetId, Version[]>();
  for (const v of view.versions.values()) {
    if (v.deleted) continue;
    const list = out.get(v.assetId) ?? [];
    list.push(v);
    out.set(v.assetId, list);
  }
  for (const list of out.values()) {
    list.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
  }
  return out;
}

/** "Version 2", "Version 3"…: the first number no version of the photo uses. */
export function nextVersionName(existing: readonly string[]): string {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()));
  for (let n = 2; ; n++) {
    const name = `Version ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}
