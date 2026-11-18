/**
 * Free-text search over file name, title, caption, keywords, camera and
 * lens: case- and accent-insensitive, every query word must start a word
 * of the photo ("har bou" finds "Harbour, Boulogne").
 */

import type { Asset, AssetId, LibraryView } from '../library/types';

const COMBINING_MARKS = /\p{M}+/gu;
const SEPARATORS = /[^\p{L}\p{N}]+/u;
/** Separates words in the indexed text; never produced by `normalizeText`. */
const SEP = '\u0001';

/** Lower case, without accents. */
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase();
}

export function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(SEPARATORS)
    .filter((t) => t !== '');
}

/** The words a photo is found by. */
export function assetSearchText(asset: Asset): string {
  const fields = [
    asset.fileName,
    asset.title,
    asset.caption,
    ...asset.keywords,
    asset.camera?.make ?? '',
    asset.camera?.model ?? '',
    asset.lens ?? '',
  ];
  const tokens = tokenize(fields.join(' '));
  return SEP + tokens.join(SEP);
}

/** A parsed query; empty matches everything. */
export interface TextQuery {
  readonly needles: readonly string[];
}

export function parseTextQuery(query: string): TextQuery {
  return { needles: tokenize(query).map((t) => SEP + t) };
}

/**
 * The indexed text of every asset in a view, kept up to date by `update`,
 * which re-indexes only assets whose object changed since the last call.
 */
export class TextIndex {
  private readonly entries = new Map<AssetId, { asset: Asset; text: string }>();
  private assets: LibraryView['assets'] | null = null;
  /** How many assets the last `update` re-indexed; for tests and diagnostics. */
  lastReindexed = 0;

  update(view: LibraryView): void {
    if (view.assets === this.assets) {
      this.lastReindexed = 0;
      return;
    }
    let reindexed = 0;
    for (const asset of view.assets.values()) {
      const entry = this.entries.get(asset.id);
      if (entry?.asset === asset) continue;
      this.entries.set(asset.id, { asset, text: assetSearchText(asset) });
      reindexed++;
    }
    if (this.entries.size > view.assets.size) {
      for (const id of this.entries.keys()) if (!view.assets.has(id)) this.entries.delete(id);
    }
    this.assets = view.assets;
    this.lastReindexed = reindexed;
  }

  get size(): number {
    return this.entries.size;
  }

  matches(assetId: AssetId, query: TextQuery): boolean {
    const entry = this.entries.get(assetId);
    if (!entry) return false;
    return query.needles.every((n) => entry.text.includes(n));
  }

  /** IDs of matching assets, in index order. */
  search(query: string | TextQuery): AssetId[] {
    const q = typeof query === 'string' ? parseTextQuery(query) : query;
    const out: AssetId[] = [];
    for (const [id, entry] of this.entries) {
      if (q.needles.every((n) => entry.text.includes(n))) out.push(id);
    }
    return out;
  }
}
