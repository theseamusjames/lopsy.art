import type { Page } from '@playwright/test';

// The mod-click that selects a layer (or its alpha) is ⌘ on macOS and Ctrl
// elsewhere. On macOS a bare Ctrl-click is a secondary (right) click, so it
// never reaches the panel's onClick — use Meta there instead.
const isMac = process.platform === 'darwin';
const modClick = (m: 'Control'): 'Control' | 'Meta' => (isMac ? 'Meta' : m);

// Shared UI-driving helpers for the Cosmic X-Ray tattoo flash composition.
// Every mutation goes through the real UI (menus, tools, panels, mouse and
// keyboard). The only store reads are for coordinate projection and ids.

export const SHOT_DIR = 'e2e/screenshots';
export const DOC_W = 1200;
export const DOC_H = 1540;

export interface Pt { x: number; y: number }
export interface Stop { pos: number; hex: string; a?: number }

let shotDir = process.env.COSMIC_SHOT_DIR ?? SHOT_DIR;
export function setShotDir(dir: string): void { shotDir = dir; }

export async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${shotDir}/cosmic-xray-${name}.png` });
}

export async function pause(page: Page, ms = 150): Promise<void> {
  await page.waitForTimeout(ms);
}

// ---------------------------------------------------------------------------
// Coordinates
// ---------------------------------------------------------------------------

export async function docToScreen(page: Page, x: number, y: number): Promise<Pt> {
  return page.evaluate(({ x, y }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { width: number; height: number }; viewport: { zoom: number; panX: number; panY: number } };
    };
    const s = store.getState();
    const c = document.querySelector('[data-testid="canvas-container"]');
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return {
      x: r.left + (x - s.document.width / 2) * s.viewport.zoom + s.viewport.panX + r.width / 2,
      y: r.top + (y - s.document.height / 2) * s.viewport.zoom + s.viewport.panY + r.height / 2,
    };
  }, { x, y });
}

export async function zoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { viewport: { zoom: number } };
    };
    return store.getState().viewport.zoom;
  });
}

export async function dragDoc(page: Page, pts: Pt[], opts: { steps?: number; modifiers?: string[] } = {}): Promise<void> {
  const first = pts[0];
  if (!first) return;
  const s0 = await docToScreen(page, first.x, first.y);
  for (const m of opts.modifiers ?? []) await page.keyboard.down(m);
  await page.mouse.move(s0.x, s0.y);
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    const s = await docToScreen(page, p.x, p.y);
    await page.mouse.move(s.x, s.y, { steps: opts.steps ?? 1 });
  }
  await page.mouse.up();
  for (const m of opts.modifiers ?? []) await page.keyboard.up(m);
  await pause(page, 120);
}

export async function clickDoc(page: Page, x: number, y: number): Promise<void> {
  const s = await docToScreen(page, x, y);
  await page.mouse.click(s.x, s.y);
  await pause(page, 120);
}

// ---------------------------------------------------------------------------
// Menus & tools
// ---------------------------------------------------------------------------

export async function menu(page: Page, top: string, item: string, sub?: string): Promise<void> {
  const bar = page.locator('nav[aria-label="Application menu"]');
  await bar.getByRole('button', { name: top, exact: true }).click();
  const dd = page.locator(`[role="menu"][aria-label="${top}"]`);
  const it = dd.getByRole('menuitem', { name: new RegExp(`^\\s*[\\u2713]?\\s*${escapeRe(item)}`) }).first();
  if (sub) {
    await it.hover();
    const sm = page.locator(`[role="menu"][aria-label="${item}"]`);
    await sm.getByRole('menuitem', { name: new RegExp(`^\\s*[\\u2713]?\\s*${escapeRe(sub)}`) }).first().click();
  } else {
    await it.click();
  }
  await pause(page, 200);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SHORTCUTS: Record<string, string> = {
  move: 'v', brush: 'b', pencil: 'n', eraser: 'e', fill: 'g', eyedropper: 'i', stamp: 's',
  dodge: 'o', smudge: 'r', spray: 'j', 'marquee-rect': 'm', lasso: 'l', wand: 'w', shape: 'u',
  text: 't', crop: 'c', path: 'p',
};

export async function tool(page: Page, id: string): Promise<void> {
  const key = SHORTCUTS[id];
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  if (key) await page.keyboard.press(key);
  else await page.locator(`[data-tool-id="${id}"]`).click();
  await pause(page, 100);
}

export async function toolOption(page: Page, label: string, value: number): Promise<void> {
  const input = page.locator(`role=toolbar >> [aria-label="${label} value"]`).first();
  await input.fill(String(value));
  await input.press('Enter');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

export async function deselect(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+d');
  await pause(page, 150);
}

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
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

export async function setFg(page: Page, hex: string, alpha?: number): Promise<void> {
  const panel = page.locator('section[aria-label="Color"]');
  if (!(await panel.isVisible().catch(() => false))) {
    await page.locator('button[aria-label="Color"]').click();
  }
  const input = page.locator('[aria-label="Hex color value"]');
  if (!(await input.isVisible().catch(() => false))) {
    const btn = page.locator('button[aria-label="Color panel"]');
    if (await btn.isVisible().catch(() => false)) await btn.click();
  }
  await input.fill(hex.replace('#', ''));
  await input.press('Enter');
  if (alpha !== undefined) {
    const a = page.locator('[aria-label="A value"]');
    if (await a.isVisible().catch(() => false)) {
      await a.fill(String(Math.round(alpha * 100)));
      await a.press('Enter');
    }
  }
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/** Drive a shared ColorPicker (SV square + hue strip + alpha strip) to a hex. */
async function pickColorIn(page: Page, scope: ReturnType<Page['locator']>, hex: string, alpha = 1): Promise<void> {
  const { r, g, b } = hexToRgb(hex);
  const { h, s, v } = rgbToHsv(r, g, b);
  const hue = scope.locator('[aria-label="Hue"]');
  const sv = scope.locator('[aria-label="Saturation and brightness"]');
  const al = scope.locator('[aria-label="Opacity"]');
  const hb = await hue.boundingBox();
  if (hb && s > 0.001) {
    await page.mouse.click(hb.x + Math.min(0.999, h / 360) * hb.width, hb.y + hb.height / 2);
  }
  const sb = await sv.boundingBox();
  if (sb) {
    await page.mouse.click(sb.x + s * (sb.width - 0.01), sb.y + (1 - v) * (sb.height - 0.01));
  }
  const ab = await al.boundingBox();
  if (ab) {
    const x = alpha >= 1 ? ab.x + ab.width - 0.5 : ab.x + alpha * ab.width;
    await page.mouse.click(x, ab.y + ab.height / 2);
  }
}

// ---------------------------------------------------------------------------
// Gradient tool
// ---------------------------------------------------------------------------

export async function setGradient(page: Page, type: 'linear' | 'radial', stops: Stop[]): Promise<void> {
  await tool(page, 'gradient');
  await page.locator('[aria-labelledby="gradient-type-label"]').selectOption(type);
  await page.getByTestId('gradient-advanced-btn').click();
  const dlg = page.locator('[role="dialog"][aria-label="Gradient Editor"]');
  await dlg.waitFor({ state: 'visible' });
  // Reduce to exactly two stops first.
  for (let guard = 0; guard < 20; guard++) {
    const n = await dlg.locator('[data-testid^="gradient-stop-"]').count();
    if (n <= 2) break;
    await dlg.getByTestId('gradient-stop-1').click();
    await dlg.getByTestId('gradient-delete-stop').click();
  }
  const bar = dlg.getByTestId('gradient-bar');
  const bb = (await bar.boundingBox())!;
  // Move the two end stops to 0 and 1.
  const handle0 = dlg.getByTestId('gradient-stop-0');
  const h0 = (await handle0.boundingBox())!;
  await page.mouse.move(h0.x + h0.width / 2, h0.y + h0.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x - 20, h0.y + h0.height / 2, { steps: 3 });
  await page.mouse.up();
  const handle1 = dlg.getByTestId('gradient-stop-1');
  const h1 = (await handle1.boundingBox())!;
  await page.mouse.move(h1.x + h1.width / 2, h1.y + h1.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width + 20, h1.y + h1.height / 2, { steps: 3 });
  await page.mouse.up();
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  // Colour the two ends.
  await dlg.getByTestId('gradient-stop-0').click();
  await pickColorIn(page, dlg, sorted[0]!.hex, sorted[0]!.a ?? 1);
  await dlg.getByTestId('gradient-stop-1').click();
  await pickColorIn(page, dlg, sorted[sorted.length - 1]!.hex, sorted[sorted.length - 1]!.a ?? 1);
  // Insert middle stops by clicking the bar at their position (the new stop
  // becomes selected), then colour them.
  for (const st of sorted.slice(1, -1)) {
    await page.mouse.click(bb.x + st.pos * bb.width, bb.y + bb.height / 2);
    await pause(page, 60);
    await pickColorIn(page, dlg, st.hex, st.a ?? 1);
  }
  await dlg.getByRole('button', { name: 'Done' }).click();
  await pause(page, 100);
}

export async function gradientDrag(page: Page, from: Pt, to: Pt): Promise<void> {
  await tool(page, 'gradient');
  await dragDoc(page, [from, to], { steps: 8 });
  await pause(page, 250);
}

// ---------------------------------------------------------------------------
// Selections
// ---------------------------------------------------------------------------

export async function rectSelect(page: Page, x: number, y: number, w: number, h: number): Promise<void> {
  // A press inside an existing selection drags that outline instead of
  // starting a new one, so clear any selection first.
  await deselect(page);
  await tool(page, 'marquee-rect');
  await dragDoc(page, [{ x, y }, { x: x + w, y: y + h }], { steps: 6 });
}

export async function ellipseSelect(page: Page, cx: number, cy: number, rx: number, ry: number): Promise<void> {
  await deselect(page);
  await tool(page, 'marquee-ellipse');
  await dragDoc(page, [{ x: cx - rx, y: cy - ry }, { x: cx + rx, y: cy + ry }], { steps: 6 });
}

export async function lassoSelect(page: Page, pts: Pt[]): Promise<void> {
  await deselect(page);
  await tool(page, 'lasso');
  const closed = [...pts, pts[0]!];
  await dragDoc(page, closed);
  await pause(page, 150);
}

export async function fill(page: Page): Promise<void> {
  await menu(page, 'Edit', 'Fill');
  await pause(page, 150);
}

export async function fillRect(page: Page, x: number, y: number, w: number, h: number, hex: string): Promise<void> {
  await setFg(page, hex);
  await rectSelect(page, x, y, w, h);
  await fill(page);
  await deselect(page);
}

export async function fillEllipse(page: Page, cx: number, cy: number, rx: number, ry: number, hex: string): Promise<void> {
  await setFg(page, hex);
  await ellipseSelect(page, cx, cy, rx, ry);
  await fill(page);
  await deselect(page);
}

export async function fillPoly(page: Page, pts: Pt[], hex: string): Promise<void> {
  await setFg(page, hex);
  await lassoSelect(page, pts);
  await fill(page);
  await deselect(page);
}

// ---------------------------------------------------------------------------
// Geometry generators
// ---------------------------------------------------------------------------

export function ellipsePts(cx: number, cy: number, rx: number, ry: number, n = 48, rot = 0): Pt[] {
  const out: Pt[] = [];
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const ex = Math.cos(t) * rx, ey = Math.sin(t) * ry;
    out.push({ x: cx + ex * c - ey * s, y: cy + ex * s + ey * c });
  }
  return out;
}

export function starPts(cx: number, cy: number, outer: number, inner: number, points: number, rot = -Math.PI / 2): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const t = rot + (i * Math.PI) / points;
    out.push({ x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r });
  }
  return out;
}

/** Four-point sparkle with concave, pinched sides (a softened astroid). */
export function sparklePts(cx: number, cy: number, r: number, p = 2.6): Pt[] {
  const out: Pt[] = [];
  const n = 72;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    out.push({ x: cx + Math.sign(c) * Math.pow(Math.abs(c), p) * r, y: cy + Math.sign(s) * Math.pow(Math.abs(s), p) * r });
  }
  return out;
}

export function heartPts(cx: number, cy: number, scale: number, n = 72): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    out.push({ x: cx + x * scale, y: cy - y * scale });
  }
  return out;
}

export function bezierPts(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 24): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

export async function activeLayerId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string } };
    };
    return store.getState().document.activeLayerId;
  });
}

export async function layerIdByName(page: Page, name: string): Promise<string> {
  const id = await page.evaluate((n) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; name: string }> } };
    };
    return store.getState().document.layers.find((l) => l.name === n)?.id ?? '';
  }, name);
  if (!id) throw new Error(`No layer named ${name}`);
  return id;
}

export async function renameActive(page: Page, name: string): Promise<void> {
  const id = await activeLayerId(page);
  const row = page.locator(`[data-layer-id="${id}"]`);
  await row.scrollIntoViewIfNeeded();
  const label = row.locator('[class*="_name_"]').first();
  await label.dblclick();
  const input = row.locator('input[aria-label="Layer name"]');
  await input.fill(name);
  await input.press('Enter');
  await pause(page, 100);
}

export async function newLayer(page: Page, name: string): Promise<string> {
  await page.locator('[aria-label="Add Layer"]').click();
  await pause(page, 150);
  await renameActive(page, name);
  return activeLayerId(page);
}

export async function selectLayer(page: Page, name: string, modifiers: Array<'Shift' | 'Control'> = []): Promise<string> {
  const id = await layerIdByName(page, name);
  const row = page.locator(`[data-layer-id="${id}"]`);
  await row.scrollIntoViewIfNeeded();
  const label = row.locator('[class*="_name_"]').first();
  await label.click({ modifiers: modifiers.map((m) => (m === 'Control' ? modClick(m) : m)) });
  await pause(page, 120);
  return id;
}

export async function openEffects(page: Page): Promise<void> {
  const drawer = page.getByTestId('effects-drawer');
  if (await drawer.isVisible().catch(() => false)) return;
  const id = await activeLayerId(page);
  const row = page.locator(`[data-layer-id="${id}"]`);
  await row.locator('button[aria-label*="effects"]').click();
  await pause(page, 200);
}

export async function closeEffects(page: Page): Promise<void> {
  const close = page.locator('[aria-label="Close effects"]');
  if (await close.isVisible().catch(() => false)) await close.click();
  await pause(page, 80);
}

export async function effect(page: Page, name: string, settings: Record<string, number>, color?: { label: string; hex: string }): Promise<void> {
  await openEffects(page);
  const drawer = page.getByTestId('effects-drawer');
  const cb = drawer.locator(`[aria-label="Enable ${name}"]`);
  if (!(await cb.isChecked())) await cb.click();
  await drawer.locator('[role="option"]').filter({ hasText: name }).click();
  for (const [label, value] of Object.entries(settings)) {
    const input = drawer.locator(`[aria-label="${label} value"]`);
    await input.fill(String(value));
    await input.press('Enter');
  }
  if (color) {
    await drawer.locator(`[aria-label="${color.label}"]`).fill(color.hex);
  }
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await pause(page, 150);
}

export async function blendMode(page: Page, mode: string): Promise<void> {
  await openEffects(page);
  await page.locator('[aria-labelledby="blend-mode-label"]').selectOption(mode);
  await pause(page, 120);
}

export async function layerOpacity(page: Page, percent: number): Promise<void> {
  const id = await activeLayerId(page);
  const row = page.locator(`[data-layer-id="${id}"]`);
  await row.locator('button[aria-label^="Opacity"]').click();
  const slider = page.locator('input[type="range"][aria-label$=" opacity"]').first();
  await slider.waitFor({ state: 'visible' });
  await slider.fill(String(percent));
  await pause(page, 100);
  await row.locator('button[aria-label^="Opacity"]').click();
  await pause(page, 100);
}

// ---------------------------------------------------------------------------
// Brush
// ---------------------------------------------------------------------------

export async function brushStroke(page: Page, pts: Pt[], steps = 2): Promise<void> {
  await dragDoc(page, pts, { steps });
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export async function filter(page: Page, item: string, params: Record<string, number> = {}, toggles: string[] = []): Promise<void> {
  await menu(page, 'Filter', item);
  const title = item.replace(/\.\.\.$/, '');
  const modal = page.locator(`[role="dialog"][aria-label="${title}"]`);
  await modal.waitFor({ state: 'visible' });
  for (const t of toggles) {
    await modal.getByRole('button', { name: t, exact: true }).click();
  }
  for (const [label, value] of Object.entries(params)) {
    const numeric = modal.locator(`[aria-label="${label} value"]`);
    if (await numeric.count()) {
      await numeric.first().fill(String(value));
      await numeric.first().press('Tab');
    } else {
      const slider = modal.locator(`text=${label}`).locator('..').locator('input[type="range"]');
      await slider.fill(String(value));
    }
  }
  await modal.getByRole('button', { name: 'Apply' }).click();
  await pause(page, 500);
}

export async function brushSettings(page: Page, settings: Record<string, number>): Promise<void> {
  const dialog = page.locator('[role="dialog"][aria-label="Brushes"]');
  if (!(await dialog.isVisible().catch(() => false))) {
    await page.locator('[aria-label="Open brush presets"]').click();
    await dialog.waitFor({ state: 'visible' });
  }
  const shapeLabels = ['Size', 'Spacing', 'Hardness', 'Opacity', 'Taper'];
  const dynamicsLabels = ['Scatter', 'Size Jitter', 'Hardness Jitter', 'Angle Jitter', 'Opacity Jitter', 'Speed Size'];
  for (const [label, value] of Object.entries(settings)) {
    const tabName = shapeLabels.includes(label) ? 'Shape' : dynamicsLabels.includes(label) ? 'Dynamics' : 'Shape';
    const tab = dialog.locator(`[role="option"]:has-text("${tabName}")`).first();
    if (!(await tab.getAttribute('aria-selected'))?.includes('true')) await tab.click();
    const input = dialog.locator(`[aria-label="${label} value"]`).first();
    await input.fill(String(value));
    await input.press('Enter');
  }
}

export async function closeBrushSettings(page: Page): Promise<void> {
  const dialog = page.locator('[role="dialog"][aria-label="Brushes"]');
  if (await dialog.isVisible().catch(() => false)) await dialog.locator('[aria-label="Close"]').first().click();
  await pause(page, 100);
}

export async function selectModify(page: Page, kind: 'Grow' | 'Shrink' | 'Feather', amount: number): Promise<void> {
  await menu(page, 'Select', `${kind}…`);
  const modal = page.locator(`[role="dialog"][aria-label="${kind} Selection"]`);
  await modal.waitFor({ state: 'visible' });
  const input = modal.locator('input[aria-label$=" value"]').first();
  await input.fill(String(amount));
  await input.press('Tab');
  await modal.getByRole('button', { name: 'Apply' }).click();
  await pause(page, 300);
}

export async function pressKey(page: Page, key: string): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(key);
  await pause(page, 200);
}

async function containerRect(page: Page): Promise<{ left: number; top: number; width: number; height: number }> {
  return page.locator('[data-testid="canvas-container"]').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
}

/** Click the top ruler to drop a vertical guide at doc x. */
export async function vGuide(page: Page, x: number): Promise<void> {
  const r = await containerRect(page);
  const p = await docToScreen(page, x, 0);
  await page.mouse.click(p.x, r.top + 10);
  await pause(page, 120);
}

/** Click the left ruler to drop a horizontal guide at doc y. */
export async function hGuide(page: Page, y: number): Promise<void> {
  const r = await containerRect(page);
  const p = await docToScreen(page, 0, y);
  await page.mouse.click(r.left + 10, p.y);
  await pause(page, 120);
}

export async function setFont(page: Page, family: string): Promise<void> {
  const trigger = page.locator('role=toolbar >> button[aria-haspopup="listbox"]').first();
  await trigger.click();
  const search = page.locator('input[aria-label="Search fonts"]');
  await search.fill(family);
  await pause(page, 400);
  const opt = page.locator('[role="listbox"] [role="option"]').filter({ hasText: new RegExp(`^${escapeRe(family)}$`) }).first();
  await opt.click();
  await pause(page, 1500);
}

export async function layerBounds(page: Page, name: string): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate((n) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ name: string; x: number; y: number; width: number; height: number }> } };
    };
    const l = store.getState().document.layers.find((x) => x.name === n)!;
    return { x: l.x, y: l.y, width: l.width, height: l.height };
  }, name);
}

/** Opaque-pixel bounds of a layer in document space (reads the GPU texture). */
export async function contentBounds(page: Page, name: string): Promise<{ x0: number; y0: number; x1: number; y1: number } | null> {
  const id = await layerIdByName(page, name);
  return page.evaluate(async (id) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const l = store.getState().document.layers.find((x) => x.id === id)!;
    const fn = (window as unknown as Record<string, unknown>).__readLayerPixels as (id: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const r = await fn(id);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) {
      if (r.pixels[(y * r.width + x) * 4 + 3]! > 100) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x0 === Infinity) return null;
    return { x0: x0 + l.x, y0: y0 + l.y, x1: x1 + l.x, y1: y1 + l.y };
  }, id);
}

/** Drag the active layer by (dx, dy) document px with the Move tool. */
export async function moveBy(page: Page, from: Pt, dx: number, dy: number): Promise<void> {
  await tool(page, 'move');
  await dragDoc(page, [from, { x: from.x + dx / 2, y: from.y + dy / 2 }, { x: from.x + dx, y: from.y + dy }], { steps: 6 });
  await pause(page, 300);
}

/** Nudge the active layer with the arrow keys (Shift = 10 px). */
export async function nudge(page: Page, dx: number, dy: number): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const step = async (key: string, n: number) => {
    const tens = Math.floor(n / 10);
    for (let i = 0; i < tens; i++) await page.keyboard.press(`Shift+${key}`);
    for (let i = 0; i < n % 10; i++) await page.keyboard.press(key);
  };
  await step(dx >= 0 ? 'ArrowRight' : 'ArrowLeft', Math.abs(Math.round(dx)));
  await step(dy >= 0 ? 'ArrowDown' : 'ArrowUp', Math.abs(Math.round(dy)));
  await pause(page, 300);
}

/** Centre a layer's opaque content on (cx, cy) with Move-tool arrow nudges. */
export async function centerContentOn(page: Page, name: string, cx: number, cy: number): Promise<{ x0: number; y0: number; x1: number; y1: number }> {
  await tool(page, 'move');
  for (let i = 0; i < 3; i++) {
    const b = await contentBounds(page, name);
    if (!b) throw new Error(`empty layer ${name}`);
    const dx = Math.round(cx - (b.x0 + b.x1) / 2);
    const dy = Math.round(cy - (b.y0 + b.y1) / 2);
    if (dx === 0 && dy === 0) return b;
    await nudge(page, dx, dy);
  }
  return (await contentBounds(page, name))!;
}

/** Cmd/Ctrl+click a layer thumbnail: load that layer's alpha as the selection. */
export async function selectAlpha(page: Page, name: string): Promise<void> {
  const id = await layerIdByName(page, name);
  const row = page.locator(`[data-layer-id="${id}"]`);
  await row.scrollIntoViewIfNeeded();
  await row.locator('[class*="_thumbnail_"]').first().click({ modifiers: [modClick('Control')] });
  await pause(page, 400);
}

export function tx(origin: Pt, pts: Pt[], scale = 1): Pt[] {
  return pts.map((p) => ({ x: origin.x + p.x * scale, y: origin.y + p.y * scale }));
}

/** Bake the active layer's effects into its pixels (keeps the document fast). */
export async function rasterizeStyle(page: Page): Promise<void> {
  await openEffects(page);
  await page.getByTestId('effects-drawer').getByRole('button', { name: 'Rasterize Layer Style' }).click();
  await pause(page, 600);
  await closeEffects(page);
}

/**
 * Paint a polyline with the active paint tool: click the first point, then
 * Shift+click each following point (straight-line strokes). Each click is its
 * own short gesture, so it is immune to the hold-to-smooth timer.
 */
export async function polyline(page: Page, pts: Pt[]): Promise<void> {
  const first = pts[0];
  if (!first) return;
  await clickDoc(page, first.x, first.y);
  await page.keyboard.down('Shift');
  for (const p of pts.slice(1)) {
    const s = await docToScreen(page, p.x, p.y);
    await page.mouse.click(s.x, s.y);
    await pause(page, 60);
  }
  await page.keyboard.up('Shift');
  await pause(page, 120);
}

/**
 * Rotate the active selection's pixels with the Move tool's corner rotation
 * handle. `bounds` is the selection's bounding box in document space.
 */
export async function rotateSelection(page: Page, bounds: { x0: number; y0: number; x1: number; y1: number }, degrees: number, shotName?: string): Promise<void> {
  await tool(page, 'move');
  const cx = (bounds.x0 + bounds.x1) / 2, cy = (bounds.y0 + bounds.y1) / 2;
  const h = { x: bounds.x1 + 14, y: bounds.y0 - 14 };
  const r = Math.hypot(h.x - cx, h.y - cy);
  const a0 = Math.atan2(h.y - cy, h.x - cx);
  const pts: Pt[] = [h];
  const n = 8;
  for (let i = 1; i <= n; i++) {
    const a = a0 + ((degrees * Math.PI) / 180) * (i / n);
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  const s0 = await docToScreen(page, h.x, h.y);
  await page.mouse.move(s0.x, s0.y);
  await pause(page, 150);
  await page.mouse.down();
  for (const p of pts.slice(1)) {
    const s = await docToScreen(page, p.x, p.y);
    await page.mouse.move(s.x, s.y, { steps: 2 });
  }
  await page.mouse.up();
  await pause(page, 400);
  if (shotName) await shot(page, shotName);
}

/** Drag a corner scale handle by (dx, dy); Cmd keeps it uniform. */
export async function scaleSelection(page: Page, corner: Pt, dx: number, dy: number, uniform = true, shotName?: string): Promise<void> {
  await tool(page, 'move');
  const s0 = await docToScreen(page, corner.x, corner.y);
  await page.mouse.move(s0.x, s0.y);
  await pause(page, 150);
  if (uniform) await page.keyboard.down('Meta');
  await page.mouse.down();
  // Firefox clamps pointer coordinates to the viewport and mishandles a drag
  // whose endpoint leaves it — an outward (grow) scale then collapses instead
  // of enlarging. Keep the endpoint just inside the viewport so the drag stays
  // a real scale on both engines; Chromium is unaffected (its endpoints for
  // these compositions already sit inside).
  const raw = await docToScreen(page, corner.x + dx, corner.y + dy);
  const vp = page.viewportSize();
  const s1 = vp
    ? { x: Math.min(Math.max(raw.x, 2), vp.width - 2), y: Math.min(Math.max(raw.y, 2), vp.height - 2) }
    : raw;
  await page.mouse.move(s1.x, s1.y, { steps: 10 });
  await page.mouse.up();
  if (uniform) await page.keyboard.up('Meta');
  await pause(page, 400);
  if (shotName) await shot(page, shotName);
}
