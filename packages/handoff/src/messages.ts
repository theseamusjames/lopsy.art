/**
 * The messages Lopsy Photos and Lopsy exchange over `window.postMessage`
 * (spec 6.12). Every message carries `protocol: 1`; anything that arrives
 * is untrusted input and goes through the validator for its type before
 * either app acts on it.
 *
 * Send flow (Photos opens Lopsy with `?photos-handoff=<id>`):
 *   Lopsy  → Photos  lopsy:ready      { id }
 *   Photos → Lopsy   photos:document  { id, document }
 *   Lopsy  → Photos  lopsy:received   { id }
 *   Lopsy  → Photos  lopsy:save       { id, saveId, … }   (each save)
 *   Photos → Lopsy   photos:saved     { id, saveId, ok }
 *
 * Reopen flow (Lopsy opens Photos with `?receive=<id>`):
 *   Photos → Lopsy   photos:ready     { id }
 *   then lopsy:save / photos:saved as above.
 */

export const PROTOCOL_VERSION = 1;

/** Query parameter Photos adds to Lopsy's URL to start a handoff. */
export const HANDOFF_PARAM = 'photos-handoff';
/** Query parameter Lopsy adds to Photos' URL when it reopens Photos to receive a save. */
export const RECEIVE_PARAM = 'receive';
/** Window name Photos opens Lopsy under, so an open Lopsy tab is reused. */
export const LOPSY_WINDOW_NAME = 'lopsy-editor';
/** Window name Lopsy opens Photos under. */
export const PHOTOS_WINDOW_NAME = 'lopsy-photos';

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

/** Where a document belongs in the Photos library. */
export interface HandoffSource {
  readonly libraryId: string;
  readonly assetId: string;
  readonly versionId: string;
  readonly recipeHash: string;
}

export interface HandoffDocument {
  readonly name: string;
  /** `png16`: a developed photo as a 16-bit PNG. `lopsy`: a `.lopsy` project. */
  readonly kind: HandoffDocumentKind;
  readonly bytes: ArrayBuffer;
  readonly source?: HandoffSource;
  /** The Drive revision a `.lopsy` came from; returned with each save. */
  readonly baseRevision?: string;
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
  /** Absent for Add to Lopsy Photos: Photos files it as a new document. */
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
    }
  | {
      readonly protocol: 1;
      readonly type: 'photos:saved';
      readonly id: string;
      readonly saveId: string;
      readonly ok: false;
      readonly error: string;
    };

export type HandoffMessage =
  | LopsyReadyMessage
  | PhotosDocumentMessage
  | LopsyReceivedMessage
  | PhotosReadyMessage
  | LopsySaveMessage
  | PhotosSavedMessage;

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
  return { libraryId, assetId, versionId, recipeHash };
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
  return { name, kind, bytes, ...optionals };
}

export function parseLopsyReady(value: unknown): LopsyReadyMessage | null {
  if (!envelope(value, 'lopsy:ready')) return null;
  return { protocol: 1, type: 'lopsy:ready', id: value.id };
}

export function parsePhotosReady(value: unknown): PhotosReadyMessage | null {
  if (!envelope(value, 'photos:ready')) return null;
  return { protocol: 1, type: 'photos:ready', id: value.id };
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
    return {
      protocol: 1,
      type: 'photos:saved',
      id: value.id,
      saveId,
      ok: true,
      ...(typeof value.revision === 'string' ? { revision: value.revision } : {}),
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
