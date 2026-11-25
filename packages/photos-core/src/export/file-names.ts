import { uniqueName } from '../import/folders';
import type { Asset, Version } from '../library/types';
import { containerOf, type ExportSettings } from './types';

export interface FileNameContext {
  readonly asset: Asset;
  readonly version: Version;
  /** 1-based position in the export. */
  readonly seq: number;
}

const MAX_STEM = 180;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

function stem(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/** Replaces the template's tokens; unknown tokens are left as written. */
export function expandTemplate(template: string, ctx: FileNameContext): string {
  const { asset, version, seq } = ctx;
  return template.replace(/\{(name|date|seq|title|version|camera)(?::(\d{1,2}))?\}/g, (whole, token: string, width?: string) => {
    switch (token) {
      case 'name':
        return stem(asset.fileName);
      case 'date':
        return (asset.capturedAt ?? asset.importedAt).slice(0, 10);
      case 'seq':
        return String(seq).padStart(width ? Number(width) : 0, '0');
      case 'title':
        return asset.title;
      case 'version':
        return version.name;
      case 'camera':
        return asset.camera?.model || asset.camera?.make || '';
      default:
        return whole;
    }
  });
}

/**
 * A name every common file system accepts: no path separators, control or
 * reserved characters, no trailing dots or spaces, not a reserved Windows
 * device name, not empty.
 */
export function sanitizeFileName(name: string): string {
  let out = [...name]
    .map((c) => (c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f || '/\\:*?"<>|'.includes(c) ? '_' : c))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if (out.length > MAX_STEM) out = out.slice(0, MAX_STEM).trim();
  if (out === '' || /^\.+$/.test(out)) out = 'export';
  if (RESERVED.test(out)) out = `_${out}`;
  return out;
}

export function extensionFor(format: ExportSettings['format']): string {
  const container = containerOf(format);
  return container === 'png' ? '.png' : container === 'tiff' ? '.tif' : '.jpg';
}

/**
 * The file name for one exported item, unique against `taken` (names
 * already used in the job or in the destination folder, any case), which
 * it adds to.
 */
export function exportFileName(
  template: string,
  ctx: FileNameContext,
  format: ExportSettings['format'],
  taken: Set<string>,
): string {
  const name = uniqueName(taken, sanitizeFileName(expandTemplate(template, ctx)) + extensionFor(format));
  taken.add(name);
  return name;
}
