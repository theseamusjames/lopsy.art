import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  engineFaceAlias,
  loadedEngineFaceAlias,
  onEngineFaceLoaded,
  registerEngineFontFace,
  resetEngineFontFacesForTests,
  withEngineFace,
} from './engine-font-faces';

interface FakeFace {
  family: string;
  descriptors: FontFaceDescriptors | undefined;
}

let added: FakeFace[] = [];
let failParse = false;

class FakeFontFace {
  family: string;
  descriptors: FontFaceDescriptors | undefined;
  constructor(family: string, _source: ArrayBuffer, descriptors?: FontFaceDescriptors) {
    this.family = family;
    this.descriptors = descriptors;
  }
  load(): Promise<FakeFontFace> {
    return failParse ? Promise.reject(new Error('bad font')) : Promise.resolve(this);
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('engine font faces', () => {
  beforeEach(() => {
    added = [];
    failParse = false;
    resetEngineFontFacesForTests();
    vi.stubGlobal('FontFace', FakeFontFace);
    vi.stubGlobal('document', { fonts: { add: (f: FakeFace) => { added.push(f); } } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('leaves the family list alone until the engine face has loaded', async () => {
    expect(withEngineFace("'Bungee Inline', display", 400, false)).toBe("'Bungee Inline', display");
    registerEngineFontFace('Bungee Inline', 400, false, new ArrayBuffer(8));
    expect(loadedEngineFaceAlias('Bungee Inline', 400, false)).toBeNull();
    await flush();
    const alias = engineFaceAlias('Bungee Inline', 400, false);
    expect(loadedEngineFaceAlias("'Bungee Inline'", 400, false)).toBe(alias);
    expect(withEngineFace("'Bungee Inline', display", 400, false)).toBe(`'${alias}', 'Bungee Inline', display`);
    expect(added).toHaveLength(1);
    expect(added[0]?.family).toBe(alias);
    expect(added[0]?.descriptors).toEqual({ weight: '400', style: 'normal' });
  });

  it('keys faces by weight and style so another weight falls through to the CSS face', async () => {
    registerEngineFontFace('Roboto', 700, true, new ArrayBuffer(8));
    await flush();
    expect(withEngineFace('Roboto, sans-serif', 400, false)).toBe('Roboto, sans-serif');
    expect(withEngineFace('Roboto, sans-serif', 700, false)).toBe('Roboto, sans-serif');
    expect(withEngineFace('Roboto, sans-serif', 700, true)).toContain(engineFaceAlias('Roboto', 700, true));
  });

  it('notifies listeners with the source family and registers each face once', async () => {
    const heard: string[] = [];
    onEngineFaceLoaded((family) => heard.push(family));
    registerEngineFontFace('Bungee Inline', 400, false, new ArrayBuffer(8));
    registerEngineFontFace('Bungee Inline', 400, false, new ArrayBuffer(8));
    await flush();
    registerEngineFontFace('Bungee Inline', 400, false, new ArrayBuffer(8));
    await flush();
    expect(heard).toEqual(['bungee inline']);
    expect(added).toHaveLength(1);
  });

  it('drops a binary the browser cannot parse', async () => {
    failParse = true;
    registerEngineFontFace('Broken', 400, false, new ArrayBuffer(8));
    await flush();
    expect(loadedEngineFaceAlias('Broken', 400, false)).toBeNull();
    expect(added).toHaveLength(0);
  });
});
