import type { Page } from '@playwright/test';
import {
  DOC_W, shot, pause, menu, tool, setFg, fill, deselect, selectLayer, renameActive, newLayer,
  setGradient, gradientDrag, type Stop, filter, blendMode, closeEffects, effect, layerOpacity,
  brushSettings, closeBrushSettings, clickDoc, type Pt,
  rectSelect, ellipseSelect, lassoSelect, fillPoly, selectModify, pressKey,
  vGuide, hGuide, docToScreen, setFont, layerBounds, contentBounds, toolOption, centerContentOn, selectAlpha, rasterizeStyle, polyline, rotateSelection, scaleSelection, ellipsePts,
} from './composition-zen-enclaves.steps.ts';

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

export const PAPER = '#F2E6CB';
export const INK = '#1C1A24';
export const GRID_TEAL = '#7FB3AA';
export const VERM = '#D8452B';
export const VERM_MID = '#B63722';
export const VERM_DARK = '#8C2717';
export const JADE_TOP = '#8DBF6A';
export const JADE_L = '#5E9A4B';
export const JADE_R = '#3F6E3A';
export const EARTH_L = '#B97A48';
export const EARTH_R = '#80502F';
export const ROCK_L = '#6E655E';
export const ROCK_R = '#4A433F';
export const STONE_TOP = '#DDD8CC';
export const STONE_L = '#ABA597';
export const STONE_R = '#7E786C';
export const TEAL_TOP = '#4FA3A0';
export const TEAL_L = '#2F7F7C';
export const TEAL_R = '#174446';
export const GOLD = '#E8B04A';
export const SAND = '#F4E7C4';
export const SAND_LINE = '#CDB88A';
export const SAKURA = '#F3A5B6';
export const WATER = '#6FC1C8';

// ---------------------------------------------------------------------------
// Isometric projection
// ---------------------------------------------------------------------------

const C30 = Math.cos(Math.PI / 6);

/** Project an (x, y, z) block coordinate onto the page: x runs down-right, y down-left, z up. */
/** Every design is drawn in 210-unit block space and scaled up to fill its cell. */
export const S = 1.1;

export function iso(o: Pt, x: number, y: number, z: number): Pt {
  return { x: o.x + (x - y) * C30 * S, y: o.y + ((x + y) * 0.5 - z) * S };
}

export interface IsoFaces { top: Pt[]; left: Pt[]; right: Pt[] }

/** The three visible faces of an axis-aligned box. */
export function isoBox(o: Pt, x: number, y: number, z: number, w: number, d: number, h: number): IsoFaces {
  const P = (a: number, b: number, c: number) => iso(o, a, b, c);
  return {
    top: [P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)],
    left: [P(x, y + d, z + h), P(x + w, y + d, z + h), P(x + w, y + d, z), P(x, y + d, z)],
    right: [P(x + w, y, z + h), P(x + w, y + d, z + h), P(x + w, y + d, z), P(x + w, y, z)],
  };
}

/** A square frustum (hip roof / tapered plinth): base w at z, top tw at z + h, centred. */
export function isoFrustum(o: Pt, cx: number, cy: number, z: number, w: number, tw: number, h: number): IsoFaces {
  const P = (a: number, b: number, c: number) => iso(o, a, b, c);
  const b = w / 2, t = tw / 2;
  return {
    top: [P(cx - t, cy - t, z + h), P(cx + t, cy - t, z + h), P(cx + t, cy + t, z + h), P(cx - t, cy + t, z + h)],
    left: [P(cx - t, cy + t, z + h), P(cx + t, cy + t, z + h), P(cx + b, cy + b, z), P(cx - b, cy + b, z)],
    right: [P(cx + t, cy - t, z + h), P(cx + t, cy + t, z + h), P(cx + b, cy + b, z), P(cx + b, cy - b, z)],
  };
}

export async function paintFaces(page: Page, f: IsoFaces, top: string, left: string, right: string): Promise<void> {
  await fillPoly(page, f.top, top);
  await fillPoly(page, f.left, left);
  await fillPoly(page, f.right, right);
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export const COL_L = 330;
export const COL_R = 870;
export const ROW_1 = 612;
// The bottom row is drawn 14 px high and dropped into place with a snapped
// group drag near the end.
export const ROW_2 = 1124;

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

export async function exportPng(page: Page, path: string): Promise<void> {
  const dl = page.waitForEvent('download', { timeout: 120000 });
  await menu(page, 'File', 'Quick Export PNG');
  const d = await dl;
  await d.saveAs(path);
}

// ---------------------------------------------------------------------------
// 1. Document, paper and isometric drafting grid
// ---------------------------------------------------------------------------

export async function s01(page: Page): Promise<void> {
  await page.goto(process.env.ZEN_URL ?? '/');
  await page.getByText('New Document').waitFor();
  await page.locator('label:has-text("Width")').locator('..').locator('input').fill('1200');
  await page.locator('label:has-text("Height")').locator('..').locator('input').fill('1540');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.locator('[data-testid="canvas-container"]').waitFor();
  await pause(page, 800);
  await selectLayer(page, 'Background');
  await setFg(page, PAPER);
  await fill(page);
  await shot(page, '01-paper');
}

// One repeat of a 30° isometric grid: verticals every 52 px and diagonals of
// slope ±30/52, so 104 × 60 tiles seamlessly.
const GX = 100, GY = 300;

export async function s02(page: Page): Promise<void> {
  await selectLayer(page, 'Layer 1');
  await renameActive(page, 'Grid Tile');
  await tool(page, 'pencil');
  await toolOption(page, 'Size', 2);
  await setFg(page, GRID_TEAL);
  const k = 30 / 52;
  for (const x of [GX, GX + 52, GX + 104, GX + 156, GX + 208]) {
    await polyline(page, [{ x, y: GY - 70 }, { x, y: GY + 130 }]);
  }
  for (const off of [-120, -60, 0, 60, 120]) {
    await polyline(page, [{ x: GX - 20, y: GY + off - 20 * k }, { x: GX + 228, y: GY + off + 228 * k }]);
    await polyline(page, [{ x: GX - 20, y: GY + off + 20 * k }, { x: GX + 228, y: GY + off - 228 * k }]);
  }
  await rectSelect(page, GX + 26, GY, 104, 60);
  await shot(page, '02a-grid-tile-marquee');
  await menu(page, 'Edit', 'Define Pattern');
  await deselect(page);
  await shot(page, '02-grid-tile');
}

export async function s03(page: Page): Promise<void> {
  // The tile layer has done its job once the pattern is defined.
  await page.locator('[aria-label="Delete Layer"]').click();
  await pause(page, 200);
  await selectLayer(page, 'Background');
  await newLayer(page, 'Iso Grid');
  await menu(page, 'Edit', 'Fill with Pattern');
  await pause(page, 500);
  await shot(page, '03a-pattern-dialog');
}

export async function s03b(page: Page): Promise<void> {
  await page.locator('[role="dialog"][aria-label="Pattern Fill"]').getByRole('button', { name: 'Apply' }).click();
  await pause(page, 800);
  await layerOpacity(page, 45);
  await shot(page, '03-iso-grid');
}

// ---------------------------------------------------------------------------
// 2. Ink border, guides and the title plate
// ---------------------------------------------------------------------------

export async function s04(page: Page): Promise<void> {
  await newLayer(page, 'Border');
  await setFg(page, INK);
  await rectSelect(page, 30, 30, DOC_W - 60, 1540 - 60);
  await fill(page);
  await rectSelect(page, 40, 40, DOC_W - 80, 1540 - 80);
  await shot(page, '04a-border-inner-marquee');
  await pressKey(page, 'Delete');
  // Hairline second rule: fill, shrink by 3, clear the middle.
  await rectSelect(page, 52, 52, DOC_W - 104, 1540 - 104);
  await fill(page);
  await selectModify(page, 'Shrink', 3);
  await shot(page, '04b-border-shrink');
  await pressKey(page, 'Delete');
  await deselect(page);
  await shot(page, '04-border');
}

export async function gridSize(page: Page, index: number): Promise<void> {
  const slider = page.locator('input[type="range"][aria-label="Grid size"]');
  if (await slider.isVisible().catch(() => false)) {
    await slider.fill(String(index));
    await pause(page, 100);
  }
}

export async function s05(page: Page): Promise<void> {
  for (const x of [COL_L, DOC_W / 2, COL_R]) await vGuide(page, x);
  for (const y of [150, ROW_1, ROW_2]) await hGuide(page, y);
  await menu(page, 'View', 'Show Grid');
  await pause(page, 300);
  await shot(page, '05-guides-grid');
}

// Title plate: a front face with an isometric extrusion running down-right.
export const PLATE = { x0: 180, y0: 92, x1: 1000, y1: 208, dx: 22, dy: 13 };

export async function s06(page: Page): Promise<void> {
  await menu(page, 'View', 'Show Grid');
  await selectLayer(page, 'Border');
  await newLayer(page, 'Title Plate');
  const p = PLATE;
  await fillPoly(page, [{ x: p.x0, y: p.y1 }, { x: p.x1, y: p.y1 }, { x: p.x1 + p.dx, y: p.y1 + p.dy }, { x: p.x0 + p.dx, y: p.y1 + p.dy }], VERM_DARK);
  await fillPoly(page, [{ x: p.x1, y: p.y0 }, { x: p.x1 + p.dx, y: p.y0 + p.dy }, { x: p.x1 + p.dx, y: p.y1 + p.dy }, { x: p.x1, y: p.y1 }], VERM_MID);
  await setGradient(page, 'linear', [{ pos: 0, hex: '#E4583A' }, { pos: 1, hex: VERM }]);
  await rectSelect(page, p.x0, p.y0, p.x1 - p.x0, p.y1 - p.y0);
  await shot(page, '06a-plate-marquee');
  await gradientDrag(page, { x: p.x0, y: p.y0 }, { x: p.x0, y: p.y1 });
  await deselect(page);
  await effect(page, 'Stroke', { Width: 4 }, { label: 'Stroke color', hex: INK.toLowerCase() });
  await closeEffects(page);
  // Inset cream keyline on its own layer, so clearing its middle keeps the face.
  await newLayer(page, 'Plate Keyline');
  await rectSelect(page, p.x0 + 9, p.y0 + 9, p.x1 - p.x0 - 18, p.y1 - p.y0 - 18);
  await setFg(page, PAPER);
  await fill(page);
  await selectModify(page, 'Shrink', 2);
  await pressKey(page, 'Delete');
  await deselect(page);
  await shot(page, '06-title-plate');
}

export async function s07(page: Page): Promise<unknown> {
  await tool(page, 'text');
  await toolOption(page, 'Size', 84);
  await setFont(page, 'Dela Gothic One');
  await setFg(page, INK);
  await clickDoc(page, 240, 112);
  // Two spaces: Dela Gothic One's word space is barely wider than its letter gaps.
  await page.keyboard.type('ZEN  ENCLAVES', { delay: 50 });
  await pause(page, 800);
  await shot(page, '07a-title-typing');
  await page.keyboard.press('Tab');
  await pause(page, 800);
  await shot(page, '07b-title-committed');
  await renameActive(page, 'ZEN ENCLAVES');
  return { layer: await layerBounds(page, 'ZEN ENCLAVES'), content: await contentBounds(page, 'ZEN ENCLAVES') };
}

export async function s08(page: Page): Promise<unknown> {
  // Too wide for the plate at 84 px: drop to 62 px, open the tracking up,
  // then select all of the text and recolour it cream.
  await selectLayer(page, 'ZEN ENCLAVES');
  await tool(page, 'text');
  await toolOption(page, 'Size', 62);
  await textPanelSetting(page, 'Letter spacing', 4);
  await pause(page, 800);
  const cb = await contentBounds(page, 'ZEN ENCLAVES');
  await clickDoc(page, (cb!.x0 + cb!.x1) / 2, (cb!.y0 + cb!.y1) / 2);
  await page.keyboard.press('Control+a');
  await pause(page, 300);
  await shot(page, '08a-title-select-all');
  await setFg(page, PAPER);
  await pause(page, 500);
  await page.keyboard.press('Tab');
  await pause(page, 800);
  // Seat the glyph box in the middle of the plate face.
  const b = await centerContentOn(page, 'ZEN ENCLAVES', (PLATE.x0 + PLATE.x1) / 2, (PLATE.y0 + PLATE.y1) / 2);
  await effect(page, 'Drop Shadow', { 'Offset X': 3, 'Offset Y': 2, Blur: 0, Opacity: 100 }, { label: 'Shadow color', hex: VERM_DARK.toLowerCase() });
  await closeEffects(page);
  await shot(page, '08-title-seated');
  return b;
}

// ---------------------------------------------------------------------------
// 3. Floating islands
// ---------------------------------------------------------------------------

export const ISLE_W = 210;
export const ISLE_H = 36;
export const ROCK_DEPTH = 170;

/** Iso origin that puts the island's top-face centre on C. */
export function isleOrigin(c: Pt): Pt {
  return { x: c.x, y: c.y - (ISLE_W / 2 - ISLE_H) * S };
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Points from a to b with a hand-chipped zigzag, for rocky undersides. */
function jagged(a: Pt, b: Pt, n: number, amp: number, seed: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i < n; i++) {
    const p = lerp(a, b, i / n);
    const k = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
    const r = (k - Math.floor(k)) * 2 - 1;
    out.push({ x: p.x + r * amp, y: p.y + Math.abs(r) * amp * 0.4 });
  }
  return out;
}

export function isleGeometry(c: Pt, seed = 1) {
  const o = isleOrigin(c);
  const W = ISLE_W, H = ISLE_H;
  const P = (a: number, b: number, z: number) => iso(o, a, b, z);
  const apex = P(W / 2 + 12, W / 2 + 12, -ROCK_DEPTH);
  const bl = P(0, W, 0), bf = P(W, W, 0), br = P(W, 0, 0);
  const rockL = [bl, bf, apex, ...jagged(apex, bl, 5, 16, seed + 1)];
  const rockR = [bf, br, ...jagged(br, apex, 5, 16, seed + 2), apex];
  const earth = isoBox(o, 0, 0, 0, W, W, H);
  // Grass lip: the top 12 px of each side face, with drips hanging below.
  const lipL: Pt[] = [P(0, W, H), P(W, W, H)];
  const lipR: Pt[] = [P(W, 0, H), P(W, W, H)];
  const n = 9;
  for (let i = n; i >= 0; i--) {
    const t = (i / n) * W;
    const drip = (i + seed) % 2 === 0 ? 12 : 12 + 7 + ((i * seed) % 3) * 4;
    lipL.push(P(t, W, H - drip));
  }
  for (let i = n; i >= 0; i--) {
    const t = (i / n) * W;
    const drip = (i + seed) % 2 === 1 ? 12 : 12 + 6 + ((i + seed * 2) % 4) * 3;
    lipR.push(P(W, t, H - drip));
  }
  return { o, apex, rockL, rockR, earth, lipL, lipR, top: earth.top };
}

export async function drawIsle(page: Page, c: Pt, topKind: 'grass' | 'sand', seed: number): Promise<void> {
  const g = isleGeometry(c, seed);
  await fillPoly(page, g.rockL, ROCK_L);
  await fillPoly(page, g.rockR, ROCK_R);
  await fillPoly(page, g.earth.left, EARTH_L);
  await fillPoly(page, g.earth.right, EARTH_R);
  await fillPoly(page, g.lipL, topKind === 'grass' ? JADE_L : STONE_L);
  await fillPoly(page, g.lipR, topKind === 'grass' ? JADE_R : STONE_R);
  const stops: Stop[] = topKind === 'grass'
    ? [{ pos: 0, hex: '#B4D98F' }, { pos: 1, hex: JADE_TOP }]
    : [{ pos: 0, hex: '#FBF1D6' }, { pos: 1, hex: SAND }];
  await setGradient(page, 'linear', stops);
  await lassoSelect(page, g.top);
  await gradientDrag(page, g.top[0]!, g.top[2]!);
  await deselect(page);
}

export const T1: Pt = { x: COL_L, y: ROW_1 };

export async function s09(page: Page): Promise<void> {
  await selectLayer(page, 'Border');
  await newLayer(page, 'Isle 1');
  await drawIsle(page, T1, 'grass', 1);
  await shot(page, '09-isle-one');
}

export const TORII_TOP = '#EE6A4B';

export async function bush(page: Page, center: Pt, rx: number, ry: number): Promise<void> {
  await setGradient(page, 'radial', [{ pos: 0, hex: '#B4D98F' }, { pos: 0.55, hex: JADE_TOP }, { pos: 1, hex: JADE_R }]);
  await ellipseSelect(page, center.x, center.y, rx, ry);
  await gradientDrag(page, { x: center.x - rx * 0.35, y: center.y - ry * 0.45 }, { x: center.x + rx, y: center.y + ry });
  await deselect(page);
}

export async function s10(page: Page): Promise<void> {
  const o = isleOrigin(T1);
  const H = ISLE_H;
  await newLayer(page, 'Shrubs 1');
  // Bushes on the two side corners, clear of the pillars.
  await bush(page, { x: iso(o, 34, 176, H).x, y: iso(o, 34, 176, H).y - 16 }, 30, 24);
  await bush(page, { x: iso(o, 180, 40, H).x, y: iso(o, 180, 40, H).y - 12 }, 22, 18);
  await newLayer(page, 'Torii');
  await drawTorii(page, o, H);
  await newLayer(page, 'Stepping Stones');
  for (const [x, y] of [[98, 186], [104, 158], [98, 131]] as const) {
    await paintFaces(page, isoBox(o, x, y, H, 20, 18, 4), STONE_TOP, STONE_L, STONE_R);
  }
  await shot(page, '10-torii');
}

export async function drawTorii(page: Page, o: Pt, H: number): Promise<void> {
  for (const x of [60, 146]) await paintFaces(page, isoBox(o, x, 98, H, 14, 14, 150), TORII_TOP, VERM, VERM_DARK);
  await paintFaces(page, isoBox(o, 40, 101, H + 112, 130, 8, 11), TORII_TOP, VERM, VERM_DARK);
  await paintFaces(page, isoBox(o, 100, 101, H + 123, 10, 8, 27), TORII_TOP, VERM, VERM_DARK);
  await paintFaces(page, isoBox(o, 36, 98, H + 150, 138, 14, 12), TORII_TOP, VERM, VERM_DARK);
  // Black kasagi cap whose ends sweep upward.
  const xs = [22, 40, 170, 188];
  const lift = [10, 0, 0, 10];
  const P = (x: number, y: number, z: number) => iso(o, x, y, z);
  const z0 = H + 162, z1 = H + 172;
  await fillPoly(page, [
    ...xs.map((x, i) => P(x, 96, z1 + lift[i]! * 1.4)),
    ...xs.slice().reverse().map((x, i) => P(x, 114, z1 + lift[3 - i]! * 1.4)),
  ], '#4A4652');
  await fillPoly(page, [
    ...xs.map((x, i) => P(x, 114, z1 + lift[i]! * 1.4)),
    ...xs.slice().reverse().map((x, i) => P(x, 114, z0 + lift[3 - i]!)),
  ], '#2C2934');
  await fillPoly(page, [P(188, 96, z1 + 14), P(188, 114, z1 + 14), P(188, 114, z0 + 10), P(188, 96, z0 + 10)], INK);
}

export async function groupLayers(page: Page, first: string, last: string, name: string): Promise<void> {
  await selectLayer(page, first);
  await selectLayer(page, last, ['Shift']);
  await menu(page, 'Layer', 'Group Layers');
  await pause(page, 300);
  await renameActive(page, name);
}

export async function inkOutline(page: Page, names: string[], width: number): Promise<void> {
  for (const n of names) {
    await selectLayer(page, n);
    await effect(page, 'Stroke', { Width: width }, { label: 'Stroke color', hex: INK.toLowerCase() });
    await closeEffects(page);
  }
}

export async function inkBrush(page: Page, size: number, hex = INK): Promise<void> {
  await tool(page, 'brush');
  await brushSettings(page, { Size: size, Hardness: 100, Opacity: 100, Spacing: 5 });
  await closeBrushSettings(page);
  await setFg(page, hex);
}

export async function drawIsleInk(page: Page, c: Pt): Promise<void> {
  const g = isleGeometry(c);
  const o = g.o, W = ISLE_W, H = ISLE_H;
  await polyline(page, [iso(o, 0, W, H), iso(o, W, W, H), iso(o, W, 0, H)]);
  await polyline(page, [iso(o, W, W, H), iso(o, W, W, 0), g.apex]);
  await polyline(page, [iso(o, 0, W, 0), iso(o, W, W, 0), iso(o, W, 0, 0)]);
}

// ---------------------------------------------------------------------------
// 5. Design 2: three-tier pagoda under a rising sun
// ---------------------------------------------------------------------------

export const T2: Pt = { x: COL_R, y: ROW_1 };
const WALL_L = '#F3E3C0';
const WALL_R = '#CBB48A';

export async function drawPagoda(page: Page, o: Pt, H: number): Promise<void> {
  const c = ISLE_W / 2;
  await paintFaces(page, isoFrustum(o, c, c, H, 120, 108, 12), STONE_TOP, STONE_L, STONE_R);
  const tiers = [
    { w: 76, h: 46, roof: 128, top: 60, rh: 26 },
    { w: 60, h: 38, roof: 108, top: 46, rh: 24 },
    { w: 46, h: 32, roof: 90, top: 0, rh: 44 },
  ];
  let z = H + 12;
  for (const t of tiers) {
    const x0 = c - t.w / 2, x1 = c + t.w / 2;
    const wall = isoBox(o, x0, x0, z, t.w, t.w, t.h);
    await fillPoly(page, wall.left, WALL_L);
    await fillPoly(page, wall.right, WALL_R);
    // Vermilion corner posts, a door on the left face and a window on the right.
    await fillPoly(page, isoBox(o, x1 - 7, x1, z, 7, 0, t.h).left, VERM);
    await fillPoly(page, isoBox(o, x0, x1, z, 7, 0, t.h).left, VERM);
    await fillPoly(page, isoBox(o, x1, x0, z, 0, 7, t.h).right, VERM_DARK);
    await fillPoly(page, isoBox(o, c - 8, x1, z, 16, 0, t.h * 0.7).left, VERM_DARK);
    await fillPoly(page, isoBox(o, x1, c - 7, z + t.h * 0.35, 0, 14, t.h * 0.4).right, INK);
    z += t.h;
    // Eave fascia, then the sloped roof on top of it.
    const eave = isoBox(o, c - t.roof / 2, c - t.roof / 2, z, t.roof, t.roof, 5);
    await fillPoly(page, eave.left, TEAL_R);
    await fillPoly(page, eave.right, '#123638');
    z += 5;
    const roof = isoFrustum(o, c, c, z, t.roof, t.top, t.rh);
    if (t.top > 0) await fillPoly(page, roof.top, TEAL_TOP);
    await fillPoly(page, roof.left, TEAL_L);
    await fillPoly(page, roof.right, TEAL_R);
    z += t.rh;
  }
  // Gold sorin spire with three rings.
  await paintFaces(page, isoBox(o, c - 2, c - 2, z - 8, 4, 4, 62), '#F6D27A', GOLD, '#A8741F');
  await setFg(page, GOLD);
  for (const dz of [12, 26, 40]) {
    const p = iso(o, c, c, z + dz);
    await ellipseSelect(page, p.x, p.y, 10, 5);
    await fill(page);
  }
  const tip = iso(o, c, c, z + 58);
  await ellipseSelect(page, tip.x, tip.y - 3, 6, 6);
  await setFg(page, '#F6D27A');
  await fill(page);
  await deselect(page);
}

export const SUN: Pt = { x: T2.x + 30, y: T2.y - 180 };

export async function s12(page: Page): Promise<void> {
  // Rising-sun rays first (they sit behind the disc), clipped to a circle.
  await selectLayer(page, 'Border');
  await newLayer(page, 'Sun Rays');
  await ellipseSelect(page, SUN.x, SUN.y, 176, 176);
  await setFg(page, '#E2694A');
  await menu(page, 'Filter', 'Sunburst');
  const modal = page.locator('[role="dialog"][aria-label="Sunburst"]');
  await modal.waitFor({ state: 'visible' });
  const set = async (label: string, v: number) => {
    const input = modal.locator(`[aria-label="${label} value"]`).first();
    await input.fill(String(v));
    await input.press('Tab');
  };
  await set('Rays', 12);
  await set('Width', 42);
  await set('Taper', 0);
  await set('Fade', 0);
  await set('Center X', Math.round((SUN.x / 1200) * 100));
  await set('Center Y', Math.round((SUN.y / 1540) * 100));
  await shot(page, '12a-sunburst-dialog');
  await modal.getByRole('button', { name: 'Apply' }).click();
  await pause(page, 800);
  await deselect(page);
  await layerOpacity(page, 60);
  await shot(page, '12-sun-rays');
}

export async function s13(page: Page): Promise<void> {
  await selectLayer(page, 'Sun Rays');
  await newLayer(page, 'Sun');
  await ellipseSelect(page, SUN.x, SUN.y, 100, 100);
  await setGradient(page, 'radial', [{ pos: 0, hex: '#F07A52' }, { pos: 1, hex: VERM }]);
  await gradientDrag(page, SUN, { x: SUN.x + 100, y: SUN.y });
  await deselect(page);
  await effect(page, 'Stroke', { Width: 3 }, { label: 'Stroke color', hex: INK.toLowerCase() });
  await closeEffects(page);
  await shot(page, '13-sun');
}

export async function s14(page: Page): Promise<void> {
  await selectLayer(page, 'Sun');
  await newLayer(page, 'Isle 2');
  await drawIsle(page, T2, 'grass', 2);
  await newLayer(page, 'Pagoda');
  await drawPagoda(page, isleOrigin(T2), ISLE_H);
  await shot(page, '14-pagoda');
}

export async function drawPagodaInk(page: Page, o: Pt, H: number): Promise<void> {
  const c = ISLE_W / 2;
  const P = (a: number, b: number, z: number) => iso(o, a, b, z);
  const tiers = [
    { w: 76, h: 46, roof: 128, top: 60, rh: 26 },
    { w: 60, h: 38, roof: 108, top: 46, rh: 24 },
    { w: 46, h: 32, roof: 90, top: 0, rh: 44 },
  ];
  let z = H + 12;
  for (const t of tiers) {
    const x1 = c + t.w / 2;
    await polyline(page, [P(x1, x1, z), P(x1, x1, z + t.h)]);
    z += t.h + 5;
    const b = t.roof / 2, tt = t.top / 2;
    await polyline(page, [P(c - b, c + b, z), P(c + b, c + b, z), P(c + b, c - b, z)]);
    await polyline(page, [P(c + b, c + b, z), P(c + tt, c + tt, z + t.rh)]);
    z += t.rh;
  }
}

// ---------------------------------------------------------------------------
// 6. Design 3: raked-sand rock garden with a bonsai pine
// ---------------------------------------------------------------------------

export const T3: Pt = { x: COL_L, y: ROW_2 };
const BARK = '#5B3A29';

/** An iso circle of radius r lying on the plane z. */
export function isoCircle(o: Pt, cx: number, cy: number, z: number, r: number, n = 40): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push(iso(o, cx + Math.cos(t) * r, cy + Math.sin(t) * r, z));
  }
  return out;
}

export async function s15(page: Page): Promise<void> {
  await selectLayer(page, 'Pagoda');
  await newLayer(page, 'Isle 3');
  await drawIsle(page, T3, 'sand', 3);
  await shot(page, '15-sand-isle');
}

export async function s16(page: Page): Promise<void> {
  // Raked sand: concentric iso rings round the rock, straight rows elsewhere.
  const o = isleOrigin(T3);
  const H = ISLE_H;
  await newLayer(page, 'Raked Sand');
  await inkBrush(page, 3, SAND_LINE);
  for (const r of [34, 48, 62]) await polyline(page, isoCircle(o, 138, 72, H, r));
  for (const y of [150, 166, 182, 198]) await polyline(page, [iso(o, 8, y, H), iso(o, 202, y, H)]);
  await shot(page, '16-raked-sand');
}

export async function s17(page: Page): Promise<void> {
  const o = isleOrigin(T3);
  const H = ISLE_H;
  await newLayer(page, 'Rocks');
  // One faceted boulder sitting flat on the sand: a crown and two flanks.
  const P = (a: number, b: number, z: number) => iso(o, a, b, z);
  const crown = [P(122, 56, H + 30), P(150, 54, H + 34), P(160, 78, H + 30), P(134, 90, H + 26)];
  await fillPoly(page, crown, STONE_TOP);
  await fillPoly(page, [crown[3]!, crown[2]!, P(166, 96, H), P(116, 98, H)], STONE_L);
  await fillPoly(page, [crown[1]!, crown[2]!, P(166, 96, H), P(168, 50, H)], STONE_R);
  await fillPoly(page, [crown[0]!, crown[3]!, P(116, 98, H), P(112, 64, H)], STONE_L);
  // A low stepping slab in front of it.
  await paintFaces(page, isoBox(o, 150, 124, H, 26, 18, 5), STONE_TOP, STONE_L, STONE_R);
  await shot(page, '17-rocks');
}

export async function s18(page: Page): Promise<void> {
  const o = isleOrigin(T3);
  const H = ISLE_H;
  const base = iso(o, 62, 128, H);
  const at = (dx: number, dy: number): Pt => ({ x: base.x + dx * S, y: base.y + dy * S });
  await newLayer(page, 'Bonsai Trunk');
  // Flared root plate so the trunk grips the sand.
  await fillPoly(page, [at(-26, 4), at(-10, -6), at(-6, -22), at(8, -22), at(12, -6), at(28, 4), at(8, 8), at(-8, 8)], BARK);
  await inkBrush(page, Math.round(16 * S), BARK);
  await polyline(page, [base, at(-8, -40), at(14, -78), at(-6, -118), at(6, -150)]);
  await inkBrush(page, Math.round(8 * S), BARK);
  await polyline(page, [at(12, -76), at(60, -96)]);
  await polyline(page, [at(-6, -112), at(-52, -130)]);
  await newLayer(page, 'Bonsai Pads');
  // Foliage pads as isometric discs: a dark rim, then the lit top.
  const pads = [
    { x: 64, y: -104, rx: 44 },
    { x: -54, y: -138, rx: 42 },
    { x: 6, y: -168, rx: 52 },
  ];
  for (const p of pads) {
    const c = at(p.x, p.y);
    const rx = p.rx * S, ry = rx * 0.5;
    await ellipseSelect(page, c.x, c.y + 9, rx, ry);
    await setFg(page, JADE_R);
    await fill(page);
    await setGradient(page, 'linear', [{ pos: 0, hex: '#B4D98F' }, { pos: 1, hex: JADE_L }]);
    await ellipseSelect(page, c.x, c.y, rx, ry);
    await gradientDrag(page, { x: c.x, y: c.y - ry }, { x: c.x, y: c.y + ry });
  }
  await deselect(page);
  await shot(page, '18-bonsai');
}

export const T4: Pt = { x: COL_R, y: ROW_2 };

export async function s19(page: Page): Promise<void> {
  await selectLayer(page, 'Bonsai Pads');
  await newLayer(page, 'Isle 4');
  await drawIsle(page, T4, 'grass', 4);
  const o = isleOrigin(T4);
  const H = ISLE_H;
  const P = (a: number, b: number, z: number) => iso(o, a, b, z);
  // Sunken pond: dark inner wall, then the water surface 10 px down.
  await fillPoly(page, [P(22, 92, H), P(128, 92, H), P(128, 192, H), P(22, 192, H)], EARTH_R);
  await setGradient(page, 'linear', [{ pos: 0, hex: '#9AD9DA' }, { pos: 1, hex: '#3E97A6' }]);
  await lassoSelect(page, [P(22, 92, H - 10), P(118, 92, H - 10), P(128, 192, H), P(32, 192, H)]);
  await gradientDrag(page, P(22, 92, H - 10), P(128, 192, H));
  await deselect(page);
  await shot(page, '19-pond');
}

export async function s20(page: Page): Promise<void> {
  const o = isleOrigin(T4);
  const H = ISLE_H;
  await newLayer(page, 'Ripples');
  await inkBrush(page, 2, '#E8FAF8');
  for (const r of [9, 18]) await polyline(page, isoCircle(o, 84, 132, H - 10, r, 28));
  await newLayer(page, 'Koi');
  // A koi seen from above, laid flat on the water plane (block coordinates).
  const W = (u: number, v: number): Pt => iso(o, 44 + u, 164 + v, H - 10);
  const body: Pt[] = [];
  for (let i = 0; i <= 20; i++) {
    const t = (i / 20) * Math.PI;
    body.push(W(-Math.cos(t) * 15, Math.sin(t) * 5.5 * (1 - 0.35 * (1 - Math.cos(t)) / 2)));
  }
  for (let i = 20; i >= 0; i--) {
    const t = (i / 20) * Math.PI;
    body.push(W(-Math.cos(t) * 15, -Math.sin(t) * 5.5 * (1 - 0.35 * (1 - Math.cos(t)) / 2)));
  }
  await fillPoly(page, body, '#F7F2E8');
  await fillPoly(page, [W(13, 0), W(24, -7), W(21, 0), W(24, 7)], '#F7F2E8');
  await fillPoly(page, ellipsePts(W(-6, 0).x, W(-6, 0).y, 6, 3.5, 18, Math.PI / 6), '#F26B2A');
  await fillPoly(page, ellipsePts(W(5, 1).x, W(5, 1).y, 4, 2.5, 16, Math.PI / 6), '#F26B2A');
  await shot(page, '20-koi');
}

export async function s21(page: Page): Promise<unknown> {
  // Copy the koi, paste it in place as a new layer, slide it across the pond
  // and swing it round with the rotation handle.
  await selectLayer(page, 'Koi');
  await pressKey(page, 'Control+c');
  await pasteAsNewLayer(page);
  await renameActive(page, 'Koi 2');
  const o = isleOrigin(T4);
  const k = iso(o, 44, 164, ISLE_H - 10);
  await tool(page, 'move');
  await pressKey(page, 'Escape');
  const { moveBy } = await import('./composition-zen-enclaves.steps.ts');
  await moveBy(page, k, 95, -2);
  await selectAlpha(page, 'Koi 2');
  const b = await contentBounds(page, 'Koi 2');
  await shot(page, '21a-koi-copy-selected');
  await rotateSelection(page, b!, 75, '21b-koi-rotate-handles');
  await pressKey(page, 'Enter');
  await deselect(page);
  await shot(page, '21-koi-pair');
  return { before: b, after: await contentBounds(page, 'Koi 2') };
}

export async function s22(page: Page): Promise<void> {
  await s22a(page);
  await s22b(page);
}

export async function s22a(page: Page): Promise<void> {
  const o = isleOrigin(T4);
  await selectLayer(page, 'Koi 2');
  await newLayer(page, 'Lily Pads');
  for (const [x, y, r] of [[42, 112, 12], [108, 176, 9]] as const) {
    const p = iso(o, x, y, ISLE_H - 10);
    await ellipseSelect(page, p.x, p.y, r * 1.5, r * 0.85);
    await setFg(page, '#6DAA55');
    await fill(page);
  }
  await deselect(page);
}

export async function s22b(page: Page): Promise<void> {
  const o = isleOrigin(T4);
  // Notch each pad with the eraser, the classic lily-pad wedge.
  await tool(page, 'eraser');
  await toolOption(page, 'Size', 5);
  for (const [x, y, r] of [[42, 112, 12], [108, 176, 9]] as const) {
    const p = iso(o, x, y, ISLE_H - 10);
    await polyline(page, [p, { x: p.x + r * 1.5, y: p.y - r * 0.4 }]);
  }
  await shot(page, '22-lily-pads');
}

export async function s23(page: Page): Promise<void> {
  const o = isleOrigin(T4);
  const H = ISLE_H;
  const cx = 158, cy = 58;
  await newLayer(page, 'Lantern');
  await paintFaces(page, isoFrustum(o, cx, cy, H, 46, 34, 10), STONE_TOP, STONE_L, STONE_R);
  await paintFaces(page, isoBox(o, cx - 8, cy - 8, H + 10, 16, 16, 48), STONE_TOP, STONE_L, STONE_R);
  await paintFaces(page, isoBox(o, cx - 19, cy - 19, H + 58, 38, 38, 9), STONE_TOP, STONE_L, STONE_R);
  const box = isoBox(o, cx - 14, cy - 14, H + 67, 28, 28, 30);
  await fillPoly(page, box.left, STONE_L);
  await fillPoly(page, box.right, STONE_R);
  // Lit windows on both visible faces.
  await fillPoly(page, isoBox(o, cx - 7, cy + 14, H + 73, 14, 0, 18).left, '#FFD66B');
  await fillPoly(page, isoBox(o, cx + 14, cy - 7, H + 73, 0, 14, 18).right, GOLD);
  const roof = isoFrustum(o, cx, cy, H + 97, 60, 12, 24);
  await fillPoly(page, roof.top, '#8F897D');
  await fillPoly(page, roof.left, '#6F695F');
  await fillPoly(page, roof.right, '#4F4A43');
  const tip = iso(o, cx, cy, H + 127);
  await ellipseSelect(page, tip.x, tip.y, 8, 8);
  await setFg(page, STONE_L);
  await fill(page);
  await deselect(page);
  await newLayer(page, 'Lantern Glow');
  await fillPoly(page, isoBox(o, cx - 7, cy + 14, H + 73, 14, 0, 18).left, '#FFD66B');
  await fillPoly(page, isoBox(o, cx + 14, cy - 7, H + 73, 0, 14, 18).right, '#FFD66B');
  await effect(page, 'Outer Glow', { Size: 26, Opacity: 85 }, { label: 'Glow color', hex: '#ffc24a' });
  await closeEffects(page);
  await shot(page, '23-lantern');
}

// ---------------------------------------------------------------------------
// 8. Line it like a tattoo: outlines, edge ink, flat offset shadows, groups
// ---------------------------------------------------------------------------

export const DESIGNS = [
  { n: 1, c: T1, group: '01 Torii', layers: ['Isle 1', 'Shrubs 1', 'Torii', 'Stepping Stones'] },
  { n: 2, c: T2, group: '02 Pagoda', layers: ['Isle 2', 'Pagoda'] },
  { n: 3, c: T3, group: '03 Rock Garden', layers: ['Isle 3', 'Rocks', 'Bonsai Trunk', 'Bonsai Pads'] },
  { n: 4, c: T4, group: '04 Koi Pond', layers: ['Isle 4', 'Koi', 'Koi 2', 'Lily Pads', 'Lantern'] },
];

export async function flatShadow(page: Page): Promise<void> {
  await effect(page, 'Drop Shadow', { 'Offset X': 10, 'Offset Y': 12, Blur: 0, Opacity: 20 }, { label: 'Shadow color', hex: INK.toLowerCase() });
  await closeEffects(page);
}

export async function s24(page: Page): Promise<void> {
  for (const d of DESIGNS.slice(0, 2)) await lineDesign(page, d);
  await shot(page, '24-ink-top-row');
}

export async function s25(page: Page): Promise<void> {
  for (const d of DESIGNS.slice(2)) await lineDesign(page, d);
  await shot(page, '25-ink-bottom-row');
}

async function lineDesign(page: Page, d: typeof DESIGNS[number]): Promise<void> {
  await inkOutline(page, d.layers, 3);
  await selectLayer(page, `Isle ${d.n}`);
  await flatShadow(page);
  await newLayer(page, `Ink ${d.n}`);
  await inkBrush(page, 3);
  await drawIsleInk(page, d.c);
  if (d.n === 2) {
    await selectLayer(page, 'Pagoda');
    await newLayer(page, 'Pagoda Ink');
    await inkBrush(page, 2);
    await drawPagodaInk(page, isleOrigin(T2), ISLE_H);
  }
  // Bake the live effects so SwiftShader keeps up.
  for (const n of d.layers) {
    await selectLayer(page, n);
    await rasterizeStyle(page);
  }
}

export async function s26(page: Page): Promise<unknown> {
  await groupLayers(page, 'Isle 1', 'Stepping Stones', '01 Torii');
  await groupLayers(page, 'Sun Rays', 'Pagoda Ink', '02 Pagoda');
  await groupLayers(page, 'Isle 3', 'Bonsai Pads', '03 Rock Garden');
  await groupLayers(page, 'Isle 4', 'Lantern Glow', '04 Koi Pond');
  await shot(page, '26-design-groups');
  return layers(page);
}

// ---------------------------------------------------------------------------
// 9. Clouds and blossoms between the islands
// ---------------------------------------------------------------------------

/** A flat-bottomed cloud: a row of bumps of the given radii over a base line. */
export function cloudPts(x0: number, base: number, radii: number[]): Pt[] {
  const out: Pt[] = [{ x: x0, y: base }];
  let x = x0;
  for (let i = 0; i < radii.length; i++) {
    const r = radii[i]!;
    const cx = x + r;
    for (let k = 0; k <= 12; k++) {
      const t = Math.PI - (k / 12) * Math.PI;
      out.push({ x: cx + Math.cos(t) * r, y: base - r * 0.45 - Math.sin(t) * r * 0.9 });
    }
    x += r * 1.55;
  }
  out.push({ x: x + radii[radii.length - 1]! * 0.45, y: base });
  return out;
}

export const CLOUD = { x0: 96, base: 330, radii: [22, 34, 26] };

export async function s27(page: Page): Promise<void> {
  // Build the cloud from overlapping circles on one layer, so the fills merge
  // into a single silhouette, then square off the base with a marquee fill.
  await selectLayer(page, 'ZEN ENCLAVES');
  await newLayer(page, 'Cloud');
  await setFg(page, '#FFF9EC');
  let x = CLOUD.x0;
  for (const r of CLOUD.radii) {
    await ellipseSelect(page, x + r, CLOUD.base - r * 0.9, r, r * 0.9);
    await fill(page);
    x += r * 1.55;
  }
  await rectSelect(page, CLOUD.x0, CLOUD.base - 22, x - CLOUD.x0 + 12, 22);
  await fill(page);
  await deselect(page);
  await effect(page, 'Stroke', { Width: 3 }, { label: 'Stroke color', hex: INK.toLowerCase() });
  await closeEffects(page);
  await rasterizeStyle(page);
  await shot(page, '27-cloud');
}

export async function s28(page: Page): Promise<unknown> {
  // Duplicate the cloud with copy / paste in place, drag it to the bottom
  // right corner and shrink it with a uniform corner-handle scale.
  await selectLayer(page, 'Cloud');
  await pressKey(page, 'Control+c');
  await pasteAsNewLayer(page);
  await renameActive(page, 'Cloud 2');
  const { moveBy } = await import('./composition-zen-enclaves.steps.ts');
  await moveBy(page, { x: CLOUD.x0 + 60, y: CLOUD.base - 20 }, 900, 1010);
  await selectAlpha(page, 'Cloud 2');
  const b = (await contentBounds(page, 'Cloud 2'))!;
  await shot(page, '28a-cloud-copy-selected');
  await scaleSelection(page, { x: b.x1 + 1, y: b.y1 + 1 }, -(b.x1 - b.x0) * 0.25, -(b.y1 - b.y0) * 0.25, true, '28b-cloud-scale-handles');
  await pressKey(page, 'Enter');
  await deselect(page);
  await shot(page, '28-clouds');
  return { cloud2: await contentBounds(page, 'Cloud 2'), before: b };
}

export function petalPts(cx: number, cy: number, r: number, angle: number): Pt[] {
  const out: Pt[] = [];
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI;
    // Teardrop from the centre out to a notched tip.
    const along = Math.sin(t / 2) * r;
    const w = Math.sin(t) * r * 0.42;
    const lx = along, ly = w * (i < n / 2 ? 1 : 1);
    out.push({ x: lx, y: ly });
  }
  const back: Pt[] = out.slice().reverse().map((p) => ({ x: p.x, y: -p.y }));
  const tip: Pt[] = [{ x: r * 0.86, y: 0 }];
  const shape = [...out, ...tip, ...back];
  const c = Math.cos(angle), s = Math.sin(angle);
  return shape.map((p) => ({ x: cx + p.x * c - p.y * s, y: cy + p.x * s + p.y * c }));
}

export const BLOSSOM: Pt = { x: 600, y: 322 };

export async function s29(page: Page): Promise<void> {
  await selectLayer(page, 'Cloud 2');
  await newLayer(page, 'Blossoms');
  for (let i = 0; i < 5; i++) {
    await fillPoly(page, petalPts(BLOSSOM.x, BLOSSOM.y, 17, -Math.PI / 2 + (i * 2 * Math.PI) / 5), SAKURA);
  }
  await ellipseSelect(page, BLOSSOM.x, BLOSSOM.y, 5, 5);
  await setFg(page, GOLD);
  await fill(page);
  await deselect(page);
  await effect(page, 'Stroke', { Width: 2 }, { label: 'Stroke color', hex: INK.toLowerCase() });
  await closeEffects(page);
  await rasterizeStyle(page);
  await shot(page, '29-blossom');
}

export async function s30(page: Page): Promise<void> {
  // Cut the blossom out to its own layer, then paste copies at the gutter
  // crossing and in both margins, each at its own size and angle.
  await selectLayer(page, 'Blossoms');
  await rectSelect(page, BLOSSOM.x - 24, BLOSSOM.y - 24, 48, 48);
  await pressKey(page, 'Control+x');
  await pasteAsNewLayer(page);
  await renameActive(page, 'Blossom 1');
  const spots = [
    { dx: 0, dy: 560, rot: 36, scale: 1.35 },
    { dx: -508, dy: 380, rot: -20, scale: 0.75 },
    { dx: 506, dy: 690, rot: 18, scale: 1 },
  ];
  const { moveBy } = await import('./composition-zen-enclaves.steps.ts');
  let i = 2;
  for (const sp of spots) {
    await pasteAsNewLayer(page);
    const name = `Blossom ${i++}`;
    await renameActive(page, name);
    await moveBy(page, BLOSSOM, sp.dx, sp.dy);
    await selectAlpha(page, name);
    let b = (await contentBounds(page, name))!;
    if (sp.scale !== 1) {
      const w = b.x1 - b.x0, h = b.y1 - b.y0;
      await scaleSelection(page, { x: b.x1 + 1, y: b.y1 + 1 }, w * (sp.scale - 1), h * (sp.scale - 1));
      await pressKey(page, 'Enter');
      await deselect(page);
      await selectAlpha(page, name);
      b = (await contentBounds(page, name))!;
    }
    await rotateSelection(page, b, sp.rot, i === 3 ? '30a-blossom-rotate' : undefined);
    await pressKey(page, 'Enter');
    await deselect(page);
  }
  await shot(page, '30-blossoms-scattered');
}

export const BADGES: Pt[] = DESIGNS.map((d) => ({ x: d.c.x - 168, y: d.c.y + 150 }));

/** How far the snapped group drag actually moved the bottom row. */
let rowShift = 0;

export async function s31(page: Page): Promise<unknown> {
  await selectLayer(page, 'ZEN ENCLAVES');
  await newLayer(page, 'Badges');
  BADGES.forEach((b, i) => { if (i >= 2) b.y += rowShift; });
  rowShift = 0;
  for (const b of BADGES) {
    await ellipseSelect(page, b.x, b.y, 27, 27);
    await setFg(page, INK);
    await fill(page);
    await ellipseSelect(page, b.x, b.y, 22, 22);
    await setFg(page, PAPER);
    await fill(page);
    await selectModify(page, 'Shrink', 2);
    await setFg(page, INK);
    await fill(page);
  }
  await deselect(page);
  await shot(page, '31a-badges');
  const out: unknown[] = [];
  for (let i = 0; i < BADGES.length; i++) {
    const b = BADGES[i]!;
    await selectLayer(page, 'Badges');
    await tool(page, 'text');
    await toolOption(page, 'Size', 26);
    await setFont(page, 'Dela Gothic One');
    await setFg(page, PAPER);
    await clickDoc(page, b.x - 14, b.y - 16);
    await page.keyboard.type(String(i + 1), { delay: 50 });
    await page.keyboard.press('Tab');
    await pause(page, 600);
    await renameActive(page, `No. ${i + 1}`);
    out.push(await centerContentOn(page, `No. ${i + 1}`, b.x, b.y));
  }
  await shot(page, '31-flash-numbers');
  return out;
}

export const FOOTER_Y = 1440;

export async function textPanelSetting(page: Page, label: string, value: number): Promise<void> {
  const input = page.locator(`[aria-label="${label} value"]`).first();
  if (!(await input.isVisible().catch(() => false))) {
    await page.locator('[role="toolbar"][aria-label="Panel visibility"] button[aria-label="Text"]').click();
    await pause(page, 300);
  }
  await input.fill(String(value));
  await input.press('Enter');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await pause(page, 600);
}

export async function s32(page: Page): Promise<unknown> {
  // Start from a raster layer: with a text layer active, the Text tool's
  // options restyle that layer.
  await selectLayer(page, 'Badges');
  await tool(page, 'text');
  await toolOption(page, 'Size', 18);
  await setFont(page, 'Zen Kaku Gothic New');
  await page.locator('role=toolbar >> [aria-label="Font weight"]').selectOption('700');
  await setFg(page, INK);
  await clickDoc(page, 360, FOOTER_Y - 10);
  await page.keyboard.type('FLOATING ISLAND FLASH  \u00B7  SHEET NO. 07', { delay: 30 });
  await page.keyboard.press('Tab');
  await pause(page, 800);
  await renameActive(page, 'Footer');
  await textPanelSetting(page, 'Letter spacing', 3);
  const b = await centerContentOn(page, 'Footer', 600, FOOTER_Y);
  // Rules either side, the same 3 px weight as the inner border rule, stopping
  // short of the seal on the right and mirrored on the left.
  await newLayer(page, 'Footer Rules');
  await setFg(page, INK);
  const gap = 22;
  const outer = SEAL.x - 44;
  await rectSelect(page, 1200 - outer, FOOTER_Y - 1, b.x0 - gap - (1200 - outer), 3);
  await fill(page);
  await rectSelect(page, b.x1 + gap, FOOTER_Y - 1, outer - b.x1 - gap, 3);
  await fill(page);
  await deselect(page);
  await shot(page, '32-footer');
  return { footer: b };
}

export const SEAL: Pt = { x: 1084, y: 1440 };

export async function s33(page: Page): Promise<unknown> {
  // A hanko-style seal: vermilion block, cream keyline, ZEN reversed out.
  await newLayer(page, 'Seal');
  await rectSelect(page, SEAL.x - 32, SEAL.y - 32, 64, 64);
  await setFg(page, VERM);
  await fill(page);
  await selectModify(page, 'Shrink', 4);
  await setFg(page, PAPER);
  await fill(page);
  await selectModify(page, 'Shrink', 2);
  await setFg(page, VERM);
  await fill(page);
  await deselect(page);
  await tool(page, 'text');
  await toolOption(page, 'Size', 14);
  await setFont(page, 'Dela Gothic One');
  await setFg(page, PAPER);
  await clickDoc(page, SEAL.x - 18, SEAL.y - 10);
  await page.keyboard.type('ZEN', { delay: 50 });
  await page.keyboard.press('Tab');
  await pause(page, 800);
  await renameActive(page, 'Seal Text');
  const text = await centerContentOn(page, 'Seal Text', SEAL.x, SEAL.y);
  await shot(page, '33a-seal-text');
  // Tilt the stamp like it was pressed by hand: rotate the block with the
  // Move tool's rotation handle, then the text layer on its own.
  await selectLayer(page, 'Seal');
  await selectAlpha(page, 'Seal');
  const b = (await contentBounds(page, 'Seal'))!;
  await rotateSelection(page, b, -6, '33b-seal-rotate');
  await pressKey(page, 'Enter');
  await deselect(page);
  await shot(page, '33-seal');
  return { text, seal: await contentBounds(page, 'Seal') };
}

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

const MOVED = ['Isle 3', 'Bonsai Pads', 'Isle 4', 'Lantern'];

export async function s34(page: Page): Promise<unknown> {
  // Drop the bottom row 16 px: select both groups and drag them together
  // with the grid shown so the drag snaps onto the lattice.
  const before = await layerHash(page, MOVED);
  const y0 = (await layerBounds(page, 'Isle 3')).y;
  await menu(page, 'View', 'Show Grid');
  await selectLayer(page, '03 Rock Garden');
  await selectLayer(page, '04 Koi Pond', ['Control']);
  await tool(page, 'move');
  const from = await docToScreen(page, T3.x + 40, T3.y + 60);
  const to = await docToScreen(page, T3.x + 40, T3.y + 76);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await pause(page, 400);
  await shot(page, '34a-group-drag-snap');
  await page.mouse.up();
  await pause(page, 500);
  await menu(page, 'View', 'Show Grid');
  const afterMove = await layerHash(page, MOVED);
  await shot(page, '34b-bottom-row-moved');
  const hashes: string[] = [afterMove];
  for (let i = 0; i < 3; i++) {
    await pressKey(page, 'Control+z');
    await pause(page, 700);
    hashes.push(await layerHash(page, MOVED));
  }
  await shot(page, '34c-undo-x3');
  for (let i = 0; i < 3; i++) {
    await pressKey(page, 'Control+Shift+z');
    await pause(page, 700);
  }
  const afterRedo = await layerHash(page, MOVED);
  await shot(page, '34d-redo-x3');
  rowShift = (await layerBounds(page, 'Isle 3')).y - y0;
  return { before, hashes, afterRedo, match: afterRedo === afterMove, isle3: await layerBounds(page, 'Isle 3') };
}

// ---------------------------------------------------------------------------
// 12. Dotwork, grain and export
// ---------------------------------------------------------------------------

export async function s35(page: Page): Promise<void> {
  // Tattoo dotwork on the sun: a dark radial ramp turned into halftone dots,
  // multiplied over the disc.
  await selectLayer(page, 'Sun');
  await selectAlpha(page, 'Sun');
  await newLayer(page, 'Sun Dotwork');
  // Dots grow toward the bottom of the disc: shading, not noise.
  await setGradient(page, 'linear', [{ pos: 0, hex: '#FFFFFF' }, { pos: 0.45, hex: '#FFFFFF' }, { pos: 1, hex: '#6A6A6A' }]);
  await gradientDrag(page, { x: SUN.x, y: SUN.y - 100 }, { x: SUN.x, y: SUN.y + 100 });
  await deselect(page);
  await filter(page, 'Halftone...', { 'Dot Size': 5 });
  await blendMode(page, 'multiply');
  await closeEffects(page);
  await shot(page, '35-sun-dotwork');
}

export async function s36(page: Page): Promise<void> {
  // A hard-edged shadow facet on each rock's right flank, so the undersides
  // read as cut stone rather than a flat wedge.
  for (const d of DESIGNS) {
    await selectLayer(page, `Isle ${d.n}`);
    const g = isleGeometry(d.c, d.n);
    const br = iso(g.o, ISLE_W, 0, 0), bf = iso(g.o, ISLE_W, ISLE_W, 0);
    await lassoSelect(page, [lerp(bf, br, 0.12), lerp(bf, br, 0.58), lerp(g.apex, br, 0.4), lerp(g.apex, bf, 0.25)]);
    if (d.n === 1) await shot(page, '36a-facet-marquee');
    await setFg(page, '#3D3733');
    await fill(page);
    await deselect(page);
  }
  await selectLayer(page, 'ZEN ENCLAVES');
  await newLayer(page, 'Paper Grain');
  await setFg(page, '#808080');
  await fill(page);
  await filter(page, 'Add Noise...', { Amount: 20 }, ['Mono', 'Gaussian']);
  await blendMode(page, 'overlay');
  await closeEffects(page);
  await layerOpacity(page, 30);
  await shot(page, '36-finishing');
}

export async function s37(page: Page, path = 'e2e/screenshots/zen-enclaves-flash-sheet.png'): Promise<void> {
  await deselect(page);
  await shot(page, '37-finished-in-editor');
  await exportPng(page, path);
}

async function layerCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __editorStore: { getState: () => { document: { layers: unknown[] } } } }).__editorStore.getState().document.layers.length);
}

/** Cmd+V, then wait for the pasted layer to exist before touching it. */
export async function pasteAsNewLayer(page: Page): Promise<void> {
  const before = await layerCount(page);
  for (let attempt = 0; attempt < 2; attempt++) {
    await pressKey(page, 'Control+v');
    for (let i = 0; i < 25; i++) {
      if ((await layerCount(page)) > before) {
        await pause(page, 300);
        return;
      }
      await pause(page, 200);
    }
    console.log(`paste produced no layer (attempt ${attempt + 1})`);
  }
  throw new Error('paste produced no layer');
}
