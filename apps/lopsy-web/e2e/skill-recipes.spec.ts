/**
 * SKILL.md, the public guide to making images through the agent page's
 * command API, must not drift from the code. This spec reads it from disk and:
 *
 * - runs every recipe (a ```json block after `<!-- recipe: name -->`) through
 *   window.lopsy on a fresh agent page, and checks the complete composition's
 *   export;
 * - checks that every command id the guide names is one lopsy.describe() lists;
 * - runs the guide's driver (the ```js block after `<!-- driver: ... -->`) with
 *   Node against this checkout's dev server and exercises each endpoint.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestInfo } from '@playwright/test';
import { test, expect, type Page } from './fixtures';
import { serveFontsOffline } from './font-fixtures';
import {
  FROM_A_WEB_PAGE,
  foreignHosts,
  freePort,
  lanAddress,
  rawRequest,
  spawnDriver,
  tryConnect,
  type RunningDriver,
} from './driver-requests';

const SKILL = readFileSync('SKILL.md', 'utf8');

/** The driver resolves `{ "$file": path }` to that file's bytes; here every such file is this photo. */
const PHOTO_FIXTURE = 'e2e/fixtures/masked-monk/raccoon.jpg';

/** The recipe the guide presents as a complete composition, and the size it says it exports. */
const COMPOSITION = { name: 'evening-poster', width: 1200, height: 800, previewWidth: 800, previewHeight: 533 };

interface Recipe {
  readonly name: string;
  readonly invocations: unknown[];
}

interface LopsyError {
  code: string;
  message: string;
  index?: number;
}

type Outcome = { ok: true; result?: unknown; results?: unknown[] } | { ok: false; error: LopsyError };

interface AgentWindow {
  lopsy: {
    describe: () => Array<{ id: string }>;
    run: (invocation: unknown) => Promise<Outcome>;
  };
}

function recipes(): Recipe[] {
  const pattern = /<!-- recipe: ([\w-]+) -->\n```json\n([\s\S]*?)\n```/g;
  return [...SKILL.matchAll(pattern)].map(([, name, body]) => ({ name: name!, invocations: JSON.parse(body!) as unknown[] }));
}

function driverBlock(): { name: string; source: string } {
  const match = /<!-- driver: ([\w.-]+) -->\n```js\n([\s\S]*?)```/.exec(SKILL);
  if (!match) throw new Error('the driver block (<!-- driver: name --> then ```js) is not in SKILL.md');
  return { name: match[1]!, source: match[2]! };
}

function resolveFiles(value: unknown, photoBase64: string): unknown {
  if (Array.isArray(value)) return value.map((v) => resolveFiles(v, photoBase64));
  if (value === null || typeof value !== 'object') return value;
  if ('$file' in value) return photoBase64;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveFiles(v, photoBase64)]));
}

async function openAgentPage(page: Page): Promise<void> {
  await page.goto('/agent/');
  await page.waitForFunction(() => !!(window as unknown as Partial<AgentWindow>).lopsy);
}

/** Width, height and the number of distinct colours of a base64 PNG, decoded in the page. */
async function decodePng(page: Page, base64: string): Promise<{ width: number; height: number; colours: number }> {
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const colours = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 97) colours.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
    return { width: bitmap.width, height: bitmap.height, colours: colours.size };
  }, base64);
}

interface StartedDriver {
  readonly driver: RunningDriver;
  readonly dir: string;
  readonly outDir: string;
  readonly port: number;
}

/** Writes the guide's driver to its own directory and starts it there, as the guide says to. */
async function startDriver(baseURL: string, testInfo: TestInfo): Promise<StartedDriver> {
  const { name, source } = driverBlock();
  const dir = testInfo.outputPath('driver');
  const outDir = join(dir, 'out');
  mkdirSync(dir, { recursive: true });
  const driverPath = join(dir, name);
  writeFileSync(driverPath, source);
  const port = await freePort();
  const driver = spawnDriver(driverPath, dir, { LOPSY_URL: `${baseURL}/agent/`, DRIVER_PORT: String(port), OUT_DIR: outDir });
  return { driver, dir, outDir, port };
}

async function waitForDriver(driver: RunningDriver): Promise<void> {
  await expect.poll(() => driver.log(), { timeout: 90_000, message: 'the driver never started' }).toContain('lopsy driver on');
}

/** The manifest of a saved .lopsy project: the JSON after its 12-byte header. */
function projectManifest(bytes: Buffer): string {
  expect(bytes.subarray(0, 6).toString('latin1')).toBe('LOPSY\0');
  return bytes.subarray(12, 12 + bytes.readUInt32LE(8)).toString('utf8');
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test.describe('SKILL.md', () => {
  test.beforeEach(({ browserName, isMobile }) => {
    test.skip(browserName !== 'chromium' || isMobile, 'the guide is for Chromium driven by Playwright');
  });

  test('has its recipes and its composition', () => {
    const names = recipes().map((r) => r.name);
    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain(COMPOSITION.name);
  });

  test.describe('recipes', () => {
    // serveFontsOffline answers the font CDN's TTF URL with a 404, so the app falls back to the WOFF2 fixture.
    test.use({ allowConsoleErrors: [/Failed to load resource/] });

    for (const recipe of recipes()) {
      test(`${recipe.name} runs as written on a fresh page`, async ({ page }) => {
        test.setTimeout(120_000);
        await serveFontsOffline(page);
        await openAgentPage(page);
        const invocations = resolveFiles(recipe.invocations, readFileSync(PHOTO_FIXTURE).toString('base64'));
        const outcome = await page.evaluate((list) => (window as unknown as AgentWindow).lopsy.run(list), invocations);
        if (!outcome.ok) throw new Error(`${recipe.name} failed at [${outcome.error.index}]: ${outcome.error.code}: ${outcome.error.message}`);
        const results = outcome.results ?? [];
        expect(results).toHaveLength(recipe.invocations.length);
        // Every text the recipe adds is drawn in its font, not a fallback.
        for (const result of results) {
          if (result && typeof result === 'object' && 'fontLoaded' in result) {
            expect(result, recipe.name).toMatchObject({ fontLoaded: true });
          }
        }
        // The undo recipe's prose says what is left.
        if (recipe.name === 'undo') {
          expect(results.at(-1)).toMatchObject({ history: { undo: ['New Document', 'Fill'] } });
        }
        if (recipe.name !== COMPOSITION.name) return;

        const [preview, exported] = results.slice(-2) as Array<{ base64: string }>;
        expect(await decodePng(page, preview!.base64)).toMatchObject({ width: COMPOSITION.previewWidth, height: COMPOSITION.previewHeight });
        const image = await decodePng(page, exported!.base64);
        expect({ width: image.width, height: image.height }).toEqual({ width: COMPOSITION.width, height: COMPOSITION.height });
        // A gradient sky, a sun, ridges, grain and type: far from blank.
        expect(image.colours).toBeGreaterThan(200);
      });
    }
  });

  test('names only commands that exist', async ({ page }) => {
    await openAgentPage(page);
    const ids = await page.evaluate(() => (window as unknown as AgentWindow).lopsy.describe().map((c) => c.id));
    const families = new Set(ids.map((id) => id.split('.')[0]));
    // The driver's own code (path.join, ...) is JavaScript, not command ids.
    const text = SKILL.replace(driverBlock().source, '');
    const named = new Set(
      [...text.matchAll(/\b([a-z]+)\.([a-z0-9]+(?:-[a-z0-9]+)*)\b/g)]
        .filter(([, family]) => families.has(family!))
        .map(([id]) => id),
    );
    expect(named.size).toBeGreaterThan(60);
    expect([...named].filter((id) => !ids.includes(id)), 'command ids in SKILL.md that describe() does not list').toEqual([]);
  });

  test('pins the Playwright version this repository tests with', () => {
    const pinned = /npm install --save-exact playwright@(\S+)/.exec(SKILL)?.[1];
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { devDependencies: Record<string, string> };
    expect(pinned).toBe(pkg.devDependencies['playwright']);
    expect(SKILL).toContain(`Playwright ${pinned}`);
  });

  test('its driver runs commands, writes files, describes and quits', async ({ baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const { driver, port } = await startDriver(baseURL!, testInfo);
    const url = (path: string) => `http://127.0.0.1:${port}${path}`;

    try {
      await waitForDriver(driver);
      expect(driver.log()).toMatch(/renderer: /);

      const run = async (body: unknown, query = ''): Promise<Record<string, unknown>> => {
        const response = await fetch(url(`/run${query}`), { method: 'POST', body: JSON.stringify(body) });
        expect(response.headers.get('content-type')).toContain('application/json');
        return (await response.json()) as Record<string, unknown>;
      };

      const made = await run([
        { op: 'doc.new', width: 320, height: 200 },
        { op: 'color.set', foreground: '#2a9d8f' },
        { op: 'select.rect', x: 40, y: 40, width: 160, height: 100 },
        { op: 'paint.fill' },
        { op: 'select.none' },
        { op: 'view.render' },
      ], '?name=check');
      expect(made.ok, JSON.stringify(made)).toBe(true);
      const rendered = (made.results as Array<Record<string, unknown>>).at(-1)!;
      expect(rendered).not.toHaveProperty('base64');
      expect(rendered).toMatchObject({ mime: 'image/png', width: 320, height: 200, file: expect.stringMatching(/check-\d{3}\.png$/) });
      expect(pngSize(readFileSync(rendered.file as string))).toEqual({ width: 320, height: 200 });

      // A saved project goes out as a file and comes back in through { "$file": path }.
      const saved = await run({ op: 'doc.save' });
      const project = (saved.result as { file: string }).file;
      expect(project).toMatch(/\.lopsy$/);
      const reopened = await run({ op: 'doc.open', base64: { $file: project }, name: 'checkpoint.lopsy' });
      expect(reopened).toMatchObject({ ok: true, result: { width: 320, height: 200 } });

      const failed = await run({ op: 'doc.nwe' });
      expect(failed).toMatchObject({ ok: false, error: { code: 'not-found', message: expect.stringContaining('doc.new') } });

      // Over 100 KB of CJK text arrives in several chunks, and a character split between two must
      // survive. x of 1, 10 and 100 shift the text by a byte each time, so at least one of the three
      // requests puts a chunk boundary inside a three-byte character.
      const line = '漢字のテスト、中文测试。한국어텍스트入力'.repeat(8);
      const text = Array.from({ length: 240 }, () => line).join('\n');
      expect(Buffer.byteLength(text)).toBeGreaterThan(100_000);
      for (const x of [1, 10, 100]) {
        const typed = await run([
          { op: 'doc.new', width: 320, height: 200 },
          { op: 'tool.set', tool: 'text', options: { fontSize: 8, align: 'left' } },
          { op: 'text.add', x, y: 4, text },
          { op: 'doc.save' },
        ]);
        expect(typed.ok, JSON.stringify(typed).slice(0, 2000)).toBe(true);
        const saved = (typed.results as Array<{ file?: string }>).at(-1)!;
        const manifest = projectManifest(readFileSync(saved.file!));
        expect(manifest.includes('\uFFFD'), `x ${x}: the text has U+FFFD in it`).toBe(false);
        expect(manifest.includes(JSON.stringify(text)), `x ${x}: the text layer's text is what was sent`).toBe(true);
      }

      const list = await (await fetch(url('/describe'))).text();
      expect(list).toContain('layer.add: ');
      expect(list.split('\n').filter(Boolean).length).toBeGreaterThan(100);
      const one = (await (await fetch(url('/describe?op=layer.effects'))).json()) as { id: string; params: Record<string, unknown> };
      expect(one.id).toBe('layer.effects');
      expect(one.params).toHaveProperty('dropShadow');
      const family = (await (await fetch(url('/describe?family=filter'))).json()) as Array<{ id: string }>;
      expect(family.length).toBeGreaterThan(20);
      expect(family.every((c) => c.id.startsWith('filter.'))).toBe(true);

      // A GET (an <img> on any web page) does not stop it; a POST from this machine does.
      expect((await fetch(url('/quit'))).status).toBe(405);
      expect(driver.isRunning()).toBe(true);
      expect((await fetch(url('/describe?op=doc.new'))).status).toBe(200);
      expect(await (await fetch(url('/quit'), { method: 'POST' })).text()).toBe('bye\n');
      expect(await driver.exited).toBe(0);
    } finally {
      driver.kill();
    }
  });

  test('its driver serves only this machine, and reads and writes only its own directories', async ({ baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const { driver, dir, outDir, port } = await startDriver(baseURL!, testInfo);
    const post = (body: unknown, { headers = {}, path = '/run' }: { headers?: Record<string, string>; path?: string } = {}) =>
      rawRequest(port, { method: 'POST', path, headers: { 'content-type': 'text/plain', ...headers }, body: JSON.stringify(body) });
    const layerNames = async (): Promise<string[]> => {
      const info = JSON.parse((await post({ op: 'doc.info' })).text) as { result: { layers: Array<{ name: string }> } };
      return info.result.layers.map((layer) => layer.name);
    };

    try {
      await waitForDriver(driver);
      expect(await tryConnect('127.0.0.1', port)).toBe('connected');
      const lan = lanAddress();
      if (lan) expect(await tryConnect(lan, port), `the driver must not listen on ${lan}`).not.toBe('connected');

      expect((await post({ op: 'doc.new', width: 40, height: 30 })).status).toBe(200);
      for (const { what, headers } of FROM_A_WEB_PAGE) {
        expect((await post({ op: 'layer.add', name: 'from-a-page' }, { headers })).status, what).toBe(403);
        expect((await post({}, { headers, path: '/quit' })).status, what).toBe(403);
        expect((await rawRequest(port, { path: '/describe', headers })).status, what).toBe(403);
      }
      for (const host of foreignHosts(port)) {
        expect((await post({ op: 'layer.add', name: 'from-a-page' }, { headers: { host } })).status, host).toBe(403);
        expect((await post({}, { headers: { host }, path: '/quit' })).status, host).toBe(403);
        expect((await rawRequest(port, { path: '/describe', headers: { host } })).status, host).toBe(403);
      }
      // What a browser sends for a URL typed in its address bar, and what curl and Node send.
      expect((await rawRequest(port, { path: '/describe', headers: { 'sec-fetch-site': 'none' } })).status).toBe(200);
      expect((await rawRequest(port, { path: '/describe', headers: { host: `localhost:${port}` } })).status).toBe(200);
      expect(await layerNames()).not.toContain('from-a-page');

      const getRun = await rawRequest(port, { path: '/run' });
      expect(getRun.status).toBe(405);
      expect((await rawRequest(port, { method: 'GET', path: '/run', body: JSON.stringify({ op: 'layer.add', name: 'by-get' }) })).status).toBe(405);
      expect(await layerNames()).not.toContain('by-get');

      // $file reads only inside the directory the driver runs in and OUT_DIR, symlinks resolved.
      const outside = testInfo.outputPath('outside-secret.txt');
      writeFileSync(outside, 'secret');
      writeFileSync(join(dir, 'inside.txt'), 'inside');
      writeFileSync(join(outDir, 'in-out.txt'), 'in out');
      symlinkSync(outside, join(dir, 'link-out.txt'));
      for (const [file, bytes] of [['inside.txt', 'inside'], [join(dir, 'inside.txt'), 'inside'], [join(outDir, 'in-out.txt'), 'in out']] as const) {
        const read = JSON.parse((await post({ op: 'layer.add', name: { $file: file } })).text) as { ok: boolean };
        expect(read.ok, file).toBe(true);
        expect(await layerNames(), file).toContain(Buffer.from(bytes).toString('base64'));
      }
      const secret = Buffer.from('secret').toString('base64');
      for (const file of [outside, '../outside-secret.txt', 'link-out.txt', '/etc/hosts']) {
        const refused = await post([{ op: 'layer.add', name: { $file: file } }, { op: 'doc.info' }]);
        expect(refused.status, file).toBe(400);
        expect(JSON.parse(refused.text), file).toMatchObject({ ok: false, error: { code: 'driver', message: expect.stringContaining('outside') } });
        expect(refused.text).not.toContain(secret);
      }
      expect(await layerNames()).not.toContain(secret);

      // An output name is a file name in OUT_DIR, never a path.
      for (const name of ['../escape', '..', 'a/b', 'a\\b', '/tmp/escape']) {
        const refused = await post({ op: 'doc.save' }, { path: `/run?name=${encodeURIComponent(name)}` });
        expect(refused.status, name).toBe(400);
        expect(JSON.parse(refused.text), name).toMatchObject({ ok: false, error: { code: 'driver' } });
      }
      expect(readdirSync(dir).filter((file) => file.includes('escape'))).toEqual([]);
      expect(readdirSync(testInfo.outputPath()).filter((file) => file.includes('escape'))).toEqual([]);
      expect(existsSync(join(outDir, 'a'))).toBe(false);
      const named = JSON.parse((await post({ op: 'doc.save' }, { path: '/run?name=poster.v2' })).text) as { result: { file: string } };
      expect(named.result.file).toMatch(/poster\.v2-\d{3}\.lopsy$/);

      expect((await rawRequest(port, { path: '/quit' })).status).toBe(405);
      expect(driver.isRunning()).toBe(true);
      expect((await post({}, { path: '/quit' })).text).toBe('bye\n');
      expect(await driver.exited).toBe(0);
    } finally {
      driver.kill();
    }
  });
});
