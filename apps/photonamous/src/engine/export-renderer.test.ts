// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RECIPE, type Recipe } from '@lopsy/photos-core/library/recipe';
import { DEFAULT_EXPORT_SETTINGS } from '@lopsy/photos-core/export/types';
import { harnessAsset, harnessVersion } from '../edit/EditHarness/harness-asset';
import type { DevelopEngine, ExportOptions } from './develop-engine';
import { createEngineExportRenderer } from './export-renderer';
import { DEFAULT_EXTRAS, withExtras } from '../library/export-size';

interface FakeEngine {
  readonly engine: DevelopEngine;
  readonly loads: string[];
  readonly recipes: Recipe[];
  readonly exports: ExportOptions[];
  isDisposed: boolean;
  /** Whether its GPU objects are gone. */
  isLost: boolean;
  /** The resolution the photo is loaded at; ensureFullResolution raises it in place. */
  resolution: 'working' | 'full';
  upgrades: number;
}

function fakeEngine(): FakeEngine {
  const fake: FakeEngine = {
    loads: [],
    recipes: [],
    exports: [],
    isDisposed: false,
    isLost: false,
    resolution: 'working',
    upgrades: 0,
    engine: undefined as unknown as DevelopEngine,
  };
  const engine: Partial<DevelopEngine> = {
    setGrainSeed: () => undefined,
    load: async (source, _format, _onProgress, options) => {
      fake.loads.push(await source.text());
      fake.resolution = options?.resolution === 'full' ? 'full' : 'working';
      return { width: 10, height: 10 };
    },
    imageSize: () => ({ width: 4000, height: 3000 }),
    isFullResolution: () => fake.resolution === 'full',
    ensureFullResolution: async () => {
      fake.upgrades++;
      fake.resolution = 'full';
    },
    setRecipe: (recipe) => {
      fake.recipes.push(recipe);
    },
    exportImage: async (options) => {
      fake.exports.push(options);
      return new Blob(['x'], { type: options.format === 'png' ? 'image/png' : 'image/jpeg' });
    },
    isLost: () => fake.isLost,
    dispose: () => {
      fake.isDisposed = true;
    },
  };
  return Object.assign(fake, { engine: engine as DevelopEngine });
}

const assetA = harnessAsset('a', 'a.jpg', 1, 'jpeg', 'image/jpeg');
const assetB = harnessAsset('b', 'b.jpg', 1, 'jpeg', 'image/jpeg');
const warm: Recipe = { ...DEFAULT_RECIPE, tone: { ...DEFAULT_RECIPE.tone, exposure: 1 } };

describe('createEngineExportRenderer', () => {
  let fakes: FakeEngine[];
  let loadOriginal: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fakes = [];
    loadOriginal = vi.fn(async (asset: { id: string }) => new Blob([asset.id]));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderer() {
    return createEngineExportRenderer({
      loadOriginal: loadOriginal as unknown as (asset: typeof assetA, signal: AbortSignal) => Promise<Blob>,
      idleMs: 1000,
      createEngine: async () => {
        const f = fakeEngine();
        fakes.push(f);
        return f.engine;
      },
    });
  }

  it('loads, applies the version recipe and exports at the settings size', async () => {
    const r = renderer();
    const blob = await r.render(assetA, harnessVersion(assetA, warm), { ...DEFAULT_EXPORT_SETTINGS, maxLongEdge: 2048 }, new AbortController().signal);
    expect(blob.type).toBe('image/jpeg');
    const [f] = fakes;
    expect(f?.loads).toEqual(['a']);
    expect(f?.recipes).toEqual([warm]);
    expect(f?.exports).toEqual([{ format: 'jpeg', quality: 0.9, maxSize: 2048, colorSpace: 'srgb' }]);
  });

  it('sizes by short edge or megapixels, never enlarging unless asked, and passes PNG depth', async () => {
    const r = renderer();
    const signal = new AbortController().signal;
    const version = harnessVersion(assetA, warm);
    const extras = { ...DEFAULT_EXTRAS, size: { mode: 'short' as const, px: 1500 } };
    await r.render(assetA, version, withExtras(DEFAULT_EXPORT_SETTINGS, extras) as typeof DEFAULT_EXPORT_SETTINGS, signal);
    expect(fakes[0]?.exports.at(-1)?.size).toEqual({ width: 2000, height: 1500 });
    const big = { ...DEFAULT_EXTRAS, size: { mode: 'megapixels' as const, mp: 48 }, pngDepth: 8 as const };
    await r.render(assetA, version, withExtras({ ...DEFAULT_EXPORT_SETTINGS, format: 'png' }, big) as typeof DEFAULT_EXPORT_SETTINGS, signal);
    expect(fakes[0]?.exports.at(-1)).toMatchObject({ format: 'png', pngDepth: 8 });
    expect(fakes[0]?.exports.at(-1)?.size).toBeUndefined();
    await r.render(assetA, version, withExtras(DEFAULT_EXPORT_SETTINGS, { ...big, allowEnlarge: true }) as typeof DEFAULT_EXPORT_SETTINGS, signal);
    expect(fakes[0]?.exports.at(-1)?.size).toEqual({ width: 8000, height: 6000 });
  });

  it('exports TIFF full size in the chosen colour space, and refuses Rec. 2020', async () => {
    const r = renderer();
    const signal = new AbortController().signal;
    const version = harnessVersion(assetA, warm);
    await r.render(assetA, version, { ...DEFAULT_EXPORT_SETTINGS, format: 'tiff', colorSpace: 'display-p3', maxLongEdge: 2048 }, signal);
    expect(fakes[0]?.exports.at(-1)).toEqual({ format: 'tiff', quality: 0.9, maxSize: undefined, colorSpace: 'display-p3' });
    await expect(r.render(assetA, version, { ...DEFAULT_EXPORT_SETTINGS, format: 'tiff', colorSpace: 'rec2020' }, signal)).rejects.toThrow(/Rec\. 2020/);
  });

  it('replaces an engine whose GPU was lost, and loads the photo into the new one', async () => {
    const r = renderer();
    const signal = new AbortController().signal;
    await r.render(assetA, harnessVersion(assetA), DEFAULT_EXPORT_SETTINGS, signal);
    const [first] = fakes;
    if (first) first.isLost = true;
    await r.render(assetA, harnessVersion(assetA, warm), DEFAULT_EXPORT_SETTINGS, signal);
    await vi.runAllTimersAsync();
    expect(fakes).toHaveLength(2);
    expect(first?.isDisposed).toBe(true);
    expect(fakes[1]?.loads).toEqual(['a']);
    expect(fakes[1]?.exports).toHaveLength(1);
  });

  it('reuses one engine and one decode for versions of the same photo', async () => {
    const r = renderer();
    const signal = new AbortController().signal;
    await Promise.all([
      r.render(assetA, harnessVersion(assetA), DEFAULT_EXPORT_SETTINGS, signal),
      r.render(assetA, harnessVersion(assetA, warm), { ...DEFAULT_EXPORT_SETTINGS, format: 'png' }, signal),
      r.render(assetB, harnessVersion(assetB), DEFAULT_EXPORT_SETTINGS, signal),
    ]);
    expect(fakes).toHaveLength(1);
    expect(fakes[0]?.loads).toEqual(['a', 'b']);
    expect(fakes[0]?.exports.map((e) => e.maxSize)).toEqual([undefined, undefined, undefined]);
  });

  it('loads small exports at the working size and brings the same decode up to full size when needed', async () => {
    const r = renderer();
    const signal = new AbortController().signal;
    await r.render(assetA, harnessVersion(assetA), { ...DEFAULT_EXPORT_SETTINGS, maxLongEdge: 2048 }, signal);
    expect(fakes[0]?.resolution).toBe('working');
    await r.render(assetA, harnessVersion(assetA, warm), { ...DEFAULT_EXPORT_SETTINGS, maxLongEdge: null }, signal);
    expect(fakes[0]?.resolution).toBe('full');
    expect(fakes[0]?.loads).toEqual(['a']);
    expect(fakes[0]?.upgrades).toBe(1);
    await r.render(assetB, harnessVersion(assetB), { ...DEFAULT_EXPORT_SETTINGS, format: 'tiff', maxLongEdge: 1024 }, signal);
    expect(fakes[0]?.resolution).toBe('full');
    expect(fakes[0]?.upgrades).toBe(1);
  });

  it('stops at an aborted signal before loading', async () => {
    const r = renderer();
    const abort = new AbortController();
    abort.abort();
    await expect(r.render(assetA, harnessVersion(assetA), DEFAULT_EXPORT_SETTINGS, abort.signal)).rejects.toThrow(/cancelled/);
    expect(loadOriginal).not.toHaveBeenCalled();
  });

  it('releases the engine after an idle spell and on dispose', async () => {
    const r = renderer();
    const signal = new AbortController().signal;
    await r.render(assetA, harnessVersion(assetA), DEFAULT_EXPORT_SETTINGS, signal);
    await vi.advanceTimersByTimeAsync(1500);
    expect(fakes[0]?.isDisposed).toBe(true);
    await r.render(assetA, harnessVersion(assetA), DEFAULT_EXPORT_SETTINGS, signal);
    expect(fakes).toHaveLength(2);
    expect(fakes[1]?.loads).toEqual(['a']);
    r.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(fakes[1]?.isDisposed).toBe(true);
  });
});
