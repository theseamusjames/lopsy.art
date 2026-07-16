import { test, expect } from './fixtures';
import { waitForStore } from './helpers';
import { resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const samplePath = resolve(here, '..', 'sample.jpg');

test('group adjustment perf: drag levels gamma on 23MP photo', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP profiling requires Chromium');
  test.skip(!existsSync(samplePath), 'sample.jpg not present');
  test.setTimeout(600_000);

  await page.goto('/');
  await waitForStore(page);

  // Open sample.jpg
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('text=Open').first().click(),
  ]);
  await fileChooser.setFiles(samplePath);
  await page.waitForFunction(
    () => (window as unknown as Record<string, { getState: () => { documentReady: boolean } }>).__editorStore?.getState().documentReady,
    null,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(2000);

  // Add levels to the root group and enable
  const groupId = await page.evaluate(() => {
    const store = (window as unknown as Record<string, { getState: () => {
      document: { layers: Array<{ id: string; type: string }> };
      setActiveLayer: (id: string) => void;
      addAdjustmentNode: (groupId: string, type: string) => void;
      setGroupAdjustmentsEnabled: (groupId: string, enabled: boolean) => void;
    } }>).__editorStore;
    const state = store.getState();
    const rootGroup = state.document.layers.find(l => l.type === 'group');
    if (!rootGroup) throw new Error('No root group');
    state.setActiveLayer(rootGroup.id);
    state.addAdjustmentNode(rootGroup.id, 'levels');
    state.setGroupAdjustmentsEnabled(rootGroup.id, true);
    return rootGroup.id;
  });
  await page.waitForTimeout(500);

  // Get the levels node ID
  const nodeId = await page.evaluate((gid: string) => {
    const store = (window as unknown as Record<string, { getState: () => {
      document: { layers: Array<{ id: string; type: string; adjustments: Array<{ id: string; type: string }> }> };
    } }>).__editorStore;
    const group = store.getState().document.layers.find(l => l.id === gid);
    if (!group || group.type !== 'group') throw new Error('Not a group');
    const levelsNode = group.adjustments.find(n => n.type === 'levels');
    if (!levelsNode) throw new Error('No levels node');
    return levelsNode.id;
  }, groupId);

  // Start CDP profiling
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.start');

  const t0 = performance.now();

  // Simulate 30 gamma value changes, one per animation frame, to
  // capture the real per-frame rendering cost.
  await page.evaluate(({ gid, nid }: { gid: string; nid: string }) => {
    return new Promise<void>((resolve) => {
      const store = (window as unknown as Record<string, { getState: () => {
        updateAdjustmentNode: (groupId: string, nodeId: string, params: Record<string, unknown>) => void;
      } }>).__editorStore;
      let i = 0;
      const tick = () => {
        if (i >= 30) { resolve(); return; }
        const gamma = 1.0 + i * 0.05;
        store.getState().updateAdjustmentNode(gid, nid, {
          levels: {
            rgb: { inputBlack: 0, inputWhite: 255, outputBlack: 0, outputWhite: 255, gamma },
            r: { inputBlack: 0, inputWhite: 255, outputBlack: 0, outputWhite: 255, gamma: 1 },
            g: { inputBlack: 0, inputWhite: 255, outputBlack: 0, outputWhite: 255, gamma: 1 },
            b: { inputBlack: 0, inputWhite: 255, outputBlack: 0, outputWhite: 255, gamma: 1 },
          },
        });
        i++;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, { gid: groupId, nid: nodeId });

  await page.waitForTimeout(1000);

  const t1 = performance.now();

  // Stop profiling
  const { profile } = await cdp.send('Profiler.stop') as {
    profile: {
      nodes: Array<{
        id: number;
        callFrame: { functionName: string; url: string; lineNumber: number };
        hitCount: number;
        children?: number[];
      }>;
      startTime: number;
      endTime: number;
    };
  };
  await cdp.send('Profiler.disable');
  await cdp.detach();

  const totalTime = (profile.endTime - profile.startTime) / 1000;
  console.log(`\n=== GROUP ADJUSTMENT PERF ===`);
  console.log(`Total profile time: ${totalTime.toFixed(1)}ms`);
  console.log(`Wall-clock time: ${(t1 - t0).toFixed(0)}ms`);

  const totalHits = profile.nodes.reduce((s, n) => s + n.hitCount, 0);
  const nodes = profile.nodes
    .filter(n => n.hitCount > 0)
    .map(n => ({
      name: n.callFrame.functionName || '(anonymous)',
      url: n.callFrame.url.replace(/.*\//, ''),
      line: n.callFrame.lineNumber,
      hits: n.hitCount,
      selfMs: (n.hitCount / totalHits) * totalTime,
    }))
    .sort((a, b) => b.hits - a.hits);

  console.log(`\nTop 30 functions by self-time:`);
  for (const n of nodes.slice(0, 30)) {
    console.log(`  ${n.selfMs.toFixed(1)}ms ${(n.selfMs / totalTime * 100).toFixed(1)}%  ${n.name}  ${n.url}:${n.line}`);
  }

  // Find specific hot functions
  const hotFns = ['syncGroupAdj', 'pushGroup', 'nodesToLegacy', 'buildLevels', 'renderFrame',
    'syncLayers', 'flattenGroup', 'JSON', 'adjIsNon', 'setGroupAdj', 'render ', 'composite'];
  console.log(`\n=== KEY FUNCTIONS ===`);
  for (const fn of hotFns) {
    const match = nodes.find(n => n.name.includes(fn));
    if (match) console.log(`  ${match.name}: ${match.selfMs.toFixed(1)}ms (${(match.selfMs / totalTime * 100).toFixed(1)}%)`);
  }

  expect(true).toBe(true);
});
