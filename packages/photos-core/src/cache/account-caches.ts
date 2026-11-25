/**
 * The device caches for one account, in OPFS under `/<sub>/originals` and
 * `/<sub>/previews` (spec 6.7), so two accounts on one browser never mix.
 * Browser only; tests build the caches over fake directory handles.
 */

import type { DirectoryHandle } from '../storage/local-folder-adapter';
import { OpfsBlobCache } from './opfs-blob-cache';
import { defaultOriginalsBudget, OriginalsCache } from './originals-cache';
import { PREVIEWS_DEFAULT_BUDGET, PreviewCache } from './preview-cache';

export interface AccountCaches {
  readonly originals: OriginalsCache;
  readonly previews: PreviewCache;
}

export interface AccountCacheOptions {
  /** Bytes; default min(20 GB, 30 % of the quota). */
  readonly originalsBudget?: number;
  /** Bytes; default 2 GB. */
  readonly previewsBudget?: number;
  /** The directory holding one folder per account; default the OPFS root. */
  readonly root?: DirectoryHandle;
}

/** `accountId` is the Google `sub` (or a fixed name such as 'local' for the local adapters). */
export async function openAccountCaches(accountId: string, options: AccountCacheOptions = {}): Promise<AccountCaches> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(accountId)) throw new RangeError(`Not a usable account ID: ${accountId}`);
  const root = options.root ?? (await navigator.storage.getDirectory());
  const account = await root.getDirectoryHandle(accountId, { create: true });
  const [originalsDir, previewsDir] = await Promise.all([
    account.getDirectoryHandle('originals', { create: true }),
    account.getDirectoryHandle('previews', { create: true }),
  ]);
  const [originals, previews] = await Promise.all([
    OpfsBlobCache.open(originalsDir, { budget: options.originalsBudget ?? (await defaultOriginalsBudget()) }),
    OpfsBlobCache.open(previewsDir, { budget: options.previewsBudget ?? PREVIEWS_DEFAULT_BUDGET }),
  ]);
  return { originals: new OriginalsCache(originals), previews: new PreviewCache(previews) };
}
