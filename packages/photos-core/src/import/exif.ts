import type { CameraInfo, ExposureInfo, GpsInfo, ImageFormat } from '../library/types';
import { readRafHeader, scanJpeg, scanPng, scanWebp } from './containers';
import { MIME_TYPES, detectFormat } from './detect-format';
import {
  GpsTag,
  TiffTag,
  collectImageIfds,
  findCfaImageIfd,
  getNumber,
  getNumbers,
  getRational,
  getString,
  openTiff,
  readIfd,
  readPointedIfd,
} from './tiff';
import type { TiffFile, TiffIfd } from './tiff';
import type { ImageMetadata } from './types';

/** What the EXIF/TIFF tags say, before the container's own facts are merged in. */
export interface TiffMetadata {
  readonly make: string | null;
  readonly model: string | null;
  readonly lens: string | null;
  readonly orientation: number | null;
  readonly capturedAt: string | null;
  readonly exposure: ExposureInfo | null;
  readonly gps: GpsInfo | null;
}

const EMPTY_TIFF_METADATA: TiffMetadata = {
  make: null,
  model: null,
  lens: null,
  orientation: null,
  capturedAt: null,
  exposure: null,
  gps: null,
};

function nonEmpty(value: string | null): string | null {
  return value === null || value === '' ? null : value;
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function trimNumber(value: number): string {
  return String(round(value, 1));
}

/** Shutter speed as written for people: '1/250', '2.5', '30'. */
export function formatExposureTime(num: number, den: number): string | null {
  if (!(num > 0) || !(den > 0)) return null;
  const seconds = num / den;
  if (seconds >= 1) return trimNumber(seconds);
  const reciprocal = den / num;
  const nearest = Math.round(reciprocal);
  // Fractions like 10/25 (0.4 s) have no exact 1/n form; cameras write those as decimals.
  if (seconds < 0.25 || Math.abs(reciprocal - nearest) < 0.01 * reciprocal) return `1/${nearest}`;
  return trimNumber(seconds);
}

const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const EXIF_OFFSET = /^[+-]\d{2}:\d{2}$/;

/** 'YYYY:MM:DD HH:MM:SS' to 'YYYY-MM-DDTHH:mm:ss', plus the offset when valid. */
export function formatExifDate(value: string | null, offset: string | null): string | null {
  if (!value) return null;
  const m = EXIF_DATE.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const month = Number(mo);
  const day = Number(d);
  if (Number(y) === 0 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 60) return null;
  const base = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  return offset && EXIF_OFFSET.test(offset) ? base + offset : base;
}

function readDegrees(tiff: TiffFile, ifd: TiffIfd, tag: number): number | null {
  const parts = getNumbers(tiff, ifd, tag);
  if (!parts || parts.length === 0 || parts.some((v) => !Number.isFinite(v))) return null;
  const [deg = 0, min = 0, sec = 0] = parts;
  return deg + min / 60 + sec / 3600;
}

function readGps(tiff: TiffFile, gpsIfd: TiffIfd): GpsInfo | null {
  let lat = readDegrees(tiff, gpsIfd, GpsTag.Latitude);
  let lon = readDegrees(tiff, gpsIfd, GpsTag.Longitude);
  if (lat === null || lon === null) return null;
  if (getString(tiff, gpsIfd, GpsTag.LatitudeRef)?.toUpperCase() === 'S') lat = -lat;
  if (getString(tiff, gpsIfd, GpsTag.LongitudeRef)?.toUpperCase() === 'W') lon = -lon;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  let alt = getNumber(tiff, gpsIfd, GpsTag.Altitude);
  if (alt !== null && getNumber(tiff, gpsIfd, GpsTag.AltitudeRef) === 1) alt = -alt;
  return { lat: round(lat, 7), lon: round(lon, 7), alt: alt === null ? null : round(alt, 2) };
}

function positive(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

/** EXIF facts from IFD0 and the Exif and GPS IFDs it points at. */
export function readTiffMetadata(tiff: TiffFile, ifd0: TiffIfd): TiffMetadata {
  const exif = readPointedIfd(tiff, ifd0, TiffTag.ExifIfd);
  const gpsIfd = readPointedIfd(tiff, ifd0, TiffTag.GpsIfd);
  const fromEither = <T>(read: (ifd: TiffIfd) => T | null): T | null =>
    (exif ? read(exif) : null) ?? read(ifd0);

  const iso = fromEither((ifd) => positive(getNumber(tiff, ifd, TiffTag.Iso))) ??
    fromEither((ifd) => positive(getNumber(tiff, ifd, TiffTag.RecommendedExposureIndex)));
  const time = fromEither((ifd) => getRational(tiff, ifd, TiffTag.ExposureTime));
  const shutter = time ? formatExposureTime(time.num, time.den) : null;
  const fNumber = fromEither((ifd) => positive(getNumber(tiff, ifd, TiffTag.FNumber)));
  const focal = fromEither((ifd) => positive(getNumber(tiff, ifd, TiffTag.FocalLength)));
  const exposure: ExposureInfo | null =
    iso === null && shutter === null && fNumber === null && focal === null
      ? null
      : {
          iso: iso === null ? null : Math.round(iso),
          shutter,
          aperture: fNumber === null ? null : round(fNumber, 1),
          focalLength: focal === null ? null : round(focal, 1),
        };

  const orientation = getNumber(tiff, ifd0, TiffTag.Orientation);
  return {
    make: nonEmpty(getString(tiff, ifd0, TiffTag.Make)),
    model: nonEmpty(getString(tiff, ifd0, TiffTag.Model)),
    lens: nonEmpty(fromEither((ifd) => getString(tiff, ifd, TiffTag.LensModel))),
    orientation: orientation !== null && orientation >= 1 && orientation <= 8 ? orientation : null,
    capturedAt: formatExifDate(
      fromEither((ifd) => getString(tiff, ifd, TiffTag.DateTimeOriginal)),
      fromEither((ifd) => getString(tiff, ifd, TiffTag.OffsetTimeOriginal)),
    ),
    exposure,
    gps: gpsIfd ? readGps(tiff, gpsIfd) : null,
  };
}

/** EXIF facts from a TIFF block at `base`; empty when there is none. */
export function readExifAt(bytes: Uint8Array, base: number | null): TiffMetadata {
  if (base === null) return EMPTY_TIFF_METADATA;
  const tiff = openTiff(bytes, base);
  const ifd0 = tiff ? readIfd(tiff, tiff.firstIfd) : null;
  return tiff && ifd0 ? readTiffMetadata(tiff, ifd0) : EMPTY_TIFF_METADATA;
}

/** Orientations 5 to 8 swap width and height. */
export function swapsAxes(orientation: number): boolean {
  return orientation >= 5 && orientation <= 8;
}

/** An image IFD's picture size: its DefaultCropSize when present, else its stored size. */
function croppedSize(tiff: TiffFile, ifd: TiffIfd): { width: number; height: number } | null {
  const crop = getNumbers(tiff, ifd, TiffTag.DefaultCropSize);
  const width = crop?.[0] ?? getNumber(tiff, ifd, TiffTag.ImageWidth);
  const height = crop?.[1] ?? getNumber(tiff, ifd, TiffTag.ImageLength);
  return width && height && width > 0 && height > 0 ? { width: Math.round(width), height: Math.round(height) } : null;
}

/** A DNG's main image size: the IFD with NewSubfileType 0, DefaultCropSize when present. */
export function dngImageSize(tiff: TiffFile): { width: number; height: number } | null {
  for (const ifd of collectImageIfds(tiff)) {
    if ((getNumber(tiff, ifd, TiffTag.NewSubfileType) ?? 0) !== 0) continue;
    const size = croppedSize(tiff, ifd);
    if (size) return size;
  }
  return null;
}

/**
 * An ARW's picture size: the raw (CFA) image's DefaultCropSize, the part
 * of the sensor the engine's decode keeps, else the raw image's stored size.
 */
export function arwImageSize(tiff: TiffFile): { width: number; height: number } | null {
  const raw = findCfaImageIfd(tiff);
  return raw ? croppedSize(tiff, raw) : null;
}

function camera(make: string | null, model: string | null): CameraInfo | null {
  if (make === null && model === null) return null;
  return { make: make ?? '', model: model ?? '' };
}

interface Facts {
  readonly tags: TiffMetadata;
  readonly width: number | null;
  readonly height: number | null;
  readonly fallbackMake?: string;
  readonly fallbackModel?: string;
}

function readFacts(bytes: Uint8Array, format: ImageFormat): Facts {
  switch (format) {
    case 'jpeg': {
      const info = scanJpeg(bytes);
      return { tags: readExifAt(bytes, info.exifBase), width: info.width, height: info.height };
    }
    case 'png': {
      const info = scanPng(bytes);
      return { tags: readExifAt(bytes, info.exifBase), width: info.width, height: info.height };
    }
    case 'webp': {
      const info = scanWebp(bytes);
      return { tags: readExifAt(bytes, info.exifBase), width: info.width, height: info.height };
    }
    case 'raf': {
      const header = readRafHeader(bytes);
      if (!header) return { tags: EMPTY_TIFF_METADATA, width: null, height: null };
      const jpeg = scanJpeg(bytes, header.jpegOffset, header.jpegOffset + header.jpegLength);
      return {
        tags: readExifAt(bytes, jpeg.exifBase),
        width: header.width,
        height: header.height,
        fallbackMake: 'FUJIFILM',
        fallbackModel: header.model || undefined,
      };
    }
    case 'dng': {
      const tiff = openTiff(bytes);
      const ifd0 = tiff ? readIfd(tiff, tiff.firstIfd) : null;
      if (!tiff || !ifd0) return { tags: EMPTY_TIFF_METADATA, width: null, height: null };
      const size = dngImageSize(tiff);
      return { tags: readTiffMetadata(tiff, ifd0), width: size?.width ?? null, height: size?.height ?? null };
    }
    case 'arw': {
      const tiff = openTiff(bytes);
      const ifd0 = tiff ? readIfd(tiff, tiff.firstIfd) : null;
      if (!tiff || !ifd0) return { tags: EMPTY_TIFF_METADATA, width: null, height: null };
      const size = arwImageSize(tiff);
      return { tags: readTiffMetadata(tiff, ifd0), width: size?.width ?? null, height: size?.height ?? null };
    }
    case 'lopsy':
      return { tags: EMPTY_TIFF_METADATA, width: null, height: null };
  }
}

/** Metadata from a file's bytes; null when the format is not one import supports. */
export function readMetadata(bytes: Uint8Array): ImageMetadata | null {
  const format = detectFormat(bytes);
  if (format === null) return null;
  const facts = readFacts(bytes, format);
  const orientation = facts.tags.orientation ?? 1;
  const swap = swapsAxes(orientation);
  return {
    format,
    mimeType: MIME_TYPES[format],
    width: swap ? facts.height : facts.width,
    height: swap ? facts.width : facts.height,
    orientation,
    capturedAt: facts.tags.capturedAt,
    camera: camera(facts.tags.make ?? facts.fallbackMake ?? null, facts.tags.model ?? facts.fallbackModel ?? null),
    lens: facts.tags.lens,
    exposure: facts.tags.exposure,
    gps: facts.tags.gps,
  };
}
