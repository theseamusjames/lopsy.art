/**
 * The `file_error` event: a file that was refused or could not be opened,
 * described by fixed words only. Nothing in it may identify the person or
 * the file: never a file name or path, a title, a folder or album name, a
 * storage id, an account id, text from the file's metadata, anything the
 * person typed, or a message shown to the person that contains any of
 * those. The reason is built from fixed sentences and the engine's own
 * refusal sentences, separately from what the person is shown.
 */

/**
 * The event's name. Not `error`, which Google Analytics reserves for its
 * own use and does not accept from a page.
 */
export const FILE_ERROR_EVENT = 'file_error';

/** Google Analytics does not log an event parameter value longer than this. */
export const MAX_VALUE_LENGTH = 100;

/**
 * The class of failure:
 * - 'unsupported-type': a file type the app does not read;
 * - 'raw-refused': a RAW file the engine recognises and refuses, or cannot decode;
 * - 'too-large': a size limit was exceeded (`limit` says which);
 * - 'decode-failed': a file of a supported type that could not be read.
 */
export type FileErrorKind = 'unsupported-type' | 'raw-refused' | 'too-large' | 'decode-failed';

/** The file types an event may name. Anything else is 'other': an extension is whatever a person typed. */
export const FILE_FORMATS = [
  'raf', 'dng', 'arw', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'orf', 'rw2', 'pef', 'srw', 'x3f', '3fr', 'iiq', 'erf', 'mrw', 'rwl',
  'srf', 'sr2', 'psd', 'lopsy', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'heic', 'avif', 'jxl', 'svg', 'ico', 'xmp',
  'mov', 'mp4',
] as const;

export type FileFormat = (typeof FILE_FORMATS)[number] | 'other';

export type AppName = 'lopsy' | 'photonamous';

/** A failure, as application code reports it (`track.error`). */
export interface FileError {
  readonly kind: FileErrorKind;
  /** One general sentence from fixed words or the engine's refusal: "Image width exceeded 16384". */
  readonly reason: string;
  readonly format: FileFormat;
  /** With 'too-large': the limit that was exceeded. */
  readonly limit?: number;
  /** How many files one action refused for this reason; 1 when left out. */
  readonly count?: number;
}

/** The event's parameters, exactly. */
export interface FileErrorProperties {
  readonly app: AppName;
  readonly kind: FileErrorKind;
  readonly reason: string;
  readonly format: FileFormat;
  readonly count: number;
  readonly limit?: number;
}

const KNOWN = new Set<string>(FILE_FORMATS);

const hasOwn = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

const ALIASES: Readonly<Record<string, FileFormat>> = {
  jpg: 'jpeg',
  jpe: 'jpeg',
  jfif: 'jpeg',
  tif: 'tiff',
  heif: 'heic',
  hif: 'heic',
};

/** A format from the list for an extension (with or without its dot, any case); 'other' for anything not on it. */
export function formatFromExtension(extension: string): FileFormat {
  const ext = extension.replace(/^\./, '').toLowerCase();
  const alias = hasOwn(ALIASES, ext) ? ALIASES[ext] : undefined;
  if (alias) return alias;
  return KNOWN.has(ext) ? (ext as FileFormat) : 'other';
}

/** The format a file's name says; 'other' when it has no extension or one not on the list. */
export function formatFromName(name: string): FileFormat {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? 'other' : formatFromExtension(base.slice(dot + 1));
}

const MIME_FORMATS: Readonly<Record<string, FileFormat>> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/heic': 'heic',
  'image/heif': 'heic',
  'image/avif': 'avif',
  'image/jxl': 'jxl',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/vnd.adobe.photoshop': 'psd',
};

/** The format a MIME type names (a paste has no file name); 'other' for anything not on the list. */
export function formatFromMime(type: string): FileFormat {
  const key = type.split(';')[0]?.trim().toLowerCase() ?? '';
  return hasOwn(MIME_FORMATS, key) ? (MIME_FORMATS[key] ?? 'other') : 'other';
}

/** `text` cut at the last word that fits `max` characters, with an ellipsis; unchanged when it fits. */
export function fitValue(text: string, max = MAX_VALUE_LENGTH): string {
  if (text.length <= max) return text;
  const room = text.slice(0, max);
  const space = room.lastIndexOf(' ');
  const cut = space >= max / 2 ? room.slice(0, space) : room.slice(0, max - 1);
  return `${cut.replace(/[\s,;:–—-]+$/, '')}…`;
}

/**
 * A reason of at most `max` characters that keeps its meaning: whitespace
 * collapsed; when too long, its asides in parentheses or brackets are
 * dropped, then only its first sentence is kept, and only then is it cut at
 * a word.
 */
export function shortenReason(text: string, max = MAX_VALUE_LENGTH): string {
  let reason = text.replace(/\s+/g, ' ').trim();
  if (reason.length <= max) return reason;
  for (let before = ''; before !== reason; ) {
    before = reason;
    reason = reason.replace(/\s*(\([^()[\]]*\)|\[[^()[\]]*\])/g, '');
  }
  reason = reason.replace(/\s+([.,;:!?])/g, '$1').trim();
  if (reason.length <= max) return reason;
  const first = /^(.+?[.!?])(?:\s|$)/.exec(reason)?.[1];
  if (first && first.length <= max) return first;
  return fitValue(first ?? reason, max);
}

/** The wrappers the engine puts before an inner error; the format is a parameter of its own. */
const ENGINE_WRAPPERS = /^(?:(?:RAF|DNG) decode failed|DNG cannot open as RAW|Failed to import (?:RAF|DNG|PSD)):\s*/i;

/**
 * The engine's refusal of a file as a reason: its sentence, without the
 * wrapper naming the format, capitalised and shortened (`shortenReason`).
 * `fallback` when there is no sentence, or when it mentions the file's
 * name (`fileName`, when the caller has one): the engine's sentences name
 * no file, and one that seems to is not sent.
 */
export function engineReason(message: string, fallback: string, fileName?: string | null): string {
  let sentence = message.replace(/\s+/g, ' ').trim();
  for (let before = ''; before !== sentence; ) {
    before = sentence;
    sentence = sentence.replace(ENGINE_WRAPPERS, '');
  }
  if (sentence === '' || (fileName && mentionsName(sentence, fileName))) return fallback;
  return shortenReason(sentence.charAt(0).toUpperCase() + sentence.slice(1));
}

/** Whether `text` contains the file's name, or its name without the extension (when that is long enough to tell). */
export function mentionsName(text: string, fileName: string): boolean {
  const lower = text.toLowerCase();
  const name = fileName.slice(Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\')) + 1).toLowerCase().trim();
  if (name === '') return false;
  if (lower.includes(name)) return true;
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name).trim();
  return base.length >= 3 && lower.includes(base);
}

/** "Image width exceeded 16384": the width when it is over `limit`, else the height, for `noun`. */
export function sideExceeded(noun: string, width: number, limit: number): string {
  return width > limit ? `${noun} width exceeded ${limit}` : `${noun} height exceeded ${limit}`;
}
