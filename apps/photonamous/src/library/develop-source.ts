import type { Asset } from '@lopsy/photos-core/library/types';

/**
 * What the develop pipelines (the Edit view, exports, background previews)
 * decode for an asset. A Lopsy document is developed from its flattened
 * render, the PNG Lopsy saves beside the .lopsy: the same asset, pointing
 * at that file, as a PNG, so its edits sit on the render the way a photo's
 * sit on its original. The .lopsy itself only ever goes back to Lopsy.
 * Anything else, and a document without a render, is itself.
 */
export function developSource(asset: Asset): Asset {
  if (asset.kind !== 'document' || asset.renderFileId === null) return asset;
  return { ...asset, fileId: asset.renderFileId, format: 'png', mimeType: 'image/png' };
}

/** Whether the develop pipelines can open the asset: any photo, and a Lopsy document that has its render. */
export function isDevelopable(asset: Asset): boolean {
  return asset.kind !== 'document' || asset.renderFileId !== null;
}
