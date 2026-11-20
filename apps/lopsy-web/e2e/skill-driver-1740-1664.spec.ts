import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TestInfo } from '@playwright/test';
import { test, expect } from './fixtures';
import { FROM_A_WEB_PAGE, foreignHosts, freePort, lanAddress, rawRequest, spawnDriver, tryConnect, type RunningDriver } from './driver-requests';

/**
 * Runs the driver published in SKILL-UI.md, as written there, against this
 * checkout's dev server.
 *
 * #1740 — h.text set font and size with the previous text layer still
 *         active, which restyled that layer: two h.text calls in a row came
 *         out in the same font.
 * #1664 — the driver gave no sign of which WebGL renderer it got, so a
 *         REAL_GPU=1 run silently on SwiftShader looked like an app stall. It
 *         now prints the renderer string at startup.
 *
 * The driver executes what it is sent, so it must serve only this machine:
 * it listens on 127.0.0.1, refuses a request a web page makes (Origin,
 * Sec-Fetch-Site) or one addressed to another host name (DNS rebinding),
 * and acts only on POST.
 */

function driverSource(): string {
  const skill = readFileSync('SKILL-UI.md', 'utf8');
  const section = skill.slice(skill.indexOf('## The driver'));
  const match = /```js\n([\s\S]*?)```/.exec(section);
  if (!match) throw new Error('driver code block not found in SKILL-UI.md');
  return match[1];
}

async function postStep(port: number, body: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`http://127.0.0.1:${port}`, { method: 'POST', body });
  return { status: res.status, text: await res.text() };
}

async function startDriver(baseURL: string, testInfo: TestInfo): Promise<{ driver: RunningDriver; port: number }> {
  const driverPath = testInfo.outputPath('lopsy-driver.mjs');
  writeFileSync(driverPath, driverSource());
  const port = await freePort();
  const driver = spawnDriver(driverPath, dirname(driverPath), {
    LOPSY_URL: `${baseURL}/`,
    DRIVER_PORT: String(port),
    OUT_DIR: testInfo.outputPath('out'),
  });
  return { driver, port };
}

async function waitForDriver(driver: RunningDriver): Promise<void> {
  await expect.poll(() => driver.log(), { timeout: 120_000 }).toContain('lopsy driver on');
}

test.describe('SKILL-UI.md driver (#1740, #1664)', () => {
  test.beforeEach(({ browserName, isMobile }) => {
    test.skip(browserName !== 'chromium' || isMobile, 'the driver launches its own Chromium');
  });

  test('prints the renderer and keeps each h.text call in its own font and size', async ({ baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const { driver, port } = await startDriver(baseURL!, testInfo);
    try {
      await waitForDriver(driver);
      expect(driver.log()).toMatch(/renderer: \S+/);

      const step = `
        await h.newDocument(1200, 800);
        await h.fg('#000000');
        await h.text(80, 90, 'FIRST', { font: 'Bebas Neue', size: 120 });
        await h.text(80, 400, 'SECOND', { font: 'Lobster', size: 64 });
        return await page.evaluate(() => window.__editorStore.getState().document.layers
          .filter((l) => l.type === 'text')
          .map((l) => ({ text: l.text, fontFamily: l.fontFamily, fontSize: l.fontSize })));
      `;
      const res = await postStep(port, step);
      expect(res.status, res.text).toBe(200);
      const layers = JSON.parse(res.text) as { text: string; fontFamily: string; fontSize: number }[];
      const first = layers.find((l) => l.text === 'FIRST');
      const second = layers.find((l) => l.text === 'SECOND');
      expect(first, res.text).toBeDefined();
      expect(second, res.text).toBeDefined();
      expect(first!.fontFamily).toMatch(/^'?Bebas Neue/);
      expect(first!.fontSize).toBe(120);
      expect(second!.fontFamily).toMatch(/^'?Lobster/);
      expect(second!.fontSize).toBe(64);
    } finally {
      await postStep(port, '__quit__').catch(() => undefined);
      driver.kill();
    }
  });

  test('serves only this machine, and acts only on POST', async ({ baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const { driver, port } = await startDriver(baseURL!, testInfo);
    const step = (body: string, headers: Record<string, string> = {}, method = 'POST') =>
      rawRequest(port, { method, headers: { 'content-type': 'text/plain', ...headers }, body });

    try {
      await waitForDriver(driver);
      expect(await tryConnect('127.0.0.1', port)).toBe('connected');
      const lan = lanAddress();
      if (lan) expect(await tryConnect(lan, port), `the driver must not listen on ${lan}`).not.toBe('connected');

      // Each refused step would leave a mark in ctx if it ran.
      for (const { what, headers } of FROM_A_WEB_PAGE) {
        expect((await step(`ctx.ran = ${JSON.stringify(what)}; return 1;`, headers)).status, what).toBe(403);
        expect((await step('__quit__', headers)).status, what).toBe(403);
      }
      for (const host of foreignHosts(port)) {
        expect((await step(`ctx.ran = ${JSON.stringify(host)}; return 1;`, { host })).status, host).toBe(403);
        expect((await step('__quit__', { host })).status, host).toBe(403);
      }
      for (const method of ['GET', 'PUT', 'DELETE']) {
        expect((await step(`ctx.ran = '${method}'; return 1;`, {}, method)).status, method).toBe(405);
      }
      expect((await step('__quit__', {}, 'GET')).status).toBe(405);
      expect(driver.isRunning()).toBe(true);

      const fromHere = await step('return ctx.ran ?? null;', { host: `localhost:${port}` });
      expect(fromHere).toEqual({ status: 200, text: 'null\n' });
      expect((await step('return 2;', { 'sec-fetch-site': 'none' })).text).toBe('2\n');

      // A body over 100 KB arrives in several chunks; a character split between two must survive.
      const text = '漢字のテスト、中文测试。한국어 텍스트'.repeat(2_000);
      expect(Buffer.byteLength(text)).toBeGreaterThan(100_000);
      const echoed = await step(`return ${JSON.stringify(text)};`);
      expect(echoed.status).toBe(200);
      const received = JSON.parse(echoed.text) as string;
      expect(received.includes('\uFFFD'), 'the step has U+FFFD in it').toBe(false);
      expect(received === text, 'the step returns the text it was sent').toBe(true);

      expect(await step('__quit__')).toEqual({ status: 200, text: 'bye\n' });
      expect(await driver.exited).toBe(0);
    } finally {
      driver.kill();
    }
  });
});

