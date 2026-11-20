import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { raiseExposure, waitForReady } from './harness';
import { generatedJpeg, importFiles } from './library';

/**
 * A Lopsy document is edited in Photonamous on its flattened render, the
 * PNG Lopsy saves with it: Enter and the tile menu's Edit open it in the
 * Edit view, the filmstrip and ← → include it, and its edit shows on its
 * tile. Edit in Lopsy still sends the document itself, as its .lopsy.
 *
 * Lopsy is played by a page served here at Lopsy's address (the dev
 * server's default, http://localhost:5173), which speaks the handoff
 * protocol (packages/handoff): it takes a photo or document, and can save
 * a document back. No Lopsy server is needed, and none on that port is
 * reached.
 */

const LOPSY_ORIGIN = 'http://localhost:5173';

/** What the stand-in keeps on its window. */
interface StandIn {
  received: { kind: string; name: string } | null;
  saves: { ok: boolean }[];
  saveBack: (name: string) => Promise<void>;
}

const STAND_IN = `<!doctype html>
<title>Lopsy stand-in</title>
<script>
  const id = new URLSearchParams(location.search).get('photos-handoff');
  window.received = null;
  window.saves = [];
  if (id && window.opener) {
    const ready = setInterval(() => window.opener && window.opener.postMessage({ protocol: 1, type: 'lopsy:ready', id }, '*'), 250);
    window.addEventListener('message', (event) => {
      const m = event.data;
      if (!m || m.id !== id) return;
      if (m.type === 'photos:document' && !window.received) {
        clearInterval(ready);
        window.received = m.document;
        event.source.postMessage({ protocol: 1, type: 'lopsy:received', id }, event.origin);
      }
      if (m.type === 'photos:saved') window.saves.push(m);
    });
    // Save to Photonamous: a .lopsy (its magic, then anything) and its flattened render.
    window.saveBack = async (name) => {
      const canvas = new OffscreenCanvas(480, 320);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#d04040';
      ctx.fillRect(0, 0, 480, 320);
      const render = await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
      const lopsy = new Uint8Array([0x4c, 0x4f, 0x50, 0x53, 0x59, 0x00, 1, 2, 3, 4]).buffer;
      const source = window.received.source;
      window.opener.postMessage({ protocol: 1, type: 'lopsy:save', id, saveId: 'save-1', name, lopsy, render, source }, '*', [lopsy, render]);
    };
  }
</script>`;

async function standInForLopsy(context: BrowserContext): Promise<void> {
  await context.route(
    (url) => url.origin === LOPSY_ORIGIN,
    (route) => route.fulfill({ status: 200, contentType: 'text/html', body: STAND_IN }),
  );
}

/** Runs `open` and returns the Lopsy tab it opens, once a photo or document has been handed to it. */
async function lopsyTab(context: BrowserContext, open: () => Promise<void>): Promise<{ tab: Page; kind: string }> {
  const [tab] = await Promise.all([context.waitForEvent('page'), open()]);
  await tab.waitForURL(new RegExp(`^${LOPSY_ORIGIN}/\\?photos-handoff=[\\w-]+$`), { timeout: 30_000 });
  const received = () => tab.evaluate(() => (window as unknown as StandIn).received?.kind ?? null);
  await expect.poll(received, { timeout: 120_000 }).not.toBeNull();
  return { tab, kind: (await received()) ?? '' };
}

test('a Lopsy document is edited on its flattened render, and goes to Lopsy as its .lopsy', async ({ page, context }) => {
  test.setTimeout(300_000);
  await standInForLopsy(context);
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  await importFiles(page, [
    { name: 'alpha.jpg', buffer: await generatedJpeg(page, 20, 480, 320) },
    { name: 'beta.jpg', buffer: await generatedJpeg(page, 200, 480, 320) },
  ]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await page.getByRole('combobox', { name: 'Order by' }).selectOption('name');
  const alpha = page.locator('[role="gridcell"][title="alpha.jpg"]');
  await expect(alpha).toBeVisible();

  // Alpha goes to Lopsy and comes back as a document, stacked behind it.
  await alpha.click();
  await alpha.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Photo actions' });
  const sent = await lopsyTab(context, () => menu.getByRole('menuitem', { name: 'Edit in Lopsy' }).click());
  expect(sent.kind).toBe('png16');
  await sent.tab.evaluate((name) => (window as unknown as StandIn).saveBack(name), 'alpha');
  await expect.poll(() => sent.tab.evaluate(() => (window as unknown as StandIn).saves.map((s) => s.ok)), { timeout: 60_000 }).toEqual([true]);
  await sent.tab.close();

  // Its stack open, the document sits between the two photos.
  const badge = alpha.getByRole('button', { name: '1 Lopsy document', exact: true });
  await expect(badge).toBeVisible({ timeout: 60_000 });
  await badge.click();
  const documentTile = page.locator('[role="gridcell"][title="alpha.lopsy"]');
  await expect(documentTile).toBeVisible();
  await expect(page.getByRole('gridcell')).toHaveCount(3);
  expect(await page.getByRole('gridcell').evaluateAll((cells) => cells.map((c) => c.getAttribute('title')))).toEqual([
    'alpha.jpg',
    'alpha.lopsy',
    'beta.jpg',
  ]);

  // The tile menu offers Edit in Lopsy and Edit for it, as for a photo; Edit in Lopsy sends the document itself.
  await documentTile.click();
  await documentTile.click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: 'Edit', exact: true })).toBeVisible();
  const reopened = await lopsyTab(context, () => menu.getByRole('menuitem', { name: 'Edit in Lopsy' }).click());
  expect(reopened.kind).toBe('lopsy');
  await reopened.tab.close();
  await page.bringToFront();

  // Enter on the document opens the Edit view, on its flattened render.
  await documentTile.click();
  const unedited = (await documentTile.getAttribute('data-preview-hash')) ?? '';
  await page.keyboard.press('Enter');
  await waitForReady(page, 60_000);
  const edit = page.getByTestId('edit-view');
  const title = edit.getByRole('heading', { level: 1 });
  await expect(title).toHaveText('alpha.lopsy');
  await expect(page.getByTestId('edit-notice')).toHaveCount(0);

  // The filmstrip has it between the two photos, and ← → go through it.
  const strip = edit.getByRole('navigation', { name: 'Filmstrip' });
  await expect(strip.getByRole('button')).toHaveCount(3);
  await expect(strip.getByRole('button', { name: 'alpha.lopsy' })).toHaveAttribute('aria-current', 'true');
  await page.locator('body').press('ArrowRight');
  await expect(title).toHaveText('beta.jpg');
  await waitForReady(page, 60_000);
  await page.locator('body').press('ArrowLeft');
  await expect(title).toHaveText('alpha.lopsy');
  await waitForReady(page, 60_000);
  await page.screenshot({ path: 'test-results/edit-documents-filmstrip.png' });

  // An edit on it is kept, and its tile shows it.
  await raiseExposure(page, 5);
  await expect(page.getByLabel('Exposure value')).toHaveValue('+0.50');
  await edit.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(documentTile).toHaveAttribute('data-edited', 'true');
  await expect(documentTile).not.toHaveAttribute('data-preview-hash', unedited, { timeout: 60_000 });
});
