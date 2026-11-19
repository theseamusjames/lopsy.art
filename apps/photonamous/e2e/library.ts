import { expect, type Page } from '@playwright/test';

/** Draws a JPEG in the page with OffscreenCanvas and returns its bytes. */
export async function generatedJpeg(page: Page, hue: number, width = 800, height = 600): Promise<Buffer> {
  const bytes = await page.evaluate(
    async ({ hue, width, height }) => {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      const g = ctx.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, `hsl(${hue} 60% 30%)`);
      g.addColorStop(1, `hsl(${(hue + 60) % 360} 60% 60%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#f0f0f0';
      ctx.beginPath();
      ctx.arc(width * 0.65, height * 0.4, height * 0.2, 0, Math.PI * 2);
      ctx.fill();
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    { hue, width, height },
  );
  return Buffer.from(bytes);
}

/** Imports files through Import photos → Choose photos, and waits for the import to finish. */
export async function importFiles(page: Page, files: { name: string; buffer: Buffer }[]): Promise<void> {
  await page.getByRole('button', { name: /Import photos/ }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: /Choose photos/ }).click();
  await (await chooser).setFiles(files.map((f) => ({ name: f.name, mimeType: 'image/jpeg', buffer: f.buffer })));
  await page.getByRole('button', { name: new RegExp(`^Import ${files.length} photo`) }).click();
  await expect(page.getByText(/^Imported \d+ photo/)).toBeVisible({ timeout: 60_000 });
}

export function tiles(page: Page) {
  return page.locator('[data-asset-id]');
}

/** The "N photos" count under the grid's title. */
export async function shownCount(page: Page): Promise<number> {
  const text = (await page.locator('h1 + span').first().textContent()) ?? '';
  return Number(text.replace(/[^\d].*$/, ''));
}
