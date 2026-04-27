# E2E Test Writing Guide

This guide captures hard-won knowledge about writing meaningful e2e tests
for Lopsy. If you're fixing a failing test or adding a new one, read this
first — most of the pitfalls below were learned the painful way.

## The golden rule

**A meaningful assertion must be able to fail when the feature breaks.**

If the test's assertion could pass against a completely stubbed or
missing implementation, the test doesn't test anything. Ask yourself:

- Would this pass if the feature were deleted?
- Would this pass if the feature were silently replaced with a no-op?
- Is the assertion exercising my own helper code or real production code?

If the answer to any of these is "yes (still passes)", rewrite the test.

---

## Test with the UI

When possible, manipulate the UI directly to simulate real user interaction.
Avoid calling store functions directly as much as you can. The goal is to
test how a real user will experience the website — when you call functions
directly, you miss bugs caused by UI interactions that real users will find.

- Interact with the UI directly with mouse clicks, mouse movement, etc.
- Use the website the way a real user would
- Don't call store actions when a UI equivalent exists

### How to select tools

Use keyboard shortcuts for tools that have them, or click the toolbar
button via its `data-tool-id` attribute:

```ts
// Keyboard shortcut (preferred when one exists)
await page.keyboard.press('b');  // brush

// Toolbar click (works for every tool, required for tools without shortcuts)
await page.locator('[data-tool-id="gradient"]').click();
```

| Tool | Shortcut | Tool | Shortcut |
|---|---|---|---|
| Move | `v` | Fill | `g` |
| Brush | `b` | Clone Stamp | `s` |
| Pencil | `n` | Dodge/Burn | `o` |
| Eraser | `e` | Smudge | `r` |
| Spray | `j` | Eyedropper | `i` |
| Shape | `u` | Text | `t` |
| Pen Tool | `p` | Crop | `c` |
| Marquee Rect | `m` | Lasso | `l` |
| Magic Wand | `w` | | |

Gradient, Elliptical Marquee, and Magnetic Lasso have **no** keyboard
shortcut — use `[data-tool-id="..."]` for these.

### How to perform common UI actions

**Undo / Redo:**
```ts
await page.keyboard.press('Control+z');        // undo
await page.keyboard.press('Control+Shift+z');  // redo
```

**Layer operations (layers panel buttons):**
```ts
await page.locator('[aria-label="Add Layer"]').click();
await page.locator('[aria-label="Duplicate Layer"]').click();
await page.locator('[aria-label="Delete Layer"]').click();
await page.locator('[aria-label="Add Mask"]').click();  // adds mask to active layer
```

**Select a layer:**
```ts
await page.locator(`[data-layer-id="${layerId}"]`).click();
```

**Toggle layer visibility (eye icon):**
```ts
await page.locator(`[data-layer-id="${layerId}"]`)
  .locator('button[aria-label="Hide layer"], button[aria-label="Show layer"]')
  .click();
```

### Drawing content on the canvas

Use `drawRect` / `drawEllipse` to create filled shapes via the shape
tool. These use real mouse drags on the canvas — exactly what a user
does:

```ts
await drawRect(page, 50, 50, 100, 80, { r: 255, g: 0, b: 0 });
await drawEllipse(page, 200, 150, 60, 40, { r: 0, g: 0, b: 255 });
```

To draw on a specific layer, select it first:

```ts
await setActiveLayer(page, layerId);
await drawRect(page, 0, 0, 50, 50, { r: 0, g: 255, b: 0 });
```

### Moving layers

Use `moveLayerTo` — it selects the move tool and performs a real mouse
drag:

```ts
await moveLayerTo(page, layerId, 80, 80);  // target doc position
```

### Layer effects

Use the effects panel helpers to configure effects the way a user would:

```ts
await configureEffect(page, 'Drop Shadow', {
  'Offset X': 4, 'Offset Y': 6, 'Blur': 8, 'Opacity': 50,
});
await setEffectColor(page, 'Shadow color', 0, 0, 0);
await closeEffectsPanel(page);
```

Effect names: `'Drop Shadow'`, `'Stroke'`, `'Outer Glow'`,
`'Inner Glow'`, `'Color Overlay'`.

### Filters

Use `applyFilter` to open the Filter menu, configure sliders, and
click Apply:

```ts
await applyFilter(page, 'Pixelate...', { 'Block Size': 10 });
```

### When store calls are acceptable

The bar is high — only use store calls when there is genuinely no UI
path:

- **`createDocument()`** — parameterised document creation.
- **`getEditorState()` / `getPixelAt()`** — reading state for assertions.
- **`pushHistory()`** — flushing pending GPU strokes before pixel reads.
- **Layer masks** (`addLayerMask` on a non-active layer, mask pixel
  data) — the "Add Mask" button operates on the active layer only.

Everything else has a UI path and must go through it. If you think
something doesn't, check the helpers table — there's probably a helper
you missed.

## Screenshots are the source of truth

**Always write tests by screenshot first, assertion second.** The
screenshot is the contract — it's the visual record of what the test
is actually verifying, committed alongside the spec file for future
reviewers.

### The screenshot-first workflow

1. **Set up the state** you want to verify. Paint, click, drag,
   configure — whatever the feature under test requires.
2. **Take a screenshot immediately**, before writing any `expect`
   calls:
   ```ts
   await page.screenshot({ path: 'e2e/screenshots/my-feature.png' });
   ```
3. **Open the screenshot and look at it.** What colours are where?
   Where are the edges? What pixel-level facts stand out? These are
   the things your assertions should check — and only these.
4. **Write assertions that describe the screenshot.** Read specific
   pixels at specific doc coordinates. Count opaque pixels in a
   region. Measure the spread of channel values at a known point.
   The assertions must match what a human can see in the image.
5. **Run the test and re-open the screenshot.** If the assertions
   pass but the screenshot no longer shows what the assertions
   describe (e.g. a regression shifted the content), the test needs
   stricter pixel probes. If the assertions fail but the screenshot
   looks correct, your assertion values or coordinates are wrong —
   not the feature.

### Screenshots are committed to git

Every test that saves a screenshot commits it. This is intentional:

- **Reviewers** can open the screenshot and verify that the assertions
  correspond to visible facts in the image. Without the screenshot, a
  reviewer has no way to tell whether `expect(pixel.r).toBe(255)` is
  correct — maybe the shape tool never rendered the red fill and the
  test is reading an unrelated pixel.
- **Regressions** are easier to diagnose. When a test fails months
  later, the committed screenshot is the reference for what the test
  used to see. Compare it against Playwright's failure screenshot in
  `test-results/` to pinpoint what changed.
- **Stable output is a feature, not a side effect.** Two runs of the
  same test should produce byte-for-byte identical screenshots unless
  production code changed. If your test produces non-deterministic
  screenshots, something is leaking state between runs (timer, random
  seed, uninitialised GPU texture, un-reset UI) — fix that before
  adding the test.

### What to screenshot

- **`page.screenshot(...)`** captures the whole viewport — app
  chrome, panels, toolbar, and the canvas area. Use this when the
  feature's visibility depends on UI state (a dialog is open, a tool
  is active, a slider has moved).
- **`element.screenshot(...)`** on the canvas container isolates the
  drawing surface. Use this when the feature is purely about what's
  rendered on the document and you want to minimize noise from
  surrounding UI.
- **Composited pixel dump via `__readCompositedPixels`** is a
  programmatic "screenshot" of the WebGL canvas. It's what pixel-probe
  assertions read from — it bypasses the overlay and UI chrome, so
  the coordinates match doc space directly.

Save screenshots to `e2e/screenshots/<descriptive-name>.png`. Use
kebab-case names that match the feature, not the test file, so two
tests exercising the same feature produce the same base name with a
suffix (`-before`, `-after`, `-with-selection`).

### When the screenshot disagrees with your assertion

This happens constantly. Almost every test in this suite has been
through at least one "I know what it SHOULD look like but the
screenshot shows something else" cycle. The screenshot wins:

- If the assertion says the corner is transparent and the screenshot
  shows a red pixel at that corner, the assertion is wrong (or the
  feature is broken).
- If the assertion says two shapes should differ and the screenshot
  shows them identical, either the feature doesn't do what you
  thought (e.g. polygon `sides=4` + `cornerRadius` is a no-op — that
  was found this way) or your "before" state leaked into the "after"
  capture.
- If the assertion says a pixel at doc (50, 50) is red and the
  screenshot shows the red region starting at (55, 55), your
  coordinates don't match the feature's rendering — either move the
  probe or use a wider tolerance.

**Never adjust an assertion by trial and error until it passes.** If
you don't know *why* the new value is correct from looking at the
screenshot, the test is just curve-fitting to the current output and
will pass against any future regression.

---

## Where to find things

### Exposed window globals (`src/main.tsx`)

These are only set in dev mode and only exist for testing. Always
double-check that a global exists before using it — don't assume.

| Global | Purpose |
|---|---|
| `__editorStore` | Zustand store for document, layers, history, selection |
| `__uiStore` | Zustand store for active tool, grid, guides, colors, transforms |
| `__toolSettingsStore` | Zustand store for per-tool settings (brush size, shape fill, etc.) |
| `__brushPresetStore` | Zustand store for brush presets and the brush modal |
| `__readCompositedPixels()` | Async. Triggers a fresh render and returns the full WebGL canvas as `{width, height, pixels[]}`. The buffer is bottom-up — flip y when projecting doc coords. |
| `__readLayerPixels(layerId?)` | Async. Syncs layers and returns a single layer's GPU texture as `{width, height, pixels[]}`. Returns `{width: 0, height: 0, pixels: []}` if the layer isn't tracked by the engine. |

**What is NOT exposed:** there is no `__engineState`, `__wasmBridge`,
`__wasmEngine`, or `__imageAdjustmentsModule`. Several historical tests
referenced these and silently passed because the globals returned
`undefined`. Don't add them — use the four stores plus the two read
functions.

### Shared helpers (`e2e/helpers.ts`)

Prefer these over local copies. If you're redefining `createDocument`,
`waitForStore`, or `getEditorState` in your spec file, stop and import
them instead.

**Setup & state inspection (store calls — acceptable):**

| Helper | Notes |
|---|---|
| `waitForStore(page)` | Polls until `window.__editorStore` exists. Budget 10+ seconds on cold start. |
| `createDocument(page, w, h, transparent)` | Creates a new doc via store. No UI equivalent for parameterised creation. |
| `getEditorState(page)` | Returns `{document, undoStackLength, redoStackLength}`. Does NOT return selection. |
| `getPixelAt(page, x, y, layerId?)` | Reads a single pixel from `__readLayerPixels`. Returns `{r:0, g:0, b:0, a:0}` for out-of-bounds. |
| `paintRect` / `paintCircle` | **Deprecated.** Use `drawRect` / `drawEllipse` instead (supports alpha via `a` field, 0–1). |
| `docToScreen(page, docX, docY)` | Projects doc coords to screen coords for mouse events. |

**UI interaction helpers (all drive real UI):**

| Helper | How it works |
|---|---|
| `selectTool(page, toolId)` | Keyboard shortcut if one exists, otherwise clicks `[data-tool-id]` in the toolbar. |
| `setToolOption(page, label, value)` | Types into the options bar value input. Labels: `"Size"`, `"Opacity"`, `"Hardness"`, `"Fade"`, `"Strength"`, `"Tolerance"`, `"Corner Radius"`, `"Width"`, etc. |
| `setForegroundColor(page, r, g, b)` | Types a hex value into the color panel input. |
| `drawRect(page, x, y, w, h, {r,g,b,a?})` | Draws a filled rectangle via the shape tool. Optional `a` (0–1) sets fill alpha. |
| `drawEllipse(page, cx, cy, rx, ry, {r,g,b,a?})` | Draws a filled ellipse via the shape tool. Same alpha support. |
| `moveLayerTo(page, layerId, x, y)` | Selects the layer, switches to move tool, performs a real mouse drag to the target position. |
| `setBlendMode(page, mode)` | Opens the effects panel if needed, selects from the blend mode dropdown. |
| `setLayerOpacity(page, layerId, percent)` | Clicks the opacity button on the layer row, fills the range slider (0–100). |
| `configureEffect(page, name, settings)` | Opens effects panel, enables the effect, sets slider values. |
| `setEffectColor(page, ariaLabel, r, g, b)` | Sets an effect color input (e.g., `'Shadow color'`, `'Stroke color'`, `'Glow color'`). |
| `openEffectsPanel(page)` / `closeEffectsPanel(page)` | Open/close the effects drawer. |
| `setBrushModalOption(page, label, value)` | Opens the brush presets modal if needed, sets a slider. Labels: `"Spacing"`, `"Scatter"`, `"Size"`, `"Hardness"`, `"Opacity"`. |
| `openBrushModal(page)` / `closeBrushModal(page)` | Open/close the brush presets modal. |
| `applyFilter(page, filterName, params?)` | Opens the Filter menu, clicks the filter, sets slider params, clicks Apply. |
| `setAdjustment(page, label, value)` | Switches to the correct Adjustments tab and fills the slider value input. |
| `addLayer(page)` | Clicks `[aria-label="Add Layer"]`. |
| `setActiveLayer(page, id)` | Clicks `[data-layer-id="${id}"]`. |
| `undo(page)` / `redo(page)` | Sends `Control+z` / `Control+Shift+z`. |

### Useful selectors

**Canvas:**
- Canvas container: `[data-testid="canvas-container"]`. Mouse events
  (`onMouseDown/Move/Up`) are bound here.
- Overlay canvas: `canvas` with `/overlayCanvas/.test(className)`. This
  is the 2D overlay where the grid, rulers, selection ants, and cursor
  are drawn. Its `getContext('2d').getImageData(...)` gives you the
  rendered overlay.
- Main WebGL canvas: the other `<canvas>` inside the canvas container.
  Read composited pixels via `__readCompositedPixels`, not by grabbing
  this element directly.

**Toolbox:**
- Tool button: `[data-tool-id="brush"]` — every tool in the toolbar
  has this attribute matching its `ToolId`.

**Layers panel:**
- Layer row: `[data-layer-id="${id}"]` — click to select a layer.
- Visibility toggle: within a layer row,
  `button[aria-label="Hide layer"]` or `button[aria-label="Show layer"]`.
- Add layer: `[aria-label="Add Layer"]`.
- Duplicate layer: `[aria-label="Duplicate Layer"]`.
- Delete layer: `[aria-label="Delete Layer"]`.
- Add mask: `[aria-label="Add Mask"]`.
- Delete mask: `[aria-label="Delete mask"]`.
- Layer effects: `[aria-label="Layer effects for ${name}"]`.
- Opacity: `[aria-label="${name} opacity"]` (range input).

**Other UI:**
- Grid slider: `input[type="range"][class*="gridSlider"]`. The
  `[class*="..."]` trick matches CSS-module-hashed class names.
- Filter dialog slider: scope by title, e.g.
  `page.locator('h2:has-text("Pixelate")').locator('xpath=ancestor::*[contains(@class,"modal")][1]').locator('input[type="range"]')`.
- Brush preview canvas: the unique `<canvas width=240 height=80>` in the
  brush modal. Find with `canvases.find(c => c.width === 240 && c.height === 80)`.

---

## Pitfalls that caused real test failures

### 1. Auto-crop after every `paintRect`

`updateLayerPixelData` fires `cropLayerToContent` internally, which
shifts `layer.x / layer.y` to the content bounds and shrinks the
texture. Consequences:

- After painting a square at doc `(60, 60)` on a 200×200 layer, the
  layer becomes `x=60, y=60, width=60, height=60` — not `x=0, y=0`.
- A **second** `paintRect` that tries to draw outside the new bounds is
  silently dropped (the helper reads existing data first, sees
  `width=60`, and the out-of-bounds pixels fall off).

**Fix:** if you need multiple painted regions, build the full ImageData
in one `page.evaluate` call and call `updateLayerPixelData` exactly
once. See `paintThreeBlocks` in `pixelate-filter.spec.ts` for the
canonical pattern.

### 2. Brush strokes live in a deferred GPU texture

After `mouse.up` on a brush stroke, the GPU stroke texture is **not**
merged into the layer texture yet — `setPendingStroke` marks it pending
so shift-click can continue. `__readLayerPixels` reads the layer
texture and sees nothing.

**Fix:** either (a) force the merge by calling `pushHistory`
(`finalizePendingStrokeGlobal` runs inside `pushHistory`), or (b) use
`__readCompositedPixels`, which runs the compositor and includes the
active stroke texture.

### 3. Wand creates a transform overlay that intercepts clicks

After a successful wand selection, `handleSelectionDown` calls
`setTransform(createTransformState(wandBounds))`, drawing transform
handles around the selection bounds. `useCanvasInteraction` then calls
`handleTransformDown` **before** dispatching to the tool handler — so
the next click near a handle triggers the transform handler, not your
active tool.

**Fix:** after a wand selection, clear the transform with
`__uiStore.getState().setTransform(null)` before firing the next click.

### 4. Auto-crop makes `addLayer` + move tool fragile

`addLayer` creates a new layer but does not necessarily activate it for
subsequent tool interactions in a test. After calling `addLayer`,
explicitly call `setActiveLayer` to the desired layer before pressing
`v` (move tool) and dragging. Without it, the drag may act on the
previous active layer (or a cropped one) and produce surprising
results.

### 5. Move-tool drag only works via real mouse events

Calling `moveLayer` from the helper bypasses `snapPositionToGrid`
entirely — it writes the position directly. If you're testing snap
behaviour, you MUST simulate real mouse events:

```ts
await page.mouse.move(start.x, start.y);
await page.mouse.down();
await page.mouse.move(end.x, end.y, { steps: 15 });
await page.mouse.up();
```

### 6. The overlay canvas spans the container, not the document

The overlay's bounding rect equals the canvas container — much larger
than the document at low zoom. Don't assume `overlay.width / 2` is the
document center. Compute doc-to-overlay projection explicitly from
`viewport.panX/panY/zoom` and the container rect, matching the
transform in `useCanvasRendering.ts`:

```
docCenterOnOverlayX = viewport.panX + overlay.width / 2
overlayX(docX) = (docX - doc.width/2) * zoom + viewport.panX + overlay.width/2
```

### 7. Scanning along a grid line gives you noise

Reading pixels along `y = height/2` when the grid is enabled will hit
the horizontal centre grid line for the entire row — every column
shows alpha > 0. Pick a scan row that's clearly between two grid lines
(e.g. `docY = doc.height/2 + 7`) before searching for vertical lines.

### 8. CSS Module class names are hashed

`styles.gridSlider` becomes something like `_gridSlider_abc123`. Match
with attribute-contains: `input[type="range"][class*="gridSlider"]`.
Don't hard-code the hash.

### 9. Slider values don't always match the underlying uniform

The Adjustments panel stores saturation in `-100..100` but the export
pipeline (`applyAdjustmentsToImageData`) treats it as `-1..1`, while
the GPU shader divides by 100 at upload. The result: a value of `-1`
does nothing on the live composite (shader sees `-0.01`), but `-100`
clamps channels to 0/255 in the export path.

**Fix:** know which path you're testing. For live composite use the
slider range (`-100..100`). For export, compare two exports (with and
without the adjustment) and assert they differ, rather than asserting
specific channel values.

### 10. Polygon corner radius is a no-op for `sides=4`

`shape_fill.glsl`'s `sdPolygon` has degenerate rounding math for
4-sided polygons — the rounded shape equals the original square. If
you want to verify rounded rectangles visually, use **ellipse** mode
instead. `sides=6` works for the polygon SDF and can be used for
"rounded vertex" tests.

### 11. Tool-settings store expects specific ranges

`setShapePolygonSides` clamps to `[3, 64]`. `setShapeCornerRadius`
clamps to `[0, 200]`. `setBrushSize` clamps to `[1, 2000]`. Check the
setter before asserting on the stored value — the clamp may silently
change what you wrote.

### 12. Fit-to-view caps zoom at 1.0

`fitToView` won't zoom in past 1:1 even if the viewport is much larger
than the document. For a 501×501 doc in a 932×628 viewport,
`viewport.zoom = 1, panX = 0, panY = 0`. The doc is centred inside the
canvas container (not the overlay).

---

## Choosing what to assert

### Read pixel content, not store plumbing

Asserting that `state.someField === someValue` only verifies the JS
store round-trips. It doesn't verify the feature renders anything.

**Good:** "after pixelate, every pixel in a 10×10 block matches its
centre colour."

**Bad:** "after pixelate, the active layer still exists."

### Use doc-coordinate pixel probes at known positions

For features with known geometry — shapes, filters, fills — compute
the exact doc coordinates where specific colours should appear, and
read those pixels. A centre/edge/outside probe trio is usually enough
to catch the interesting failure modes.

### Use pixel diff between two rasters for continuous features

For features where the exact output is hard to predict (export
pipeline, brush strokes, effects), compare two snapshots (before/after
the change) and assert that they differ by a meaningful number of
pixels. This catches "feature is a silent no-op" without requiring
you to model the output.

### Read composited vs. layer, depending on what the feature affects

| Feature | Read method |
|---|---|
| Pure layer content (fill, shape, paint, filter) | `__readLayerPixels(id)` / `getPixelAt` |
| Group adjustments, effects, selection overlay, active brush stroke | `__readCompositedPixels()` |
| Grid, rulers, marching ants, guides, transform handles | Overlay 2D canvas via `getImageData` |
| Brush preview, thumbnails, filter preview | The specific `<canvas>` element in the relevant component (brush preview is 240×80) |

### Screenshots belong with the test

See "Screenshots are the source of truth" at the top of this file. In
short: save to `e2e/screenshots/<descriptive-name>.png`, commit
alongside the spec, and make sure a reviewer can look at the
screenshot and verify your assertions without running the test.

---

## Workflow for fixing a failing test

1. **Run the single failing test** to get the real error message, not a
   summary count. `npx playwright test --project=chromium e2e/<file> -g "<name>"`.
2. **Open the committed screenshot for this test** (or Playwright's
   failure screenshot in `test-results/` if there's no baseline).
   That's the source of truth — you're reconciling the assertions
   against what's actually on screen, not the other way around.
3. **Read the test and ask: what is it trying to verify?** Compare
   the assertion's claim ("pixel at (50, 50) should be red") to the
   screenshot. If they don't agree, one of them is wrong.
4. **Look up the production code path** the test should be exercising.
   Find the store action or handler that does the real work
   (`src/app/store/actions/*`, `src/app/interactions/*-handlers.ts`,
   `src/tools/*/\*.ts`, `engine-rs/**/*.rs`).
5. **Check the units**. Is the slider in `0..100` or `-1..1`? Is the
   angle in radians or degrees? Is the coordinate doc-space or
   layer-local? The test's assertion values must match the production
   code's units *and* the screenshot.
6. **Write a one-off debug test** if the failure is mysterious. Dump
   viewport state, active layer, pixel samples along a scan line,
   layer bounds — whatever you need. Always save a screenshot inside
   the debug test; it will usually reveal the problem immediately.
   Delete the debug test before committing.
7. **Re-run and re-check the screenshot.** A green test whose
   screenshot no longer matches the asserted content is worse than a
   failing test — it's a regression waiting to go unnoticed. If the
   screenshot changed unexpectedly, either your fix is wrong or a
   production regression slipped in; don't commit until you understand
   which.

---

## Command reference

```bash
# Warm the dev server (playwright's webServer config reuses it)
npx vite --port 5174

# Run one test file in chromium only
npx playwright test --project=chromium e2e/<file>.spec.ts

# Run one test by name pattern
npx playwright test --project=chromium e2e/<file>.spec.ts -g "<test name>"

# Rebuild WASM when engine-rs sources change
npm run wasm:build
```

The WASM build **must** be present in `src/engine-wasm/pkg/` or the app
fails to initialise and every test times out in `waitForStore`. The
dev server emits a "WASM is stale" warning when the Rust sources are
newer than the compiled output — heed it.
