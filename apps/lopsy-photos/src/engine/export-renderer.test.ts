// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RECIPE, type Recipe } from '@lopsy/photos-core/library/recipe';
import { DEFAULT_EXPORT_SETTINGS } from '@lopsy/photos-core/export/types';
import { harnessAsset, harnessVersion } from '../edit/EditHarness/harness-asset';
import type { DevelopEngine, ExportOptions } from './develop-engine';
import { createEngineExportRenderer } from './export-renderer';

interface FakeEngine {
  readonly engine: DevelopEngine;
  readonly loads: string[];
  readonly recipes: Recipe[];
  readonly exports: ExportOptions[];
  isDisposed: boolean;
}

function fakeEngine(): FakeEngine {
  const fake: FakeEngine = { loads: [], recipes: [], exports: [], isDisposed: false, engine: undefined as unknown as DevelopEngine };
  const engine: Partial<DevelopEngine> = {
    load: async (source) => {
      fake.loads.push(await source.text());
      return { width: 10, height: 10 };
    },
    setRecipe: (recipe) => {
      fake.recipes.push(recipe);
    },
    exportImage: async (options) => {
      fake.exports.push(options);
      return new Blob(['x'], { type: options.format === 'png' ? 'image/png' : 'image/jpeg' });
    },
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
    expect(f?.exports).toEqual([{ format: 'jpeg', quality: 0.9, maxSize: 2048 }]);
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
