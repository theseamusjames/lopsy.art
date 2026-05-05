import { test, expect, type Page } from './fixtures';
import * as fs from 'fs';
import * as path from 'path';

async function createDocument(page: Page, width: number, height: number) {
  await page.evaluate(
    ({ w, h }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, false);
    },
    { w: width, h: height },
  );
  await page.waitForFunction(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: unknown[] }; undoStack: unknown[] };
    } | undefined;
    if (!store) return false;
    const s = store.getState();
    return s.document.layers.length > 0 && s.undoStack.length > 0;
  });
}

async function docToScreen(page: Page, docX: number, docY: number) {
  return page.evaluate(
    ({ docX, docY }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          viewport: { zoom: number; panX: number; panY: number };
        };
      };
      const state = store.getState();
      const container = document.querySelector('[data-testid="canvas-container"]');
      if (!container) return { x: 0, y: 0 };
      const rect = container.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      return {
        x: rect.left + (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx,
        y: rect.top + (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy,
      };
    },
    { docX, docY },
  );
}

async function selectFont(page: Page, fontFamily: string) {
  await page.locator('button[aria-haspopup="listbox"]').click();
  await page.waitForTimeout(150);
  const searchInput = page.locator('input[aria-label="Search fonts"]');
  await searchInput.fill(fontFamily);
  await page.waitForTimeout(300);
  const byImage = page.locator('[role="option"]').filter({ has: page.locator(`img[alt="${fontFamily}"]`) });
  await page.locator('[role="option"]').first().waitFor({ state: 'visible', timeout: 5000 });
  const imageCount = await byImage.count();
  const fontItem = imageCount > 0
    ? byImage.first()
    : page.locator('[role="option"]').filter({ hasText: new RegExp(`^${fontFamily}`) }).first();
  await fontItem.click();
  await page.waitForTimeout(200);
}

async function waitForFontInEngine(page: Page, fontFamily: string, timeoutMs = 20000) {
  await page.waitForFunction(
    (family) => {
      const fn = (window as unknown as Record<string, unknown>).__isFontLoaded as
        ((f: string) => boolean) | undefined;
      return fn ? fn(family) : false;
    },
    fontFamily,
    { timeout: timeoutMs },
  );
}

async function exportPng(page: Page, saveTo: string): Promise<void> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'File' }).click();
  await page.waitForTimeout(100);
  await page.getByRole('menuitem', { name: 'Quick Export PNG' }).click();
  const download = await downloadPromise;
  const tmpPath = await download.path();
  if (tmpPath) {
    fs.copyFileSync(tmpPath, saveTo);
  }
}

test.describe('Text curve quality', () => {
  test.use({ allowConsoleErrors: [/Failed to load resource.*403/] });

  test('Acme font at 200px has smooth curves in exported PNG', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
    await createDocument(page, 1200, 400);

    // Select text tool and set up Acme font at 200px
    await page.keyboard.press('t');
    await selectFont(page, 'Acme');
    await waitForFontInEngine(page, 'Acme');

    const sizeInput = page.locator('[aria-label="Size value"]').first();
    await sizeInput.fill('200');
    await sizeInput.press('Enter');
    await page.waitForTimeout(100);

    // Click to place text
    const pos = await docToScreen(page, 100, 80);
    await page.mouse.click(pos.x, pos.y);
    await page.keyboard.type('LOPSY');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(500);

    // Export the actual PNG via File > Export PNG
    const pngPath = path.resolve('e2e/screenshots/text-curve-quality-acme-200px-export.png');
    await exportPng(page, pngPath);

    // Read the exported PNG and analyze it
    const pngExists = fs.existsSync(pngPath);
    expect(pngExists).toBe(true);

    // Load the PNG back into the page for pixel analysis
    const pngBase64 = fs.readFileSync(pngPath).toString('base64');
    const analysis = await page.evaluate(async (b64) => {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = `data:image/png;base64,${b64}`;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const data = imageData.data;
      const w = img.width;
      const h = img.height;

      // Find the bounding box of non-white pixels (text content)
      let textTop = h, textBottom = 0, textLeft = w, textRight = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          const r = data[idx]!, g = data[idx + 1]!, b = data[idx + 2]!;
          if (r < 250 || g < 250 || b < 250) {
            if (y < textTop) textTop = y;
            if (y > textBottom) textBottom = y;
            if (x < textLeft) textLeft = x;
            if (x > textRight) textRight = x;
          }
        }
      }

      if (textTop >= textBottom) {
        return { width: w, height: h, textFound: false, edgePixels: 0, smoothEdgePixels: 0, ratio: 0, sampleRow: '', textBounds: null };
      }

      // Analyze edge quality: look at luminance transitions on horizontal scanlines
      // through the text. For black text on white, luminance = (r+g+b)/3.
      // Smooth AA: many pixels with intermediate luminance (50-200).
      // Hinted/aliased: few intermediate pixels, abrupt 0↔255 transitions.
      let edgePixels = 0;
      let smoothEdgePixels = 0;

      const textH = textBottom - textTop;
      for (let scanY = textTop + Math.floor(textH * 0.15); scanY < textTop + Math.floor(textH * 0.85); scanY += 2) {
        for (let x = textLeft; x <= textRight; x++) {
          const idx = (scanY * w + x) * 4;
          const lum = (data[idx]! + data[idx + 1]! + data[idx + 2]!) / 3;
          const prevIdx = (scanY * w + (x - 1)) * 4;
          const prevLum = (data[prevIdx]! + data[prevIdx + 1]! + data[prevIdx + 2]!) / 3;
          const diff = Math.abs(lum - prevLum);
          if (diff > 3) {
            edgePixels++;
            if (lum > 20 && lum < 235) {
              smoothEdgePixels++;
            }
          }
        }
      }

      // Also dump a sample scanline through the middle of the "O" for debugging
      const midY = Math.floor((textTop + textBottom) / 2);
      const sampleLums: number[] = [];
      for (let x = textLeft; x <= Math.min(textRight, textLeft + 400); x++) {
        const idx = (midY * w + x) * 4;
        const lum = Math.round((data[idx]! + data[idx + 1]! + data[idx + 2]!) / 3);
        sampleLums.push(lum);
      }

      return {
        width: w,
        height: h,
        textFound: true,
        edgePixels,
        smoothEdgePixels,
        ratio: edgePixels > 0 ? smoothEdgePixels / edgePixels : 0,
        sampleRow: sampleLums.join(','),
        textBounds: { top: textTop, bottom: textBottom, left: textLeft, right: textRight },
      };
    }, pngBase64);

    console.log('Export analysis:', JSON.stringify({
      dimensions: `${analysis.width}x${analysis.height}`,
      textFound: analysis.textFound,
      textBounds: analysis.textBounds,
      edgePixels: analysis.edgePixels,
      smoothEdgePixels: analysis.smoothEdgePixels,
      aaRatio: analysis.ratio.toFixed(3),
    }));
    console.log('Sample luminance row (first 200 values):', analysis.sampleRow.split(',').slice(0, 200).join(','));

    expect(analysis.textFound).toBe(true);
    expect(analysis.edgePixels).toBeGreaterThan(50);

    // Save a cropped version of just the text at 1:1 for direct inspection
    const croppedPath = path.resolve('e2e/screenshots/text-curve-quality-acme-200px-cropped.png');
    await page.evaluate(async ({ b64, bounds }) => {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = `data:image/png;base64,${b64}`;
      });
      const pad = 10;
      const cw = bounds.right - bounds.left + pad * 2;
      const ch = bounds.bottom - bounds.top + pad * 2;
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(img, bounds.left - pad, bounds.top - pad, cw, ch, 0, 0, cw, ch);
      const dataUrl = canvas.toDataURL('image/png');
      (window as unknown as Record<string, string>).__croppedPng = dataUrl;
    }, { b64: pngBase64, bounds: analysis.textBounds });

    const croppedDataUrl = await page.evaluate(() =>
      (window as unknown as Record<string, string>).__croppedPng ?? ''
    );
    if (croppedDataUrl.startsWith('data:image/png;base64,')) {
      const b64 = croppedDataUrl.replace('data:image/png;base64,', '');
      fs.writeFileSync(croppedPath, Buffer.from(b64, 'base64'));
    }

    // Dump a detailed vertical slice through the O's right curve to check AA quality.
    // This gives us pixel-by-pixel luminance values to see if transitions are smooth.
    const curveSlice = await page.evaluate(async (b64) => {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = `data:image/png;base64,${b64}`;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const data = imageData.data;
      const w = img.width;
      const h = img.height;

      // Find horizontal scan through the middle of text
      let textTop = h, textBottom = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          if (data[idx]! < 250) {
            if (y < textTop) textTop = y;
            if (y > textBottom) textBottom = y;
          }
        }
      }

      // Collect several horizontal scans through the text
      const scans: { y: number; lums: number[] }[] = [];
      const textH = textBottom - textTop;
      for (const frac of [0.15, 0.3, 0.45, 0.55, 0.7, 0.85]) {
        const scanY = textTop + Math.floor(textH * frac);
        const lums: number[] = [];
        for (let x = 0; x < w; x++) {
          const idx = (scanY * w + x) * 4;
          lums.push(Math.round((data[idx]! + data[idx + 1]! + data[idx + 2]!) / 3));
        }
        scans.push({ y: scanY, lums });
      }

      // For each scan, find all edge transitions and measure how many
      // intermediate values exist per transition.
      const transitionDetails: { y: number; transitions: { pos: number; values: number[] }[] }[] = [];
      for (const scan of scans) {
        const transitions: { pos: number; values: number[] }[] = [];
        let inTransition = false;
        let transValues: number[] = [];
        let transPos = 0;
        for (let x = 1; x < scan.lums.length; x++) {
          const diff = Math.abs(scan.lums[x]! - scan.lums[x - 1]!);
          if (diff > 2) {
            if (!inTransition) {
              inTransition = true;
              transPos = x - 1;
              transValues = [scan.lums[x - 1]!];
            }
            transValues.push(scan.lums[x]!);
          } else if (inTransition) {
            transValues.push(scan.lums[x]!);
            transitions.push({ pos: transPos, values: transValues });
            inTransition = false;
          }
        }
        if (inTransition) {
          transitions.push({ pos: transPos, values: transValues });
        }
        transitionDetails.push({ y: scan.y, transitions });
      }

      return { textTop, textBottom, transitionDetails };
    }, pngBase64);

    // Log detailed edge transition data
    for (const scan of curveSlice.transitionDetails) {
      const summary = scan.transitions.map(t =>
        `@${t.pos}:[${t.values.join(',')}](${t.values.length}px)`
      ).join(' ');
      console.log(`Row ${scan.y}: ${scan.transitions.length} transitions: ${summary}`);
    }

    // Extract a pixel grid from the O's right curve for visual inspection.
    // The O should be the second letter, starting roughly at textLeft + letterWidth.
    const curveGrid = await page.evaluate(async (b64) => {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = `data:image/png;base64,${b64}`;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height).data;
      const w = img.width;

      // Find the text bounding box
      let textTop = img.height, textBottom = 0, textLeft = img.width, textRight = 0;
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const idx = (y * w + x) * 4;
          if (data[idx]! < 250) {
            if (y < textTop) textTop = y;
            if (y > textBottom) textBottom = y;
            if (x < textLeft) textLeft = x;
            if (x > textRight) textRight = x;
          }
        }
      }

      // Find the O letter's right edge. Scan horizontally through the middle of
      // text and find the 2nd white gap (between L and O the gap, then O's
      // interior hole, then the right edge of O).
      const midY = Math.floor((textTop + textBottom) / 2);
      let gapCount = 0;
      let inBlack = false;
      let oRightEdge = 0;
      for (let x = textLeft; x <= textRight; x++) {
        const idx = (midY * w + x) * 4;
        const lum = Math.round((data[idx]! + data[idx + 1]! + data[idx + 2]!) / 3);
        const isBlack = lum < 128;
        if (isBlack && !inBlack) {
          inBlack = true;
        } else if (!isBlack && inBlack) {
          inBlack = false;
          gapCount++;
          if (gapCount === 2) {
            // We've exited the O's right wall. Now find the outer right edge.
            // Continue scanning to find the next black→white transition.
            for (let x2 = x; x2 <= textRight; x2++) {
              const idx2 = (midY * w + x2) * 4;
              const lum2 = Math.round((data[idx2]! + data[idx2 + 1]! + data[idx2 + 2]!) / 3);
              if (lum2 < 128) {
                // Found the right stroke of O, now find its outer edge
                for (let x3 = x2; x3 <= textRight; x3++) {
                  const idx3 = (midY * w + x3) * 4;
                  const lum3 = Math.round((data[idx3]! + data[idx3 + 1]! + data[idx3 + 2]!) / 3);
                  if (lum3 > 200) {
                    oRightEdge = x3 - 5;
                    break;
                  }
                }
                break;
              }
            }
            break;
          }
        }
      }

      // Extract a 30-row tall vertical strip around the O's right curve
      const stripW = 20;
      const stripH = textBottom - textTop;
      const stripX = oRightEdge - 10;
      const rows: string[] = [];
      for (let y = textTop; y <= textBottom; y++) {
        let row = '';
        for (let dx = 0; dx < stripW; dx++) {
          const x = stripX + dx;
          const idx = (y * w + x) * 4;
          const lum = Math.round((data[idx]! + data[idx + 1]! + data[idx + 2]!) / 3);
          // Map to visual characters
          if (lum > 240) row += '·';
          else if (lum > 200) row += '░';
          else if (lum > 150) row += '▒';
          else if (lum > 100) row += '▓';
          else if (lum > 50) row += '█';
          else row += '■';
        }
        rows.push(`${String(y).padStart(3)}|${row}|`);
      }
      return { oRightEdge, stripX, rows, gapCount };
    }, pngBase64);

    console.log(`O right edge at x=${curveGrid.oRightEdge}, strip at x=${curveGrid.stripX}`);
    console.log('Curve pixel grid (O right edge):');
    for (const row of curveGrid.rows) {
      console.log(row);
    }

    // Generate a browser canvas reference and compare edge quality side by side.
    const comparison = await page.evaluate(async (b64) => {
      await document.fonts.ready;

      // Render reference with canvas 2D
      const refCanvas = document.createElement('canvas');
      refCanvas.width = 1200;
      refCanvas.height = 400;
      const refCtx = refCanvas.getContext('2d')!;
      refCtx.fillStyle = 'white';
      refCtx.fillRect(0, 0, 1200, 400);
      refCtx.fillStyle = 'black';
      refCtx.font = '200px Acme';
      refCtx.fillText('LOPSY', 100, 280);
      const refData = refCtx.getImageData(0, 0, 1200, 400).data;

      // Load our export
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = `data:image/png;base64,${b64}`;
      });
      const ourCanvas = document.createElement('canvas');
      ourCanvas.width = img.width;
      ourCanvas.height = img.height;
      const ourCtx = ourCanvas.getContext('2d')!;
      ourCtx.drawImage(img, 0, 0);
      const ourData = ourCtx.getImageData(0, 0, img.width, img.height).data;
      const w = img.width;

      // Compare edge smoothness between the two renderings.
      // Count pixels where our rendering differs from the reference by >30 in luminance.
      let differentPixels = 0;
      let totalDarkPixels = 0;
      for (let y = 100; y < 350; y++) {
        for (let x = 50; x < 700; x++) {
          const oi = (y * w + x) * 4;
          const ri = (y * 1200 + x) * 4;
          const ourLum = (ourData[oi]! + ourData[oi + 1]! + ourData[oi + 2]!) / 3;
          const refLum = (refData[ri]! + refData[ri + 1]! + refData[ri + 2]!) / 3;
          if (ourLum < 200 || refLum < 200) totalDarkPixels++;
          if (Math.abs(ourLum - refLum) > 30) differentPixels++;
        }
      }

      // Sample the S curve in detail from both renderings.
      // Find where S is (4th letter, roughly x=440-530 area based on prior data)
      const sampleRows = [0.3, 0.5, 0.7].map(f => Math.floor(100 + 250 * f));
      const edgeDetails: string[] = [];
      for (const row of sampleRows) {
        let ourEdges = '';
        let refEdges = '';
        for (let x = 420; x < 550; x++) {
          const oi = (row * w + x) * 4;
          const ri = (row * 1200 + x) * 4;
          const ourLum = Math.round((ourData[oi]! + ourData[oi + 1]! + ourData[oi + 2]!) / 3);
          const refLum = Math.round((refData[ri]! + refData[ri + 1]! + refData[ri + 2]!) / 3);
          ourEdges += ourLum < 128 ? '█' : ourLum < 240 ? '▓' : '·';
          refEdges += refLum < 128 ? '█' : refLum < 240 ? '▓' : '·';
        }
        edgeDetails.push(`Row ${row} our: ${ourEdges}`);
        edgeDetails.push(`Row ${row} ref: ${refEdges}`);
      }

      return {
        differentPixels,
        totalDarkPixels,
        diffRatio: totalDarkPixels > 0 ? differentPixels / totalDarkPixels : 0,
        edgeDetails,
      };
    }, pngBase64);

    console.log(`Pixel diff: ${comparison.differentPixels}/${comparison.totalDarkPixels} (${(comparison.diffRatio * 100).toFixed(1)}%)`);
    for (const line of comparison.edgeDetails) {
      console.log(line);
    }

    expect(analysis.ratio).toBeGreaterThan(0.15);
  });
});
