---
name: lopsy
description: >
  Create images with Lopsy (https://lopsy.art), a free, open-source image
  editor that runs entirely in the browser: layers, masks, blend modes, layer
  effects, gradients, brushes, text with Google Fonts, filters and PNG export.
  Use this when you need to make a poster, illustration, logo, cover, social
  image or any other raster artwork by driving the editor with Playwright.
---

# Making images with Lopsy

Lopsy is an image editor that runs entirely in the browser. It has no backend
and no API: there is nothing to call. You make an image the way a person does,
by operating the real UI (menus, tools, panels, mouse drags, the keyboard) in
a browser you control with Playwright, and then exporting a PNG.

This file covers everything you need to do that reliably:

1. [Setup](#setup): install Playwright, save the driver, start it.
2. [The technique](#the-technique): one long-lived page, driven one step at a time.
3. [Coordinates](#coordinates): how document pixels map to screen pixels.
4. [The driver](#the-driver): a complete, tested script with helpers for every common operation.
5. [Recipes](#recipes): how to build shapes, gradients, glows, type and texture.
6. [Behaviours that trip up agents](#behaviours-that-trip-up-agents).
7. [UI reference](#ui-reference): stable selectors, if you need something the helpers don't cover.

Related resources:

- **Feature catalog:** <https://lopsy.art/FEATURES.md>. It's long and exhaustive:
  every tool, every slider range, and known defects. Read the sections for
  the tools you plan to use before you script them.
- **Index for agents:** <https://lopsy.art/llms.txt>
- **Tutorials** (step-by-step compositions made this way): <https://lopsy.art/tutorials/>
- **Source:** <https://github.com/theseamusjames/lopsy.art>. Open issues list
  current bugs, so search them when something looks wrong.
- **Contributing:** we accept pull requests written by AI agents. If you hit a
  bug or a missing feature, you're welcome to fix it: read
  [AGENTS.md](https://github.com/theseamusjames/lopsy.art/blob/main/AGENTS.md)
  for the workflow first.

## Setup

You need Node 18+ and Playwright's Chromium.

```bash
mkdir lopsy-work && cd lopsy-work
npm init -y
npm install --save-exact playwright@1.58.2
npx playwright install chromium
```

Save [the driver](#the-driver) below as `lopsy-driver.mjs`, then start it
in the background and leave it running for the whole session:

```bash
node lopsy-driver.mjs > driver.log 2>&1 &
```

It opens <https://lopsy.art/> headless at 1600×1000 and listens on
`http://localhost:47391`. Useful environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `LOPSY_URL` | `https://lopsy.art/` | Point at a local dev server instead. |
| `DRIVER_PORT` | `47391` | Change if the port is taken. |
| `OUT_DIR` | `./lopsy-out` | Where screenshots, exports and projects are written. |
| `HEADED` | unset | `1` shows the browser window. |
| `REAL_GPU` | unset | `1` drops the SwiftShader flags. Much faster on a machine with a GPU. |

## The technique

A finished piece takes dozens to hundreds of UI operations. Don't write one
giant script and rerun it from the top every time something is off: that's
slow, and a single bad locator throws away all the work before it.

Instead, the driver keeps **one** page open and runs small JavaScript *step
files* that you POST to it. Each step is the body of an async function that
receives `page` (the Playwright page), `h` (the helpers) and `ctx` (an object
that persists between steps, for palettes, measurements and your own helper
functions). Whatever the step returns comes back as JSON.

```bash
cat > steps/01-background.js <<'EOF'
await h.newDocument(1200, 1500);
await h.selectLayer('Layer 1');
await h.renameActive('Sky');
await h.gradient('linear', [{ pos: 0, hex: '#1B2A4A' }, { pos: 1, hex: '#F2A541' }]);
await h.drag([{ x: 600, y: 0 }, { x: 600, y: 1500 }], { steps: 8 });
return await h.shot('background');
EOF
curl -s --data-binary @steps/01-background.js localhost:47391
```

Always send step files with `--data-binary @file`; `echo` and `--data`
mangle newlines. A failing step returns HTTP 500 with the stack trace and the
path of an automatic error screenshot.

The loop:

1. **Plan before you touch the editor.** Decide the concept, the document
   size, a palette of 4–8 hex colours, and the layer stack from back to
   front. Compute geometry in code (polygons, curves, grids) and keep it
   in `ctx`, so shapes line up exactly.
2. **Build in stages**, one step file per stage (background, main shapes,
   detail, type, effects, finishing). Keep each step to a few operations.
3. **Look at every screenshot** (`h.shot()` returns the path). Check that
   the step did what you intended before you send the next one. Most mistakes
   are cheap to undo (`h.key('ControlOrMeta+z')`) straight away and expensive
   to find later.
4. **Checkpoint** with `h.saveProject()` after each stage. The page can be
   reloaded or the WebGL context lost, and a `.lopsy` file can be reopened
   through **File → Open Project...**.
5. **Export** with `h.exportPng('name.png')` and look at the exported file
   itself, not only the canvas screenshot.
6. **Stop the driver** when you're done: `curl -s --data '__quit__' localhost:47391`.

## Coordinates

Every helper takes **document** coordinates: pixels of the image, with (0, 0)
at the top-left of the canvas. The driver converts them to screen
coordinates with a closed-form mapping:

- **View → Fit to Screen** sets the pan to 0 and the zoom to
  `0.9 × min(containerWidth / docWidth, containerHeight / docHeight)`.
  `h.newDocument()` and `h.fit()` run it and record the mapping.
- `screen = containerCentre + (doc − docSize / 2) × zoom`.
- **Never zoom or pan with the mouse wheel or the Hand tool**, because the
  mapping would silently go stale. If you must, call `h.fit()` afterwards.
  Also call it after **Image → Canvas Size**, **Image Size**, **Crop** or
  opening a file.
- `h.probe(x, y)` hovers a point and reads it back from the status bar's
  `X: … Y: …` readout. Use it to prove the mapping once per document.

Tool positions are rounded to whole document pixels. At 90% of a
1600×1000 window, one screen pixel is about 1–2 document pixels for a
1000–2000 px image, so precision is good. For very large documents, drags
land in coarser steps.

## The driver

Tested against lopsy.art with Playwright 1.58.2. Save it as
`lopsy-driver.mjs`.

```js
// lopsy-driver.mjs — keeps ONE Lopsy page open and runs JS step files POSTed to it.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';

const LOPSY_URL = process.env.LOPSY_URL ?? 'https://lopsy.art/';
const PORT = Number(process.env.DRIVER_PORT ?? 47391);
const OUT = process.env.OUT_DIR ?? './lopsy-out';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: process.env.HEADED !== '1',
  // A real GPU is much faster; SwiftShader makes WebGL2 work on headless/CI machines.
  args: process.env.REAL_GPU === '1' ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  acceptDownloads: true,
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on('dialog', (d) => d.accept());
await page.goto(LOPSY_URL);
await page.getByRole('dialog', { name: 'New Document' }).waitFor();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const blur = () => page.evaluate(() => document.activeElement?.blur());
let view = null; // { left, top, cx, cy, zoom, W, H } — set by h.fit()
let shotN = 0;

const h = {
  sleep, blur, OUT,

  // ---- document & view ---------------------------------------------------
  async newDocument(width, height, background = 'White') {
    let dlg = page.getByRole('dialog', { name: 'New Document' });
    if (!(await dlg.isVisible())) { await h.menu('File', 'New'); await dlg.waitFor(); }
    const unit = dlg.locator('select').first();
    await unit.selectOption({ label: 'Pixels' }).catch(() => {});
    const nums = dlg.locator('input[type="number"], input[inputmode]');
    await nums.nth(0).fill(String(width));
    await nums.nth(1).fill(String(height));
    await dlg.getByLabel(background).check();
    await dlg.getByRole('button', { name: 'Create' }).click();
    await dlg.waitFor({ state: 'hidden' });
    await sleep(500);
    return h.fit();
  },
  // View → Fit to Screen sets pan to 0 and zoom to 0.9 × the tighter axis, so
  // document → screen mapping is closed-form. Call again after anything that
  // changes the view or the canvas size.
  async fit() {
    await h.menu('View', 'Fit to Screen');
    const size = await page.locator('footer[aria-label="Status bar"]').innerText();
    const m = size.match(/(\d+)\s*x\s*(\d+)\s*px/);
    const W = Number(m[1]), H = Number(m[2]);
    const r = await page.locator('[data-testid="canvas-container"]').boundingBox();
    const zoom = Math.min(r.width / W, r.height / H) * 0.9;
    view = { left: r.x, top: r.y, cx: r.x + r.width / 2, cy: r.y + r.height / 2, zoom, W, H };
    return view;
  },
  toScreen(x, y) {
    return { x: view.cx + (x - view.W / 2) * view.zoom, y: view.cy + (y - view.H / 2) * view.zoom };
  },
  // Hover a document point and read the status bar's X/Y back — proves the mapping.
  async probe(x, y) {
    const s = h.toScreen(x, y);
    await page.mouse.move(s.x, s.y);
    await sleep(80);
    const t = await page.locator('footer[aria-label="Status bar"]').innerText();
    const m = t.match(/X:\s*(-?\d+)\s*Y:\s*(-?\d+)/);
    return { x: Number(m[1]), y: Number(m[2]) };
  },

  // ---- pointer -------------------------------------------------------------
  async click(x, y, modifiers = []) {
    const s = h.toScreen(x, y);
    for (const m of modifiers) await page.keyboard.down(m);
    await page.mouse.click(s.x, s.y);
    for (const m of modifiers) await page.keyboard.up(m);
    await sleep(120);
  },
  async drag(points, { steps = 4, modifiers = [] } = {}) {
    const s0 = h.toScreen(points[0].x, points[0].y);
    for (const m of modifiers) await page.keyboard.down(m);
    await page.mouse.move(s0.x, s0.y);
    await page.mouse.down();
    for (const p of points.slice(1)) {
      const s = h.toScreen(p.x, p.y);
      await page.mouse.move(s.x, s.y, { steps });
    }
    await page.mouse.up();
    for (const m of modifiers) await page.keyboard.up(m);
    await sleep(150);
  },
  async key(combo) { await blur(); await page.keyboard.press(combo); await sleep(150); },

  // ---- menus & tools ---------------------------------------------------------
  async menu(top, item, sub) {
    await page.locator('nav[aria-label="Application menu"]').getByRole('button', { name: top, exact: true }).click();
    const dd = page.locator(`[role="menu"][aria-label="${top}"]`);
    const it = dd.getByRole('menuitem', { name: new RegExp(`^\\s*✓?\\s*${esc(item)}`) }).first();
    if (sub) {
      await it.hover();
      await page.locator(`[role="menu"][aria-label="${item}"]`)
        .getByRole('menuitem', { name: new RegExp(`^\\s*✓?\\s*${esc(sub)}`) }).first().click();
    } else {
      await it.click();
    }
    await sleep(200);
  },
  async tool(id) { await blur(); await page.locator(`[data-tool-id="${id}"]`).click(); await sleep(120); },
  // Options-bar numeric field, e.g. h.option('Size', 40)
  async option(label, value) {
    const input = page.getByRole('toolbar').locator(`[aria-label="${label} value"]`).first();
    await input.fill(String(value));
    await input.press('Enter');
    await blur();
  },

  // ---- colour ------------------------------------------------------------------
  async fg(hex) {
    const input = page.locator('[aria-label="Hex color value"]').first();
    if (!(await input.isVisible().catch(() => false))) {
      await page.locator('button[aria-label="Color"]').first().click();
      await input.waitFor();
    }
    await input.fill(hex.replace('#', ''));
    await input.press('Enter');
    await blur();
  },

  // ---- selections & fills ----------------------------------------------------
  async deselect() { await h.key('ControlOrMeta+d'); },
  async rect(x, y, w, h_) { await h.deselect(); await h.tool('marquee-rect'); await h.drag([{ x, y }, { x: x + w, y: y + h_ }]); },
  async ellipse(cx, cy, rx, ry) { await h.deselect(); await h.tool('marquee-ellipse'); await h.drag([{ x: cx - rx, y: cy - ry }, { x: cx + rx, y: cy + ry }]); },
  async lasso(pts) { await h.deselect(); await h.tool('lasso'); await h.drag([...pts, pts[0]], { steps: 1 }); },
  // Select → Grow… / Shrink… / Feather… by `amount` px.
  async modifySelection(kind, amount) {
    await h.menu('Select', `${kind}…`);
    const dlg = page.getByRole('dialog', { name: `${kind} Selection` });
    await dlg.waitFor();
    const input = dlg.locator('input[aria-label$=" value"]').first();
    await input.fill(String(amount));
    await input.press('Tab');
    await dlg.getByRole('button', { name: 'Apply' }).click();
    await sleep(300);
  },
  async fill() { await h.menu('Edit', 'Fill'); await sleep(150); },
  async fillRect(x, y, w, h_, hex) { await h.fg(hex); await h.rect(x, y, w, h_); await h.fill(); await h.deselect(); },
  async fillEllipse(cx, cy, rx, ry, hex) { await h.fg(hex); await h.ellipse(cx, cy, rx, ry); await h.fill(); await h.deselect(); },
  async fillPoly(pts, hex) { await h.fg(hex); await h.lasso(pts); await h.fill(); await h.deselect(); },

  // ---- layers ------------------------------------------------------------------
  row(name) { return page.locator('[data-layer-id]').filter({ has: page.locator(`button[aria-label="Layer effects for ${name}"], button[aria-label="Group effects for ${name}"]`) }).first(); },
  async newLayer(name) {
    await page.getByRole('button', { name: 'Add Layer', exact: true }).click();
    await sleep(150);
    if (name) await h.renameActive(name);
  },
  async renameActive(name) {
    const row = page.locator('[data-layer-id][class*="_active_"]').first();
    await row.getByText(/.+/).first().dblclick();
    const input = page.locator('input[aria-label="Layer name"]');
    await input.fill(name);
    await input.press('Enter');
    await sleep(100);
  },
  async selectLayer(name) { const r = h.row(name); await r.scrollIntoViewIfNeeded(); await r.getByText(name, { exact: true }).click(); await sleep(120); },

  // ---- gradient ------------------------------------------------------------------
  // stops: [{ pos: 0..1, hex, a?: 0..1 }]. The gradient ignores FG/BG; its stops
  // are set in the Gradient Editor, by typing each one into its picker's hex field.
  async gradient(type, stops) {
    await h.tool('gradient');
    await page.locator('[aria-labelledby="gradient-type-label"]').selectOption(type);
    await page.getByTestId('gradient-advanced-btn').click();
    const dlg = page.getByRole('dialog', { name: 'Gradient Editor' });
    await dlg.waitFor();
    while ((await dlg.locator('[data-testid^="gradient-stop-"]').count()) > 2) {
      await dlg.getByTestId('gradient-stop-1').click();
      await dlg.getByTestId('gradient-delete-stop').click();
    }
    const bar = (await dlg.getByTestId('gradient-bar').boundingBox());
    for (const [i, x] of [[0, bar.x - 20], [1, bar.x + bar.width + 20]]) {
      const b = await dlg.getByTestId(`gradient-stop-${i}`).boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(x, b.y + b.height / 2, { steps: 3 });
      await page.mouse.up();
    }
    const sorted = [...stops].sort((a, b) => a.pos - b.pos);
    await dlg.getByTestId('gradient-stop-0').click();
    await h.pickColor(dlg, sorted[0].hex, sorted[0].a);
    await dlg.getByTestId('gradient-stop-1').click();
    await h.pickColor(dlg, sorted.at(-1).hex, sorted.at(-1).a);
    for (const st of sorted.slice(1, -1)) {
      await page.mouse.click(bar.x + st.pos * bar.width, bar.y + bar.height / 2);
      await sleep(60);
      await h.pickColor(dlg, st.hex, st.a);
    }
    await dlg.getByRole('button', { name: 'Done' }).click();
    await sleep(100);
  },
  // Sets any picker in `scope` (Gradient Editor, Gradient Map drawer, shape
  // fill/stroke popover, guide colour): type the hex, then click the alpha bar.
  async pickColor(scope, hex, alpha = 1) {
    const field = scope.locator('[aria-label="Hex color"]');
    await field.fill(hex.replace('#', ''));
    await field.press('Enter');
    const ab = await scope.getByRole('slider', { name: 'Opacity' }).boundingBox();
    await page.mouse.click(alpha >= 1 ? ab.x + ab.width - 0.5 : ab.x + alpha * ab.width, ab.y + ab.height / 2);
  },

  // ---- text ------------------------------------------------------------------------
  // Point text in the current FG colour. Click in EMPTY canvas: a click inside an
  // existing text layer's box edits that layer instead. Tab commits.
  async text(x, y, str, { font, size } = {}) {
    await h.tool('text');
    if (size) await h.option('Size', size);
    if (font) await h.font(font);
    await h.click(x, y);
    await page.keyboard.type(str);
    await page.keyboard.press('Tab');
    await sleep(300);
  },
  async font(family) {
    await page.getByRole('toolbar').locator('button[aria-haspopup="listbox"]').first().click();
    await page.getByLabel('Search fonts').fill(family);
    await sleep(400);
    await page.getByRole('option').filter({ hasText: new RegExp(`^${esc(family)}$`) }).first().click();
    await sleep(1500); // Google fonts download on first use
  },

  // ---- layer effects, blend mode, opacity -----------------------------------------
  async openEffects(name) {
    const drawer = page.getByTestId('effects-drawer');
    if (await drawer.isVisible().catch(() => false)) return drawer;
    await h.row(name).locator('button[aria-label^="Layer effects for"], button[aria-label^="Group effects for"]').click();
    await drawer.waitFor();
    return drawer;
  },
  async closeEffects() {
    const close = page.locator('[aria-label="Close effects"]');
    if (await close.isVisible().catch(() => false)) await close.click();
    await sleep(100);
  },
  // e.g. h.effect('Sun', 'Outer Glow', { Size: 40, Opacity: 60 }, { label: 'Glow color', hex: '#ffcc66' })
  async effect(layer, name, settings = {}, color) {
    const drawer = await h.openEffects(layer);
    const cb = drawer.locator(`[aria-label="Enable ${name}"]`);
    if (!(await cb.isChecked())) await cb.click();
    await drawer.getByRole('option').filter({ hasText: name }).click();
    for (const [label, value] of Object.entries(settings)) {
      const input = drawer.locator(`[aria-label="${label} value"]`).first();
      await input.fill(String(value));
      await input.press('Enter');
    }
    if (color) await drawer.locator(`[aria-label="${color.label}"]`).fill(color.hex);
    await blur();
    await h.closeEffects();
  },
  async blendMode(layer, mode) {
    await h.openEffects(layer);
    await page.locator('[aria-labelledby="blend-mode-label"]').selectOption({ label: mode });
    await h.closeEffects();
  },
  async opacity(layer, percent) {
    const btn = h.row(layer).locator('button[aria-label^="Opacity"]');
    await btn.click();
    const slider = page.locator(`input[type="range"][aria-label="${layer} opacity"]`);
    const b = await slider.boundingBox();
    await page.mouse.click(b.x + 8 + (b.width - 16) * percent / 100, b.y + b.height / 2);
    await btn.click();
    await sleep(100);
  },

  // ---- filters ---------------------------------------------------------------------
  // h.filter('Gaussian Blur...', { Radius: 12 }). Values are typed then Tabbed:
  // Enter inside a filter dialog applies it immediately.
  async filter(item, params = {}, toggles = []) {
    await h.menu('Filter', item);
    const dlg = page.getByRole('dialog', { name: item.replace(/\.\.\.$/, '') });
    await dlg.waitFor();
    for (const t of toggles) await dlg.getByRole('button', { name: t, exact: true }).click();
    for (const [label, value] of Object.entries(params)) {
      const input = dlg.locator(`[aria-label="${label} value"]`).first();
      await input.fill(String(value));
      await input.press('Tab');
    }
    await dlg.getByRole('button', { name: 'Apply' }).click();
    await dlg.waitFor({ state: 'hidden', timeout: 120000 });
    await sleep(300);
  },

  // ---- transforms (Move tool + the handles of the current selection) ---------------
  // Select the pixels first (h.rect / h.ellipse / h.lasso around them), then:
  // rotate by dragging the rotation handle 20 doc px outside the top-left corner.
  // A text layer needs no selection: pass its line box (see Rotating and scaling).
  async rotate(sel, degrees) {
    await h.tool('move');
    const cx = (sel.x0 + sel.x1) / 2, cy = (sel.y0 + sel.y1) / 2;
    const start = { x: sel.x0 - 20, y: sel.y0 - 20 };
    const r = Math.hypot(start.x - cx, start.y - cy), a0 = Math.atan2(start.y - cy, start.x - cx);
    const pts = [start];
    for (let i = 1; i <= 8; i++) {
      const a = a0 + (degrees * Math.PI / 180) * (i / 8);
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    await h.drag(pts, { steps: 2 });
  },
  // Drag a corner scale handle by (dx, dy). uniform holds Meta (Cmd), which locks the aspect ratio.
  async scale(corner, dx, dy, uniform = true) {
    await h.tool('move');
    await h.drag([corner, { x: corner.x + dx, y: corner.y + dy }], { steps: 10, modifiers: uniform ? ['Meta'] : [] });
  },

  // ---- output --------------------------------------------------------------------
  async shot(label = '') {
    // Park the pointer on the status bar so hover previews (ruler guides, brush
    // cursors) stay out of the picture.
    const bar = await page.locator('footer[aria-label="Status bar"]').boundingBox().catch(() => null);
    if (bar) await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
    await sleep(250);
    const path = `${OUT}/${String(++shotN).padStart(3, '0')}${label ? '-' + label : ''}.png`;
    await page.screenshot({ path });
    return path;
  },
  async exportPng(name = 'final.png') {
    const dl = page.waitForEvent('download', { timeout: 120000 });
    await h.menu('File', 'Quick Export PNG');
    const path = `${OUT}/${name}`;
    await (await dl).saveAs(path);
    return path;
  },
  async saveProject(name = 'checkpoint.lopsy') {
    const dl = page.waitForEvent('download', { timeout: 120000 });
    await h.menu('File', 'Save Project');
    const path = `${OUT}/${name}`;
    await (await dl).saveAs(path);
    return path;
  },
};

const ctx = {}; // survives between steps: stash palettes, helper functions, measurements
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  if (body.trim() === '__quit__') { res.end('bye\n'); await browser.close(); process.exit(0); }
  try {
    const result = await new AsyncFunction('page', 'h', 'ctx', body)(page, h, ctx);
    res.end(JSON.stringify(result ?? null) + '\n');
  } catch (err) {
    const path = await h.shot('error').catch(() => '');
    res.statusCode = 500;
    res.end(`${err.stack ?? err}\nscreenshot: ${path}\n`);
  }
}).listen(PORT, () => console.log(`lopsy driver on http://localhost:${PORT} → ${LOPSY_URL}`));
```

A complete first step, which draws a sunset poster in about fifteen seconds:

```js
await h.newDocument(1200, 800);
await h.selectLayer('Layer 1');
await h.renameActive('Sky');
await h.gradient('linear', [
  { pos: 0, hex: '#1B2A4A' }, { pos: 0.6, hex: '#C8553D' }, { pos: 1, hex: '#F2A541' },
]);
await h.drag([{ x: 600, y: 0 }, { x: 600, y: 800 }], { steps: 8 });

await h.newLayer('Sun');
await h.fillEllipse(600, 470, 180, 180, '#FFE8A3');
await h.effect('Sun', 'Outer Glow', { Size: 60, Opacity: 70 }, { label: 'Glow color', hex: '#ffb347' });

await h.newLayer('Mountains');
await h.fillPoly([
  { x: 0, y: 800 }, { x: 0, y: 560 }, { x: 260, y: 380 }, { x: 480, y: 600 },
  { x: 760, y: 330 }, { x: 1200, y: 640 }, { x: 1200, y: 800 },
], '#0E1628');

await h.newLayer('Haze');
await h.fillRect(0, 500, 1200, 120, '#FFFFFF');
await h.filter('Gaussian Blur...', { Radius: 40 });
await h.blendMode('Haze', 'Soft Light');

await h.fg('#F7F1E3');
await h.text(80, 90, 'EVENING', { font: 'Bebas Neue', size: 140 });

return { shot: await h.shot('scene'), png: await h.exportPng('evening.png') };
```

## Recipes

**Flat, crisp shapes: select, then fill.** Selection plus **Edit → Fill**
is the most dependable primitive in the editor. `h.fillRect`,
`h.fillEllipse` and `h.fillPoly` each set the foreground colour, make the
selection, fill it and deselect. Generate polygon points in code: stars,
waves, isometric faces, letterforms, hand-tuned silhouettes. A 48–72 point
polygon reads as a smooth curve. Fill on a fresh layer per element, so each
one can be moved, recoloured or given effects later.

**Soft shapes and light.** Feather the selection before filling
(`h.modifySelection('Feather', 40)`; the engine caps feather at 63 px), or
fill hard and then run `h.filter('Gaussian Blur...', { Radius: 30 })` on
that layer. Put glows and haze on their own layers with a blend mode:
`Screen` or `Add` for light, `Multiply` for shade, `Overlay` or
`Soft Light` for tint.

**Rings and outlines.** Fill a shape, `h.modifySelection('Shrink', n)`, then
`h.key('Delete')` to clear the inside. Or use the **Stroke** layer effect.

**Gradients.** `h.gradient(type, stops)` loads the stops, and a drag with
the Gradient tool paints them. Linear runs along the drag. Radial is
centred on the drag's start, with the drag length as its radius. A gradient
composites over what's already on the layer, across the whole layer unless
there's a selection, so marquee first to paint a gradient into a shape.
Transparent stops (`a: 0`) let the layer show through.

**Brush work.** `h.tool('brush')`, `h.option('Size', 8)`, set `h.fg()`,
then `h.drag(points, { steps: 3 })`. Denser points give smoother strokes.
**Shift-click** paints a straight line from the previous dab:
`h.click(x, y)` then `h.click(x2, y2, ['Shift'])`. The Pencil (`pencil`)
gives aliased, pixel-art lines. Spray, Smudge, Dodge/Burn, Sponge and Clone
Stamp work the same way. See FEATURES.md for their options.

**Type.** `h.text(x, y, 'TITLE', { font, size })` makes point text in the
foreground colour at (x, y), the top-left of the line box. The glyph ink
starts noticeably lower than y. Any Google Font can be picked by exact family
name. Wait until the font has downloaded before judging a screenshot: the
first render can show the fallback. The layer is named after its text (first
16 characters). To recolour text later, click the options bar's
`[aria-label="Text color"]` swatch and type a hex into the picker's
`[aria-label="Hex color"]` field: with a text layer selected it recolours
the whole layer; while editing it recolours the selected characters only
(select them with Shift+arrows first). A multi-coloured selection shows
"–". Text stays editable, but pixel tools, filters, Image →
Flip and masks refuse it until you click **Rasterize Layer**. That button appears in the
Layers panel toolbar when a text layer is active.

**Layer effects.** `h.effect(layer, name, settings, color)` with `name` one
of `Drop Shadow`, `Outer Glow`, `Inner Glow`, `Stroke`, `Color Overlay`.
Settings are keyed by the slider label (`Size`, `Opacity`, `Blur`,
`Offset X`, `Offset Y`, `Width`...). Colour labels are `Shadow color`,
`Glow color`, `Stroke color` and `Overlay color`.

**Blend modes and opacity.** `h.blendMode(layer, 'Multiply')` and
`h.opacity(layer, 60)`. Mode names are as they appear in the list:
`Normal`, `Multiply`, `Screen`, `Overlay`, `Soft Light`, `Hard Light`,
`Color Dodge`, `Color Burn`, `Darken`, `Lighten`, `Difference`, `Exclusion`,
`Hue`, `Saturation`, `Color`, `Luminosity`, and more.

**Filters.** `h.filter('Name...', { 'Slider label': value }, ['Toggle'])`
applies to the active layer, or to the selection if there is one. Useful for
illustration: Add Noise (grain), Halftone, Pixelate, Posterize, Threshold,
Oil Paint, Clouds / Fibers / Smoke / Sunburst (they render texture onto the
layer), Motion Blur, Radial Blur, Lens Distortion, Chromatic Aberration,
Kaleidoscope, Voronoi. `Invert`, `Desaturate` and `Find Edges` apply
straight from the menu with no dialog: use `h.menu('Filter', 'Invert')`.
**Layer → Adjustment Layer…** opens non-destructive adjustments (curves,
levels, hue/saturation, colour balance, gradient map, and more) on a group.

**Masks.** With the layer active, click `Add Mask` in the Layers panel
toolbar, then its `Edit mask for <name>` thumbnail. In mask edit mode the
Brush and Pencil always **hide** (paint black) and the Eraser always
**reveals**, whatever the foreground colour. The Gradient and a
selection + Fill also work on the mask.

**Clipping texture to a shape.** Load the shape as a selection
(Ctrl/Cmd-click its layer thumbnail), switch to the texture layer,
`h.menu('Select', 'Inverse')` and `h.key('Delete')`.

**Moving things.** Activate the layer (`h.selectLayer`), `h.tool('move')`,
then drag from a point on its pixels: `h.drag([from, to], { steps: 6 })`.
Arrow keys nudge by 1 px and Shift+arrows by 10 px, but prefer a drag for
long distances. **Align** buttons on the Move tool's options bar align the
active layer to the canvas.

**Rotating and scaling.** On a pixel layer, transforms act on the
*selection*. Marquee around the pixels, then `h.rotate({ x0, y0, x1, y1 },
degrees)` (positive is clockwise) or `h.scale(corner, dx, dy)`, and **commit
with `h.deselect()`**. Do rotations and scales last on a pixel layer, and
never drag inside a live rotated box, because that moves or resets it.
Move-tool options also offer Flip, Rotate 90° and Mesh Warp. **Several layers at once:** with no marquee
(`h.deselect()`), select them in the Layers panel (click the top row,
Shift+click the bottom one, or select their group); the Move tool's handles
then frame the union of their content, and `h.rotate(box, degrees)` /
`h.scale(corner, dx, dy)` with that box turn or scale all of them about its
centre in one undo step. Commit with `h.deselect()` as usual. Text layers
among them keep the rotation or scale live (later text edits keep it), but
Distort / Perspective corner drags are refused when text is selected, and so
is any box transform holding text on a path.

**Text transforms stay live.** With the Move tool and a text layer active,
handles appear around the text's *line box* with no selection: its top-left
is the (x, y) you typed at and it is about 1.4 × size tall. Pass that box to
`h.rotate` (`x1` is where the text ends; it turns about the box centre) or
grab its corners with `h.scale`. Rotate, scale, flip and Free / Skew all keep
the text editable, and later Size or font changes keep the transform, so you
can transform text at any point. A selection over only part of a text layer
is refused; Rasterize Layer first for that.

**Duplicating.** `h.menu('Layer', 'Duplicate Layer')` makes `<name> copy`
**directly on top of the original** (same position) and selects only the
copy, so you can move it where you want it straight away. For repeated
elements, it's usually simpler to fill each one in place from computed
geometry.

**Groups.** Click `New Group` in the Layers panel toolbar and add layers
while a layer inside it is active. A new layer is always inserted directly
above the active layer, and inside the group if the active layer is a group.
Group effects and adjustment layers apply to everything inside the group.

**Guides and grid.** **View → Show Grid** turns snapping on the first time,
which quantizes marquee and Shape drags (a shape's centre and corner both
snap, so its edges land on grid lines). Untick **Snap** in the options bar before
drawing thin or precise shapes; it then stays off when you hide and show the
grid again. A single click on a ruler drops a guide (Cmd/Ctrl-click drops
it on the nearest half, third, quarter… of the canvas). Marquee edges that
end within 8 screen px of a guide snap onto it, and so do Shape drags; turn this off with
**View → Snap to Guides** if you need an edge just beside a guide.

## Behaviours that trip up agents

These are by design, and the helpers already handle most of them:

- **Shift adds to a selection, Alt subtracts, Shift+Alt intersects.** This
  works with the marquee, ellipse, lasso, magnetic lasso and Magic Wand. The
  `h.rect` / `h.ellipse` / `h.lasso` helpers deselect first, so build a
  multi-part selection with the tool and a modifier instead. For example,
  `await h.tool('lasso'); await h.drag([...tri2, tri2[0]], { steps: 1, modifiers: ['Shift'] });`
  after `h.lasso(tri1)`, then one `h.fill()` fills both. Each combine is one
  undo step.
- **A plain marquee drag that starts inside an existing selection moves the
  outline** instead of making a new one. Deselect first (`h.rect` does), or
  hold Shift / Alt to combine.
- **Blur before pressing keys.** Focus stays on the last control you
  clicked. A focused button activates again on Enter, and a focused dropdown
  keeps the arrow keys. `h.key()` and `h.tool()` blur first. Do the same in
  your own code (`await h.blur()`).
- **Enter inside a filter dialog applies the filter.** Commit typed values
  with Tab, as `h.filter` does.
- **Text clicks.** A text-tool click inside an existing text layer's box
  edits that layer (and loads its font and size) instead of creating a new
  one. Create new text in empty canvas and move it afterwards. Tab commits,
  Escape cancels, and plain Enter inserts a newline. Changing font or size
  with a text layer active restyles *that* layer, so set them before you
  click.
- **`Cmd+A` selects the canvas, not the layers.** It selects every layer
  only while keyboard focus is inside the Layers panel, which `h.blur()`
  clears. While editing text it selects the text.
- **Escape** cancels text editing and commits a live transform. **`Cmd+D`**
  (the key, not the Select menu item) deselects and commits a transform.
- **Menus close by clicking their title again**, not with Escape.
- **Gradient stops ignore the foreground and background colours.** Set them
  in the Gradient Editor (`h.gradient`).
- **The undo history holds 50 steps.** Save projects as checkpoints instead
  of relying on deep undo.
- **Headless rendering is software WebGL (SwiftShader), and it's slow.**
  Filters, blurs and effects on large canvases can take tens of seconds.
  Keep documents around 1000–2000 px on the long side, keep the default 15 s
  locator timeout, give filter dialogs up to 2 minutes, and use
  `REAL_GPU=1` when the machine has a GPU. Many live layer effects slow every
  later operation down. Once a layer's look is final, bake it with
  **Rasterize Layer Style** in its effects drawer.
- **Colours look more saturated than their hex values.** On a Display P3
  capable setup the canvas and exported PNGs are P3-tagged. That's expected,
  not a bug.
- **Something that looks like a bug may be one.** Search
  <https://github.com/theseamusjames/lopsy.art/issues> for workarounds.
  FEATURES.md also documents known defects inline, marked "Known defect".

## UI reference

Stable hooks for anything the helpers don't cover. Prefer roles and labels:
CSS class names are hashed in production.

| Thing | Selector |
| --- | --- |
| Menu bar | `nav[aria-label="Application menu"]`, where each top-level menu is a `button` with the menu name |
| Open menu | `[role="menu"][aria-label="<Menu>"]` with `role="menuitem"` entries, and submenus as `[role="menu"][aria-label="<Item>"]` |
| Tools | `[data-tool-id="…"]`: `move`, `marquee-rect`, `marquee-ellipse`, `lasso`, `lasso-magnetic`, `wand`, `quick-select`, `brush`, `pencil`, `spray`, `eraser`, `fill`, `gradient`, `stamp`, `healing`, `dodge`, `sponge`, `smudge`, `eyedropper`, `shape`, `text`, `path`, `crop` |
| Options bar | `role="toolbar"`, with numeric fields as `[aria-label="<Label> value"]` |
| Foreground colour | `[aria-label="Hex color value"]` in the Color panel (toggle the panel with `button[aria-label="Color"]`) |
| Colour pickers | `role="slider"` named `Hue`, `Saturation and brightness` and `Opacity`, plus a hex field `[aria-label="Hex color"]` (type 3 or 6 digits, press Enter). The Color panel's own field is `Hex color value` |
| Layers panel buttons | `Add Layer`, `New Group`, `Duplicate Layer`, `Add Mask`, `Rasterize Layer`, `Delete Layer` (by accessible name) |
| Layer row | `[data-layer-id]`, identified by its `button[aria-label="Layer effects for <name>"]`; the active row's class contains `_active_` |
| Row controls | `Hide layer` / `Show layer`, `Lock layer`, `Opacity N% for <name>` (opens a `<name> opacity` range), `Drag to reorder <name>`, `Edit mask for <name>` |
| Rename | Double-click the row's name, then fill `input[aria-label="Layer name"]` and press Enter |
| Effects drawer | `[data-testid="effects-drawer"]`, with checkboxes `Enable <Effect>`, blend mode `[aria-labelledby="blend-mode-label"]`, close button `Close effects` |
| Dialogs | `role="dialog"` named after their title: `New Document`, `Gaussian Blur`, `Gradient Editor`, `Feather Selection`... |
| Fonts | The options-bar `button[aria-haspopup="listbox"]`, then `Search fonts` and a `role="option"` |
| Text colour | The options-bar `[aria-label="Text color"]` swatch (`data-mixed="true"` and "–" when the text holds several colours) opens `role="dialog"` `Text color picker` |
| Canvas | `[data-testid="canvas-container"]` |
| Status bar | `footer[aria-label="Status bar"]`, showing zoom %, cursor `X: Y:` and document size |

Keyboard shortcuts use `ControlOrMeta` in Playwright, so they work on every
platform. The common ones are `+z` undo, `+Shift+z` redo, `+d` deselect,
`+c` / `+v` copy and paste, `+e` merge down and `+Shift+i` inverse
selection. Some accelerators shown in the menus are labels only and don't
respond to keys: New, Open, Save Project, the exports, New Layer, Duplicate
Layer, Group Layers and Fill. Click those menu items instead (the helpers do).

## Running Lopsy locally

With a clone of the repository (`npm install`, `npm run wasm:build` with
Rust and wasm-pack, then `npm run dev`), point the driver at the dev server
with `LOPSY_URL=http://localhost:5173/`. Development builds also expose
read-only inspection hooks, which are handy for measuring what you drew:
`window.__editorStore.getState()` (document, layers, viewport),
`window.__readLayerPixels(layerId)` and `window.__readCompositedPixels()`.
Keep making changes through the UI. The hooks are for looking, and they
don't exist on lopsy.art.
