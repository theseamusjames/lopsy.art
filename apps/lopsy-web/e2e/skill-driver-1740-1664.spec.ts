import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { test, expect } from './fixtures';

/**
 * Runs the driver published in SKILL.md, as written there, against this
 * checkout's dev server.
 *
 * #1740 — h.text set font and size with the previous text layer still
 *         active, which restyled that layer: two h.text calls in a row came
 *         out in the same font.
 * #1664 — the driver gave no sign of which WebGL renderer it got, so a
 *         REAL_GPU=1 run silently on SwiftShader looked like an app stall. It
 *         now prints the renderer string at startup.
 */

function driverSource(): string {
  const skill = readFileSync('SKILL.md', 'utf8');
  const section = skill.slice(skill.indexOf('## The driver'));
  const match = /```js\n([\s\S]*?)```/.exec(section);
  if (!match) throw new Error('driver code block not found in SKILL.md');
  return match[1];
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function postStep(port: number, body: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`http://localhost:${port}`, { method: 'POST', body });
  return { status: res.status, text: await res.text() };
}

test.describe('SKILL.md driver (#1740, #1664)', () => {
  test.beforeEach(({ browserName, isMobile }) => {
    test.skip(browserName !== 'chromium' || isMobile, 'the driver launches its own Chromium');
  });

  test('prints the renderer and keeps each h.text call in its own font and size', async ({ baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const driverPath = testInfo.outputPath('lopsy-driver.mjs');
    writeFileSync(driverPath, driverSource());
    const port = await freePort();

    let log = '';
    const driver: ChildProcess = spawn(process.execPath, [driverPath], {
      env: {
        ...process.env,
        LOPSY_URL: `${baseURL}/`,
        DRIVER_PORT: String(port),
        OUT_DIR: testInfo.outputPath('out'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    driver.stdout?.on('data', (d: Buffer) => { log += d.toString(); });
    driver.stderr?.on('data', (d: Buffer) => { log += d.toString(); });

    try {
      await expect.poll(() => log, { timeout: 120_000 }).toContain('lopsy driver on');
      expect(log).toMatch(/renderer: \S+/);

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
});
