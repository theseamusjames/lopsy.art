import { test, expect } from '@playwright/test';
import { waitForStore, createDocument, getEditorState, getPixelAt, docToScreen, setToolOption } from './helpers';

test('select all + delete clears all brush dabs', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 400, 300, false);
  await page.waitForTimeout(500);

  const state = await getEditorState(page);
  const activeId = state.document.activeLayerId;

  await page.keyboard.press('b');
  await page.waitForTimeout(100);
  await setToolOption(page, 'Size', 50);
  await page.waitForTimeout(100);

  const d1 = await docToScreen(page, 100, 100);
  await page.mouse.click(d1.x, d1.y);
  await page.waitForTimeout(500);

  const d2 = await docToScreen(page, 250, 200);
  await page.mouse.click(d2.x, d2.y);
  await page.waitForTimeout(500);

  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);

  await page.screenshot({ path: 'e2e/screenshots/delete-selection-cleared.png' });

  const p1 = await getPixelAt(page, 100, 100, activeId);
  const p2 = await getPixelAt(page, 250, 200, activeId);

  expect(p1.a).toBe(0);
  expect(p2.a).toBe(0);
});
