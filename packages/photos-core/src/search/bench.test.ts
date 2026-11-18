import { describe, expect, it } from 'vitest';
import type { Asset } from '../library/types';
import { groupBursts } from './bursts';
import { buildDateTree } from './dates';
import { computeFacets } from './facets';
import { compileSearch } from './rules';
import { TextIndex } from './text';
import { asset, view } from './test-support/fixtures';

const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env;
const COUNT = 50_000;

function time<T>(label: string, run: () => T, budgetMs: number): T {
  const start = performance.now();
  const result = run();
  const ms = performance.now() - start;
  console.log(`${label}: ${ms.toFixed(1)} ms`);
  expect(ms).toBeLessThan(budgetMs);
  return result;
}

describe.skipIf(env?.['LOPSY_BENCH'] !== '1')('search at 50,000 assets (LOPSY_BENCH=1)', () => {
  const cameras = ['X-E5', 'X100VI', 'X-T5', 'Q3'];
  const assets: Asset[] = Array.from({ length: COUNT }, (_, i) => {
    const day = 1 + (i % 28);
    const second = i % 60;
    return asset({
      id: `bench${i}`,
      title: i % 7 === 0 ? `Harbour ${i}` : `Street ${i}`,
      keywords: i % 3 === 0 ? ['travel', 'été'] : [],
      rating: (i % 6) as Asset['rating'],
      camera: { make: 'FUJIFILM', model: cameras[i % 4] ?? 'X-E5' },
      capturedAt: `20${20 + (i % 7)}-${String(1 + (i % 12)).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(second).padStart(2, '0')}`,
      edited: i % 5 === 0,
    });
  });
  const lib = view(assets);

  it('filters by a compiled rule', () => {
    const predicate = compileSearch({
      kind: 'group',
      match: 'all',
      rules: [
        { kind: 'rating', op: 'gte', value: 3 },
        { kind: 'camera', in: ['x-e5', 'q3'] },
        { kind: 'captureDate', from: '2022-01-01', to: null },
        { kind: 'edited', value: false },
      ],
    });
    const hits = time('rule filter', () => assets.filter((a) => predicate(a, lib)).length, 300);
    expect(hits).toBeGreaterThan(0);
  });

  it('builds, updates and queries the text index', () => {
    const index = new TextIndex();
    time('text index build', () => index.update(lib), 2000);
    time('text index no-op update', () => index.update({ ...lib }), 200);
    const hits = time('text query', () => index.search('har ete'), 200);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('counts facets, builds the date tree and groups bursts', () => {
    time('facets', () => computeFacets(assets, lib), 300);
    time('date tree', () => buildDateTree(assets), 300);
    time('bursts', () => groupBursts(assets), 800);
  });
});
