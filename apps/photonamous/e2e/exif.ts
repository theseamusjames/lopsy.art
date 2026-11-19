import type { Asset } from '../../../packages/photos-core/src/library/types';
import { buildExportExif, insertJpegExif } from '../../../packages/photos-core/src/export/exif-writer';
import { DEFAULT_EXPORT_SETTINGS } from '../../../packages/photos-core/src/export/types';

export interface TestExif {
  /** 'YYYY-MM-DDTHH:mm:ss' */
  readonly capturedAt: string;
  readonly make: string;
  readonly model: string;
}

/** Writes DateTimeOriginal and the camera into a JPEG, as a camera would. */
export function withExif(jpeg: Buffer, exif: TestExif): Buffer {
  // buildExportExif reads only these fields of the asset.
  const asset = {
    capturedAt: exif.capturedAt,
    camera: { make: exif.make, model: exif.model },
    exposure: null,
    lens: null,
    gps: null,
  } as unknown as Asset;
  const tiff = buildExportExif(asset, { ...DEFAULT_EXPORT_SETTINGS, metadata: 'all' });
  return Buffer.from(insertJpegExif(new Uint8Array(jpeg), tiff));
}
