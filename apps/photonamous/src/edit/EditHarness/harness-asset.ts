/** Builds the library records the Edit view needs for a file opened in the harness. */

import { DEFAULT_RECIPE, type Recipe } from '@lopsy/photos-core/library/recipe';
import type { Asset, ImageFormat, PreviewRef, Version } from '@lopsy/photos-core/library/types';

const BY_EXTENSION: Readonly<Record<string, ImageFormat>> = {
  raf: 'raf',
  dng: 'dng',
  arw: 'arw',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  png: 'png',
  webp: 'webp',
};

const BY_MIME: Readonly<Record<string, ImageFormat>> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/x-fuji-raf': 'raf',
  'image/x-adobe-dng': 'dng',
  'image/x-sony-arw': 'arw',
};

export function formatOf(fileName: string, mimeType: string): ImageFormat | null {
  const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  return BY_EXTENSION[ext] ?? BY_MIME[mimeType] ?? null;
}

export function harnessAsset(id: string, fileName: string, byteSize: number, format: ImageFormat, mimeType: string): Asset {
  return {
    id,
    kind: 'original',
    fileId: id,
    sha256: '',
    fileName,
    byteSize,
    format,
    mimeType,
    capturedAt: null,
    importedAt: new Date(0).toISOString(),
    importId: 'harness',
    width: null,
    height: null,
    orientation: 1,
    camera: null,
    lens: null,
    exposure: null,
    gps: null,
    pairedWith: null,
    source: null,
    renderFileId: null,
    rating: 0,
    label: null,
    setAside: false,
    title: '',
    caption: '',
    keywords: [],
    primaryVersionId: `${id}-v1`,
    deleted: false,
  };
}

export function harnessVersion(
  asset: Asset,
  recipe: Recipe = DEFAULT_RECIPE,
  previews: { thumb: PreviewRef | null; screen: PreviewRef | null } = { thumb: null, screen: null },
): Version {
  return {
    id: asset.primaryVersionId,
    assetId: asset.id,
    name: 'Original',
    recipe,
    createdAt: new Date(0).toISOString(),
    thumb: previews.thumb,
    screen: previews.screen,
    deleted: false,
  };
}
