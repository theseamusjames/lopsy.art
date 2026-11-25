import { describe, expect, it } from 'vitest';
import { expandTemplate, exportFileName, extensionFor, sanitizeFileName } from './file-names';
import { testAsset, testVersion } from './test-support/fixtures';

const ctx = { asset: testAsset(), version: testVersion({ name: 'Warm' }), seq: 7 };

describe('export file names', () => {
  it('expands every token', () => {
    expect(expandTemplate('{name}', ctx)).toBe('DSCF1234');
    expect(expandTemplate('{date} {seq} {seq:3} {title} {version} {camera}', ctx)).toBe('2026-11-14 7 007 Harbour Warm X100VI');
    expect(expandTemplate('{date}', { ...ctx, asset: testAsset({ capturedAt: null }) })).toBe('2026-11-18');
    expect(expandTemplate('{camera}', { ...ctx, asset: testAsset({ camera: null }) })).toBe('');
    expect(expandTemplate('{unknown}-{name}', ctx)).toBe('{unknown}-DSCF1234');
  });

  it('sanitizes for every common file system', () => {
    expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
    expect(sanitizeFileName('tab\there\u0001')).toBe('tab_here_');
    expect(sanitizeFileName('  spaced   out. . ')).toBe('spaced out');
    expect(sanitizeFileName('')).toBe('export');
    expect(sanitizeFileName('..')).toBe('export');
    expect(sanitizeFileName('CON')).toBe('_CON');
    expect(sanitizeFileName('lpt1.x')).toBe('_lpt1.x');
    expect(sanitizeFileName('x'.repeat(500))).toHaveLength(180);
  });

  it('adds the extension and keeps names unique, ignoring case', () => {
    const taken = new Set(['dscf1234.jpg']);
    expect(exportFileName('{name}', ctx, 'jpeg', taken)).toBe('DSCF1234 (2).jpg');
    expect(exportFileName('{name}', ctx, 'jpeg', taken)).toBe('DSCF1234 (3).jpg');
    expect(exportFileName('{name}', ctx, 'png', taken)).toBe('DSCF1234.png');
    expect(exportFileName('{title}', { ...ctx, asset: testAsset({ title: '' }) }, 'jpeg', taken)).toBe('export.jpg');
  });
});

describe('HDR file extensions', () => {
  it('are .png and .jpg, as the files they are', () => {
    expect(extensionFor('hdr-png')).toBe('.png');
    expect(extensionFor('hdr-jpeg')).toBe('.jpg');
    expect(extensionFor('tiff')).toBe('.tif');
  });
});
