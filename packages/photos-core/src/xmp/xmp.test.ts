import { describe, expect, it } from 'vitest';
import { DEFAULT_RECIPE } from '../library/recipe';
import type { Recipe } from '../library/recipe';
import { asset } from '../search/test-support/fixtures';
import type { Version } from '../library/types';
import { exportSidecars } from './export';
import { readXmp, recipeFromXmp } from './read';
import { matchSidecars } from './sidecars';
import { LIGHTROOM_XMP, REJECTED_CROPPED_XMP } from './test-support/samples';
import { escapeXml, writeXmp } from './write';
import { parseXml } from './xml';
import { MemoryAdapter } from '../storage/memory-adapter';

describe('XML subset parser', () => {
  it('resolves namespaces by URI and decodes entities', () => {
    const root = parseXml('<a:x xmlns:a="urn:a" xmlns="urn:d" a:k="1 &lt; 2 &#x263A;" k="&quot;q&quot;"><y>t&amp;<![CDATA[<raw>]]></y></a:x>');
    expect(root?.name).toEqual({ uri: 'urn:a', local: 'x' });
    expect(root?.attributes.find((a) => a.local === 'k' && a.uri === 'urn:a')?.value).toBe('1 < 2 ☺');
    expect(root?.attributes.find((a) => a.local === 'k' && a.uri === '')?.value).toBe('"q"');
    expect(root?.children[0]?.name).toEqual({ uri: 'urn:d', local: 'y' });
    expect(root?.children[0]?.text).toBe('t&<raw>');
    expect(parseXml('<a k="x > y"/>')?.attributes[0]?.value).toBe('x > y');
  });

  it('refuses DOCTYPE, entities, malformed and oversized input', () => {
    const bad = [
      '<!DOCTYPE x [<!ENTITY e "boom">]><x>&e;</x>',
      '<x>&e;</x>',
      '<x><y></x></y>',
      '<x>',
      '<x/><y/>',
      '<p:x/>',
      '<x a="1" a="2"/>',
      '<x a=1/>',
      'text<x/>',
    ];
    for (const b of bad) expect(parseXml(b)).toBeNull();
    expect(parseXml('<x>' + '<y>'.repeat(100) + '</y>'.repeat(100) + '</x>')).toBeNull();
    expect(parseXml('<x/>', { maxChars: 3, maxDepth: 4, maxElements: 4, maxAttributes: 4 })).toBeNull();
  });

  it('does not resolve entities through the object prototype', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(parseXml(`<x>&${name};</x>`)).toBeNull();
      expect(parseXml(`<x a="&${name};"/>`)).toBeNull();
    }
    expect(readXmp(`<x:xmpmeta xmlns:x="adobe:ns:meta/">&constructor;</x:xmpmeta>`)).toBeNull();
  });

  it('caps attributes per element and checks duplicates in linear time', () => {
    const tag = (n: number) => `<x ${Array.from({ length: n }, (_, i) => `a${i}="1"`).join(' ')}/>`;
    expect(parseXml(tag(512))?.attributes).toHaveLength(512);
    expect(parseXml(tag(513))).toBeNull();
    // Nearly 4 MB of attributes in one start tag: refused quickly, not after an O(n^2) scan.
    const huge = tag(300_000);
    expect(huge.length).toBeLessThan(4 * 1024 * 1024);
    const start = performance.now();
    expect(parseXml(huge)).toBeNull();
    expect(performance.now() - start).toBeLessThan(1000);
    expect(parseXml(tag(500), { ...{ maxChars: 1e7, maxDepth: 8, maxElements: 8 }, maxAttributes: 100_000 })).not.toBeNull();
    let seed = 3;
    for (let n = 0; n < 300; n++) {
      const chars = [...LIGHTROOM_XMP];
      for (let k = 0; k < 4; k++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        chars[seed % chars.length] = '<>&"=/ x'[seed % 8] ?? 'x';
      }
      expect(() => readXmp(chars.join(''))).not.toThrow();
    }
  });
});

describe('readXmp', () => {
  it('reads a Lightroom sidecar', () => {
    const x = readXmp(LIGHTROOM_XMP);
    expect(x).toMatchObject({
      rating: 4,
      setAside: false,
      label: 'green',
      title: 'Harbour at dusk',
      caption: 'Boats & lights, Boulogne',
      keywords: ['harbour', 'France', 'Boats'],
      recipe: null,
      crop: null,
      orientation: 6,
      edits: {
        'tone.exposure': 0.65,
        'tone.contrast': 12,
        'tone.highlights': -48,
        'tone.shadows': 35,
        'tone.whites': 5,
        'tone.blacks': -10,
        'color.vibrance': 15,
        'color.saturation': -5,
      },
    });
    const recipe = x ? recipeFromXmp(x, 6) : null;
    expect(recipe?.tone).toEqual({ exposure: 0.65, contrast: 12, highlights: -48, shadows: 35, whites: 5, blacks: -10 });
    // RAW Kelvin (Custom 5600 K) without the photo's Kelvin scale cannot be placed against as shot: left as shot.
    expect(recipe?.whiteBalance).toEqual(DEFAULT_RECIPE.whiteBalance);
    expect(recipe?.framing.rotate).toBe(0);
    expect(x ? recipeFromXmp(x, 1)?.framing.rotate : null).toBe(90);
  });

  it('reads a rejected photo, an unknown label and a plain crop, whatever the prefixes', () => {
    const x = readXmp(REJECTED_CROPPED_XMP);
    expect(x).toMatchObject({ rating: 0, setAside: true, label: null, keywords: [] });
    expect(x?.crop?.x).toBeCloseTo(0.2);
    expect(x?.crop?.width).toBeCloseTo(0.5);
    expect(x?.crop?.height).toBeCloseTo(0.8);
    expect(x ? recipeFromXmp(x, 1)?.framing.crop?.y : null).toBeCloseTo(0.1);
    expect(x ? recipeFromXmp(x, 6) : 'x').toBeNull();
  });

  it('returns null for what is not XML and nothing for an empty packet', () => {
    expect(readXmp('not xml')).toBeNull();
    const empty = readXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"/>');
    expect(empty).toMatchObject({ rating: null, label: null, keywords: [], recipe: null, edits: {} });
    expect(empty ? recipeFromXmp(empty, 1) : 'x').toBeNull();
  });
});

describe('writeXmp', () => {
  const recipe: Recipe = {
    ...DEFAULT_RECIPE,
    profile: { id: 'vivid "quoted" <&>' },
    whiteBalance: { mode: 'custom', temperature: 12, tint: -3 },
    tone: { ...DEFAULT_RECIPE.tone, exposure: -1.25, shadows: 40 },
    color: { vibrance: 10, saturation: 0 },
    framing: { ...DEFAULT_RECIPE.framing, crop: { x: 0.125, y: 0.25, width: 0.5, height: 0.5 } },
    sharpness: { amount: 40, radius: 1.2, edges: 10 },
    noise: { ...DEFAULT_RECIPE.noise, luminance: 20 },
  };
  const version: Version = {
    id: 'v1',
    assetId: 'w1',
    name: 'Original',
    recipe,
    createdAt: '',
    thumb: null,
    screen: null,
    deleted: false,
  };
  const a = asset({
    id: 'w1',
    rating: 3,
    label: 'purple',
    keywords: ['été', 'a & b', '<tag>'],
    title: 'Title "q"',
    caption: 'line one\nline two',
    primaryVersionId: 'v1',
  });

  it('round-trips marks and the exact recipe', () => {
    const text = writeXmp(a, version);
    expect(parseXml(text)).not.toBeNull();
    const x = readXmp(text);
    expect(x).toMatchObject({
      rating: 3,
      setAside: false,
      label: 'purple',
      keywords: ['été', 'a & b', '<tag>'],
      title: 'Title "q"',
      caption: 'line one\nline two',
    });
    expect(x?.recipe).toEqual(recipe);
    expect(x ? recipeFromXmp(x, 6) : null).toEqual(recipe);
    expect(x?.edits).toMatchObject({ 'tone.exposure': -1.25, 'tone.shadows': 40, 'color.vibrance': 10 });
    expect(x?.crop).toEqual({ x: 0.125, y: 0.25, width: 0.5, height: 0.5 });
  });

  it('writes set-aside as a rejection and escapes everything', () => {
    const x = readXmp(writeXmp(asset({ setAside: true, rating: 4 }), null));
    expect(x).toMatchObject({ setAside: true, rating: 0, recipe: null });
    expect(escapeXml('a<b>&"c"\u0001\n')).toBe('a&lt;b&gt;&amp;&quot;c&quot;&#10;');
  });
});

describe('sidecar matching', () => {
  it('pairs exact names first, then base names preferring the RAW', () => {
    const names = ['DSCF1.RAF', 'DSCF1.JPG', 'dscf1.xmp', 'DSCF2.JPG', 'DSCF2.JPG.xmp', 'DSCF2.xmp', 'lonely.xmp'];
    const m = matchSidecars(names);
    expect([...m.sidecarFor]).toEqual([
      [3, 4],
      [0, 2],
    ]);
    expect(m.imageFor.get(5)).toBeNull();
    expect(m.imageFor.get(6)).toBeNull();
  });
});

describe('exportSidecars', () => {
  it('writes one sidecar per photo, by base name, into a folder or for download', async () => {
    const adapter = new MemoryAdapter();
    const root = await adapter.getRoot();
    const folder = await adapter.createFolder(root.id, 'Sidecars');
    await adapter.createFile({ parentId: folder.id, name: 'DSCF7.xmp', mimeType: 'text/plain' }, new Blob(['old']));
    const raw = asset({ id: 'x1', fileName: 'DSCF7.RAF', rating: 2 });
    const jpg = asset({ id: 'x2', fileName: 'DSCF7.JPG' });
    const solo = asset({ id: 'x3', fileName: 'DSCF8.RAF', label: 'blue' });
    const view = {
      assets: new Map([raw, jpg, solo].map((a) => [a.id, a])),
      versions: new Map(),
      albums: new Map(),
      settings: new Map(),
      presets: new Map(),
      exportPresets: new Map(),
    };
    const session = { getView: () => view, adapter, libraryId: 'lib' };
    const toFolder = await exportSidecars(session, ['x1', 'x2', 'x3', 'missing'], { kind: 'folder', folderId: folder.id });
    expect(toFolder.files.map((f) => f.name)).toEqual(['DSCF7.RAF.xmp', 'DSCF7.JPG.xmp', 'DSCF8.xmp']);
    expect(toFolder.errors).toEqual([{ assetId: 'missing', error: 'Photo not in the library' }]);
    const stored = await adapter.getFile(toFolder.files[2]?.fileId ?? '');
    expect(stored?.properties).toEqual({ 'lp.lib': 'lib', 'lp.role': 'sidecar', 'lp.asset': 'x3' });
    expect(readXmp(await (await adapter.readContent(stored?.id ?? '')).text())?.label).toBe('blue');

    const download = await exportSidecars(session, ['x3'], { kind: 'download' });
    expect(download.files.map((f) => [f.name, f.fileId])).toEqual([['DSCF8.xmp', null]]);
  });
});
