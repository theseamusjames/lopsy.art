/**
 * The messages Photonamous and Lopsy exchange over `window.postMessage`
 * (spec 6.12). Every message carries `protocol: 1`; anything that arrives
 * is untrusted input and goes through the validator for its type before
 * either app acts on it.
 *
 * Send flow (Photonamous opens Lopsy with `?photos-handoff=<id>`):
 *   Lopsy       → Photonamous  lopsy:ready      { id }
 *   Photonamous → Lopsy        photos:document  { id, document }
 *   Lopsy       → Photonamous  lopsy:received   { id }
 *   Lopsy       → Photonamous  lopsy:save       { id, saveId, … }   (each save)
 *   Photonamous → Lopsy        photos:saved     { id, saveId, ok }
 *
 * Reopen flow (Lopsy opens Photonamous with `?receive=<id>`):
 *   Photonamous → Lopsy        photos:ready     { id }
 *   then lopsy:save / photos:saved as above.
 *
 * Before saving to a Photonamous tab it already knows, Lopsy checks that the tab
 * still listens for this handoff (it may have reloaded or navigated):
 *   Lopsy       → Photonamous  lopsy:ping       { id }
 *   Photonamous → Lopsy        photos:pong      { id }
 * No pong within `PING_TIMEOUT_MS` and Lopsy reopens Photonamous to receive.
 *
 * Grade a layer (Lopsy opens Photonamous with `?grade=<id>`):
 *   Photonamous → Lopsy        photos:ready     { id }
 *   Lopsy       → Photonamous  lopsy:grade      { id, layer }
 *   Photonamous → Lopsy        photos:graded    { id, ok: true, png, recipe }   (Done)
 *                                               { id, ok: false, cancelled }    (Cancel)
 */

export const PROTOCOL_VERSION = 1;

/** Query parameter Photonamous adds to Lopsy's URL to start a handoff. */
export const HANDOFF_PARAM = 'photos-handoff';
/** Query parameter Lopsy adds to Photonamous' URL when it reopens Photonamous to receive a save. */
export const RECEIVE_PARAM = 'receive';
/** Query parameter Lopsy adds to Photonamous' URL to grade one layer. */
export const GRADE_PARAM = 'grade';
/** Window name Lopsy opens Photonamous under to grade a layer. */
export const GRADE_WINDOW_NAME = 'photonamous-grade';
/** Largest side of a layer sent to be graded. */
export const MAX_GRADE_SIDE = 65536;
/** Largest recipe, as JSON, a graded layer may carry. */
export const MAX_RECIPE_JSON = 64 * 1024;

/** Window name Photonamous opens Lopsy under, so an open Lopsy tab is reused. */
export const LOPSY_WINDOW_NAME = 'lopsy-editor';
/** Window name Lopsy opens Photonamous under. */
export const PHOTOS_WINDOW_NAME = 'photonamous';

/** How long Lopsy waits for a pong before reopening Photonamous; short enough that the click still allows a popup. */
export const PING_TIMEOUT_MS = 1500;

/** Largest file either side accepts in one message (1 GiB). */
export const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const MAX_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 255;
const MAX_FIELD_LENGTH = 512;
const MAX_ERROR_LENGTH = 2000;
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const LOPSY_MAGIC = [0x4c, 0x4f, 0x50, 0x53, 0x59, 0x00];

export type HandoffDocumentKind = 'png16' | 'lopsy';

/** Where a document belongs in the Photonamous library. */
export interface HandoffSource {
  readonly libraryId: string;
  readonly assetId: string;
  readonly versionId: string;
  readonly recipeHash: string;
  /**
   * The library's document asset this file is, once there is one. Photonamous
   * sends it with a document it reopens and returns it with the first save
   * of a new document, so later saves update that document in place.
   */
  readonly documentId?: string;
}

/**
 * A summary of the photo's camera metadata (spec 6.12), for Lopsy to keep
 * in the `.lopsy` with the source block. Every field may be absent.
 */
export interface CameraSummary {
  readonly make?: string;
  readonly model?: string;
  readonly lens?: string;
  readonly iso?: number;
  /** As written for people: '1/250', '2.5'. */
  readonly shutter?: string;
  readonly aperture?: number;
  /** Millimetres. */
  readonly focalLength?: number;
  /** As the camera wrote it, e.g. '2026-11-14T16:02:11'. */
  readonly capturedAt?: string;
}

export interface HandoffDocument {
  readonly name: string;
  /** `png16`: a developed photo as a 16-bit PNG. `lopsy`: a `.lopsy` project. */
  readonly kind: HandoffDocumentKind;
  readonly bytes: ArrayBuffer;
  readonly source?: HandoffSource;
  /** The Drive revision a `.lopsy` came from; returned with each save. */
  readonly baseRevision?: string;
  readonly camera?: CameraSummary;
}

export interface LopsyReadyMessage {
  readonly protocol: 1;
  readonly type: 'lopsy:ready';
  readonly id: string;
}

export interface PhotosDocumentMessage {
  readonly protocol: 1;
  readonly type: 'photos:document';
  readonly id: string;
  readonly document: HandoffDocument;
}

export interface LopsyReceivedMessage {
  readonly protocol: 1;
  readonly type: 'lopsy:received';
  readonly id: string;
}

export interface PhotosReadyMessage {
  readonly protocol: 1;
  readonly type: 'photos:ready';
  readonly id: string;
}

export interface LopsySaveMessage {
  readonly protocol: 1;
  readonly type: 'lopsy:save';
  readonly id: string;
  /** Distinguishes saves within one handoff; `photos:saved` echoes it. */
  readonly saveId: string;
  readonly name: string;
  /** The `.lopsy` project bytes. */
  readonly lopsy: ArrayBuffer;
  /** The flattened composite as a 16-bit PNG. */
  readonly render: ArrayBuffer;
  /** Absent for Add to Photonamous: Photonamous files it as a new document. */
  readonly source?: HandoffSource;
  readonly baseRevision?: string;
}

export type PhotosSavedMessage =
  | {
      readonly protocol: 1;
      readonly type: 'photos:saved';
      readonly id: string;
      readonly saveId: string;
      readonly ok: true;
      /** The Drive revision the save created, for the next save's baseRevision. */
      readonly revision?: string;
      /** The document asset the save was stored as; Lopsy adds it to its source block. */
      readonly documentId?: string;
    }
  | {
      readonly protocol: 1;
      readonly type: 'photos:saved';
      readonly id: string;
      readonly saveId: string;
      readonly ok: false;
      readonly error: string;
    };

export interface LopsyPingMessage {
  readonly protocol: 1;
  readonly type: 'lopsy:ping';
  readonly id: string;
}

export interface PhotosPongMessage {
  readonly protocol: 1;
  readonly type: 'photos:pong';
  readonly id: string;
}

/**
 * One raster layer to grade. `pixels` is the engine's 16-bit layer blob
 * (`readLayerPixelsLz4U16`: a 32-byte geometry header, then LZ4), which the
 * Photonamous engine uploads as it is (`uploadLayerPixelsCompressedU16`).
 */
export interface GradeLayer {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly pixels: ArrayBuffer;
}

export interface LopsyGradeMessage {
  readonly protocol: 1;
  readonly type: 'lopsy:grade';
  readonly id: string;
  readonly layer: GradeLayer;
}

/** The develop recipe a grade used, as plain JSON (photos-core `Recipe`). */
export type GradeRecipe = Readonly<Record<string, unknown>>;

export type PhotosGradedMessage =
  | {
      readonly protocol: 1;
      readonly type: 'photos:graded';
      readonly id: string;
      readonly ok: true;
      /** The graded layer, full size, as a 16-bit PNG. */
      readonly png: ArrayBuffer;
      readonly recipe: GradeRecipe;
    }
  | {
      readonly protocol: 1;
      readonly type: 'photos:graded';
      readonly id: string;
      readonly ok: false;
      /** True when the user pressed Cancel; otherwise `error` says what failed. */
      readonly cancelled: boolean;
      readonly error?: string;
    };

export type HandoffMessage =
  | LopsyReadyMessage
  | PhotosDocumentMessage
  | LopsyReceivedMessage
  | PhotosReadyMessage
  | LopsySaveMessage
  | PhotosSavedMessage
  | LopsyPingMessage
  | PhotosPongMessage
  | LopsyGradeMessage
  | PhotosGradedMessage;

type Fields = Record<string, unknown>;

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for an ArrayBuffer from any realm (a cloned message's buffer comes from the receiver's). */
export function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

export function isHandoffId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH && ID_PATTERN.test(value);
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_NAME_LENGTH;
}

function startsWith(bytes: ArrayBuffer, signature: readonly number[]): boolean {
  if (bytes.byteLength < signature.length) return false;
  const head = new Uint8Array(bytes, 0, signature.length);
  return signature.every((b, i) => head[i] === b);
}

export function isPngBytes(bytes: ArrayBuffer): boolean {
  return startsWith(bytes, PNG_SIGNATURE);
}

export function isLopsyBytes(bytes: ArrayBuffer): boolean {
  return startsWith(bytes, LOPSY_MAGIC);
}

function isFile(value: unknown, check: (b: ArrayBuffer) => boolean): value is ArrayBuffer {
  return isArrayBuffer(value) && value.byteLength > 0 && value.byteLength <= MAX_FILE_BYTES && check(value);
}

function envelope(value: unknown, type: HandoffMessage['type']): value is Fields & { id: string } {
  return isRecord(value) && value.protocol === PROTOCOL_VERSION && value.type === type && isHandoffId(value.id);
}

/** A well-formed source block, or null. Extra fields are dropped. */
export function parseSource(value: unknown): HandoffSource | null {
  if (!isRecord(value)) return null;
  const { libraryId, assetId, versionId, recipeHash } = value;
  if (
    !isBoundedString(libraryId, MAX_FIELD_LENGTH) ||
    !isBoundedString(assetId, MAX_FIELD_LENGTH) ||
    !isBoundedString(versionId, MAX_FIELD_LENGTH) ||
    !isBoundedString(recipeHash, MAX_FIELD_LENGTH)
  ) {
    return null;
  }
  const { documentId } = value;
  if (documentId !== undefined && !isHandoffId(documentId)) return null;
  return { libraryId, assetId, versionId, recipeHash, ...(documentId !== undefined ? { documentId } : {}) };
}

/**
 * Optional fields shared by documents and saves: absent is fine, present
 * must be valid. Returns null when a present field is malformed.
 */
function parseOptionals(fields: Fields): { source?: HandoffSource; baseRevision?: string } | null {
  const out: { source?: HandoffSource; baseRevision?: string } = {};
  if (fields.source !== undefined) {
    const source = parseSource(fields.source);
    if (!source) return null;
    out.source = source;
  }
  if (fields.baseRevision !== undefined) {
    if (!isBoundedString(fields.baseRevision, MAX_FIELD_LENGTH)) return null;
    out.baseRevision = fields.baseRevision;
  }
  return out;
}

export function parseHandoffDocument(value: unknown): HandoffDocument | null {
  if (!isRecord(value)) return null;
  const { name, kind, bytes } = value;
  if (!isName(name)) return null;
  if (kind !== 'png16' && kind !== 'lopsy') return null;
  if (!isFile(bytes, kind === 'png16' ? isPngBytes : isLopsyBytes)) return null;
  const optionals = parseOptionals(value);
  if (!optionals) return null;
  if (value.camera !== undefined) {
    const camera = parseCameraSummary(value.camera);
    if (!camera) return null;
    return { name, kind, bytes, ...optionals, camera };
  }
  return { name, kind, bytes, ...optionals };
}

const CAMERA_STRINGS = ['make', 'model', 'lens', 'shutter', 'capturedAt'] as const;
const CAMERA_NUMBERS = ['iso', 'aperture', 'focalLength'] as const;

/** A well-formed camera summary, or null. Unknown fields are dropped. */
export function parseCameraSummary(value: unknown): CameraSummary | null {
  if (!isRecord(value)) return null;
  const out: Record<string, string | number> = {};
  for (const key of CAMERA_STRINGS) {
    const v = value[key];
    if (v === undefined) continue;
    if (!isBoundedString(v, 128)) return null;
    out[key] = v;
  }
  for (const key of CAMERA_NUMBERS) {
    const v = value[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e6) return null;
    out[key] = v;
  }
  return out as CameraSummary;
}

export function parseLopsyReady(value: unknown): LopsyReadyMessage | null {
  if (!envelope(value, 'lopsy:ready')) return null;
  return { protocol: 1, type: 'lopsy:ready', id: value.id };
}

export function parsePhotosReady(value: unknown): PhotosReadyMessage | null {
  if (!envelope(value, 'photos:ready')) return null;
  return { protocol: 1, type: 'photos:ready', id: value.id };
}

export function parseLopsyPing(value: unknown): LopsyPingMessage | null {
  if (!envelope(value, 'lopsy:ping')) return null;
  return { protocol: 1, type: 'lopsy:ping', id: value.id };
}

export function parsePhotosPong(value: unknown): PhotosPongMessage | null {
  if (!envelope(value, 'photos:pong')) return null;
  return { protocol: 1, type: 'photos:pong', id: value.id };
}

export function parseLopsyReceived(value: unknown): LopsyReceivedMessage | null {
  if (!envelope(value, 'lopsy:received')) return null;
  return { protocol: 1, type: 'lopsy:received', id: value.id };
}

export function parsePhotosDocument(value: unknown): PhotosDocumentMessage | null {
  if (!envelope(value, 'photos:document')) return null;
  const document = parseHandoffDocument(value.document);
  if (!document) return null;
  return { protocol: 1, type: 'photos:document', id: value.id, document };
}

export function parseLopsySave(value: unknown): LopsySaveMessage | null {
  if (!envelope(value, 'lopsy:save')) return null;
  const { saveId, name, lopsy, render } = value;
  if (!isHandoffId(saveId) || !isName(name)) return null;
  if (!isFile(lopsy, isLopsyBytes) || !isFile(render, isPngBytes)) return null;
  const optionals = parseOptionals(value);
  if (!optionals) return null;
  return { protocol: 1, type: 'lopsy:save', id: value.id, saveId, name, lopsy, render, ...optionals };
}

export function parsePhotosSaved(value: unknown): PhotosSavedMessage | null {
  if (!envelope(value, 'photos:saved')) return null;
  const { saveId, ok } = value;
  if (!isHandoffId(saveId)) return null;
  if (ok === true) {
    if (value.revision !== undefined && !isBoundedString(value.revision, MAX_FIELD_LENGTH)) return null;
    if (value.documentId !== undefined && !isHandoffId(value.documentId)) return null;
    return {
      protocol: 1,
      type: 'photos:saved',
      id: value.id,
      saveId,
      ok: true,
      ...(typeof value.revision === 'string' ? { revision: value.revision } : {}),
      ...(typeof value.documentId === 'string' ? { documentId: value.documentId } : {}),
    };
  }
  if (ok === false) {
    if (typeof value.error !== 'string') return null;
    return {
      protocol: 1,
      type: 'photos:saved',
      id: value.id,
      saveId,
      ok: false,
      error: value.error.slice(0, MAX_ERROR_LENGTH),
    };
  }
  return null;
}

/** Width and height from a PNG's IHDR (bytes 16-24, big-endian), or null. */
export function pngDimensions(bytes: ArrayBuffer): { width: number; height: number } | null {
  if (!isPngBytes(bytes) || bytes.byteLength < 24) return null;
  const view = new DataView(bytes);
  if (view.getUint32(12) !== 0x49484452) return null; // 'IHDR'
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** The full texture size a 16-bit layer blob's geometry header states (`full_w`, `full_h`), or null. */
export function layerBlobSize(bytes: ArrayBuffer): { width: number; height: number } | null {
  if (bytes.byteLength < 24) return null;
  const view = new DataView(bytes);
  return { width: view.getInt32(16, true), height: view.getInt32(20, true) };
}

/** Largest layer, in bytes at 16 bits per channel (width x height x 8), either side accepts to grade. */
export const MAX_GRADE_BYTES = MAX_FILE_BYTES;

function isSide(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_GRADE_SIDE;
}

export function parseLopsyGrade(value: unknown): LopsyGradeMessage | null {
  if (!envelope(value, 'lopsy:grade')) return null;
  const layer = value.layer;
  if (!isRecord(layer)) return null;
  const { name, width, height, pixels } = layer;
  if (!isName(name) || !isSide(width) || !isSide(height)) return null;
  if (!isArrayBuffer(pixels) || pixels.byteLength < 32 || pixels.byteLength > MAX_FILE_BYTES) return null;
  // The blob must describe the size the message states, and that size must
  // fit the budget: the engine allocates what the header says.
  const blobSize = layerBlobSize(pixels);
  if (!blobSize || blobSize.width !== width || blobSize.height !== height) return null;
  if (width * height * 8 > MAX_GRADE_BYTES) return null;
  return { protocol: 1, type: 'lopsy:grade', id: value.id, layer: { name, width, height, pixels } };
}

/** A recipe object of bounded size, or null. */
export function parseGradeRecipe(value: unknown): GradeRecipe | null {
  if (!isRecord(value)) return null;
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return null;
  }
  if (json.length > MAX_RECIPE_JSON) return null;
  return JSON.parse(json) as GradeRecipe;
}

export function parsePhotosGraded(value: unknown): PhotosGradedMessage | null {
  if (!envelope(value, 'photos:graded')) return null;
  if (value.ok === true) {
    if (!isFile(value.png, isPngBytes)) return null;
    const size = pngDimensions(value.png);
    if (!size || !isSide(size.width) || !isSide(size.height)) return null;
    const recipe = parseGradeRecipe(value.recipe);
    if (!recipe) return null;
    return { protocol: 1, type: 'photos:graded', id: value.id, ok: true, png: value.png, recipe };
  }
  if (value.ok === false) {
    if (typeof value.cancelled !== 'boolean') return null;
    if (value.error !== undefined && typeof value.error !== 'string') return null;
    return {
      protocol: 1,
      type: 'photos:graded',
      id: value.id,
      ok: false,
      cancelled: value.cancelled,
      ...(typeof value.error === 'string' ? { error: value.error.slice(0, MAX_ERROR_LENGTH) } : {}),
    };
  }
  return null;
}
