import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';
export type { Page } from '@playwright/test';

// Vite's dev-only HMR socket (ws://localhost:<port>/?token=…) can drop or
// fail to connect while the dev server is loaded by the full suite. That is
// test-harness noise, not an app error: production builds have no such
// socket. Firefox reports it as "can't establish a connection to the server
// at ws://…", Chromium as "WebSocket connection to 'ws://…' failed".
const DEV_SERVER_NOISE = [/ws:\/\/localhost:\d+\/\?token=/];

/**
 * Every test fails if the browser logged a console error or threw a page
 * error. A real bug (a wasm panic, an unhandled rejection, a React warning
 * promoted to error) often passes unnoticed when only the assertions drive
 * pass/fail — wire it through the harness so it can't.
 *
 * Opt out for a single test that legitimately exercises an error path:
 *
 *   test.use({ allowConsoleErrors: [/expected: foo/] });
 *   test('invalid input shows message', async () => { ... });
 */
/**
 * `window.__readLayerImage`, installed on every page: a layer's pixels as
 * the engine holds them, layer-local, read through the app's awaited dev
 * hook. Undefined when the layer has no texture. Declare it in a
 * `page.evaluate` callback with
 * `(window as unknown as { __readLayerImage: ReadLayerImage }).__readLayerImage`.
 */
export type ReadLayerImage = (
  layerId?: string,
) => Promise<{ data: number[]; width: number; height: number } | undefined>;

/**
 * `window.__readLayerInDocument`, installed on every page: a layer's pixels
 * in document space, as a document-sized ImageData, read from the GPU with
 * the app's awaited reads after pending strokes and JS pixels are pushed to
 * it. Transparent when the layer has no texture.
 */
export type ReadLayerInDocument = (layerId?: string) => Promise<ImageData>;

export const test = base.extend<{
  allowConsoleErrors: RegExp[];
  _consoleErrorGuard: void;
  _layerImageReader: void;
}>({
  allowConsoleErrors: [[], { option: true }],

  _layerImageReader: [
    async ({ page }, use) => {
      await page.addInitScript(() => {
        const w = window as unknown as Record<string, unknown>;
        w.__readLayerInDocument = async (layerId?: string) => {
          const settle = w.__readLayerPixels as ((id?: string) => Promise<unknown>) | undefined;
          // Bakes a pending stroke and pushes pending JS pixels to the GPU.
          if (settle) await settle(layerId);
          const store = w.__editorStore as {
            getState: () => { document: { width: number; height: number; activeLayerId: string | null } };
          };
          const { width, height, activeLayerId } = store.getState().document;
          const engine = (w.__engineState as { getEngine: () => unknown } | undefined)?.getEngine();
          const bridge = w.__wasmBridge as
            | { readLayerPixelsForFill: (engine: unknown, id: string) => Promise<Uint8Array> }
            | undefined;
          const id = layerId ?? activeLayerId;
          const image = new ImageData(width, height);
          if (!engine || !bridge || !id) return image;
          const bytes = await bridge.readLayerPixelsForFill(engine, id).catch(() => null);
          if (bytes && bytes.length === image.data.length) image.data.set(bytes);
          return image;
        };
        w.__readLayerImage = async (layerId?: string) => {
          const read = w.__readLayerPixels as
            | ((id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>)
            | undefined;
          const layer = read ? await read(layerId) : null;
          return layer && layer.width > 0
            ? { data: layer.pixels, width: layer.width, height: layer.height }
            : undefined;
        };
      });
      await use();
    },
    { auto: true },
  ],

  _consoleErrorGuard: [
    async ({ page, allowConsoleErrors }, use) => {
      const errors: string[] = [];
      const isAllowed = (text: string) =>
        [...DEV_SERVER_NOISE, ...allowConsoleErrors].some((re) => re.test(text));

      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (isAllowed(text)) return;
        errors.push(`[console.error] ${text}`);
      });
      page.on('pageerror', (err) => {
        const text = err.message;
        if (isAllowed(text)) return;
        errors.push(`[pageerror] ${text}`);
      });

      await use();

      if (errors.length > 0) {
        const unique = Array.from(new Set(errors));
        throw new Error(
          `Browser logged ${errors.length} error(s) during this test:\n` +
            unique.map((e) => '  - ' + e).join('\n'),
        );
      }
    },
    { auto: true },
  ],
});
