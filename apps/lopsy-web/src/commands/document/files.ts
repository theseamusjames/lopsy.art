import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { base64Spec, decodeBase64, encodeBase64, requireDocument, requireEngine } from '../context';
import { baselineEntry, newDocumentResult, type NewDocumentResult } from './document';
import { useEditorStore } from '../../app/editor-store';
import { describeError } from '../../app/notifications-store';
import { encodeDocumentImage, type EncodedImage } from '../../io/export-image';
import { serializeProject } from '../../io/project-save';
import { encodePsdFile } from '../../io/psd';
import { ImageDecodeError, isOpenableFileName, OPEN_FILE_ACCEPT, openFileOrThrow } from '../../io/open-file';
import { isLossyFormat, type ExportFormat } from '../../app/MenuBar/export-logic';

/** The Export dialog's Quality slider: 1-100, 92 when it opens. */
const DEFAULT_QUALITY = 92;

/** What File > Save Project and Export PSD put in their downloads' blobs. */
const FILE_MIME = 'application/octet-stream';

const PSD_DEPTHS = [8, 16] as const;

export interface ExportResult {
  mime: string;
  ext: string;
  width: number;
  height: number;
  base64: string;
}

export interface FileResult {
  mime: string;
  ext: string;
  base64: string;
}

function exportQuality(format: ExportFormat, quality: number | undefined): number {
  if (isLossyFormat(format)) return quality ?? DEFAULT_QUALITY;
  if (quality !== undefined) {
    throw new CommandError('invalid', `doc.export: quality applies to jpeg and webp only, not ${format}`);
  }
  return 100;
}

function exportResult(image: EncodedImage | null): ExportResult {
  if (!image) throw new CommandError('unavailable', 'The document composite is empty: there is nothing to export.');
  const { mime, ext, width, height, bytes } = image;
  return { mime, ext, width, height, base64: encodeBase64(bytes) };
}

export const docExport = defineCommand({
  id: 'doc.export',
  summary:
    'Encodes the flattened document as File > Export… does (the same composite, metadata and colour profile) and returns the file as base64 with its mime type, extension and size. Nothing is downloaded and the document stays as dirty as it was.',
  surface: 'document',
  params: {
    format: { type: 'string', enum: ['png', 'jpeg', 'webp', 'bmp'] },
    quality: {
      type: 'number',
      integer: true,
      min: 1,
      max: 100,
      optional: true,
      description: 'Percent, as the dialog\'s Quality slider; jpeg and webp only. Default 92.',
    },
    highQuality: {
      type: 'boolean',
      optional: true,
      description: 'png only: true writes 16 bits a channel (the dialog\'s Quality: High), false 8 (Regular, the default).',
    },
  },
  run({ format, quality, highQuality }): Promise<ExportResult> {
    requireDocument();
    requireEngine();
    if (highQuality !== undefined && format !== 'png') {
      throw new CommandError('invalid', `doc.export: highQuality applies to png only, not ${format}`);
    }
    const settings = { format, quality: exportQuality(format, quality), highQuality: highQuality ?? false };
    return encodeDocumentImage(settings).then(exportResult);
  },
});

export const docSave = defineCommand({
  id: 'doc.save',
  summary:
    'Serializes the document as File > Save Project does (layers, masks, effects, text, adjustments, paths, guides) and returns the .lopsy file as base64. Nothing is downloaded and the document stays as dirty as it was; doc.open reopens the file.',
  surface: 'document',
  params: {},
  run(): Promise<FileResult> {
    requireDocument();
    requireEngine();
    return serializeProject().then((bytes) => ({ mime: FILE_MIME, ext: 'lopsy', base64: encodeBase64(bytes) }));
  },
});

export const docExportPsd = defineCommand({
  id: 'doc.export-psd',
  summary:
    'Encodes the document as a layered Photoshop file as File > Export PSD does and returns it as base64. Nothing is downloaded and the document stays as dirty as it was.',
  surface: 'document',
  params: {
    depth: {
      type: 'number',
      integer: true,
      min: 8,
      max: 16,
      default: 16,
      description: 'Bits a channel: 8 or 16. File > Export PSD writes 16.',
    },
  },
  run({ depth }): Promise<FileResult> {
    requireDocument();
    requireEngine();
    const bits = PSD_DEPTHS.find((candidate) => candidate === depth);
    if (bits === undefined) throw new CommandError('invalid', `doc.export-psd: depth must be 8 or 16, got ${depth}`);
    return encodePsdFile(bits).then((bytes) => {
      if (!bytes) throw new CommandError('unavailable', 'The rendering engine stopped before the PSD was written.');
      return { mime: FILE_MIME, ext: 'psd', base64: encodeBase64(bytes) };
    });
  },
});

function openFailure(name: string, err: unknown): CommandError {
  const reason = err instanceof ImageDecodeError ? 'the browser could not decode it as an image' : describeError(err);
  return new CommandError('invalid', `doc.open: could not open ${JSON.stringify(name)}: ${reason}`);
}

async function openedDocument(name: string, documentVersion: number, fonts: Promise<void>): Promise<NewDocumentResult> {
  const version = useEditorStore.getState().documentVersion;
  if (version === documentVersion) {
    throw new CommandError('unavailable', `doc.open: ${JSON.stringify(name)} did not open: the canvas could not be drawn.`);
  }
  await fonts.catch(() => undefined);
  await baselineEntry(version);
  return newDocumentResult();
}

export const docOpen = defineCommand({
  id: 'doc.open',
  summary:
    'Opens a file as the document, replacing the open one without asking, as File > Open... does with the file its picker returns: a .lopsy project, a PSD, a DNG or RAF raw, or a PNG, JPEG, GIF, BMP or WebP image. Waits for the text layers\' fonts. Returns its size, colour mode, layers (bottom to top) and the active layer id.',
  surface: 'document',
  params: {
    base64: base64Spec('The file\'s bytes'),
    name: {
      type: 'string',
      minLength: 1,
      maxLength: 255,
      description: `The file name. Its extension picks the loader, as the picker's: one of ${OPEN_FILE_ACCEPT}. An image's document is named after it without the extension.`,
    },
  },
  run({ base64, name }): Promise<NewDocumentResult> {
    if (!isOpenableFileName(name)) {
      throw new CommandError('invalid', `doc.open: ${JSON.stringify(name)} is not a type File > Open... opens; its extension must be one of ${OPEN_FILE_ACCEPT}`);
    }
    const file = new File([decodeBase64('doc.open', 'base64', base64) as BlobPart], name);
    const documentVersion = useEditorStore.getState().documentVersion;
    return openFileOrThrow(file).then(
      ({ fonts }) => openedDocument(name, documentVersion, fonts),
      (err: unknown) => {
        throw openFailure(name, err);
      },
    );
  },
});
