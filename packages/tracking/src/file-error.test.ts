import { describe, expect, it } from 'vitest';
import {
  engineReason,
  fitValue,
  formatFromExtension,
  formatFromMime,
  formatFromName,
  mentionsName,
  shortenReason,
  sideExceeded,
} from './file-error';

describe('formats', () => {
  it('names a format on the list from an extension, in any case, with its aliases', () => {
    expect(formatFromName('DSCF8078.RAF')).toBe('raf');
    expect(formatFromName('holiday.JPG')).toBe('jpeg');
    expect(formatFromName('scan.tif')).toBe('tiff');
    expect(formatFromName('IMG_1.HEIF')).toBe('heic');
    expect(formatFromName('folder/sub\\DSC_0001.nef')).toBe('nef');
    expect(formatFromExtension('.CR3')).toBe('cr3');
  });

  it('sends "other" for anything not on the list: an extension is whatever a person typed', () => {
    expect(formatFromName('Ada Lovelace private notes.ada-lovelace')).toBe('other');
    expect(formatFromName('no-extension')).toBe('other');
    expect(formatFromName('.hidden')).toBe('other');
    expect(formatFromName('trailing.')).toBe('other');
    expect(formatFromExtension('constructor')).toBe('other');
    expect(formatFromExtension('__proto__')).toBe('other');
  });

  it('names a format from a MIME type', () => {
    expect(formatFromMime('image/png')).toBe('png');
    expect(formatFromMime('image/jpeg; charset=binary')).toBe('jpeg');
    expect(formatFromMime('text/plain')).toBe('other');
    expect(formatFromMime('')).toBe('other');
  });
});

describe('reasons', () => {
  it('says which side of an image went over the limit', () => {
    expect(sideExceeded('Image', 8200, 8192)).toBe('Image width exceeded 8192');
    expect(sideExceeded('Project', 100, 8192)).toBe('Project height exceeded 8192');
  });

  it('fits a value to 100 characters at a word, with an ellipsis', () => {
    expect(fitValue('short')).toBe('short');
    const cut = fitValue(`${'alpha '.repeat(20)}omega`);
    expect(cut.length).toBeLessThanOrEqual(100);
    expect(cut.endsWith('alpha…')).toBe(true);
  });

  it('keeps a reason that fits as it is, whitespace collapsed', () => {
    expect(shortenReason('  File type   not supported ')).toBe('File type not supported');
  });

  it('shortens a long reason by dropping asides, then later sentences, then at a word', () => {
    expect(
      shortenReason(
        'This DNG uses lossy JPEG compression, which is not supported yet: only 8-bit LinearRaw RGB is read (this is 16-bit, 1 samples, PhotometricInterpretation 32803)',
      ),
    ).toBe('This DNG uses lossy JPEG compression, which is not supported yet: only 8-bit LinearRaw RGB is read');
    expect(shortenReason(`a [${'1, '.repeat(200)}2] colour filter pattern is not a 2×2 Bayer pattern`)).toBe(
      'a colour filter pattern is not a 2×2 Bayer pattern',
    );
    const words = shortenReason(`${'unbracketed words without any stop '.repeat(10)}`);
    expect(words.length).toBeLessThanOrEqual(100);
    expect(words.endsWith('…')).toBe(true);
    const lastWord = /(\w+)…$/.exec(words)?.[1];
    expect(['unbracketed', 'words', 'without', 'any', 'stop']).toContain(lastWord);
  });

  it('takes the engine’s sentence without its format wrapper, capitalised', () => {
    expect(engineReason('RAF decode failed: Not a Fujifilm RAF file (bad magic)', 'RAW file could not be decoded')).toBe(
      'Not a Fujifilm RAF file (bad magic)',
    );
    expect(engineReason('DNG cannot open as RAW: the file has no ColorMatrix1', 'x')).toBe('The file has no ColorMatrix1');
    expect(engineReason('Failed to import DNG: DNG decode failed: Unsupported DNG compression: 9', 'x')).toBe('Unsupported DNG compression: 9');
    expect(engineReason('   ', 'RAW file could not be decoded')).toBe('RAW file could not be decoded');
  });

  it('shortens a 300-character engine message to 100 or fewer without a cut word', () => {
    const message = `This Sony RAW's white balance [${Array.from({ length: 80 }, (_, i) => i).join(', ')}] is not four positive levels`;
    expect(message.length).toBeGreaterThan(300);
    const reason = engineReason(message, 'RAW file could not be decoded');
    expect(reason).toBe("This Sony RAW's white balance is not four positive levels");
  });

  it('sends the fallback, never the sentence, when the sentence mentions the file’s name', () => {
    const fileName = 'Camera serial 4412 at home.arw';
    expect(engineReason('This Sony RAW at Camera serial 4412 at home is damaged', 'RAW file could not be decoded', fileName)).toBe(
      'RAW file could not be decoded',
    );
    expect(engineReason('This is not a Sony RAW file', 'RAW file could not be decoded', fileName)).toBe('This is not a Sony RAW file');
  });

  it('finds a name with or without its extension, but not a base too short to tell', () => {
    expect(mentionsName('Failed to open image: Holiday.JPG', 'holiday.jpg')).toBe(true);
    expect(mentionsName('the holiday photo', 'Holiday.jpg')).toBe(true);
    expect(mentionsName('an image', 'a.png')).toBe(false);
    expect(mentionsName('anything', '')).toBe(false);
  });
});
