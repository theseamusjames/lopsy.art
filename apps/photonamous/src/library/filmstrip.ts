/**
 * The Edit view's filmstrip (spec 5.4) in the library's terms: the grid's
 * tiles in its order, each resolved to the photo and the version it shows.
 * A photo's tile shows its shown (primary) version; a version's own tile,
 * there while the photo's stack is open, shows that version. Pure.
 */

import type { AssetId, LibraryView, PreviewRef, VersionId } from '@lopsy/photos-core/library/types';
import { itemForVersion, parseItem, type ItemId } from './items';

/** A photo and one of its versions: what the Edit view opens. */
export interface PhotoVersion {
  readonly assetId: AssetId;
  readonly versionId: VersionId;
}

export interface StripEntry extends PhotoVersion {
  /** The tile it stands for. */
  readonly id: ItemId;
  /** The photo's file name, and the version's name on a version's own tile. */
  readonly label: string;
  /** The version's 512 px preview. */
  readonly thumb: PreviewRef | null;
}

/** The photo and version a tile opens in the Edit view; null for a tile whose photo or version is gone. */
export function editTargetOf(view: LibraryView, id: ItemId): PhotoVersion | null {
  const { assetId, versionId } = parseItem(id);
  const asset = view.assets.get(assetId);
  if (!asset || asset.deleted) return null;
  const target = versionId ?? asset.primaryVersionId;
  const version = view.versions.get(target);
  if (!version || version.deleted || version.assetId !== assetId) return null;
  return { assetId, versionId: target };
}

/** The filmstrip's tiles: the grid's, in order. */
export function filmstripEntries(orderedIds: readonly ItemId[], view: LibraryView): StripEntry[] {
  const out: StripEntry[] = [];
  for (const id of orderedIds) {
    const target = editTargetOf(view, id);
    const asset = target && view.assets.get(target.assetId);
    const version = target && view.versions.get(target.versionId);
    if (!target || !asset || !version) continue;
    const isOwnTile = version.id !== asset.primaryVersionId;
    out.push({ ...target, id, label: isOwnTile ? `${asset.fileName} (${version.name})` : asset.fileName, thumb: version.thumb });
  }
  return out;
}

/**
 * The tile the filmstrip marks as open: the version's own tile when the
 * grid shows it, else the photo's first tile there (its own tile comes
 * before its versions'). When the photo is not in the grid at all, an id
 * no tile has, so none is marked and ← → have nowhere to go.
 */
export function currentStripId(entries: readonly StripEntry[], view: LibraryView, open: PhotoVersion): ItemId {
  const own = itemForVersion(view, open.assetId, open.versionId);
  const entry = entries.find((e) => e.id === own) ?? entries.find((e) => e.assetId === open.assetId);
  return entry?.id ?? own;
}
