/**
 * The Lopsy Photos handoff, Lopsy's side (spec 6.12).
 *
 * A stand-in Photos page is served with `context.route` at Lopsy's default
 * dev Photos URL (http://localhost:5174/). Its inline script plays the
 * Photos side of the protocol by hand: it opens Lopsy with
 * `?photos-handoff=<id>`, answers `lopsy:ready` with a 16-bit PNG, and
 * records each `lopsy:save` it receives. Writing the wire format out here,
 * rather than importing @lopsy/handoff, keeps the test honest about what
 * actually crosses between the tabs.
 */
import { deflateSync } from 'node:zlib';
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { getEditorState, getPixelAt, waitForStore } from './helpers';

const PHOTOS_ORIGIN = 'http://localhost:5174';
const EVIL_ORIGIN = 'http://localhost:5175';

const PNG_W = 64;
const PNG_H = 48;

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(new Uint8Array(Buffer.concat([head.subarray(4), data]))), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * A 16-bit RGBA PNG: red rises 1024 per column, green 1365 per row, blue is
 * mid-grey, alpha opaque. At (32, 24) that is about (128, 127, 128) in 8 bits.
 */
function makePng16(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(PNG_W, 0);
  ihdr.writeUInt32BE(PNG_H, 4);
  ihdr[8] = 16; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = 1 + PNG_W * 8;
  const raw = Buffer.alloc(stride * PNG_H);
  for (let y = 0; y < PNG_H; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < PNG_W; x++) {
      const o = y * stride + 1 + x * 8;
      raw.writeUInt16BE(Math.min(65535, x * 1024), o);
      raw.writeUInt16BE(Math.min(65535, y * 1365), o + 2);
      raw.writeUInt16BE(0x8000, o + 4);
      raw.writeUInt16BE(0xffff, o + 6);
    }
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * The stand-in Photos page. `startHandoff` plays the send flow
 * (`mode: 'unprompted'` posts the document without waiting for ready); a
 * page opened with `?receive=<id>` plays the reopen flow with its opener.
 */
const photosPage = (lopsyOrigin: string): string => `<!doctype html><meta charset="utf-8"><title>Photos stand-in</title><body>
<script>
window.__log = [];
window.__saves = [];
const recordSave = (m) => {
  const lopsy = new Uint8Array(m.lopsy);
  const render = new DataView(m.render);
  window.__saves.push({
    name: m.name,
    source: m.source,
    baseRevision: m.baseRevision,
    lopsyMagic: Array.from(lopsy.subarray(0, 6)),
    renderSignature: Array.from(new Uint8Array(m.render, 0, 8)),
    renderChunk: String.fromCharCode(...new Uint8Array(m.render, 12, 4)),
    renderWidth: render.getUint32(16),
    renderHeight: render.getUint32(20),
    renderBitDepth: render.getUint8(24),
  });
};
const receiveId = new URLSearchParams(location.search).get('receive');
if (receiveId && window.opener) {
  const lopsyOrigin = ${JSON.stringify(lopsyOrigin)};
  window.addEventListener('message', (e) => {
    if (e.origin !== lopsyOrigin || e.source !== window.opener) return;
    const m = e.data;
    window.__log.push(m.type);
    if (m.type !== 'lopsy:save' || m.id !== receiveId) return;
    recordSave(m);
    window.opener.postMessage({ protocol: 1, type: 'photos:saved', id: receiveId, saveId: m.saveId, ok: true }, lopsyOrigin);
  });
  window.opener.postMessage({ protocol: 1, type: 'photos:ready', id: receiveId }, lopsyOrigin);
}
window.startHandoff = (lopsyUrl, pngBase64, mode) => {
  const id = 'e2e' + Math.random().toString(36).slice(2);
  const lopsyOrigin = new URL(lopsyUrl).origin;
  const makeDocument = () => {
    const bytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0)).buffer;
    return {
      message: {
        protocol: 1, type: 'photos:document', id,
        document: {
          name: 'DSCF1234', kind: 'png16', bytes,
          source: { libraryId: 'lib-1', assetId: 'asset-1', versionId: 'v-1', recipeHash: 'hash-1' },
          baseRevision: 'rev-1',
        },
      },
      bytes,
    };
  };
  const win = window.open(lopsyUrl + '?photos-handoff=' + id, 'lopsy-editor');
  let isSent = false;
  window.addEventListener('message', (e) => {
    if (e.origin !== lopsyOrigin || e.source !== win) return;
    const m = e.data;
    window.__log.push(m.type);
    if (m.type === 'lopsy:ready' && !isSent) {
      isSent = true;
      const { message, bytes } = makeDocument();
      win.postMessage(message, lopsyOrigin, [bytes]);
      window.__isDetached = bytes.byteLength === 0;
    }
    if (m.type === 'lopsy:save') {
      recordSave(m);
      win.postMessage({ protocol: 1, type: 'photos:saved', id, saveId: m.saveId, ok: true, revision: 'rev-' + (window.__saves.length + 1) }, lopsyOrigin);
    }
  });
  if (mode === 'unprompted') {
    window.__timer = setInterval(() => {
      const { message, bytes } = makeDocument();
      win.postMessage(message, lopsyOrigin, [bytes]);
    }, 200);
  }
  return id;
};
</script>`;

async function servePhotosPages(context: BrowserContext, lopsyOrigin: string): Promise<void> {
  for (const origin of [PHOTOS_ORIGIN, EVIL_ORIGIN]) {
    await context.route(`${origin}/**`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: photosPage(lopsyOrigin) }),
    );
  }
}

async function openLopsyFrom(
  context: BrowserContext,
  photos: Page,
  lopsyUrl: string,
  mode: 'handshake' | 'unprompted' = 'handshake',
): Promise<Page> {
  const png = makePng16().toString('base64');
  const [lopsy] = await Promise.all([
    context.waitForEvent('page'),
    photos.evaluate(({ url, b64, m }) => (window as unknown as { startHandoff: (u: string, b: string, m: string) => string }).startHandoff(url, b64, m), {
      url: lopsyUrl,
      b64: png,
      m: mode,
    }),
  ]);
  await lopsy.waitForLoadState();
  return lopsy;
}

interface RecordedSave {
  name: string;
  source: unknown;
  baseRevision: string;
  lopsyMagic: number[];
  renderSignature: number[];
  renderChunk: string;
  renderWidth: number;
  renderHeight: number;
  renderBitDepth: number;
}

function savesOf(photos: Page): Promise<RecordedSave[]> {
  return photos.evaluate(() => (window as unknown as { __saves: RecordedSave[] }).__saves);
}

test.describe('Lopsy Photos handoff', () => {
  test('opens a 16-bit PNG from Photos and saves back a .lopsy and a 16-bit PNG', async ({ page, context, baseURL }) => {
    await servePhotosPages(context, new URL(baseURL!).origin);
    await page.goto(`${PHOTOS_ORIGIN}/library`);
    const lopsy = await openLopsyFrom(context, page, `${baseURL}/`);
    await waitForStore(lopsy);

    const bar = lopsy.getByRole('region', { name: 'Lopsy Photos' });
    await expect(bar).toBeVisible({ timeout: 30_000 });
    await expect(bar).toContainText('From Lopsy Photos: DSCF1234');
    await expect(lopsy.getByRole('dialog', { name: 'New Document' })).toBeHidden();
    // The parameter is stripped so a reload doesn't ask for the photo again.
    expect(new URL(lopsy.url()).search).toBe('');
    // The document was transferred, not copied.
    expect(await page.evaluate(() => (window as unknown as { __isDetached: boolean }).__isDetached)).toBe(true);

    const state = await getEditorState(lopsy);
    expect(state.document.width).toBe(PNG_W);
    expect(state.document.height).toBe(PNG_H);
    expect(state.document.name).toBe('DSCF1234');
    // Red 32*1024/65535 ≈ 0.5, green 24*1365/65535 ≈ 0.5, blue 0.5.
    const px = await getPixelAt(lopsy, 32, 24);
    expect(Math.abs(px.r - 128)).toBeLessThanOrEqual(2);
    expect(Math.abs(px.g - 127)).toBeLessThanOrEqual(2);
    expect(Math.abs(px.b - 128)).toBeLessThanOrEqual(2);
    expect(px.a).toBe(255);
    await lopsy.screenshot({ path: 'e2e/screenshots/photos-handoff-opened.png' });

    await bar.getByRole('button', { name: 'Save to Lopsy Photos' }).click();
    await expect(bar.getByRole('status')).toHaveText('Saved to Lopsy Photos', { timeout: 30_000 });
    await lopsy.screenshot({ path: 'e2e/screenshots/photos-handoff-saved.png' });

    const [first] = await savesOf(page);
    expect(first).toBeDefined();
    expect(first!.name).toBe('DSCF1234');
    expect(first!.source).toEqual({ libraryId: 'lib-1', assetId: 'asset-1', versionId: 'v-1', recipeHash: 'hash-1' });
    expect(first!.baseRevision).toBe('rev-1');
    expect(first!.lopsyMagic).toEqual([0x4c, 0x4f, 0x50, 0x53, 0x59, 0x00]); // "LOPSY\0"
    expect(first!.renderSignature).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(first!.renderChunk).toBe('IHDR');
    expect(first!.renderWidth).toBe(PNG_W);
    expect(first!.renderHeight).toBe(PNG_H);
    expect(first!.renderBitDepth).toBe(16);

    // While the bar is shown, Ctrl+S saves to Photos, carrying the revision the last save returned.
    await lopsy.locator('[data-testid="canvas-container"]').click({ position: { x: 5, y: 5 } });
    await lopsy.keyboard.press('Control+s');
    await expect.poll(async () => (await savesOf(page)).length, { timeout: 30_000 }).toBe(2);
    const second = (await savesOf(page))[1]!;
    expect(second.baseRevision).toBe('rev-2');
    expect(second.lopsyMagic).toEqual([0x4c, 0x4f, 0x50, 0x53, 0x59, 0x00]);
  });

  test('ignores a handoff from an origin that is not Photos', async ({ page, context, baseURL }) => {
    await servePhotosPages(context, new URL(baseURL!).origin);
    await page.goto(`${EVIL_ORIGIN}/`);
    const lopsy = await openLopsyFrom(context, page, `${baseURL}/`, 'unprompted');
    await waitForStore(lopsy);

    // The wrong-origin page keeps posting a valid document every 200 ms.
    await lopsy.waitForTimeout(3000);
    await expect(lopsy.getByRole('dialog', { name: 'New Document' })).toBeVisible();
    await expect(lopsy.getByRole('region', { name: 'Lopsy Photos' })).toHaveCount(0);
    expect((await getEditorState(lopsy)).document.width).not.toBe(PNG_W);
    // Lopsy said ready only to the Photos origin, so this page never heard from it.
    expect(await page.evaluate(() => (window as unknown as { __log: string[] }).__log)).toEqual([]);
  });

  test('File > Add to Lopsy Photos opens Photos to receive the document', async ({ page, context, baseURL }) => {
    await servePhotosPages(context, new URL(baseURL!).origin);
    await page.goto('/');
    await waitForStore(page);
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(120, 80, false);
    });

    await page.getByRole('button', { name: 'File' }).click();
    const [photos] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('menuitem', { name: 'Add to Lopsy Photos' }).click(),
    ]);
    expect(new URL(photos.url()).origin).toBe(PHOTOS_ORIGIN);
    expect(new URL(photos.url()).searchParams.get('receive')).toMatch(/^[A-Za-z0-9_-]+$/);

    await expect(page.getByText('Added to Lopsy Photos')).toBeVisible({ timeout: 30_000 });
    const [save] = await savesOf(photos);
    expect(save!.source).toBeUndefined();
    expect(save!.baseRevision).toBeUndefined();
    expect(save!.lopsyMagic).toEqual([0x4c, 0x4f, 0x50, 0x53, 0x59, 0x00]);
    expect(save!.renderBitDepth).toBe(16);
    expect(save!.renderWidth).toBe(120);
    expect(save!.renderHeight).toBe(80);
    // A document that did not come from Photos gets no bar.
    await expect(page.getByRole('region', { name: 'Lopsy Photos' })).toHaveCount(0);
  });

  test('without the handoff parameter Lopsy shows no Photos bar', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(200, 100, false);
    });
    await expect(page.getByRole('button', { name: 'File' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Lopsy Photos' })).toHaveCount(0);
  });
});
