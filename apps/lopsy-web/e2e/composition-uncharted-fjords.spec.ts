import { test, expect, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as flow from './composition-uncharted-fjords.flow.ts';

// Sandboxed runners may block cdn.jsdelivr.net (the engine's Google Font
// TTFs) and give headless Chromium no route to Google Fonts (the canvas
// path-text renderer's @font-face). FJORDS_FONT_DIR points at a local mirror of
// google/fonts (ofl/<dir>/<file>); when set, TTFs are served from it and
// Google Fonts CSS / font files are fetched with curl, which honours the proxy.
async function mirrorFonts(page: Page): Promise<void> {
  const dir = process.env.FJORDS_FONT_DIR;
  if (!dir) return;
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, async (route) => {
    const url = route.request().url();
    const ua = await page.evaluate(() => navigator.userAgent).catch(() => 'Mozilla/5.0 Chrome/120');
    try {
      const body = execFileSync('curl', ['-sSf', '-A', ua, url], { maxBuffer: 1 << 26 });
      const type = url.includes('googleapis') ? 'text/css' : url.endsWith('.ttf') ? 'font/ttf' : 'font/woff2';
      await route.fulfill({ body, contentType: type, headers: { 'access-control-allow-origin': '*' } });
    } catch {
      await route.abort();
    }
  });
  await page.route('https://cdn.jsdelivr.net/gh/google/fonts@main/**', async (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.replace('/gh/google/fonts@main/', ''));
    const file = `${dir}/${rel}`;
    if (existsSync(file)) {
      await route.fulfill({ body: readFileSync(file), contentType: 'font/ttf' });
      return;
    }
    await route.continue();
  });
}

// "Uncharted Fjords": a cartographic expedition-company emblem built entirely
// through the editor UI (see e2e/GUIDE.md). It doubles as the capture script
// for tutorials/uncharted-fjords-cartographic-logo. Screenshots land in
// e2e/screenshots with a fjords- prefix.

test.describe('composition: Uncharted Fjords cartographic logo', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('builds the emblem through the UI', async ({ page }) => {
    test.setTimeout(4 * 60 * 60 * 1000);
    await mirrorFonts(page);
    await flow.s01(page);
    await flow.s02(page);
    await flow.s03(page);
    await flow.s04(page);
    await flow.s05(page);
    await flow.s06(page);
    await flow.s07(page);

    // Copy / paste / rotate / scale three skerries; undo x3 then redo x3
    // must bring the last one back byte-identical.
    const skerries = await flow.s08(page) as { undoChanged: boolean; redoMatches: boolean };
    expect(skerries.undoChanged).toBe(true);
    expect(skerries.redoMatches).toBe(true);

    await flow.s09(page);
    await flow.s10(page);
    await flow.s11(page);
    await flow.s12(page);
    await flow.s13(page);

    // Snap-dragging the Compass Rose group moves all its layers; undo puts
    // them back exactly, redo re-applies the move.
    const rose = await flow.s14(page) as { movedDiffers: boolean; undoRestores: boolean; redoMatches: boolean; finalHome: boolean };
    expect(rose).toEqual({ ...rose, movedDiffers: true, undoRestores: true, redoMatches: true, finalHome: true });

    await flow.s15(page);
    await flow.s16(page);

    // FJORDS is centred on the ribbon, and the J's descender stays inside
    // the cream inner rule (band 782..898, rule 7-9 px in).
    const word = await flow.s17(page) as { x0: number; y0: number; x1: number; y1: number };
    expect(Math.abs((word.x0 + word.x1) / 2 - 600)).toBeLessThanOrEqual(1);
    expect(word.y0).toBeGreaterThan(flow.BAND.y0 + 20);
    expect(word.y1).toBeLessThan(flow.BAND.y1 - 9);

    // Both seal lines are centred on the emblem's vertical axis.
    const top = await flow.s18(page) as { final: { x0: number; x1: number } };
    expect(Math.abs((top.final.x0 + top.final.x1) / 2 - 600)).toBeLessThanOrEqual(2);
    const bottom = await flow.s19(page) as { final: { x0: number; x1: number; y1: number } };
    expect(Math.abs((bottom.final.x0 + bottom.final.x1) / 2 - 600)).toBeLessThanOrEqual(2);

    // The coordinates are turned upright (taller than wide) and centred in the rim band.
    const coords = await flow.s20(page) as Array<{ x0: number; y0: number; x1: number; y1: number }>;
    for (const [i, c] of coords.entries()) {
      expect(c.y1 - c.y0).toBeGreaterThan((c.x1 - c.x0) * 2);
      expect(Math.abs((c.x0 + c.x1) / 2 - (i === 0 ? 600 - flow.R_BAND : 600 + flow.R_BAND))).toBeLessThanOrEqual(1);
      expect(Math.abs((c.y0 + c.y1) / 2 - 600)).toBeLessThanOrEqual(1);
    }

    await flow.s21(page);
    await flow.s22(page);
  });
});
