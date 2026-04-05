import { test, expect } from '@playwright/test';

test('guide color swatch works with gradient tool active', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
  
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
    };
    store.getState().createDocument(400, 300, false);
  });
  await page.waitForTimeout(500);

  // Set gradient tool active
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { setActiveTool: (tool: string) => void };
    };
    store.getState().setActiveTool('gradient');
  });
  await page.waitForTimeout(100);

  const container = page.locator('[data-testid="canvas-container"]');
  const box = await container.boundingBox();
  expect(box).toBeTruthy();
  
  // Click the ruler corner with gradient tool
  await page.mouse.click(box!.x + 10, box!.y + 10);
  await page.waitForTimeout(300);
  
  const picker = page.locator('[class*="guideColorPicker"]');
  const visible = await picker.isVisible().catch(() => false);
  console.log('Picker visible with gradient tool:', visible);
  expect(visible).toBe(true);
});
