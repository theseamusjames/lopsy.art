/**
 * The engine's description of a RAW file (`rawPrepare`'s `describeJson`,
 * `lopsy_core::raw::RawDescription`): everything the app needs to show and
 * develop a prepared file of any format, so nothing here knows one format
 * from another. A format's own facts arrive as fields of the description
 * (its white-balance model, its profiles, whether it has finished bands).
 */

import type { ImageFormat } from '@lopsy/photos-core/library/types';
import { readDevelopProfiles, type DevelopProfile } from '../profiles';
import { readRawDevelopSettings, type RawDevelopSettings } from '../raw-develop';
import { readKelvinScale, readPresets, type KelvinScale, type WhiteBalancePresetValues } from '../white-balance';

/** The engine's format ids; a new format brings its own. */
export type RawFormatId = 'raf' | 'dng' | 'arw' | (string & {});

/** The formats the Edit view develops through the RAW interface. */
export const RAW_PATH_FORMATS: ReadonlySet<ImageFormat> = new Set<ImageFormat>(['raf', 'dng', 'arw']);

/**
 * How a photo in `format` opens: 'raw', through the RAW interface; 'baked',
 * as the finished picture the engine's baked decode makes, where the GPU
 * has no float targets and the format renders no finished look in bands;
 * 'image', any other photo. (A file the RAW interface cannot prepare also
 * falls back to the baked decode, once it has tried.)
 *
 * `rendersFinishedBands` is the engine's `rawRendersFinishedBands`, which
 * answers from the format id alone, so the choice is made before any
 * worker starts; the decode checks the file's description agrees.
 */
export function rawLoadPath(
  format: ImageFormat,
  hasFloat: boolean,
  rendersFinishedBands: (format: string) => boolean,
): 'raw' | 'baked' | 'image' {
  if (!RAW_PATH_FORMATS.has(format)) return 'image';
  return hasFloat || rendersFinishedBands(format) ? 'raw' : 'baked';
}

/** Where Kelvin comes from, if anywhere. */
export type KelvinModel =
  | ({ readonly kind: 'fitted' } & KelvinScale)
  | { readonly kind: 'measured'; readonly asShotKelvin: number; readonly asShotTint: number }
  | { readonly kind: 'none' };

export interface RawWhiteBalanceModel {
  /** 'fixed': one matrix whatever the white (the profile's); 'perWhite': the matrix follows the white. */
  readonly matrix: 'fixed' | 'perWhite';
  readonly kelvin: KelvinModel;
  readonly presetSource: 'camera' | 'illuminants' | 'none';
  /** In the recipe's units, in menu order. */
  readonly presets: readonly WhiteBalancePresetValues[];
}

export interface RawDescription {
  readonly format: RawFormatId;
  /** The final (oriented) size: the developed picture's. */
  readonly width: number;
  readonly height: number;
  /** The plane's size before orientation; a plane row is `planeWidth × samplesPerPixel` values. */
  readonly planeWidth: number;
  readonly planeHeight: number;
  readonly samplesPerPixel: number;
  readonly clipLevels: readonly [number, number, number] | null;
  readonly cameraModel: string;
  /** A sentence for under the Profile control, when there is one. */
  readonly colorNote: string | null;
  readonly notApplied: readonly string[];
  /** `setRawDevelop`'s settings to open with. */
  readonly developDefaults: RawDevelopSettings;
  readonly profiles: readonly DevelopProfile[];
  readonly whiteBalance: RawWhiteBalanceModel;
  /** Whether `rawRenderFinishedBand` renders the finished look (the path without float targets). */
  readonly finishedBands: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function readKelvinModel(raw: unknown): KelvinModel {
  if (!isRecord(raw)) return { kind: 'none' };
  if (raw.kind === 'fitted') {
    const scale = readKelvinScale(raw);
    return scale ? { kind: 'fitted', ...scale } : { kind: 'none' };
  }
  if (raw.kind === 'measured') {
    const asShotKelvin = finite(raw.asShotKelvin);
    const asShotTint = finite(raw.asShotTint);
    if (asShotKelvin !== null && asShotKelvin > 0 && asShotTint !== null) return { kind: 'measured', asShotKelvin, asShotTint };
  }
  return { kind: 'none' };
}

function readWhiteBalanceModel(raw: unknown): RawWhiteBalanceModel {
  if (!isRecord(raw)) throw new Error('The RAW description has no white-balance model');
  if (raw.matrix !== 'fixed' && raw.matrix !== 'perWhite') throw new Error('The RAW description names no white-balance matrix model');
  const presetSource = raw.presetSource === 'camera' || raw.presetSource === 'illuminants' ? raw.presetSource : 'none';
  return { matrix: raw.matrix, kelvin: readKelvinModel(raw.kelvin), presetSource, presets: readPresets(raw.presets) };
}

function readClipLevels(raw: unknown): readonly [number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  const [r, g, b] = raw.map(finite);
  return r != null && g != null && b != null ? [r, g, b] : null;
}

/** Reads `describeJson`; throws when it is not a description the app can develop. */
export function parseRawDescription(json: string): RawDescription {
  const raw: unknown = JSON.parse(json);
  if (!isRecord(raw)) throw new Error('The RAW description is not an object');
  const { format, width, height, planeWidth, planeHeight, samplesPerPixel } = raw;
  if (typeof format !== 'string' || format === '') throw new Error('The RAW description names no format');
  if (!isCount(width) || !isCount(height)) throw new Error('The RAW file decoded to an empty image');
  if (!isCount(planeWidth) || !isCount(planeHeight) || !isCount(samplesPerPixel)) throw new Error('The RAW description gives no plane size');
  return {
    format,
    width,
    height,
    planeWidth,
    planeHeight,
    samplesPerPixel,
    clipLevels: readClipLevels(raw.clipLevels),
    cameraModel: typeof raw.cameraModel === 'string' ? raw.cameraModel : '',
    colorNote: typeof raw.colorNote === 'string' && raw.colorNote !== '' ? raw.colorNote : null,
    notApplied: Array.isArray(raw.notApplied) ? raw.notApplied.filter((n): n is string => typeof n === 'string') : [],
    developDefaults: readRawDevelopSettings(raw.developDefaults),
    profiles: readDevelopProfiles(raw.profiles),
    whiteBalance: readWhiteBalanceModel(raw.whiteBalance),
    finishedBands: raw.finishedBands === true,
  };
}
