import type { Page } from '@playwright/test';
import {
  DOC_W, DOC_H, shot, pause, menu, tool, setFg, fill, deselect, selectLayer, renameActive, newLayer,
  setGradient, gradientDrag, type Stop, filter, blendMode, closeEffects, effect, layerOpacity,
  ellipseSelect, rectSelect, selectModify, pressKey, type Pt, vGuide, hGuide, contentBounds, rasterizeStyle,
  selectAlpha, setFont, centerContentOn, dragDoc, layerBounds, rotateSelection, scaleSelection, moveBy, brushSettings, closeBrushSettings, polyline, toolOption, clickDoc, docToScreen,
} from './composition-uncharted-fjords.steps.ts';
import { C, R_SEA, R_TICKS, R_PLATE, K, landPoly, fjordPoly, skerry, polar, kite } from './composition-uncharted-fjords.geo.ts';

export const INK = '#2B2118';
export const PAPER = '#E9DDC3';
export const PLATE = '#F2E7CB';
export const SEA_DEEP = '#1F404A';
export const SEA_MID = '#3A6B78';
export const RED = '#A8352A';

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

/** Freehand lasso through many points with one cached viewport projection. */
export async function lassoMany(page: Page, pts: Pt[]): Promise<void> {
  await deselect(page);
  await tool(page, 'lasso');
  const t = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { width: number; height: number }; viewport: { zoom: number; panX: number; panY: number } };
    };
    const s = store.getState();
    const r = document.querySelector('[data-testid="canvas-container"]')!.getBoundingClientRect();
    return { z: s.viewport.zoom, ox: r.left + s.viewport.panX + r.width / 2 - (s.document.width / 2) * s.viewport.zoom, oy: r.top + s.viewport.panY + r.height / 2 - (s.document.height / 2) * s.viewport.zoom };
  });
  const sc = (p: Pt) => ({ x: t.ox + p.x * t.z, y: t.oy + p.y * t.z });
  const all = [...pts, pts[0]!];
  const s0 = sc(all[0]!);
  await page.mouse.move(s0.x, s0.y);
  await page.mouse.down();
  for (const p of all.slice(1)) {
    const s = sc(p);
    await page.mouse.move(s.x, s.y);
  }
  await page.mouse.up();
  await pause(page, 250);
}

export async function disc(page: Page, r: number, center: Pt = C): Promise<void> {
  await ellipseSelect(page, center.x, center.y, r, r);
}

// ---------------------------------------------------------------------------
// 1. Document, guides, paper
// ---------------------------------------------------------------------------

export async function s01(page: Page): Promise<void> {
  await page.goto(process.env.FJORDS_URL ?? '/');
  await page.getByText('New Document').waitFor();
  await page.locator('label:has-text("Width")').locator('..').locator('input').fill(String(DOC_W));
  await page.locator('label:has-text("Height")').locator('..').locator('input').fill(String(DOC_H));
  await page.getByRole('button', { name: 'Create' }).click();
  await page.locator('[data-testid="canvas-container"]').waitFor();
  await pause(page, 800);
  // Centre cross, the sea edge top and bottom, and the compass centre.
  await vGuide(page, C.x);
  await hGuide(page, C.y);
  await hGuide(page, C.y - R_PLATE);
  await hGuide(page, C.y + R_PLATE);
  await vGuide(page, K.x);
  await shot(page, '01-guides');
}

export async function s02(page: Page): Promise<void> {
  await selectLayer(page, 'Background');
  await setFg(page, PAPER);
  await fill(page);
  await selectLayer(page, 'Layer 1');
  await renameActive(page, 'Paper Mottle');
  await filter(page, 'Clouds...', { Scale: 14 });
  await blendMode(page, 'multiply');
  await closeEffects(page);
  await layerOpacity(page, 9);
  await shot(page, '02-paper');
}

// ---------------------------------------------------------------------------
// 2. The emblem plate and the chart neatline
// ---------------------------------------------------------------------------

export async function s03(page: Page): Promise<void> {
  await newLayer(page, 'Plate');
  await disc(page, R_PLATE);
  await setFg(page, PLATE);
  await fill(page);
  // Double rule inside the rim: an ink ring 8 px in, 2 px wide.
  await selectModify(page, 'Shrink', 8);
  await setFg(page, INK);
  await fill(page);
  await selectModify(page, 'Shrink', 2);
  await shot(page, '03a-plate-rule-marquee');
  await setFg(page, PLATE);
  await fill(page);
  await deselect(page);
  await effect(page, 'Stroke', { Width: 3 }, { label: 'Stroke color', hex: INK });
  await effect(page, 'Inner Glow', { Size: 46, Opacity: 45 }, { label: 'Glow color', hex: '#9c7a45' });
  await effect(page, 'Drop Shadow', { 'Offset X': 0, 'Offset Y': 10, Blur: 26, Opacity: 45 }, { label: 'Shadow color', hex: '#3a2a14' });
  await closeEffects(page);
  await shot(page, '03-plate');
  await rasterizeStyle(page);
}

export async function s04(page: Page): Promise<void> {
  // Alternating black / white degree bars, the border of an old sea chart.
  await newLayer(page, 'Neatline');
  await disc(page, R_TICKS);
  await setFg(page, INK);
  await fill(page);
  await setFg(page, PLATE);
  await filter(page, 'Sunburst...', { Rays: 72, Length: 100, Width: 50, Taper: 0, Rotation: 0, 'Center X': 50, 'Center Y': 50 });
  await shot(page, '04a-neatline-sunburst');
  await disc(page, R_SEA);
  await shot(page, '04b-neatline-inner-marquee');
  await pressKey(page, 'Delete');
  await deselect(page);
  await effect(page, 'Stroke', { Width: 2 }, { label: 'Stroke color', hex: INK });
  await closeEffects(page);
  await rasterizeStyle(page);
  await shot(page, '04-neatline');
}

// ---------------------------------------------------------------------------
// 3. Sea, rhumb lines
// ---------------------------------------------------------------------------

export const SEA: Stop[] = [
  { pos: 0, hex: '#4F8591' },
  { pos: 0.6, hex: SEA_MID },
  { pos: 1, hex: SEA_DEEP },
];

export async function s05(page: Page): Promise<void> {
  await newLayer(page, 'Sea');
  await disc(page, R_SEA);
  await setGradient(page, 'radial', SEA);
  await gradientDrag(page, { x: K.x, y: K.y }, { x: K.x + 560, y: K.y });
  await deselect(page);
  await effect(page, 'Inner Glow', { Size: 40, Opacity: 55 }, { label: 'Glow color', hex: '#12272d' });
  await closeEffects(page);
  await shot(page, '05-sea');
  await rasterizeStyle(page);
}

export async function s06(page: Page): Promise<void> {
  // Portolan rhumb lines fanning out of the compass, clipped to the sea.
  await newLayer(page, 'Rhumb Lines');
  await disc(page, R_SEA - 2);
  await setFg(page, '#D9BE84');
  await filter(page, 'Sunburst...', { Rays: 32, Length: 100, Width: 5, Taper: 50, Rotation: 0, 'Center X': 35, 'Center Y': 52, Opacity: 100 });
  await shot(page, '06a-rhumb-sunburst');
  await deselect(page);
  await layerOpacity(page, 32);
  await shot(page, '06-rhumb-lines');
}

// ---------------------------------------------------------------------------
// 4. Land, fjords, skerries
// ---------------------------------------------------------------------------

export const ISLANDS: Array<{ x: number; y: number; rx: number; ry: number; seed: number; rot: number }> = [
  { x: 300, y: 470, rx: 26, ry: 15, seed: 3, rot: 0.5 },
];

export async function s07(page: Page): Promise<void> {
  await newLayer(page, 'Land');
  await setFg(page, '#EFE2C0');
  await lassoMany(page, landPoly());
  await shot(page, '07a-coast-lasso');
  // A 1 px feather softens the stair-stepped diagonals of the freehand coast.
  await selectModify(page, 'Feather', 1);
  await fill(page);
  await deselect(page);
  for (let i = 0; i < 3; i++) {
    await lassoMany(page, fjordPoly(i));
    await selectModify(page, 'Feather', 1);
    if (i === 1) await shot(page, '07b-fjord-lasso');
    await pressKey(page, 'Delete');
  }
  await deselect(page);
  await shot(page, '07-land-fjords');
}

export async function copyPasteMove(page: Page, box: { x: number; y: number; w: number; h: number }, dx: number, dy: number, name: string, cut = false): Promise<void> {
  await rectSelect(page, box.x, box.y, box.w, box.h);
  await pressKey(page, cut ? 'Control+x' : 'Control+c');
  await pressKey(page, 'Control+v');
  await pause(page, 600);
  await deselect(page);
  await renameActive(page, name);
  await moveBy(page, { x: box.x + box.w / 2, y: box.y + box.h / 2 }, dx, dy);
}

/** Position + pixel fingerprint of the given layers (reads GPU textures). */
export async function layerHash(page: Page, names: string[]): Promise<string> {
  return page.evaluate(async (names) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; name: string; x: number; y: number }> } };
    };
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as (id: string) => Promise<{ width: number; height: number; pixels: ArrayLike<number> }>;
    const parts: string[] = [];
    for (const n of names) {
      const l = store.getState().document.layers.find((x) => x.name === n);
      if (!l) { parts.push(`${n}:missing`); continue; }
      const r = await read(l.id);
      let h = 2166136261;
      for (let i = 0; i < r.pixels.length; i += 3) { h ^= r.pixels[i]!; h = Math.imul(h, 16777619) >>> 0; }
      parts.push(`${n}@${l.x},${l.y}:${r.width}x${r.height}:${h.toString(16)}`);
    }
    return parts.join('|');
  }, names);
}

export const LAND = '#EFE2C0';
const SKERRY_COPIES: Array<{ name: string; x: number; y: number; deg: number; scale: number }> = [
  { name: 'Skerry 2', x: 252, y: 566, deg: 60, scale: 0.7 },
  { name: 'Skerry 3', x: 612, y: 752, deg: -35, scale: 1.25 },
  { name: 'Skerry 4', x: 668, y: 938, deg: 25, scale: 0.75 },
];

export async function s08(page: Page): Promise<unknown> {
  // One skerry, then copy / paste / rotate / scale it into a small archipelago.
  const is = ISLANDS[0]!;
  await setFg(page, LAND);
  await lassoMany(page, skerry(is.x, is.y, is.rx, is.ry, is.seed, is.rot));
  await fill(page);
  await deselect(page);
  await shot(page, '08a-first-skerry');
  const box = { x: is.x - 36, y: is.y - 28, w: 72, h: 56 };
  const hashes: string[] = [];
  for (const c of SKERRY_COPIES) {
    await selectLayer(page, 'Land');
    await copyPasteMove(page, box, c.x - is.x, c.y - is.y, c.name);
    await selectAlpha(page, c.name);
    const b0 = (await contentBounds(page, c.name))!;
    await rotateSelection(page, b0, c.deg, c.name === 'Skerry 3' ? '08b-skerry-rotate' : undefined);
    await deselect(page);
    await selectAlpha(page, c.name);
    const b1 = (await contentBounds(page, c.name))!;
    const k = c.scale - 1;
    await scaleSelection(page, { x: b1.x1, y: b1.y1 }, (b1.x1 - b1.x0) * k, (b1.y1 - b1.y0) * k, true, c.name === 'Skerry 3' ? '08c-skerry-scale' : undefined);
    await deselect(page);
    hashes.push(await layerHash(page, [c.name]));
  }
  // Undo the last scale, rotate and move, then redo: the skerry must come back byte-identical.
  const names = SKERRY_COPIES.map((c) => c.name);
  const before = await layerHash(page, names);
  for (let i = 0; i < 3; i++) { await pressKey(page, 'Control+z'); await pause(page, 500); }
  const undone = await layerHash(page, names);
  await shot(page, '08d-undo-x3');
  for (let i = 0; i < 3; i++) { await pressKey(page, 'Control+Shift+z'); await pause(page, 500); }
  const redone = await layerHash(page, names);
  await shot(page, '08e-redo-x3');
  // Fold the copies back into the land.
  for (const c of [...SKERRY_COPIES].reverse()) {
    await selectLayer(page, c.name);
    await menu(page, 'Layer', 'Merge Down');
    await pause(page, 400);
  }
  await shot(page, '08-skerries');
  return { undoChanged: undone !== before, redoMatches: redone === before, before, undone, redone };
}

export const TERRACES: Array<{ shrink: number; hex: string }> = [
  { shrink: 12, hex: '#E7D6AB' },
  { shrink: 14, hex: '#DDC895' },
  { shrink: 18, hex: '#D0B780' },
  { shrink: 24, hex: '#C1A36B' },
  { shrink: 30, hex: '#AD8E59' },
];
export const CONTOUR_INK = '#6E5234';

export async function s09(page: Page): Promise<void> {
  // Coastline in ink, baked.
  await selectLayer(page, 'Land');
  await effect(page, 'Stroke', { Width: 2 }, { label: 'Stroke color', hex: INK });
  await closeEffects(page);
  await rasterizeStyle(page);
  // Hypsometric tints: each terrace is the coast shrunk further inland, and
  // its 1 px stroke is the contour line.
  let prev = 'Land';
  for (let i = 0; i < TERRACES.length; i++) {
    const t = TERRACES[i]!;
    await selectAlpha(page, prev);
    await selectModify(page, 'Shrink', t.shrink);
    if (i === 1) await shot(page, '09a-contour-shrink-marquee');
    await selectLayer(page, prev);
    const name = `Contour ${i + 1}`;
    await newLayer(page, name);
    await setFg(page, t.hex);
    await fill(page);
    await deselect(page);
    await effect(page, 'Stroke', { Width: 1 }, { label: 'Stroke color', hex: CONTOUR_INK });
    await closeEffects(page);
    await rasterizeStyle(page);
    prev = name;
  }
  await shot(page, '09-contours');
}

export async function s10(page: Page): Promise<void> {
  // Shallows and engraved waterlines ringing every coast, under the land.
  await selectLayer(page, 'Rhumb Lines');
  await newLayer(page, 'Shallows');
  await selectAlpha(page, 'Land');
  await selectModify(page, 'Grow', 12);
  await setFg(page, '#5A8E98');
  await fill(page);
  await deselect(page);
  await newLayer(page, 'Waterlines');
  // Outermost first: each Delete clears everything nearer the coast.
  const rings: Array<[number, string]> = [[46, '#6E989F'], [31, '#8AAEB2'], [19, '#A9C6C6'], [6, '#CFE0DC']];
  // Load the coast from Land's own row, then click back to Waterlines before
  // editing: a thumbnail Ctrl+click from another layer leaves a pending float
  // that makes Delete wipe the whole active layer (#801).
  const loadCoast = async () => {
    await selectLayer(page, 'Land');
    await selectAlpha(page, 'Land');
    await selectLayer(page, 'Waterlines');
  };
  for (const [n, hex] of rings) {
    await loadCoast();
    await selectModify(page, 'Grow', n);
    await setFg(page, hex);
    await fill(page);
    await loadCoast();
    await selectModify(page, 'Grow', n - 2);
    if (n === 31) await shot(page, '10a-waterline-grow-marquee');
    await pressKey(page, 'Delete');
  }
  await deselect(page);
  await layerOpacity(page, 75);
  await shot(page, '10-waterlines');
}

export async function s11(page: Page): Promise<void> {
  // Clip everything that spilled past the sea disc.
  await disc(page, R_SEA);
  await menu(page, 'Select', 'Inverse');
  await shot(page, '11a-clip-inverse-marquee');
  for (const name of ['Shallows', 'Waterlines', 'Land', ...TERRACES.map((_, i) => `Contour ${i + 1}`)]) {
    await selectLayer(page, name);
    await pressKey(page, 'Delete');
  }
  await deselect(page);
  await shot(page, '11-clipped');
}

/** Conic graticule: meridians converge on an apex far above the map; parallels are arcs round it. */
export const APEX: Pt = { x: 600, y: -1900 };

export async function s12(page: Page): Promise<void> {
  await selectLayer(page, `Contour ${TERRACES.length}`);
  await newLayer(page, 'Graticule');
  await disc(page, R_SEA - 1);
  await tool(page, 'brush');
  await brushSettings(page, { Size: 2, Hardness: 100, Spacing: 10, Opacity: 100 });
  await closeBrushSettings(page);
  await setFg(page, '#9DB0B6');
  const base = C.y - APEX.y;
  for (const x of [300, 400, 500, 600, 700, 800, 900]) {
    const dirx = (x - APEX.x) / base;
    const at = (y: number) => ({ x: APEX.x + dirx * (y - APEX.y), y });
    await polyline(page, [at(200), at(1000)]);
  }
  for (const y of [300, 400, 500, 600, 700, 800, 900]) {
    const r = y - APEX.y;
    const pts: Pt[] = [];
    for (let i = 0; i <= 20; i++) {
      const deg = 90 + (i / 20 - 0.5) * 22;
      pts.push(polar(APEX, r, deg));
    }
    await polyline(page, pts);
  }
  await deselect(page);
  await layerOpacity(page, 55);
  await shot(page, '12-graticule');
}

// ---------------------------------------------------------------------------
// 5. Compass rose
// ---------------------------------------------------------------------------

export const ROSE_LEN = 104;
export const ROSE_SHOULDER = 16;
export const ROSE_DARK = '#1E1812';

async function fillPts(page: Page, pts: Pt[], hex: string): Promise<void> {
  await setFg(page, hex);
  await lassoMany(page, pts);
  await fill(page);
  await deselect(page);
}

export async function s13(page: Page): Promise<void> {
  await selectLayer(page, 'Graticule');
  // Degree ring: ink disc, Sunburst ticks from the same centre, hollowed out.
  await newLayer(page, 'Rose Ring');
  await disc(page, 84, K);
  await setFg(page, ROSE_DARK);
  await fill(page);
  await setFg(page, PLATE);
  await filter(page, 'Sunburst...', { Rays: 64, Length: 100, Width: 50, Taper: 0, Rotation: 0, 'Center X': 35, 'Center Y': 52, Opacity: 100 });
  await disc(page, 78, K);
  await pressKey(page, 'Delete');
  await disc(page, 73, K);
  await setFg(page, PLATE);
  await fill(page);
  await selectModify(page, 'Shrink', 2);
  await pressKey(page, 'Delete');
  await deselect(page);
  await shot(page, '13a-rose-ring');
  // Cardinal star: every point split into a light and a dark half.
  await newLayer(page, 'Rose Cardinal');
  for (const deg of [0, 90, 180, 270]) {
    await fillPts(page, kite(K, ROSE_LEN, ROSE_SHOULDER, deg, -1), PLATE);
    await fillPts(page, kite(K, ROSE_LEN, ROSE_SHOULDER, deg, 1), ROSE_DARK);
  }
  await shot(page, '13b-rose-cardinal');
  // Copy it in place; the original underneath becomes the intercardinal star:
  // rotate 45 degrees (Cmd snaps to 15 degree steps) and scale it to 60%.
  const box = { x: K.x - ROSE_LEN - 4, y: K.y - ROSE_LEN - 4, w: 2 * ROSE_LEN + 8, h: 2 * ROSE_LEN + 8 };
  await rectSelect(page, box.x, box.y, box.w, box.h);
  await pressKey(page, 'Control+c');
  await pressKey(page, 'Control+v');
  await pause(page, 600);
  await deselect(page);
  await renameActive(page, 'Rose Cardinal Top');
  await selectLayer(page, 'Rose Cardinal');
  await renameActive(page, 'Rose Intercardinal');
  await selectAlpha(page, 'Rose Intercardinal');
  const b0 = (await contentBounds(page, 'Rose Intercardinal'))!;
  await rotateSelection(page, b0, 45, '13c-rose-rotate-45', true);
  await deselect(page);
  await selectAlpha(page, 'Rose Intercardinal');
  const b1 = (await contentBounds(page, 'Rose Intercardinal'))!;
  await scaleSelection(page, { x: b1.x1, y: b1.y1 }, -(b1.x1 - b1.x0) * 0.4, -(b1.y1 - b1.y0) * 0.4, true, '13d-rose-scale-60');
  await deselect(page);
  await centerContentOn(page, 'Rose Intercardinal', K.x, K.y);
  await selectLayer(page, 'Rose Cardinal Top');
  await renameActive(page, 'Rose Cardinal');
  await effect(page, 'Stroke', { Width: 1 }, { label: 'Stroke color', hex: PLATE });
  await effect(page, 'Drop Shadow', { 'Offset X': 3, 'Offset Y': 4, Blur: 6, Opacity: 60 }, { label: 'Shadow color', hex: '#050d14' });
  await closeEffects(page);
  await rasterizeStyle(page);
  // North in red, then the hub.
  await newLayer(page, 'Rose North');
  await fillPts(page, kite(K, ROSE_LEN, ROSE_SHOULDER, 270, -1), '#C8503E');
  await fillPts(page, kite(K, ROSE_LEN, ROSE_SHOULDER, 270, 1), '#7A2118');
  await disc(page, 9, K);
  await setFg(page, ROSE_DARK);
  await fill(page);
  await selectModify(page, 'Shrink', 2);
  await setFg(page, PLATE);
  await fill(page);
  await selectModify(page, 'Shrink', 4);
  await setFg(page, RED);
  await fill(page);
  await deselect(page);
  await shot(page, '13e-rose-north-hub');
  // The N.
  await tool(page, 'text');
  await toolOption(page, 'Size', 34);
  await setFont(page, 'IM Fell English SC');
  await setFg(page, '#F4E9CE');
  await clickDoc(page, 60, 60);
  await page.keyboard.type('N', { delay: 60 });
  await page.keyboard.press('Tab');
  await pause(page, 800);
  await renameActive(page, 'Rose N');
  await centerContentOn(page, 'Rose N', K.x, K.y - ROSE_LEN - 22);
  await shot(page, '13-compass-rose');
}

export async function groupLayers(page: Page, first: string, last: string, name: string): Promise<void> {
  await selectLayer(page, first);
  await selectLayer(page, last, ['Shift']);
  await menu(page, 'Layer', 'Group Layers');
  await pause(page, 300);
  await renameActive(page, name);
}

const ROSE_LAYERS = ['Rose Ring', 'Rose Intercardinal', 'Rose Cardinal', 'Rose North', 'Rose N'];

export async function s14(page: Page): Promise<unknown> {
  await groupLayers(page, 'Rose Ring', 'Rose N', 'Compass Rose');
  await shot(page, '14a-rose-group');
  // Try the rose further out to sea with Snap to Grid, then think better of it.
  const home = await layerHash(page, ROSE_LAYERS);
  await menu(page, 'View', 'Show Grid');
  await menu(page, 'View', 'Snap to Grid');
  await tool(page, 'move');
  const from = await docToScreen(page, K.x, K.y);
  const to = await docToScreen(page, K.x + 36, K.y + 70);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await pause(page, 400);
  await shot(page, '14b-rose-group-drag-snap');
  await page.mouse.up();
  await pause(page, 500);
  const moved = await layerHash(page, ROSE_LAYERS);
  const ring = await layerBounds(page, 'Rose Ring');
  await pressKey(page, 'Control+z');
  await pause(page, 600);
  const undone = await layerHash(page, ROSE_LAYERS);
  await pressKey(page, 'Control+Shift+z');
  await pause(page, 600);
  const redone = await layerHash(page, ROSE_LAYERS);
  await pressKey(page, 'Control+z');
  await pause(page, 600);
  await menu(page, 'View', 'Snap to Grid');
  await menu(page, 'View', 'Show Grid');
  const final = await layerHash(page, ROSE_LAYERS);
  await shot(page, '14-rose-home');
  return { movedDiffers: moved !== home, undoRestores: undone === home, redoMatches: redone === moved, finalHome: final === home, ring };
}

// ---------------------------------------------------------------------------
// 6. The expedition route and the summit
// ---------------------------------------------------------------------------

export const ROUTE: Pt[] = [
  { x: 706, y: 790 }, { x: 668, y: 738 }, { x: 636, y: 692 }, { x: 604, y: 652 }, { x: 578, y: 606 },
  { x: 546, y: 568 }, { x: 526, y: 538 }, { x: 546, y: 502 }, { x: 572, y: 468 }, { x: 604, y: 440 },
  { x: 626, y: 398 }, { x: 660, y: 380 }, { x: 692, y: 370 }, { x: 736, y: 332 }, { x: 772, y: 320 },
];
export const X_MARK: Pt = { x: 792, y: 318 };
export const PEAK: Pt = { x: 818, y: 470 };

export async function s15(page: Page): Promise<void> {
  await selectLayer(page, 'Graticule');
  await newLayer(page, 'Route');
  await tool(page, 'brush');
  await brushSettings(page, { Size: 6, Hardness: 100, Spacing: 200, Opacity: 100 });
  await closeBrushSettings(page);
  await setFg(page, '#B8322A');
  await polyline(page, ROUTE);
  await shot(page, '15a-route-dotted');
  await brushSettings(page, { Size: 6, Spacing: 10 });
  await closeBrushSettings(page);
  await polyline(page, [{ x: X_MARK.x - 15, y: X_MARK.y - 15 }, { x: X_MARK.x + 15, y: X_MARK.y + 15 }]);
  await polyline(page, [{ x: X_MARK.x + 15, y: X_MARK.y - 15 }, { x: X_MARK.x - 15, y: X_MARK.y + 15 }]);
  await effect(page, 'Stroke', { Width: 2 }, { label: 'Stroke color', hex: PLATE });
  await closeEffects(page);
  await rasterizeStyle(page);
  // Summit triangle.
  await newLayer(page, 'Summit');
  await fillPts(page, [{ x: PEAK.x, y: PEAK.y - 13 }, { x: PEAK.x + 12, y: PEAK.y + 8 }, { x: PEAK.x - 12, y: PEAK.y + 8 }], ROSE_DARK);
  await tool(page, 'text');
  await toolOption(page, 'Size', 18);
  await setFont(page, 'IM Fell English SC');
  await setFg(page, ROSE_DARK);
  await clickDoc(page, 60, 60);
  await page.keyboard.type('Skårtind 1834 m', { delay: 40 });
  await page.keyboard.press('Tab');
  await pause(page, 800);
  await renameActive(page, 'Summit Label');
  await centerContentOn(page, 'Summit Label', PEAK.x, PEAK.y + 26);
  await shot(page, '15-route-summit');
}

// ---------------------------------------------------------------------------
// 7. Ribbon banner and wordmark
// ---------------------------------------------------------------------------

export const BAND = { x0: 196, y0: 782, x1: 1004, y1: 898 };
const RIBBON: Stop[] = [{ pos: 0, hex: '#AE3A2E' }, { pos: 1, hex: '#9A2E26' }];

function tail(side: 1 | -1): Pt[] {
  const edge = side < 0 ? BAND.x0 : BAND.x1;
  const inner = edge + side * 30;
  const outer = edge + side * 84;
  const notch = edge + side * 58;
  return [
    { x: inner - side * 40, y: BAND.y0 + 26 }, { x: outer, y: BAND.y0 + 26 }, { x: notch, y: BAND.y1 - 16 },
    { x: outer, y: BAND.y1 + 26 }, { x: inner - side * 40, y: BAND.y1 + 26 },
  ];
}

function fold(side: 1 | -1): Pt[] {
  const edge = side < 0 ? BAND.x0 : BAND.x1;
  return [{ x: edge, y: BAND.y1 }, { x: edge + side * 30, y: BAND.y1 }, { x: edge + side * 30, y: BAND.y1 + 26 }];
}

export async function s16(page: Page): Promise<void> {
  // Start from a root-level layer: a new layer made with a group selected lands inside the group.
  await selectLayer(page, 'Summit Label');
  await newLayer(page, 'Ribbon Tails');
  await fillPts(page, tail(-1), '#6E1F1A');
  await fillPts(page, tail(1), '#6E1F1A');
  await fillPts(page, fold(-1), '#4A150F');
  await fillPts(page, fold(1), '#4A150F');
  await effect(page, 'Stroke', { Width: 3 }, { label: 'Stroke color', hex: INK });
  await closeEffects(page);
  await rasterizeStyle(page);
  await newLayer(page, 'Ribbon');
  await rectSelect(page, BAND.x0, BAND.y0, BAND.x1 - BAND.x0, BAND.y1 - BAND.y0);
  await setGradient(page, 'linear', RIBBON);
  await gradientDrag(page, { x: 600, y: BAND.y0 }, { x: 600, y: BAND.y1 });
  // Hairline cream rule 7 px inside the band.
  await selectModify(page, 'Shrink', 7);
  await setFg(page, PLATE);
  await fill(page);
  await selectModify(page, 'Shrink', 2);
  await shot(page, '16a-ribbon-rule-marquee');
  await setGradient(page, 'linear', RIBBON);
  await gradientDrag(page, { x: 600, y: BAND.y0 }, { x: 600, y: BAND.y1 });
  await deselect(page);
  await effect(page, 'Stroke', { Width: 3 }, { label: 'Stroke color', hex: INK });
  await effect(page, 'Drop Shadow', { 'Offset X': 0, 'Offset Y': 6, Blur: 10, Opacity: 50 }, { label: 'Shadow color', hex: '#1a0d06' });
  await closeEffects(page);
  await rasterizeStyle(page);
  await shot(page, '16-ribbon');
}

export async function letterSpacing(page: Page, value: number): Promise<void> {
  const input = page.locator('[aria-label="Letter spacing value"]').first();
  if (!(await input.isVisible().catch(() => false))) {
    await page.locator('[aria-label="Panel visibility"] [aria-label="Text"]').click();
  }
  await input.fill(String(value));
  await input.press('Enter');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await pause(page, 500);
}

export async function s17(page: Page): Promise<unknown> {
  await selectLayer(page, 'Ribbon');
  await tool(page, 'text');
  await toolOption(page, 'Size', 64);
  await setFont(page, 'IM Fell English SC');
  await setFg(page, ROSE_DARK);
  await clickDoc(page, 60, 40);
  await page.keyboard.type('FJORDS', { delay: 60 });
  await page.keyboard.press('Tab');
  await pause(page, 800);
  await renameActive(page, 'FJORDS');
  await letterSpacing(page, 26);
  // Recolour: click into the text, select all, pick the cream.
  await tool(page, 'text');
  const cb = (await contentBounds(page, 'FJORDS'))!;
  await clickDoc(page, (cb.x0 + cb.x1) / 2, (cb.y0 + cb.y1) / 2);
  await page.keyboard.press('Control+a');
  await pause(page, 300);
  await shot(page, '17a-wordmark-select-all');
  await setFg(page, '#F6ECD2');
  await pause(page, 500);
  await page.keyboard.press('Tab');
  await pause(page, 800);
  // IM Fell's J drops about 0.28 em below the baseline. Centre the caps, not
  // the caps-plus-descender box, so the word sits optically in the middle.
  const b = await centerContentOn(page, 'FJORDS', 600, (BAND.y0 + BAND.y1) / 2 + Math.round(0.14 * 64));
  await effect(page, 'Drop Shadow', { 'Offset X': 2, 'Offset Y': 3, Blur: 0, Opacity: 70 }, { label: 'Shadow color', hex: '#3d0f0a' });
  await closeEffects(page);
  await shot(page, '17-wordmark');
  return b;
}

// ---------------------------------------------------------------------------
// 8. Seal lettering on circular paths
// ---------------------------------------------------------------------------

/** Mid-radius of the lettering band between the neatline (394) and the plate rule (460). */
export const R_BAND = 425;

/** Draw a circular arc with the Pen tool: smooth anchors whose handles follow the tangent. */
export async function penArc(page: Page, r: number, fromDeg: number, spanDeg: number, segments = 4): Promise<string> {
  const step = spanDeg / segments;
  const h = (4 / 3) * Math.tan((Math.abs(step) * Math.PI) / 180 / 4) * r;
  const sign = Math.sign(spanDeg);
  const draftSize = () => page.evaluate(() => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as { getState: () => { pathDraft?: { anchors: unknown[] } | null; activeTool: string } };
    const st = ui.getState();
    return `${st.activeTool}:${st.pathDraft?.anchors.length ?? 0}`;
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await tool(page, 'path');
    for (let i = 0; i <= segments; i++) {
      const deg = fromDeg + i * step;
      const a = polar(C, r, deg);
      const rad = (deg * Math.PI) / 180;
      const t = { x: -Math.sin(rad) * sign, y: Math.cos(rad) * sign };
      await dragDoc(page, [a, { x: a.x + t.x * h, y: a.y + t.y * h }], { steps: 6 });
      await pause(page, 250);
    }
    const d = await draftSize();
    console.log('penArc draft', d);
    if (d.endsWith(`:${segments + 1}`)) break;
    await shot(page, `debug-penarc-${attempt}`);
  }
  await page.locator('[aria-label="Commit path"]').click();
  await pause(page, 300);
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as { getState: () => { paths: Array<{ id: string }> } };
    const ps = store.getState().paths;
    return ps[ps.length - 1]!.id;
  });
}

async function straightText(page: Page, text: string, size: number, font: string, hex: string, spacing: number, name: string): Promise<void> {
  await tool(page, 'text');
  await toolOption(page, 'Size', size);
  await setFont(page, font);
  await setFg(page, hex);
  await clickDoc(page, 40, 40);
  await page.keyboard.type(text, { delay: 50 });
  await page.keyboard.press('Tab');
  await pause(page, 800);
  await renameActive(page, name);
  if (spacing) await letterSpacing(page, spacing);
}

async function bindToPath(page: Page, name: string, pathId: string): Promise<void> {
  await selectLayer(page, name);
  await tool(page, 'text');
  await page.locator('[aria-label="Text path"]').selectOption(pathId);
  await pause(page, 1500);
}

/**
 * Set a line of caps on the seal band, centred on the top (outward-facing,
 * baseline inside) or the bottom (inward-facing, baseline outside) of the circle.
 */
export async function sealText(page: Page, name: string, where: 'top' | 'bottom', shotName: string): Promise<unknown> {
  const lb = await layerBounds(page, name);
  const cb = (await contentBounds(page, name))!;
  const cap = cb.y1 - cb.y0 + 1;
  const w = cb.x1 - cb.x0 + 1;
  const mid = cb.x0 - lb.x + w / 2;
  const top = where === 'top';
  const rb = top ? R_BAND - cap / 2 : R_BAND + cap / 2;
  const centre = top ? 270 : 90;
  const dir = top ? 1 : -1;
  const midDeg = (mid / rb) * (180 / Math.PI);
  // Point text has no stored width, so size the arc from the inked extent.
  const spanDeg = ((cb.x1 - lb.x + 80) / rb) * (180 / Math.PI);
  let start = centre - dir * midDeg;
  let pathId = await penArc(page, rb, start, dir * spanDeg);
  await bindToPath(page, name, pathId);
  let b = (await contentBounds(page, name))!;
  const first = b;
  // One correction pass: re-seat on a new arc if the ink is off centre.
  const d = (b.x0 + b.x1) / 2 - C.x;
  if (Math.abs(d) > 1.5) {
    // Along the top the path runs left to right as the angle grows; along the bottom it runs the other way.
    start -= (top ? 1 : -1) * (d / rb) * (180 / Math.PI);
    // The new arc lies on the old one; with the old path selected, Pen
    // presses would edit it instead of starting a new path.
    await deselectPath(page);
    pathId = await penArc(page, rb, start, dir * spanDeg);
    await bindToPath(page, name, pathId);
    b = (await contentBounds(page, name))!;
  }
  await shot(page, shotName);
  return { name, cap, w, rb, start, first, final: b };
}

export async function s18(page: Page): Promise<unknown> {
  await selectLayer(page, 'Plate');
  await straightText(page, 'UNCHARTED', 54, 'IM Fell English SC', ROSE_DARK, 16, 'UNCHARTED');
  await shot(page, '18a-uncharted-straight');
  return sealText(page, 'UNCHARTED', 'top', '18-uncharted-arc');
}

export async function s19(page: Page): Promise<unknown> {
  await selectLayer(page, 'Plate');
  await straightText(page, 'EXPEDITION CO. · EST. 1893', 25, 'IM Fell English SC', ROSE_DARK, 5, 'Est Line');
  return sealText(page, 'Est Line', 'bottom', '19-est-arc');
}

export async function s20(page: Page): Promise<unknown> {
  // Latitude and longitude read up the left side and down the right.
  const out: unknown[] = [];
  for (const [text, name, deg, x] of [["69°38'N", 'Latitude', -90, C.x - R_BAND], ["18°57'E", 'Longitude', 90, C.x + R_BAND]] as const) {
    await selectLayer(page, 'Plate');
    await straightText(page, text, 24, 'IM Fell English SC', ROSE_DARK, 2, name);
    await selectAlpha(page, name);
    const b = (await contentBounds(page, name))!;
    if (deg < 0) {
      // Exact quarter turn from the Move options bar.
      await tool(page, 'move');
      await page.locator('[aria-label="Rotate 90° CCW"]').click();
      await pause(page, 600);
      await shot(page, '20a-latitude-rotate-ccw');
    } else {
      // Drag the rotation handle; Cmd snaps it to 15 degree steps.
      await rotateSelection(page, b, deg, '20b-longitude-rotate-handle', true);
    }
    await deselect(page);
    out.push(await centerContentOn(page, name, x, C.y));
  }
  await shot(page, '20-coordinates');
  return out;
}

// ---------------------------------------------------------------------------
// 9. Finishing
// ---------------------------------------------------------------------------

export async function s21(page: Page): Promise<void> {
  // Shade the ribbon's foot with the Burn tool so it curls away from the light.
  await selectLayer(page, 'Ribbon');
  await tool(page, 'dodge');
  await page.locator('[aria-labelledby="dodge-mode-label"]').selectOption('burn');
  await toolOption(page, 'Exposure', 14);
  await toolOption(page, 'Size', 18);
  await polyline(page, [{ x: BAND.x0 + 14, y: BAND.y1 - 13 }, { x: BAND.x1 - 14, y: BAND.y1 - 13 }]);
  await shot(page, '21a-ribbon-burn');
  // Grain over everything.
  await selectLayer(page, 'FJORDS');
  await newLayer(page, 'Grain');
  await setFg(page, '#808080');
  await fill(page);
  await filter(page, 'Add Noise...', { Amount: 24 }, ['Mono', 'Gaussian']);
  await blendMode(page, 'overlay');
  await closeEffects(page);
  await layerOpacity(page, 28);
  await shot(page, '21-finishing');
}

export async function exportPng(page: Page, path: string): Promise<void> {
  const dl = page.waitForEvent('download', { timeout: 120000 });
  await menu(page, 'File', 'Quick Export PNG');
  const d = await dl;
  await d.saveAs(path);
}

export async function deselectPath(page: Page): Promise<void> {
  const list = page.locator('[role="listbox"][aria-label="Paths"]');
  if (!(await list.isVisible().catch(() => false))) {
    await page.locator('[aria-label="Panel visibility"] [aria-label="Paths"]').click();
  }
  const sel = list.locator('[aria-selected="true"]');
  if (await sel.count()) await sel.first().click();
  await pause(page, 200);
  await page.locator('[aria-label="Panel visibility"] [aria-label="Paths"]').click();
  await pause(page, 200);
}

export async function s22(page: Page): Promise<void> {
  await deselect(page);
  await deselectPath(page);
  await menu(page, 'View', 'Show Guides');
  await tool(page, 'move');
  await shot(page, '22-finished-in-editor');
  await exportPng(page, 'e2e/screenshots/uncharted-fjords.png');
}
