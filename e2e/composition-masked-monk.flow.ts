import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  pause, menu, tool, setFg, fill, deselect, selectLayer, renameActive, newLayer,
  gradientDrag, hexToRgb, type Stop, filter, blendMode, closeEffects, effect, layerOpacity,
  brushSettings, closeBrushSettings, dragDoc, clickDoc, type Pt,
  lassoSelect, rectSelect, pressKey, docToScreen, setFont, contentBounds, toolOption, moveBy, selectAlpha,
  rasterizeStyle, scaleSelection, centerContentOn, rotateSelection, bezierPts, ellipsePts, activeLayerId,
} from './composition-cosmic-xray.steps.ts';

// "Rise of the Masked Monk": a photo collage movie poster built entirely
// through the editor UI. It doubles as the capture script for
// tutorials/raccoon-kung-fu-monk-movie-poster. Screenshots land in
// e2e/screenshots with a masked-monk- prefix.

export const DOC_W = 1200;
export const DOC_H = 1600;
const FIXTURES = 'e2e/fixtures/masked-monk';

let shotDir = process.env.MONK_SHOT_DIR ?? 'e2e/screenshots';
export function setShotDir(dir: string): void { shotDir = dir; }

export async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shotDir}/masked-monk-${name}.png` });
}

export async function layers(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string; layerOrder: string[]; layers: Array<Record<string, unknown>> }; undoStack: unknown[]; redoStack: unknown[] };
    };
    const s = store.getState();
    return {
      active: s.document.activeLayerId, undo: s.undoStack.length, redo: s.redoStack.length,
      layers: s.document.layerOrder.map((id) => {
        const l = s.document.layers.find((x) => x.id === id)!;
        return `${l.name} [${l.type}] ${l.x},${l.y} ${l.width}x${l.height} op=${l.opacity} ${l.blendMode} parent=${l.parentId ?? ''}`;
      }),
    };
  });
}

/** Drop a photo from disk onto the canvas, the way dragging it from a folder does. */
export async function dropPhoto(page: Page, file: string): Promise<void> {
  const b64 = readFileSync(`${FIXTURES}/${file}`).toString('base64');
  const before = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as { getState: () => { document: { layers: unknown[] } } };
    return store.getState().document.layers.length;
  });
  await page.evaluate(async ({ b64, file }) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const f = new File([bytes], file, { type: 'image/jpeg' });
    const target = document.querySelector('[data-testid="canvas-container"]')!;
    const dt = new DataTransfer();
    dt.items.add(f);
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  }, { b64, file });
  await page.waitForFunction((n) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as { getState: () => { document: { layers: unknown[] } } };
    return store.getState().document.layers.length > n;
  }, before);
  await pause(page, 1200);
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/**
 * Drive a shared ColorPicker to a hex. Clicks stay 2 px inside each strip:
 * a click on the square's last pixel row lands outside it and is ignored.
 */
async function pickColorIn(page: Page, scope: ReturnType<Page['locator']>, hex: string, alpha = 1): Promise<void> {
  const { r, g, b } = hexToRgb(hex);
  const { h, s, v } = rgbToHsv(r, g, b);
  const inset = (x: number, w: number, t: number) => x + 2 + t * (w - 4);
  const hb = await scope.locator('[aria-label="Hue"]').boundingBox();
  if (hb && s > 0.001) await page.mouse.click(inset(hb.x, hb.width, h / 360), hb.y + hb.height / 2);
  const sb = await scope.locator('[aria-label="Saturation and brightness"]').boundingBox();
  if (sb) await page.mouse.click(inset(sb.x, sb.width, s), inset(sb.y, sb.height, 1 - v));
  const ab = await scope.locator('[aria-label="Opacity"]').boundingBox();
  if (ab) await page.mouse.click(inset(ab.x, ab.width, alpha), ab.y + ab.height / 2);
}

export async function setGradient(page: Page, type: 'linear' | 'radial', stops: Stop[]): Promise<void> {
  await tool(page, 'gradient');
  await page.locator('[aria-labelledby="gradient-type-label"]').selectOption(type);
  await page.getByTestId('gradient-advanced-btn').click();
  const dlg = page.locator('[role="dialog"][aria-label="Gradient Editor"]');
  await dlg.waitFor({ state: 'visible' });
  for (let guard = 0; guard < 20; guard++) {
    const n = await dlg.locator('[data-testid^="gradient-stop-"]').count();
    if (n <= 2) break;
    await dlg.getByTestId('gradient-stop-1').click();
    await dlg.getByTestId('gradient-delete-stop').click();
  }
  const bar = dlg.getByTestId('gradient-bar');
  const bb = (await bar.boundingBox())!;
  for (const [i, x] of [[0, bb.x - 20], [1, bb.x + bb.width + 20]] as const) {
    const hb = (await dlg.getByTestId(`gradient-stop-${i}`).boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, hb.y + hb.height / 2, { steps: 3 });
    await page.mouse.up();
  }
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  const first = sorted[0]!, last = sorted[sorted.length - 1]!;
  await dlg.getByTestId('gradient-stop-0').click();
  await pickColorIn(page, dlg, first.hex, first.a ?? 1);
  await dlg.getByTestId('gradient-stop-1').click();
  await pickColorIn(page, dlg, last.hex, last.a ?? 1);
  for (const st of sorted.slice(1, -1)) {
    await page.mouse.click(bb.x + st.pos * bb.width, bb.y + bb.height / 2);
    await pause(page, 60);
    await pickColorIn(page, dlg, st.hex, st.a ?? 1);
  }
  await dlg.getByRole('button', { name: 'Done' }).click();
  await pause(page, 100);
}

/** Click a layer's mask thumbnail to paint on the mask instead of the pixels. */
export async function editMask(page: Page, name: string): Promise<void> {
  await page.locator(`[aria-label="Edit mask for ${name}"]`).click();
  await pause(page, 200);
}

/**
 * Web fonts load from jsDelivr's mirror of the google/fonts repo. Sandboxes
 * that only reach GitHub fetch the same files from raw.githubusercontent.com.
 */
export async function mirrorFonts(page: Page): Promise<void> {
  await page.route('https://cdn.jsdelivr.net/gh/google/fonts@main/**', async (route) => {
    const file = route.request().url().split('/gh/google/fonts@main/')[1];
    const res = await route.fetch({ url: `https://raw.githubusercontent.com/google/fonts/main/${file}` });
    await route.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': '*' } });
  });
}

export async function s01(page: Page): Promise<void> {
  if (process.env.MONK_MIRROR_FONTS) await mirrorFonts(page);
  await page.goto(process.env.MONK_URL ?? '/');
  await page.getByText('New Document').waitFor();
  await page.locator('label:has-text("Width")').locator('..').locator('input').fill(String(DOC_W));
  await page.locator('label:has-text("Height")').locator('..').locator('input').fill(String(DOC_H));
  await page.getByRole('button', { name: 'Create' }).click();
  await page.locator('[data-testid="canvas-container"]').waitFor();
  await pause(page, 800);
  await selectLayer(page, 'Background');
  await setFg(page, '#0E1216');
  await fill(page);
  await shot(page, '01-new-doc');
}

export async function s02(page: Page): Promise<void> {
  await selectLayer(page, 'Layer 1');
  await dropPhoto(page, 'wudang-temple.jpg');
  await renameActive(page, 'Temple');
  await shot(page, '02-temple-dropped');
}

export async function s03(page: Page): Promise<void> {
  // The drop fitted the photo to 1200 x 1488 at y 56. Blow it up 1.5x so the
  // courtyard floor is big enough to stand on: zoom out to reach the handle,
  // then drag the bottom-right corner out to 1800 x 2232.
  await menu(page, 'View', 'Zoom Out');
  await menu(page, 'View', 'Zoom Out');
  await scaleSelection(page, { x: 1200, y: 1544 }, 600, 744, true);
  await shot(page, '03a-temple-scaled');
  // Slide it up and left until the front edge of the courtyard sits at the
  // bottom of the poster and the central hall is centred.
  await dragDoc(page, [{ x: 900, y: 1300 }, { x: 780, y: 1230 }, { x: 656, y: 1162 }], { steps: 8 });
  await shot(page, '03b-temple-moved');
  await deselect(page);
  await menu(page, 'View', 'Fit to Screen');
  await shot(page, '03-temple-placed');
}

export async function s04(page: Page): Promise<void> {
  await selectLayer(page, 'Layer 1');
  await page.locator('[aria-label="Delete Layer"]').click();
  await pause(page, 200);
  await selectLayer(page, 'Temple');
  await newLayer(page, 'Storm');
  await filter(page, 'Clouds...', { Scale: 5 });
  // Flatten the clouds' range so Multiply greys the sky instead of blacking it.
  await filter(page, 'Brightness/Contrast...', { Brightness: 30, Contrast: -50 });
  await blendMode(page, 'multiply');
  await closeEffects(page);
  await shot(page, '04a-storm-clouds');
  // Fade the storm out below the ridge line with a gradient on a layer mask.
  await page.locator('[aria-label="Add Mask"]').click();
  await pause(page, 200);
  await editMask(page, 'Storm');
  await setGradient(page, 'linear', [{ pos: 0, hex: '#FFFFFF' }, { pos: 1, hex: '#000000' }]);
  await gradientDrag(page, { x: 600, y: 200 }, { x: 600, y: 640 });
  await selectLayer(page, 'Storm');
  await shot(page, '04-storm-sky');
}

// The fighter's silhouette in the photo's own pixels, traced around the
// wine jar, the raised fist and the lifted knee.
const FIGHTER_OUTLINE = '416,205 397,209 391,214 385,227 371,231 364,239 326,245 316,250 306,260 299,273 285,322 271,415 281,436 291,446 313,460 354,477 385,482 416,477 427,466 453,423 459,417 461,418 460,435 471,474 469,563 476,626 471,635 471,640 477,641 483,661 483,675 496,709 497,747 492,748 496,761 507,764 503,756 507,749 516,751 526,758 536,761 542,771 541,776 534,784 530,782 530,778 523,778 522,789 514,811 514,817 504,838 494,870 493,901 496,923 492,929 495,940 496,1023 504,1092 505,1170 512,1225 516,1232 512,1245 514,1279 526,1366 525,1371 512,1389 505,1415 516,1459 496,1475 493,1489 495,1497 504,1502 515,1505 542,1506 565,1501 586,1488 604,1486 609,1481 619,1482 632,1478 636,1472 636,1458 639,1455 650,1454 629,1382 635,1332 635,1305 629,1264 626,1150 638,1129 644,1111 659,1036 663,1023 671,1010 671,1005 699,983 725,929 750,920 760,911 778,902 782,894 779,885 806,865 817,853 794,808 782,795 785,756 774,742 778,720 777,700 747,673 732,666 721,666 706,662 700,656 711,649 731,646 740,641 763,643 780,649 806,649 825,643 846,623 853,605 859,598 864,575 870,566 872,555 867,548 867,538 864,530 842,508 820,511 803,520 781,515 768,531 765,540 749,538 731,521 698,502 686,487 655,463 647,462 638,455 632,442 644,438 661,418 679,410 682,383 679,374 679,349 674,336 674,328 655,283 637,259 625,255 616,247 612,249 601,242 582,244 550,253 539,258 520,275 501,303 495,306 484,302 470,284 472,253 462,242 454,223 431,207';

function parsePts(s: string, dx = 0, dy = 0): Pt[] {
  return s.split(' ').map((p) => {
    const [x, y] = p.split(',').map(Number);
    return { x: x! + dx, y: y! + dy };
  });
}

async function featherSelection(page: Page, px: number): Promise<void> {
  await menu(page, 'Select', 'Feather…');
  const dlg = page.locator('[role="dialog"][aria-label="Feather Selection"]');
  await dlg.waitFor({ state: 'visible' });
  await dlg.locator('input[aria-label$=" value"]').first().fill(String(px));
  await dlg.locator('input[aria-label$=" value"]').first().press('Tab');
  await dlg.getByRole('button', { name: 'Apply' }).click();
  await pause(page, 300);
}

export async function s05(page: Page): Promise<void> {
  await selectLayer(page, 'Storm');
  await dropPhoto(page, 'kung-fu-fighter.jpg');
  await renameActive(page, 'Fighter');
  await shot(page, '05a-fighter-dropped');
  await lassoSelect(page, parsePts(FIGHTER_OUTLINE));
  await shot(page, '05b-fighter-lasso');
  await featherSelection(page, 1);
  await pressKey(page, 'Control+Shift+i');
  await pressKey(page, 'Delete');
  await deselect(page);
  await shot(page, '05-fighter-cut-out');
}

// Raccoon head in the raccoon photo's pixels: ears, crown, cheek ruffs and
// the white chin under the nose. The leaves below the chin stay outside.
export const RACCOON_HEAD: Pt[] = [
  { x: 405, y: 330 }, { x: 398, y: 270 }, { x: 410, y: 215 }, { x: 432, y: 170 }, { x: 440, y: 120 },
  { x: 448, y: 78 }, { x: 470, y: 48 }, { x: 500, y: 40 }, { x: 530, y: 48 }, { x: 552, y: 70 },
  { x: 575, y: 62 }, { x: 620, y: 55 }, { x: 680, y: 55 }, { x: 740, y: 62 }, { x: 790, y: 80 },
  { x: 815, y: 100 }, { x: 845, y: 92 }, { x: 880, y: 90 }, { x: 912, y: 100 }, { x: 928, y: 120 },
  { x: 926, y: 150 }, { x: 910, y: 185 }, { x: 900, y: 230 }, { x: 898, y: 280 }, { x: 888, y: 325 },
  { x: 865, y: 365 }, { x: 828, y: 392 }, { x: 780, y: 408 }, { x: 740, y: 422 }, { x: 702, y: 440 },
  { x: 682, y: 470 }, { x: 665, y: 500 }, { x: 630, y: 512 }, { x: 590, y: 505 }, { x: 560, y: 470 },
  { x: 540, y: 430 }, { x: 500, y: 405 }, { x: 455, y: 385 }, { x: 420, y: 360 },
];

// The fighter is scaled to 85 % about his feet so both shoes stand on the
// hall steps above the title block. fig() maps a point laid out for the
// unscaled fighter (dropped at 0,0 and moved 28,40) to the final poster.
export const FIG_SCALE = 0.85;
export const FEET_Y = 1240;
export function fig(p: Pt): Pt {
  return { x: 600 + (p.x - 600) * FIG_SCALE, y: FEET_Y + (p.y - 1544) * FIG_SCALE };
}
/** Map a point in the fighter photo's own pixels to the poster. */
function figPhoto(p: Pt): Pt {
  return fig({ x: p.x + 28, y: p.y + 40 });
}

export async function s06(page: Page): Promise<void> {
  await selectLayer(page, 'Fighter');
  await moveBy(page, { x: 600, y: 900 }, 28, 40);
  // Scale him down about his feet so he stands on the steps, not over the wall.
  await selectAlpha(page, 'Fighter');
  const b = (await contentBounds(page, 'Fighter'))!;
  await scaleSelection(page, { x: b.x1, y: b.y1 }, -(b.x1 - b.x0) * (1 - FIG_SCALE), -(b.y1 - b.y0) * (1 - FIG_SCALE), true);
  await shot(page, '06b-fighter-scaled');
  await deselect(page);
  const c = fig({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
  await centerContentOn(page, 'Fighter', Math.round(c.x), Math.round(c.y));
  // Clear the fighter's own head and hair down to the collar.
  await lassoSelect(page, [
    { x: 505, y: 300 }, { x: 560, y: 262 }, { x: 640, y: 262 }, { x: 712, y: 300 }, { x: 725, y: 380 },
    { x: 700, y: 470 }, { x: 660, y: 522 }, { x: 610, y: 536 }, { x: 560, y: 522 }, { x: 526, y: 470 },
    { x: 505, y: 400 },
  ].map(fig));
  await shot(page, '06a-head-lasso');
  await pressKey(page, 'Delete');
  await deselect(page);
  await shot(page, '06-fighter-headless');
}

export async function s07(page: Page): Promise<void> {
  await selectLayer(page, 'Fighter');
  await dropPhoto(page, 'raccoon.jpg');
  await renameActive(page, 'Raccoon');
  await lassoSelect(page, RACCOON_HEAD);
  await shot(page, '07a-raccoon-lasso');
  await featherSelection(page, 1);
  await pressKey(page, 'Control+Shift+i');
  await pressKey(page, 'Delete');
  await deselect(page);
  await shot(page, '07b-raccoon-head-cut');
  // Clone fur from just above over the grass blade across the muzzle.
  await tool(page, 'stamp');
  await toolOption(page, 'Size', 16);
  const src = await docToScreen(page, 500, 382);
  await page.keyboard.down('Alt');
  await page.mouse.click(src.x, src.y);
  await page.keyboard.up('Alt');
  await pause(page, 150);
  await dragDoc(page, [{ x: 500, y: 400 }, { x: 620, y: 400 }, { x: 735, y: 400 }], { steps: 16 });
  await shot(page, '07-raccoon-healed');
}

/** Where the raccoon head's centre sits: low enough that the chin covers the collar. */
export const NECK = fig({ x: 606, y: 436 });

export async function s08(page: Page): Promise<void> {
  await deselect(page);
  await selectAlpha(page, 'Raccoon');
  const b = (await contentBounds(page, 'Raccoon'))!;
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  // Uniform scale to 44 % from the bottom-right handle.
  await scaleSelection(page, { x: b.x1, y: b.y1 }, -w * 0.56, -h * 0.56, true);
  await shot(page, '08a-raccoon-scaled');
  const cx = b.x0 + w * 0.22, cy = b.y0 + h * 0.22;
  await dragDoc(page, [{ x: cx, y: cy }, { x: (cx + NECK.x) / 2, y: (cy + NECK.y) / 2 }, NECK], { steps: 8 });
  await shot(page, '08b-raccoon-moved');
  await deselect(page);
  await centerContentOn(page, 'Raccoon', Math.round(NECK.x), Math.round(NECK.y));
  await shot(page, '08-raccoon-on-body');
}

export async function s09(page: Page): Promise<void> {
  await selectLayer(page, 'Raccoon');
  // The raccoon was shot in flat daylight; give it the fighter's punch.
  await filter(page, 'Brightness/Contrast...', { Brightness: -6, Contrast: 12 });
  await effect(page, 'Drop Shadow', { 'Offset X': 0, 'Offset Y': 10, Blur: 18, Opacity: 70 });
  await closeEffects(page);
  // A soft shadow on the collar under the chin joins head to body.
  await selectLayer(page, 'Fighter');
  await newLayer(page, 'Neck Shadow');
  await tool(page, 'brush');
  await toolOption(page, 'Hardness', 0);
  await toolOption(page, 'Opacity', 60);
  await toolOption(page, 'Size', 90);
  await setFg(page, '#000000');
  await dragDoc(page, [fig({ x: 560, y: 548 }), fig({ x: 606, y: 558 }), fig({ x: 655, y: 548 })], { steps: 8 });
  await blendMode(page, 'multiply');
  await closeEffects(page);
  await shot(page, '09-raccoon-seated');
}

const KASAYA: Pt[] = [
  { x: 690, y: 532 }, { x: 725, y: 530 }, { x: 750, y: 556 }, { x: 748, y: 592 }, { x: 700, y: 650 },
  { x: 640, y: 725 }, { x: 596, y: 800 }, { x: 572, y: 828 }, { x: 546, y: 812 }, { x: 540, y: 780 },
  { x: 560, y: 745 }, { x: 610, y: 660 }, { x: 662, y: 578 },
];

export async function s10(page: Page): Promise<void> {
  await selectLayer(page, 'Fighter');
  await newLayer(page, 'Kasaya');
  await lassoSelect(page, KASAYA.map(fig));
  // Stripes across the band's width read as creases running down the cloth.
  await setGradient(page, 'linear', [
    { pos: 0, hex: '#5E250C' }, { pos: 0.25, hex: '#C9772A' }, { pos: 0.48, hex: '#8A3A14' },
    { pos: 0.72, hex: '#D98A34' }, { pos: 1, hex: '#5A230A' },
  ]);
  await gradientDrag(page, fig({ x: 614, y: 660 }), fig({ x: 676, y: 701 }));
  await shot(page, '10a-kasaya-fill');
  await filter(page, 'Add Noise...', { Amount: 14 }, ['Mono']);
  await filter(page, 'Motion Blur...', { Angle: 124, Distance: 14 });
  await filter(page, 'Hue/Saturation...', { Saturation: -20 });
  await deselect(page);
  await effect(page, 'Drop Shadow', { 'Offset X': -4, 'Offset Y': 6, Blur: 10, Opacity: 60 });
  await closeEffects(page);
  await shot(page, '10-kasaya');
}

/** Bead centres along an elliptical arc, from angle a0 to a1 (degrees). */
export function arcPts(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = ((a0 + ((a1 - a0) * i) / (n - 1)) * Math.PI) / 180;
    out.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
  }
  return out;
}

export async function s11(page: Page): Promise<void> {
  await selectLayer(page, 'Kasaya');
  await newLayer(page, 'Mala');
  await tool(page, 'brush');
  await toolOption(page, 'Size', 15);
  await toolOption(page, 'Hardness', 95);
  await toolOption(page, 'Opacity', 100);
  await setFg(page, '#8A5A30');
  const loop = fig({ x: 640, y: 600 });
  for (const p of arcPts(loop.x, loop.y, 64 * FIG_SCALE, 92 * FIG_SCALE, 217, -37, 21)) await clickDoc(page, p.x, p.y);
  // A larger guru bead where the loop hangs lowest.
  await toolOption(page, 'Size', 24);
  await setFg(page, '#B0421C');
  const guru = fig({ x: 640, y: 700 });
  await clickDoc(page, guru.x, guru.y);
  await effect(page, 'Inner Glow', { Size: 5, Opacity: 70 }, { label: 'Glow color', hex: '#f7c98f' });
  await effect(page, 'Drop Shadow', { 'Offset X': 2, 'Offset Y': 4, Blur: 5, Opacity: 75 });
  await closeEffects(page);
  await shot(page, '11-mala-beads');
}

// Skin and white sneakers in the fighter photo's pixels.
const WRAPS: Record<string, string> = {
  jarhand: '368,235 368,243 373,243 375,237 383,235 384,246 391,251 407,255 413,259 420,259 421,264 442,265 444,278 458,275 462,279 460,298 466,299 469,294 473,294 478,301 481,301 469,285 469,263 471,258 469,250 461,243 453,224 434,210 422,206 398,210 392,215 386,228 378,229',
  fist: '871,556 866,549 866,539 863,531 844,510 835,509 818,513 809,520 804,521 782,516 777,520 764,543 747,538 727,546 708,546 704,550 703,556 697,556 688,560 688,567 723,555 724,560 721,562 721,566 732,566 732,578 729,586 729,595 721,596 721,600 728,600 732,613 735,613 739,620 751,631 761,631 764,642 770,645 770,638 772,636 777,636 782,640 795,640 810,632 818,625 828,608 835,606 836,597 849,600 849,604 842,614 842,619 838,626 839,629 845,622 852,604 858,597 863,574 869,565',
  kneeshoe: '662,1001 648,998 647,996 632,996 616,993 613,990 607,991 580,1062 564,1087 559,1101 554,1108 552,1145 559,1157 569,1165 579,1169 597,1170 613,1162 625,1152 626,1146 637,1128 643,1110 658,1035 662,1022 670,1009 670,1006',
  footshoe: '495,1494 505,1501 516,1504 541,1505 561,1501 582,1488 590,1487 588,1486 588,1481 604,1471 633,1468 633,1476 636,1465 635,1457 638,1454 649,1453 645,1439 647,1452 629,1456 623,1461 576,1462 560,1454 545,1451 533,1451 522,1458 518,1458 512,1438 517,1460 495,1479',
};

export async function s11b(page: Page): Promise<void> {
  // Human hands and stage-lit trainers give the collage away. A Multiply
  // layer in dark umber turns them into cloth wraps and black kung fu shoes
  // while keeping their folds and knuckles.
  await selectLayer(page, 'Fighter');
  await newLayer(page, 'Wraps');
  await setFg(page, '#4A4038');
  for (const outline of Object.values(WRAPS)) {
    await lassoSelect(page, parsePts(outline).map(figPhoto));
    await fill(page);
  }
  await shot(page, '11a-wraps-fill');
  await deselect(page);
  await blendMode(page, 'multiply');
  await closeEffects(page);
  await shot(page, '11b-wraps');
}

export const HEAD = fig({ x: 606, y: 420 });

export async function s12(page: Page): Promise<void> {
  await selectLayer(page, 'Storm');
  await newLayer(page, 'Halo');
  await setGradient(page, 'radial', [{ pos: 0, hex: '#FFE0AE' }, { pos: 0.35, hex: '#F7A955', a: 0.55 }, { pos: 1, hex: '#F7A955', a: 0 }]);
  await gradientDrag(page, HEAD, { x: HEAD.x + 480, y: HEAD.y });
  await blendMode(page, 'screen');
  await closeEffects(page);
  await shot(page, '12a-halo');
  await newLayer(page, 'Rays');
  await setFg(page, '#FFD08A');
  await filter(page, 'Sunburst...', {
    Rays: 44, Length: 95, Width: 30, Fade: 85, Softness: 70, Jitter: 35, Seed: 7, Opacity: 60,
    'Center X': Math.round((HEAD.x / DOC_W) * 100), 'Center Y': Math.round((HEAD.y / DOC_H) * 100),
  });
  await blendMode(page, 'screen');
  await closeEffects(page);
  await layerOpacity(page, 45);
  await shot(page, '12-hero-backlight');
}

export async function s13(page: Page): Promise<void> {
  // A shallow depth of field pushes the temple behind the hero.
  await selectLayer(page, 'Temple');
  await filter(page, 'Gaussian Blur...', { Radius: 3 });
  await filter(page, 'Brightness/Contrast...', { Brightness: -18, Contrast: 10 });
  // Warm rim light where the backlight wraps the silhouette.
  await selectLayer(page, 'Fighter');
  await effect(page, 'Inner Glow', { Size: 14, Opacity: 45 }, { label: 'Glow color', hex: '#ffb766' });
  await closeEffects(page);
  await selectLayer(page, 'Raccoon');
  await effect(page, 'Inner Glow', { Size: 10, Opacity: 35 }, { label: 'Glow color', hex: '#ffb766' });
  await closeEffects(page);
  await shot(page, '13-rim-light');
}

/** Small deterministic PRNG so the spark pattern is the same every run. */
function prng(seed: number): () => number {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export async function s14(page: Page): Promise<void> {
  await selectLayer(page, 'Raccoon');
  await newLayer(page, 'Sparks');
  await tool(page, 'brush');
  await toolOption(page, 'Hardness', 100);
  await setFg(page, '#FFC166');
  const rand = prng(1987);
  // Sparks drift up from the ground on both sides of the fighter.
  for (let i = 0; i < 46; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const y = 300 + rand() * 940;
    const spread = 200 + (FEET_Y - y) * 0.1 + rand() * 260;
    const x = 600 + side * spread;
    await toolOption(page, 'Size', 6 + Math.round(rand() * 7));
    await clickDoc(page, Math.max(15, Math.min(1185, x)), y);
  }
  // Streak the dots upward, then let them glow.
  await filter(page, 'Motion Blur...', { Angle: 80, Distance: 8 });
  await effect(page, 'Outer Glow', { Size: 10, Opacity: 90 }, { label: 'Glow color', hex: '#ff6a1a' });
  await blendMode(page, 'screen');
  await closeEffects(page);
  await shot(page, '14-sparks');
  // Bake the glow: dozens of live glows slow every redraw.
  await rasterizeStyle(page);
}

export async function s15(page: Page): Promise<void> {
  // Atmospheric perspective: a thin blue-grey veil lifts the temple's blacks
  // so it sits further back than the fighter.
  await selectLayer(page, 'Temple');
  await newLayer(page, 'Haze');
  await setFg(page, '#8FA3B3');
  await fill(page);
  await blendMode(page, 'screen');
  await closeEffects(page);
  await layerOpacity(page, 22);
  // Only the distance gets hazy: fade it out toward the courtyard.
  await page.locator('[aria-label="Add Mask"]').click();
  await pause(page, 200);
  await editMask(page, 'Haze');
  await setGradient(page, 'linear', [{ pos: 0, hex: '#FFFFFF' }, { pos: 1, hex: '#000000' }]);
  await gradientDrag(page, { x: 600, y: 300 }, { x: 600, y: 1250 });
  // A soft ambient shadow plus a tight contact shadow under the planted foot.
  await selectLayer(page, 'Rays');
  await newLayer(page, 'Contact Shadow');
  await tool(page, 'brush');
  await toolOption(page, 'Hardness', 0);
  await setFg(page, '#000000');
  await toolOption(page, 'Opacity', 40);
  await toolOption(page, 'Size', 240);
  await dragDoc(page, [fig({ x: 450, y: 1575 }), fig({ x: 580, y: 1572 }), fig({ x: 720, y: 1575 })], { steps: 10 });
  await toolOption(page, 'Opacity', 85);
  await toolOption(page, 'Size', 60);
  await dragDoc(page, [fig({ x: 530, y: 1550 }), fig({ x: 585, y: 1552 }), fig({ x: 640, y: 1552 })], { steps: 10 });
  await blendMode(page, 'multiply');
  await closeEffects(page);
  await shot(page, '15a-contact-shadow');
  // Low mist drifting across the feet puts the fighter inside the scene.
  await selectLayer(page, 'Sparks');
  await newLayer(page, 'Ground Mist');
  await filter(page, 'Clouds...', { Scale: 6 });
  await blendMode(page, 'screen');
  await closeEffects(page);
  await page.locator('[aria-label="Add Mask"]').click();
  await pause(page, 200);
  await editMask(page, 'Ground Mist');
  await setGradient(page, 'linear', [{ pos: 0, hex: '#FFFFFF' }, { pos: 1, hex: '#000000' }]);
  await gradientDrag(page, { x: 600, y: 1600 }, { x: 600, y: 1000 });
  await selectLayer(page, 'Ground Mist');
  await layerOpacity(page, 55);
  await shot(page, '15-grounded');
}

/** Add a node to the open adjustments drawer and set its sliders. */
async function addAdjustmentNode(page: Page, label: string, settings: Array<[string, number] | ['tab', string]>): Promise<void> {
  const drawer = page.getByTestId('effects-drawer');
  await drawer.locator('[aria-label="Add Adjustment"]').click();
  await drawer.getByRole('menuitem', { name: label, exact: true }).click();
  await pause(page, 300);
  for (const [key, value] of settings) {
    if (key === 'tab') {
      await drawer.getByRole('tab', { name: String(value), exact: true }).click();
      continue;
    }
    const input = drawer.locator(`[aria-label="${key} value"]`).first();
    await input.fill(String(value));
    await input.press('Enter');
  }
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await pause(page, 400);
}

/** Expand the stack's first (Levels) node and drag its input black and white handles. */
async function setLevels(page: Page, black: number, white: number): Promise<void> {
  const drawer = page.getByTestId('effects-drawer');
  await drawer.locator('button[aria-label="Expand"]').first().click();
  await pause(page, 300);
  const track = (await drawer.getByTestId('levels-input-track').boundingBox())!;
  for (const [id, v] of [['levels-input-black-handle', black], ['levels-input-white-handle', white]] as const) {
    const h = (await drawer.getByTestId(id).boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(track.x + (v / 255) * track.width, h.y + h.height / 2, { steps: 6 });
    await page.mouse.up();
    await pause(page, 200);
  }
}

export async function s17(page: Page): Promise<void> {
  // One grade over the whole poster: Layer → Adjustment Layer… opens the
  // root group's adjustment stack.
  await menu(page, 'Layer', 'Adjustment Layer…');
  const info = page.getByRole('dialog').filter({ hasText: /adjust/i }).last();
  const ok = info.getByRole('button').first();
  if (await ok.isVisible().catch(() => false)) await ok.click();
  await pause(page, 300);
  // New documents start with identity Levels, Curves, Exposure and
  // Hue / Saturation nodes. Use the Levels one to set a firm black point.
  await setLevels(page, 14, 242);
  await shot(page, '17a-levels');
  await addAdjustmentNode(page, 'Saturation & Vibrance', [['Saturation', -40], ['Vibrance', 6]]);
  await shot(page, '17a-desaturate');
  await addAdjustmentNode(page, 'Color Balance', [
    ['tab', 'Shadows'], ['Cyan — Red', -18], ['Yellow — Blue', 12],
    ['tab', 'Midtones'], ['Cyan — Red', -4],
    ['tab', 'Highlights'], ['Cyan — Red', 12], ['Yellow — Blue', -12],
  ]);
  await shot(page, '17b-teal-orange');
  await addAdjustmentNode(page, 'Highlights & Shadows', [['Highlights', -30]]);
  await addAdjustmentNode(page, 'Contrast', [['Contrast', 22]]);
  await addAdjustmentNode(page, 'Vignette', [['Vignette', 40]]);
  await shot(page, '17-grade');
  await closeEffects(page);
}

export async function s18(page: Page): Promise<void> {
  // A single grain layer over everything hides the three photos' different noise.
  const top = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layerOrder: string[]; layers: Array<{ id: string; name: string; type: string }> } };
    };
    const d = store.getState().document;
    const ids = d.layerOrder.filter((id) => d.layers.find((l) => l.id === id)?.type !== 'group');
    return d.layers.find((l) => l.id === ids[ids.length - 1])!.name;
  });
  await selectLayer(page, top);
  await newLayer(page, 'Grain');
  await setFg(page, '#808080');
  await fill(page);
  await filter(page, 'Add Noise...', { Amount: 28 }, ['Mono', 'Gaussian']);
  await blendMode(page, 'overlay');
  await closeEffects(page);
  await layerOpacity(page, 40);
  await shot(page, '18-film-grain');
}

interface Line { text: string; font: string; size: number; hex: string; spacing: number; cy: number; weight?: string }

/** Type one line with the Text tool, space it out, and centre it on x 600. */
async function typeLine(page: Page, line: Line): Promise<void> {
  // With a text layer active, the options bar edits that layer, so park on
  // the shade layer before dialing in the next line's settings.
  await selectLayer(page, 'Title Shade');
  await tool(page, 'text');
  await toolOption(page, 'Size', line.size);
  await setFont(page, line.font);
  if (line.weight) {
    await page.locator('role=toolbar >> select[aria-label="Font weight"]').selectOption(line.weight);
    await pause(page, 800);
  }
  await setFg(page, line.hex);
  await clickDoc(page, 120, line.cy - line.size / 2);
  await page.keyboard.type(line.text, { delay: 30 });
  await pause(page, 600);
  await page.keyboard.press('Tab');
  await pause(page, 800);
  const input = page.locator('[aria-label="Letter spacing value"]').first();
  if (!(await input.isVisible().catch(() => false))) {
    await page.locator('[aria-label="Panel visibility"] [aria-label="Text"]').click();
  }
  await input.fill(String(line.spacing));
  await input.press('Enter');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await pause(page, 500);
  const name = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; name: string }> } };
    };
    const d = store.getState().document;
    return d.layers.find((l) => l.id === d.activeLayerId)!.name;
  });
  await centerContentOn(page, name, 600, line.cy);
}

export const TITLE: Line = { text: 'MASKED MONK', font: 'Cinzel', size: 116, hex: '#EFE7D6', spacing: 6, cy: 1400, weight: '900' };

export async function s16(page: Page): Promise<void> {
  // Darken the top and bottom bands so the type reads over the photo.
  await selectLayer(page, 'Ground Mist');
  await newLayer(page, 'Title Shade');
  await setGradient(page, 'linear', [{ pos: 0, hex: '#05070A', a: 0.92 }, { pos: 1, hex: '#05070A', a: 0 }]);
  // A gradient fills the whole layer, so fence each band with a marquee.
  await rectSelect(page, 0, 1180, DOC_W, 420);
  await gradientDrag(page, { x: 600, y: 1600 }, { x: 600, y: 1180 });
  await rectSelect(page, 0, 0, DOC_W, 300);
  await gradientDrag(page, { x: 600, y: 0 }, { x: 600, y: 300 });
  await deselect(page);
  await shot(page, '16a-title-shade');
}

export async function s16b(page: Page): Promise<void> {
  // Work from the bottom up so a click never lands inside an earlier text box.
  await typeLine(page, { text: 'COMING SOON', font: 'Oswald', size: 32, hex: '#D9843A', spacing: 16, cy: 1542, weight: '600' });
  await typeLine(page, { text: 'WUDANG PICTURES PRESENTS \u00B7 A BANDIT MONK FILM \u00B7 MUSIC BY THE TEMPLE BELLS', font: 'Oswald', size: 22, hex: '#B8B0A2', spacing: 2, cy: 1484, weight: '400' });
  await typeLine(page, TITLE);
  await effect(page, 'Inner Glow', { Size: 6, Opacity: 75 }, { label: 'Glow color', hex: '#4a4038' });
  await effect(page, 'Outer Glow', { Size: 26, Opacity: 40 }, { label: 'Glow color', hex: '#ff8a2a' });
  await effect(page, 'Drop Shadow', { 'Offset X': 0, 'Offset Y': 6, Blur: 14, Opacity: 85 });
  await closeEffects(page);
  await typeLine(page, { text: 'RISE OF THE', font: 'Oswald', size: 44, hex: '#F2EADA', spacing: 14, cy: 1304, weight: '500' });
  await effect(page, 'Drop Shadow', { 'Offset X': 0, 'Offset Y': 3, Blur: 10, Opacity: 95 });
  await closeEffects(page);
  await typeLine(page, { text: 'HE WAS BORN WITH THE MASK.', font: 'Oswald', size: 30, hex: '#D9D2C3', spacing: 10, cy: 70, weight: '300' });
  await shot(page, '16-title-block');
}

/** Close the drawer and export the finished poster. Returns the PNG bytes. */
export async function s19(page: Page): Promise<Buffer> {
  await closeEffects(page);
  await pause(page, 500);
  await shot(page, '19-final');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 300_000 }),
    menu(page, 'File', 'Quick Export PNG'),
  ]);
  const path = await download.path();
  return readFileSync(path);
}
