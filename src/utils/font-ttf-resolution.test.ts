import { describe, it, expect } from 'vitest';
import { resolveTtfPaths } from './font-ttf-resolution';
import type { RepoTtfFile } from './font-ttf-resolution';

function repo(...paths: (string | [string, number])[]): RepoTtfFile[] {
  return paths.map((p) =>
    typeof p === 'string' ? { path: p, size: 1000 } : { path: p[0], size: p[1] },
  );
}

describe('resolveTtfPaths', () => {
  it('maps static families to per-weight files', () => {
    expect(resolveTtfPaths('Anton', [400], repo('ofl/anton/Anton-Regular.ttf'))).toEqual({
      ttfDir: 'ofl/anton',
      ttfFile: null,
      ttfWeightFiles: { 400: 'Anton-Regular.ttf' },
    });
  });

  it('resolves multi-weight statics and leaves missing weights unmapped', () => {
    const result = resolveTtfPaths('Lora', [400, 500, 700], repo(
      'ofl/lora/Lora-Regular.ttf',
      'ofl/lora/Lora-Bold.ttf',
    ));
    expect(result.ttfWeightFiles).toEqual({ 400: 'Lora-Regular.ttf', 700: 'Lora-Bold.ttf' });
  });

  it('picks variable files with any axis combination', () => {
    expect(resolveTtfPaths('Roboto', [100, 400, 900], repo(
      'ofl/roboto/Roboto-Italic[wdth,wght].ttf',
      'ofl/roboto/Roboto[wdth,wght].ttf',
    ))).toEqual({ ttfDir: 'ofl/roboto', ttfFile: 'Roboto[wdth,wght].ttf', ttfWeightFiles: null });

    expect(resolveTtfPaths('Climate Crisis', [400], repo(
      'ofl/climatecrisis/ClimateCrisis[YEAR].ttf',
    )).ttfFile).toBe('ClimateCrisis[YEAR].ttf');

    expect(resolveTtfPaths('Recursive', [300, 400], repo(
      'ofl/recursive/Recursive[CASL,CRSV,MONO,slnt,wght].ttf',
    )).ttfFile).toBe('Recursive[CASL,CRSV,MONO,slnt,wght].ttf');
  });

  it('prefers complete statics over a variable file', () => {
    const result = resolveTtfPaths('Asap', [400], repo(
      'ofl/asap/Asap[wdth,wght].ttf',
      'ofl/asap/static/Asap-Regular.ttf',
    ));
    expect(result.ttfWeightFiles).toEqual({ 400: 'static/Asap-Regular.ttf' });
  });

  it('accepts weight-named files with a legacy prefix when unambiguous', () => {
    const result = resolveTtfPaths('PT Sans', [400, 700], repo(
      'ofl/ptsans/PT_Sans-Web-Regular.ttf',
      'ofl/ptsans/PT_Sans-Web-Bold.ttf',
      'ofl/ptsans/PT_Sans-Web-Italic.ttf',
    ));
    expect(result.ttfWeightFiles).toEqual({
      400: 'PT_Sans-Web-Regular.ttf',
      700: 'PT_Sans-Web-Bold.ttf',
    });

    expect(resolveTtfPaths('Old Standard TT', [400, 700], repo(
      'ofl/oldstandardtt/OldStandard-Regular.ttf',
      'ofl/oldstandardtt/OldStandard-Bold.ttf',
      'ofl/oldstandardtt/OldStandard-Italic.ttf',
    )).ttfWeightFiles).toEqual({ 400: 'OldStandard-Regular.ttf', 700: 'OldStandard-Bold.ttf' });
  });

  it('falls back to the bare family-name file', () => {
    expect(resolveTtfPaths('Shadows Into Light', [400], repo(
      'ofl/shadowsintolight/ShadowsIntoLight.ttf',
    )).ttfFile).toBe('ShadowsIntoLight.ttf');
  });

  it('uses a sole root TTF even with an opaque name', () => {
    expect(resolveTtfPaths('UnifrakturMaguntia', [400], repo(
      'ofl/unifrakturmaguntia/UnifrakturMaguntia-Book.ttf',
    )).ttfFile).toBe('UnifrakturMaguntia-Book.ttf');
  });

  it('returns null for ambiguous multi-file dirs instead of guessing', () => {
    // IM Fell-style opaque names: an italic guess would render wrong.
    expect(resolveTtfPaths('IM Fell English', [400], repo(
      'ofl/imfellenglish/IMFeENit28P.ttf',
      'ofl/imfellenglish/IMFeENrm28P.ttf',
      'ofl/imfellenglish/IMFeENsc28P.ttf',
    ))).toEqual({ ttfDir: null, ttfFile: null, ttfWeightFiles: null });
  });

  it('excludes files over the jsDelivr 20MB limit', () => {
    expect(resolveTtfPaths('Noto Serif KR', [400], repo(
      ['ofl/notoserifkr/NotoSerifKR[wght].ttf', 23_795_420],
    ))).toEqual({ ttfDir: null, ttfFile: null, ttfWeightFiles: null });
  });

  it('resolves italic-only families to the italic file', () => {
    expect(resolveTtfPaths('Molle', [400], repo(
      'ofl/molle/Molle-Italic.ttf',
      'ofl/molle/Molle-Regular.ttf',
    )).ttfWeightFiles).toEqual({ 400: 'Molle-Regular.ttf' });

    expect(resolveTtfPaths('Imagined', [400], repo(
      'ofl/imagined/Imagined-Italic.ttf',
      'ofl/imagined/Imagined-Extra.ttf',
    )).ttfFile).toBe('Imagined-Italic.ttf');
  });

  it('returns null when the family is not in the repo', () => {
    expect(resolveTtfPaths('Google Sans', [400], repo('ofl/roboto/Roboto[wdth,wght].ttf')))
      .toEqual({ ttfDir: null, ttfFile: null, ttfWeightFiles: null });
  });
});
