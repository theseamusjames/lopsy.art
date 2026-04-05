import { test, expect } from '@playwright/test';

test('guide color picker hue bar drag releases properly', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
  
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
    };
    store.getState().createDocument(400, 300, false);
  });
  await page.waitForTimeout(500);

  // Click the swatch to open picker
  const container = page.locator('[data-testid="canvas-container"]');
  const box = await container.boundingBox();
  await page.mouse.click(box!.x + 10, box!.y + 10);
  await page.waitForTimeout(300);

  // Find the picker
  const picker = page.locator('[class*="guideColorPicker"]');
  await expect(picker).toBeVisible();
  const pickerBox = await picker.boundingBox();

  // Click and drag on the hue bar (second row in the picker)
  // The hue bar is below the SV area, roughly at pickerBox.y + pickerBox.height * 0.75
  const hueY = pickerBox!.y + pickerBox!.height * 0.7;
  const hueX = pickerBox!.x + pickerBox!.width * 0.5;
  
  await page.mouse.move(hueX, hueY);
  await page.mouse.down();
  await page.mouse.move(hueX + 20, hueY);
  await page.mouse.up();
  await page.waitForTimeout(100);

  // Now move the mouse elsewhere — it should NOT still be dragging
  const colorBefore = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { guideColor: { r: number; g: number; b: number } };
    };
    return store.getState().guideColor;
  });

  // Move mouse far away
  await page.mouse.move(300, 300);
  await page.waitForTimeout(100);

  const colorAfter = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { guideColor: { r: number; g: number; b: number } };
    };
    return store.getState().guideColor;
  });

  // Color should NOT have changed after mouseup + mousemove elsewhere
  console.log('Before:', colorBefore, 'After:', colorAfter);
  expect(colorAfter.r).toBe(colorBefore.r);
  expect(colorAfter.g).toBe(colorBefore.g);
  expect(colorAfter.b).toBe(colorBefore.b);
});

test('esc closes the guide color picker', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
  
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
    };
    store.getState().createDocument(400, 300, false);
  });
  await page.waitForTimeout(500);

  const container = page.locator('[data-testid="canvas-container"]');
  const box = await container.boundingBox();
  await page.mouse.click(box!.x + 10, box!.y + 10);
  await page.waitForTimeout(300);

  const picker = page.locator('[class*="guideColorPicker"]');
  await expect(picker).toBeVisible();

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  await expect(picker).not.toBeVisible();
});
