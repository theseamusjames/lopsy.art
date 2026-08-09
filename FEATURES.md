# Lopsy Feature Catalog

## Drawing & Painting Tools

### Brush

The toolbar exposes Size, Opacity, Hardness, Fade, and the symmetry toggle. Everything else (preset gallery, brush-tip import, dynamics, texture) lives in the **Brushes modal**.

**The Brushes modal.** Opened by clicking the brush-tip thumbnail at the left of the Brush options bar — note that button only renders while a preset is active, so deleting the active preset removes this entry point (the canvas right-click **Define Brush Preset** is the only other way in, and it needs a selection). The modal is a fixed 640 × 600 centered dialog, draggable by its title bar, closed with the ✕ (there is no Escape-to-close and no backdrop — the canvas stays fully interactive behind it). Its body is a **vertical five-tab rail** on the left — **Presets, Shape, Dynamics, Texture, Sub-Brushes** — with the active tab's controls to the right. Two things sit outside the tabs and are visible from every one of them:

- **Live stroke preview** — a canvas strip below the tab area that redraws a cubic-Bézier S-stroke through the *whole* current parameter set: size, spacing, hardness, opacity, scatter, angle, tip bitmap, all four jitters, speed-size, taper, and the texture with its blend mode and scale. Updates are debounced ~200 ms, and the randomization uses a fixed xorshift seed so the preview is stable between redraws rather than reshuffling on every keystroke. Velocity is simulated as slow at both ends and fastest mid-stroke, so Speed Size is visible here.
- **Footer** — **Export** (opens the Export Brushes modal, below) and **Save Current**, which prompts for a name and snapshots the live brush — tip, size, hardness, spacing, scatter, angle, opacity, fade, taper, all four jitters, the speed-size settings, and any sub-brushes — as a new custom preset, which it then makes active. Texture is deliberately *not* captured.

**Core parameters**
- **Size**: 1 - 2000 px (auto-scaled by document size). **The two places that edit this number do not share a ceiling**: the Brushes modal's Shape tab runs to `max(2000, 1.5 × longest-document-side)` while the **options-bar** Size slider stops at `max(200, …)` — both write the same `settings.brush.size`. A size dialed above 200 in the modal survives (sliders clamp on interaction, not on render) until you next touch the options-bar slider, which clamps it back down to its own maximum.
- **Opacity**: 1 - 100%
- **Hardness**: 0 - 100%
- **Fade**: 0 - 2000 px (opacity fade-out distance, exposed on the options bar)
- **Taper**: 0 - 2000 px base range, auto-scaled by document size like Size (the modal's Shape-tab slider max is `1.5 × longest-document-side`, capped at 5000 px) — size taper-out distance: brush dabs shrink toward zero over this many pixels of stroke length, independent of the Fade opacity rolloff
- **Spacing**: 1 - 200% of brush size
- **Scatter**: 0 - 100%
- **Angle**: 0 - 360 degrees (set via the modal's angle dial)
- **Symmetry**: horizontal, vertical, both (4-way), or radial (2 - 32 segments). The horizontal/vertical toggles and the **Radial Symmetry** control (with its segment-count number input) all live in the Brush options bar; see the Symmetry section for full behavior.

**Shape tab** (Brushes modal). Holds the Size / Spacing / Hardness / Opacity / Taper sliders, an angle dial, and its own copy of the preset grid.
- **The Shape tab's grid changes the tip only.** Clicking a preset here swaps the brush's bitmap and leaves every other parameter — size, spacing, jitters, sub-brushes — exactly as you set it. That is the opposite of the **Presets** tab, where clicking applies the entire preset and overwrites the current settings. Use Shape to audition tips without losing a brush you've dialed in.
- **Angle dial**: a 64 px circle; press anywhere inside it and drag to set the angle from the pointer's bearing relative to the center, rounded to whole degrees, with the value shown numerically beside it. It is exposed as a `slider` role and is keyboard-focusable.
- **Dab preview**: a static single-dab render sits next to the dial, showing the current tip at the current size, hardness, opacity, and angle.
- Slider drag ranges are pinned shorter than their true maxima — Size drags to 300 and Taper to 1000 — while each slider's numeric input still accepts anything up to the document-scaled maximum.

**Dynamics** (Brushes modal → Dynamics tab). Scatter also lives on this tab.

The four jitters are **not implemented the same way**, and the difference shows up in the stroke. **Angle Jitter** and **Opacity Jitter** are applied **GPU-side**, hashed from each dab's center position (`dabHash(u_center, …)` in `brush_dab_footer.glsl`) — every dab is randomized independently, and because the hash is purely positional the result is **deterministic**: the same path re-painted produces the same variation. **Size Jitter** and **Hardness Jitter** are applied **CPU-side** before the dab is emitted (`advanceJitterWalk`, `paint-handlers.ts`), and they are a smooth **random walk along the stroke** rather than per-dab noise — a new target is drawn every 30 – 120 px of travel for size and every 80 – 280 px for hardness, and the value smoothsteps toward it in between. Those targets come from `Math.random()`, so these two are **not** deterministic: the same path painted twice varies. (The GPU's own size-jitter uniform is passed 0 on this path, so the jitter is never applied twice.)

- **Size Jitter**: 0 - 100% — how far the size walk may dip below the base size
- **Hardness Jitter**: 0 - 100% — how far the hardness walk may dip (varies the softness of the dab falloff)
- **Angle Jitter**: 0 - 100% — per-dab rotation randomization (most visible with non-circular tips)
- **Opacity Jitter**: 0 - 100% — per-dab transparency randomization
- **Speed Size**: stroke velocity modulates brush size. A `Faster is` toggle picks the direction (`Thinner`: faster strokes shrink toward 1 px, range 0 – 100%; `Wider`: faster strokes grow up to 3× the base size, range 0 – 300%; switching back to `Thinner` clamps a value above 100 down to 100). Raw velocity is normalized against a 5 px/ms ceiling and clamped to 1, then averaged over a sliding window — and **that window length is what the `Sensitivity` toggle sets**: Low = 6 samples, Med = 3, High = 2, so Low is the most damped and High the twitchiest. The resulting size *scale* is then eased toward its target by a further 0.25 blend per dab, which is what keeps the width from stepping visibly.

**Texture** (Brushes modal → Texture tab). The tab shows a texture dropdown and an Import button; the blend-mode dropdown and the Scale slider appear **only once a texture is selected**.
- **Built-in textures**: Noise, Canvas, Grain (128×128 grayscale tiles generated procedurally from seamless value noise) — `No Texture` disables texturing
- **Import custom texture**: accepts any image the browser can decode (the picker is `image/*`, not just grayscale files) and converts it to a grayscale tile with Rec.601 luma weights. Imported textures join the dropdown next to the built-ins; the **Delete** button appears only while an imported texture is selected, so built-ins can't be removed.
- **Texture blend mode**: Multiply, Subtract, or Overlay. The texture modulates the **dab's alpha (coverage)** — with the color channels carried along premultiplied — rather than blending against the brush color: Multiply scales coverage by the tile value, Subtract by its inverse, Overlay applies the standard overlay curve to coverage.
- **Scale**: 10 - 300% (tile size relative to the source tile)
- **Each stroke gets its own tile grid.** The tiling is anchored at the stroke's **first dab** and rotated by a fresh random angle chosen when the stroke begins (`begin_stroke`, seeded from the layer id XOR the current time). Adjacent strokes therefore deliberately do *not* line up on a shared pattern grid — that is what stops a textured brush from showing an obvious repeating lattice across a filled area. The trade-off is that a texture pass is not reproducible: the same stroke re-painted gets a different rotation.
- **Texture is not part of a preset.** `Save Current` doesn't record it, and selecting any preset **resets the texture to none** (blend mode back to Multiply, scale back to 100%). Pick the preset first, then the texture.

**Sub-brushes** (Brushes modal → Sub-Brushes tab). Each sub-brush emits an additional dab co-located with every primary dab, so a single stroke can layer multiple textures, sizes, and rotations at once. A tip can carry any number of sub-brushes (there is no cap); each sub-brush picks its own tip from the same preset grid as the primary brush, and each gets its own **Remove** button. **Add Sub-Brush** appends one with no tip, Size Ratio 50%, Hardness 100, Opacity Ratio 50%, and Angle Offset and all three jitters at 0.
- **Size Ratio**: 10 - 200% (sub-brush size relative to the primary brush)
- **Hardness**: 0 - 100% (independent hardness for the sub-brush)
- **Opacity Ratio**: 1 - 100% of the primary brush opacity
- **Angle Offset**: 0 - 360° relative to the primary brush angle
- **Size / Angle / Opacity Jitter**: 0 - 100% per-dab randomization, independent from the primary brush's dynamics

**Tips & presets** (Brushes modal → Presets tab)
- **Tip kinds**: procedural circle (no bitmap), **alpha tip** (1 byte/pixel grayscale, brush color tints the dab), or **color tip** (4 byte/pixel RGBA, color comes from the bitmap itself). Color-tip dabs use premultiplied-alpha "over" compositing so overlapping rotated dabs layer correctly.
- **Custom brush tips**: import grayscale bitmaps as alpha tips. PNG/JPG/WebP supported.
- **Brush from Selection** — **Edit → Define Brush…** (alpha) and **Edit → Define Color Brush…** (RGBA), both disabled without an active selection. Each prompts for a name, then adds the tip as a custom preset and makes it active, sized to the longer edge of the captured bitmap. Two variants:
  - **Grayscale (alpha) capture**: inverts the source so dark pixels paint opaquely (Photoshop convention) and the selection mask crops to the marquee bounds.
  - **Color capture**: preserves full RGBA so the tip stamps the original colors of the selection (useful for stamp-pattern brushes).
  - The canvas right-click **Define Brush Preset** is a *separate* path with different behavior — it skips the name prompt (the tip is always called "Custom Brush") and opens the Brushes modal afterwards.
- **ABR import**: Adobe Brush file support — drops every brush in the file into the preset grid as new tips. Parsing runs in a Web Worker, so a large `.abr` doesn't stall the UI.
- **Import** (Presets tab): one button handling both formats — `.abr` brush files and `.json` preset libraries.
- **Export** (footer) opens a dedicated **Export Brushes** modal: a checkbox gallery of every preset with **Select All** / **Select None**, a live "*N* selected" count, and an Export button disabled at zero selection. Note it starts with **everything selected, built-ins included** — this is a "choose what to ship" dialog, not a custom-presets-only dump. The selection is written to `lopsy-brushes.json` as `{version: 1, presets: […]}` with Base64-encoded bitmap data plus every dynamic / sub-brush parameter. Re-importing on any machine restores them; imported presets always come back flagged custom, so a re-imported built-in becomes deletable.
- **Built-in presets** come from two independent sources that share one grid:
  - **11 procedural presets defined in TypeScript** — Hard Round, Soft Round, Airbrush, Square, Cross Hatch, Diamond, Star, Slash, Chalk, Spray, Leaf — whose tips are generated in code at startup. All ship with spacing standardized to 1% of brush size so they paint smooth strokes by default.
  - **9 bitmap tips embedded in the Rust engine** — Bubbles, Caligraphic Angle, Caligraphic Rounded, Calligraphic Split, Light Offset, Oblong, Smooth, Star, Triangle. Every PNG in `engine-rs/brushes/` is compiled into the WASM binary by `build.rs` (`include_bytes!`), so adding a file there is all it takes to ship a new tip. They load asynchronously once the engine is up and are appended to the grid, decoded to alpha with the same dark-pixels-paint-opaquely inversion, at size 30 / hardness 100 / spacing 1.
- **Delete**: removes the active preset, after a confirm prompt. Only enabled for custom presets (imported or user-saved), never built-ins.

**Shape-aware hardness**
- Tip hardness is implemented as an inner-glow falloff: the tip alpha is inverted, Gaussian-blurred, normalized, then multiplied back in as an opacity mask. This preserves the tip silhouette while softening edges — corners and straight edges soften proportionally to their distance from the interior, so non-circular tips (Square, Star, Slash, Leaf) don't degenerate into circular blobs when hardness is reduced.

**Stroke modifiers**
- **Shift+click**: draws a straight line from the previous stroke endpoint to the click point (see Straight-Line Strokes below for the shared cross-tool behavior, the live preview, and the 15° snap)
- **Hold-to-smooth**: pause the cursor mid-stroke for ~1500 ms and the recorded freehand path is auto-smoothed and re-rasterized in place. The path is first tested for straightness — if every point lies within a tolerance of the first→last line it is replaced with a perfect straight segment; the tolerance is the larger of **4 px** or **10% of the stroke length**, so long strokes with small relative wobble still snap straight. Otherwise the path is simplified with Ramer-Douglas-Peucker (9 px epsilon) and re-interpolated as a Catmull-Rom spline. Undo restores the freehand version first, then the pre-stroke state.
  - **Applies to the Brush only**, requires the GPU stroke path, and is disabled while `maskMode` is set — so it never fires when painting a layer mask or in Quick Mask.
  - **The re-raster does not carry every brush parameter.** It emits uniform dabs carrying size, hardness, opacity, color, and symmetry only: angle jitter and opacity jitter are hard-coded to zero, and taper, fade, scatter, and sub-brushes are not routed through at all. A heavily scattered / jittered / tapered / sub-brush tip therefore visibly changes character the moment hold-to-smooth fires.

### Pencil
- **Size**: 1 - 100 px (base range; auto-scaled by document size). The slider knob's draggable range is capped at 250 px — matching the convention the other size sliders use (Brush and Eraser cap at 300, Spray at 500) — while the numeric input still accepts anything up to the document-scaled maximum.
- **Symmetry**: horizontal, vertical, or both
- Pixel-perfect Bresenham lines (no anti-aliasing)
- **Shift+click**: draws a straight pixel-perfect line from the previous stroke endpoint

### Eraser
- **Size**: 1 - 200 px (base range; auto-scaled by document size)
- **Opacity**: 1 - 100%
- **Hardness**: fixed internal soft falloff (0.8) — there is no user-facing hardness control; the options bar exposes only Size and Opacity
- **Shift+click**: erases a straight line from the previous stroke endpoint

### Dodge / Burn
- **Mode**: dodge or burn
- **Exposure**: 1 - 100%
- **Size**: 1 - 200 px (base range; auto-scaled by document size). **This is the Brush's size setting, not a separate one** — the Dodge options bar binds `settings.brush.size` directly, so resizing here (by slider or by `[` / `]`) resizes the Brush too, and vice versa. Exposure and Mode are the only settings Dodge/Burn owns.
- **Shift+click**: applies dodge/burn along a straight line from the previous stroke endpoint

### Sponge
- **Mode**: saturate or desaturate
- **Strength**: 1 - 100 (saturation delta applied per dab)
- **Size**: 1 px – document-scaled max (default cap 200 px)
- Shortcut: `Y`
- Converts each affected pixel to HSL, shifts the saturation channel by the configured delta with a Gaussian falloff (1.0 at the dab center, 0 at the edge), and writes back to RGB. Internal hardness is fixed at 0.5; dab spacing is 25% of the brush size.
- **`[` / `]` do not resize the Sponge** — the size shortcut has no branch for this tool, so its Size is slider-only (see [Single-Key Shortcuts](#single-key-shortcuts)).
- **Shift+click**: applies the sponge along a straight line from the previous stroke endpoint

### Clone Stamp
- **Size**: 1 - 200 px (base range; auto-scaled by document size)
- **Alt/Cmd+click**: set the source sample point
- **Shift+click**: stamps along a straight line from the previous stroke endpoint, preserving source offset
- **Cursor**: a circular brush-size cursor (no crosshair fallback). Once a source point is set, the cursor becomes a live **source preview** — the pixels under the source offset are drawn at 70% opacity, clipped to the brush circle, with a white outline ring around the cursor and a small crosshair marking the current source point. The preview tracks the source offset as you move, so you can see exactly what will be stamped before painting.

### Healing Brush
- **Size**: 1 px – document-scaled max (default cap 200 px, scales with canvas size)
- **Opacity**: 1 - 100%
- **Alt/Cmd+click**: set the healing source sample point
- **Shift+click**: heals along a straight line from the previous stroke endpoint, preserving source offset
- Color-correction healing: subtracts the source mean color and adds the destination mean color, so texture is borrowed from the source while tone matches the destination
- Soft quadratic falloff at the dab edge for seamless blending
- **Cursor**: the same circular brush-size cursor and live **source preview** as the Clone Stamp — once a source point is set, the source pixels render at 70% opacity inside the brush circle with a white outline ring and a crosshair at the source point (previously the heal brush fell through to a plain crosshair).

### Smudge
- **Size**: 1 - 200 px (base range; auto-scaled by document size)
- **Strength**: 0 - 100% (how far pixels are pulled along the stroke)
- Shortcut: `R`
- Pulls colors along the stroke direction, blending neighbouring pixels.
- **Shift+click**: the straight-line smudge is implemented but does not fire after a smudge stroke — smudge is not registered as a paint tool, so its strokes never record a line origin. See the Smudge caveat under Straight-Line Strokes.

### Spray
- **Size**: 1 - 500 px (base range; auto-scaled by document size)
- **Density**: 1 - 100 (number of dots emitted per dab)
- **Opacity**: 1 - 100%
- **Softness**: 0 - 100% (per-dot hardness falloff)
- Shortcut: `J`
- Holding the cursor still keeps emitting dots at ~6 Hz so paint accumulates over time, mimicking an airbrush. Dragging spreads dots along the path with automatic spacing scaled to brush size.
- **No shift+click straight line**: unlike the other paint tools, the spray handler never reads the shift key, so shift+click sprays a normal dab at the click point. A shift-hold line preview *is* drawn (see below) even though clicking will not follow it.
- **No size cursor and no `[` / `]`**: Spray is the one painting tool left out of both size affordances. It is absent from the brush-cursor tool set, so it falls through to a plain crosshair with no ring showing the dab footprint, and absent from the size-shortcut branches, so the brackets do nothing. Both gaps bite hardest here, since Spray has the widest size range of any tool (base cap 500 px).

### Straight-Line Strokes (shared across paint tools)

After you finish a stroke, its endpoint is remembered as the origin for a straight-line stroke. **Shift+click** then paints a straight line from that origin to the click point instead of a single dab. The origin is only remembered per layer — switching the active layer discards it.

**Which tools support it**

| Tool | Shift+click line | Cmd/Meta 15° snap | Notes |
|------|------------------|-------------------|-------|
| Brush, Pencil, Eraser | yes | yes | the full behavior |
| Dodge / Burn, Sponge | yes | no | line only, no angle snap |
| Clone Stamp, Healing Brush | yes | no | Cmd is already taken — see below |
| Spray | no | no | preview draws, click does not follow it |
| Smudge | not on its own | no | see the caveat below |

- **Cmd/Meta+shift**: while shift-clicking a line, holding Cmd/Meta snaps the endpoint to the nearest **15°** increment about the origin (matching the gradient tool's snap). This is implemented only in the shared brush/pencil/eraser handler — the other paint tools draw an unsnapped line.
- **Clone Stamp / Healing Brush caveat**: those two tools branch on `Alt || Cmd` to set the clone source *before* any shift-line handling, so Cmd+shift+click **re-sets the source point and paints nothing** rather than snapping. Use Alt to set the source and plain shift+click for lines.
- **Smudge caveat**: the smudge handler implements shift-line smudging, but smudge is not registered as a paint tool, so a smudge stroke never records an endpoint. Shift+click therefore does nothing after a smudge stroke; it only fires if the *previous* stroke came from a different paint tool on the same layer (e.g. brush, then switch to smudge, then shift+click). Smudge also draws no shift-hold preview.

**Shift-hold line preview**

Holding **Shift** while hovering the canvas draws a live hairline showing exactly where the straight-line stroke will land, before you commit it.

- **Requires a prior stroke** on the **active layer** — a shift-hover on a fresh document or a just-switched layer shows nothing.
- Drawn for every registered paint tool (brush, pencil, eraser, clone stamp, healing brush, dodge/burn, sponge, spray) — note this includes spray and excludes smudge, neither of which matches its actual shift+click behavior.
- **Style**: a solid (undashed) hairline — a 1.5 px white under-stroke for contrast against dark artwork, over-stroked at 0.75 px in **black** normally or **blue** (`#2196f3`) while the 15° snap is engaged, so the color tells you whether the angle is snapped. Widths are divided by zoom, so the line stays ~1.5 screen px at any magnification.
- **Cmd/Meta** (or **Ctrl**) while hovering snaps the previewed endpoint to 15°. Note the preview accepts Ctrl as a Meta alias but the actual paint commit does not — on Windows/Linux, Ctrl+Shift+hover previews a *snapped* line while the click draws an *unsnapped* one.
- The preview updates from a global key listener as well as on pointer-move, so pressing or releasing the modifier re-draws it without moving the mouse.
- **Clears on**: releasing shift, leaving the canvas, switching tools, changing the active layer, or finishing a stroke (it reappears on the next hover).

---

## Shape & Vector Tools

### Shape Tool
- **Shape types**: ellipse, polygon. A rectangle/square is drawn as a
  4-sided polygon (set sides to 4); triangles use sides=3, etc.
- **Output**: pixels or path
- **Fill color**: any color or none
- **Stroke color**: any color or none
- **Fill / Stroke swatches**: each is a small swatch in the options bar. **Click** opens an inline color popover (with a "Remove fill" / "Remove stroke" button that sets it back to none); **double-click** instead pushes that color into the foreground swatch and reveals the Color panel — opening it if it was closed, bringing its tab forward if it was a background tab, and raising its window if it was a buried floating panel. When a fill or stroke is set to none the swatch is replaced by a `—` button that re-adds a color (opaque white for fill, opaque black for stroke) and opens the popover.
- **Stroke width**: 1 - 50 px
- **Polygon sides**: 3 - 64
- **Corner radius**: 0 - 200 px
- **Aspect ratio lock**: width/height ratio constraint
- **Cmd/Meta+drag**: holding meta while dragging temporarily forces a 1:1 aspect ratio (perfect square / circle / regular polygon) regardless of the persistent aspect-ratio toggle. Releasing meta returns to the unconstrained or persistently-locked behavior.
- **Click without dragging** (pixel output only): a click that doesn't drag past the threshold opens the **Shape Size modal** — type an exact Width and Height (1 - 16384 px) and the shape is created at the click point with those dimensions (Photoshop-style click-to-create). `Enter` confirms, `Escape` (or clicking the backdrop) cancels. In **path** output mode a no-drag click is ignored instead of opening the modal.

### Path / Pen Tool
- **Stroke width**: 1 - 50 px
- Bezier anchors with in/out handles
- Close path, split segment, convert anchor
- Stroke path to pixels
- Convert path to selection
- **Cmd/Meta+click an anchor**: toggles between corner (no handles) and smooth spline (double-click does the same)
- **Enter** (with the Path tool active and ≥ 2 anchors placed): strokes the in-progress anchor list directly to pixels on the active layer using the current stroke width — no need to commit the path through the Paths panel first.
- **Escape** (with the Path tool active and anchors placed): discards the in-progress anchor list without stroking. When no path is in progress, Escape falls through to its global behavior (clears any active selection and cancels any pending transform).
- **Boolean path operations** (Path options bar buttons + **Path** menu in the menu bar): Unite, Subtract, Intersect, Exclude. Operates between the selected path and the most recently added other path; both source paths are consumed and replaced by the result. Implemented by flattening Bezier paths to polygons, rasterizing to binary masks, combining pixel-wise, then tracing contours with marching squares and refitting Catmull-Rom/Bezier anchors. Buttons are disabled until the document contains at least 2 paths and one is selected.

### Text Tool
- **Font size**: 1 - 500
- **Font family**: chosen from a searchable **font browser** (see below) covering 1,954 families — 14 system faces (Inter, Arial, Helvetica, Georgia, Times New Roman, Courier New, JetBrains Mono, Verdana, Trebuchet MS, Impact, Comic Sans MS, Palatino, Garamond, Brush Script MT) plus 1,940 Google Fonts.
- **Font weight**: the dropdown lists exactly the weights the selected family ships, labelled Thin (100) / ExtraLight (200) / Light (300) / Regular (400) / Medium (500) / SemiBold (600) / Bold (700) / ExtraBold (800) / Black (900) / UltraBlack (1000). Families outside the catalog fall back to Regular + Bold. Switching to a family that lacks the current weight snaps to the numerically nearest one it does have.
- **Font style**: normal or italic
- **Text align**: left, center, right, justify
- **Line height**: stored per text layer (default 1.4× the font size). Not in the options bar, but adjustable in the **Text panel** (0.5× – 4×).
- **Letter spacing**: stored per text layer (default 0). Not in the options bar, but adjustable in the **Text panel** (−20 – 200 px); applied in the WASM engine (cosmic-text has no native tracking) and respected by the path-bound layout.
- **Paragraph spacing**: extra space between paragraphs, stored per text layer (default 0). Text-panel only (0 – 200 px), also applied in the engine.
- **Underline (`U`)**: toggle a horizontal stroke 10% of the font size below the baseline, 8% of font-size thick
- **Strikethrough (`S`)**: toggle a horizontal stroke 32% of the font size above the baseline, 8% of font-size thick
- **Mode**: point text (no wrap) or area text (fixed width with wrapping)
- **Bind to path**: a Path dropdown in the text options bar lists every stored path. Once bound, glyphs are placed one by one along the path's arc-length and rotated to match the local Bezier tangent (works on both open and closed paths). Live editing (typing) re-flows the type along the curve in real time, and editing the path's anchors invalidates the cached layout so the text follows. Selecting "None" unbinds and restores the layer's pre-bind position.

**Font browser** (the Font control in the text options bar)
- Opens as a portalled dropdown anchored under the trigger button (repositioned to stay on screen near the viewport edges), with a **search box** focused automatically on open — typing filters the whole catalog by substring, case-insensitive.
- Fonts are grouped under **Sans Serif / Serif / Display / Handwriting / Monospace** headers, each showing the count in that category; families are sorted alphabetically inside a group.
- The list is **virtualized** (48 px rows, only the visible window rendered) so a ~2,000-entry catalog scrolls without jank. Each row shows a pre-rendered 48 px PNG preview of the family (served from jsDelivr), falling back to the family name in plain text when the catalog has no preview or the image fails to load.
- **Keyboard**: ↑ / ↓ move the highlight (skipping category headers and auto-scrolling it into view), Enter picks the highlighted family, Escape closes and returns focus to the trigger. Clicking outside also closes it.
- **Loading is on demand**: picking a Google family injects its `css2` stylesheet for DOM previews *and* fetches the binary for the selected weight into the WASM engine's font database so the canvas renders the real face. The binary comes from the exact TTF path baked into the generated catalog (jsDelivr → `google/fonts` repo), falling back to the css2 API's latin-subset WOFF2 (decoded in the engine) and finally to the bundled Inter if every fetch fails. Fetched binaries are cached per family+weight, so switching back is instant.

**Editing keys** (active while a text layer is being edited)
- **Shift+Enter** or **Tab**: commit the edit and exit text editing (plain Enter inserts a newline). Tab also swallows the browser's default focus change so the next single-key shortcut isn't captured by a newly-focused element.
- **Escape**: cancel the edit. If the layer was newly created in this editing session, it is removed entirely; otherwise the layer keeps its prior text.
- **Caret movement**: ←/→ move one character; **⌥←/→** jump by word (Unicode letter/number/underscore runs); **⌘←/→** and **Home/End** jump to line start/end; **↑/↓** move a line at a time, preserving a *goal column* across short lines via engine-provided caret geometry (on the first/last line they snap to the line boundary).
- **Selection**: hold **Shift** with any caret-movement key to extend a highlighted selection; **⌘/Ctrl+A** selects all (a real range, not just a caret jump). On the canvas, a plain click places the caret and begins a **drag-select**, **Shift+click** extends the selection, and **double-click** selects the word under the pointer. A click **inside** the text repositions the caret; a click **outside** commits the edit.
- **Clipboard** (system clipboard): **⌘/Ctrl+C** copies the selection, **⌘/Ctrl+X** cuts it, and **⌘/Ctrl+V** pastes plain text into the buffer (replacing any selection). Image paste is suppressed while a text layer is being edited.
- **Backspace / Delete** remove the selection if there is one, otherwise the character before/after the caret.

---

## Selection Tools

### Rectangular Marquee
- **Aspect ratio lock**: width/height constraint
- **Feather**: 0 - 250 px (soft edge applied after the marquee is committed). The blur is a **two-pass separable Gaussian on the GPU** — one horizontal and one vertical pass over normalized weights `exp(-i² / 2σ²)` with `σ = radius / 2` — not a box blur. **The engine clamps the radius to 63 px**, because the blur shader carries a fixed `u_weights[64]` array, so every slider value from 63 to 250 produces an identical result.
- **Cmd/Meta+drag**: holding meta while dragging temporarily forces a 1:1 (square) aspect ratio for the duration of the press, regardless of the persistent aspect-ratio toggle. Releasing meta returns to the unconstrained or persistently-locked behavior immediately.

### Elliptical Marquee
- **Aspect ratio lock**: width/height constraint
- **Feather**: 0 - 250 px (same GPU feather pipeline as the rectangular marquee)
- **Cmd/Meta+drag**: holding meta forces a 1:1 (circle) aspect ratio while dragging, identical to the rectangular marquee transient lock.

### Lasso (Freehand)
- No configurable parameters

### Magnetic Lasso
- **Width**: 1 - 40 px (perpendicular search radius from the cursor path)
- **Contrast**: 1 - 100% (minimum edge strength to snap onto)
- **Frequency**: 0 - 200 px (distance between auto-placed anchors; 0 disables auto-anchoring)
- Edge detection runs in WASM against the active layer's GPU texture; only snapped coordinates cross back to JS

### Magic Wand
- **Tolerance**: 0 - 255
- **Contiguous**: on/off
- **Graduated**: on/off — when enabled, the wand uses a gradient-aware flood fill that produces partial-coverage selection edges across smooth color transitions, instead of a hard threshold cut
- **Feather**: 0 - 250 px (shared marquee feather slider; applied after the wand fill)
- **Shift+click**: adds the new region to the existing selection; **Alt/Option+click**: subtracts it (both combine against the current selection mask via `combineSelections`). Clicking with no modifier replaces the selection, and an Alt-subtract that empties the selection clears it.

### Quick Selection
- **Size**: 1 - 100 px (brush radius for the paint stroke; default 20)
- **Tolerance**: 0 - 255 (per-channel color distance threshold; default 32)
- **Edge Strength**: 0 - 100 (Sobel gradient threshold — higher values stop the grow at stronger edges; default 50)
- **Mode**: add or subtract
- **`[` / `]` do not resize the Quick Selection brush**, and arrow keys do not nudge the selection while this tool is active — it is missing from both handlers' tool lists (see [Single-Key Shortcuts](#single-key-shortcuts) and [Move](#move)).
- Paint over the canvas to grow (or shrink) the selection: each pointer-move samples the seed color under the cursor and runs a flood-fill region-grow constrained by the brush radius, the tolerance, and the edge strength. Strokes accumulate across many sample points so dragging across a region progressively absorbs it. The pre-stroke mask is preserved so a single undo restores the prior selection.

### Selection Operations
- **Combine modes are per-tool, not global.** There is no shared add / subtract / intersect mode switch. Only two tools combine with an existing selection: the **Magic Wand** (Shift+click adds, Alt/Option+click subtracts) and **Quick Selection** (its own add / subtract Mode control). The marquee, lasso, and magnetic lasso tools always replace the selection — they read no Shift or Alt modifier for combining. The underlying mask combiner also implements an **intersect** mode, but no caller ever requests it, so intersect is unreachable from the UI.
- Invert selection (`⇧⌘I`) — inverts every mask value (`255 − v`, so partial coverage inverts to its complement rather than snapping) and sets the reported selection bounds to the **whole document**, since an inverted selection almost always touches the canvas edges.
- Select all (`⌘A`)
- Deselect (`⌘D`)
- **Move the selection outline**: with a rectangular or elliptical marquee tool active, press-drag from *inside* an existing selection to translate the selection mask itself — the marching-ants outline moves while the underlying pixels stay put (any active floating selection is dropped first). Arrow keys nudge the same marquee bounds.
- **Click to deselect**: a single click (drag < 2 px) with a marquee tool clears the active selection, the same as `⌘D`.
- Selection from layer alpha — `Cmd/Ctrl+click` a layer thumbnail (non-transparent pixels become the selection)
- Path → Selection (from the Paths panel)
- **Selection → Path**: traces the selection mask with marching squares, simplifies the contour with Douglas-Peucker, and fits smooth cubic Bezier anchors using Catmull-Rom tangents. The result is added to the Paths panel as a new path. Disabled when nothing is selected.
- **Grow…**: expands the selection by an integer pixel amount (1 - 100 px)
- **Shrink…**: contracts the selection (1 - 100 px)
- Grow and Shrink are **CPU-side binary morphology**, unlike Feather: each finds the pixels on the mask border (any non-zero pixel with a strictly-zero 4-neighbour) and paints a disc of the given radius through them, writing a hard 255 for Grow and a hard 0 for Shrink. Two consequences: any partial coverage inside that disc is flattened to fully-selected or fully-unselected, so growing and then shrinking by the same amount does **not** restore a feathered edge; and because "selected" means non-zero, Grow measures from the outermost fringe of a feathered selection rather than from its 50 % line.
- **Feather…**: softens the selection edge, running the same two-pass GPU Gaussian as the marquee's own Feather slider. The dialog offers radius 1 - 250 px but the engine clamps it to **63 px**, so values above 63 all land on the same result.

### Marching Ants (selection outline)

The outline is drawn on the 2D overlay canvas, not by the GPU compositor.

- **The ants trace the 50 % contour.** Edge extraction thresholds the mask at **128**, so a selection is outlined where it crosses half coverage. A soft selection whose values are all below 128 — a heavily feathered edge, or the selection returned by exiting a quick mask that was painted at low opacity — is fully active and does constrain painting, but draws **no ants at all**. The absence of an outline is not proof of an empty selection.
- Edge segments are chained into connected polylines by matching shared endpoints, so the dash pattern flows continuously around each contour instead of restarting on every one-pixel segment.
- Each contour is stroked twice: a solid black under-stroke, then a white dashed over-stroke on top, so the outline stays legible over any background. Line width is `1.5 / zoom` and the dash is `8 / zoom` on/off, both zoom-compensated so the ants keep a constant on-screen size. The dash offset cycles over a 120-frame period.
- Contours are cached against the mask buffer's identity and retraced only when the mask itself is replaced, and the edge scan is clipped to the selection's bounding box (expanded 1 px) rather than the whole canvas — without that clip a live drag on a large document collapses to a few frames per second.
- **While a new marquee is being dragged out the ants are drawn straight from the rectangle or ellipse geometry**, bypassing the mask, the contour tracer, and the GPU bridge entirely; the real mask is only built on release. Dragging an *existing* marquee to a new position instead reuses the traced contours and offsets them through a translate-only transform, so that gesture never retraces either.
- The ants animate on an **overlay-only frame path** that redraws the 2D overlay without recompositing any layer, so an idle selection does not cost a full GPU recomposite every frame.
- When a transform is active the outline is drawn through the transform matrix — see the Transform section for which handles it does and does not follow.

### Quick Mask Mode
- Shortcut: `Q` (toggle). There is also a dedicated toggle button in its own group at the bottom of the toolbox, labelled *Enter Quick Mask (Q)* / *Exit Quick Mask (Q)* and highlighted while the mode is on.
- **Entering** clears the active selection and blits the selection mask GPU-to-GPU into a separate quick-mask texture. With no selection active it starts all-zero — nothing selected.
- **The overlay is blue, and it covers the *unselected* region** — not a red overlay of the selection. Coverage is `(1 − mask) × 0.5`, so fully-unselected areas are tinted `rgb(0, 99, 255)` at 50 % and fully-selected areas are left untouched. It shares the shader branch used by layer-mask edit mode, which is why the two look alike.
- Brush, pencil, and eraser edit the selection mask directly. **The foreground color is reduced to a binary decision**: Rec. 709 luminance ≥ 128 adds to the selection, below 128 subtracts. A mid-gray therefore does not paint partial coverage — it just picks a side. Partial coverage comes from brush hardness and opacity, which shape the dab with a quadratic `1 − t²` falloff plus a 1 px smoothstep edge. The eraser ignores the color and always subtracts.
- **Adding and subtracting are not symmetric.** Adding takes `max(existing, dabStrength)`, so opacity acts as a ceiling — repeated passes at 50 % opacity never push that area past 50 %. Subtracting multiplies by `(1 − dabStrength)`, so repeated passes compound and do drive the mask to zero.
- Works regardless of the active layer — painting only affects the selection mask, not pixels
- **Fill (paint bucket) and Gradient tools route into the quick mask** instead of the active layer while quick mask is on, so smooth selection falloffs (linear or radial gradients) and bucket fills of the selection mask are first-class operations. Quick mask mode takes precedence over layer-mask edit mode if both are somehow active.
- **The Move tool moves painted mask content.** With a marquee active in quick mask, dragging translates both the marquee and the quick-mask pixels inside it: the pixels under the marquee's original position are cleared and the moved content is max-blended into its new position, so it adds to rather than replaces whatever it lands on. Mask content outside the marquee stays put, and the layer texture is never touched.
- **Exiting** reads the quick-mask texture back from the GPU and installs it as the selection. Bounds are computed from any non-zero pixel, so a soft-edged mask reports bounds covering its entire falloff. No feather is applied on the way out — the marquee's Feather slider has no effect on a quick-mask selection.
- **Quick-mask strokes are not undoable.** Painting pushes a *Quick Mask Paint* / *Quick Mask Erase* entry into history, but a history snapshot stores the document, the selection, and layer textures — the quick-mask texture is not among them. Undoing one of these entries restores nothing visible and the painted mask survives; the entry still consumes an undo step.

---

## Transform

Transform is **selection-bound** — there is no separate transform tool and no
"free transform the whole layer" mode. The handles are drawn on top of the
marching ants, and Escape or `⌘D` tears both down together.

Seeding a transform is an explicit step that individual call sites opt into,
*not* something `setSelection` does on its own. Committing a marquee, lasso,
wand or quick-select drag seeds one, as do loading a layer's alpha,
converting a layer mask to a marquee, arrow-key nudging a selection, and the
Select menu's Grow / Shrink / Feather dialog. **Select All (`⌘A`) and Invert
Selection do not** — they call `setSelection` alone, so a fresh `⌘A` selects
the document without putting any handles on screen.

### Who responds to the handles

- **Move tool** — the only tool that transforms *pixels* through the handles.
- **Selection tools** (rectangular/elliptical marquee, lasso, magnetic lasso,
  wand) — grabbing a handle scales the **selection outline only**, leaving
  pixels untouched. Only the 8 scale handles respond; rotation handles are
  ignored, so a drag on one falls through and starts a brand-new selection.
  The rebuilt mask is a rectangle or an ellipse depending on which marquee
  tool is active, and the rebuild is coalesced to one allocation + GPU upload
  per animation frame (a full-document mask on a 4K canvas is ~16 MB, so a
  raw pointer-event-rate rebuild would thrash).
- **Every other tool** (fill, eyedropper, text, …) ignores the handles
  entirely and dispatches to its own handler. This is deliberate: at low zoom
  over a small selection the handle hit-radius can cover the whole selection
  and would otherwise swallow every click (#222).

### Handles

- **12 handles**: 8 scale (4 corners + 4 edge midpoints) and 4 rotation
  handles, each sitting 20 document-px diagonally outside its corner and
  tethered to it by a line. Rotation handles are hit-tested **first**, so they
  win where the two overlap.
- **Hit radius** is `8 / zoom` in document space — constant in screen terms.
  For the Move tool it is additionally clamped to at most 80% of the
  selection's smaller half-extent (and at least 1 px) so a click near the
  middle of a small selection can't register as a handle grab.
- **Cursors**: `nwse-resize` / `nesw-resize` on the corners, `ns-resize` /
  `ew-resize` on the edge midpoints, `crosshair` on the rotation handles.
- **Drawing**: a blue (`#00aaff`) quad through the four corners, white filled
  squares (6 px) on the scale handles, white filled circles (5 px radius) on
  the rotation handles. All sizes divide by zoom, so the chrome stays the same
  on-screen size at any magnification.
- The **marching ants follow translate, rotate, and scale** but *not* skew and
  *not* the distort/perspective corner offsets — in those three modes the
  handle box deforms while the ants outline does not.

### Modes

Free / Skew / Distort / Perspective, selected from a segmented button group in
the Move tool's options bar (visible only while a selection is active).
**Switching mode commits the in-flight transform and resets to identity** on
the current selection bounds — a rotation cannot be carried into Distort, it
gets baked first.

- **Free** — scale from the 8 scale handles, rotate from the 4 rotation
  handles.
- **Skew** — edge and corner handles skew instead of scaling, clamped to
  **±60°** on each axis. `left`/`right` produce vertical skew; `top`, `bottom`
  **and all four corners** produce horizontal skew only. The edge opposite the
  one being dragged is pinned via a translate compensation.
- **Distort** — a corner handle moves that corner alone; an edge handle
  translates both corners of that edge together. No clamping, so corners may
  cross over each other.
- **Perspective** — dragging a corner moves it *and mirrors the other corner
  of the same horizontal edge* (one `+dx`, the other `−dx`, both `+dy`) while
  the opposite edge stays fixed, giving the trapezoid / vanishing-point
  effect. Edge handles behave as they do in Distort.
- In Distort and Perspective the corner geometry is built from the corner
  offsets alone, so the **rotation handles have no visible effect** in those
  two modes.

### Scale, rotate, and modifiers

- **Scale** pins the opposite edge or corner: the box grows by the drag delta
  and the center moves by half of it. The drag delta is un-rotated into the
  box's own axes first, so scaling behaves correctly on an already-rotated
  selection. Scale is floored at **0.01** per axis (and has no ceiling), so a
  handle cannot be dragged through the far edge to flip content — use the flip
  buttons for that.
- **`Cmd`/`Meta` + drag a scale handle** forces `scaleX == scaleY` by
  **averaging the two axis scales**. On a corner handle that reads as the
  expected uniform scale; on an *edge* handle only one axis was driven by the
  drag, so averaging applies half the drag's magnitude to both axes.
- **Rotation** is measured from the center of the current (scaled, translated)
  bounds. **`Cmd`/`Meta` + drag a rotation handle** snaps to 15° increments
  (`π/12`); enabling grid + snap-to-grid applies the same snap automatically
  without the modifier.
- Grid + snap-to-grid *also* snaps the pointer position to grid cells while
  dragging a **scale** handle — a separate effect from the 15° rotation snap.
- Only `metaKey` is read — this is Cmd on macOS and the Windows/Super key
  elsewhere, **not** Ctrl.

### Commit lifecycle

- Grabbing a handle pushes a single **"Transform"** history entry, then floats
  the selected pixels into a GPU texture and composites them live each frame —
  as an inverse affine matrix in Free/Skew, or as a 4-corner homography in
  Distort/Perspective.
- **Releasing the mouse does not commit.** The GPU float is deliberately kept
  alive so a follow-up grab re-derives from the *original* floated pixels;
  successive scale/rotate drags therefore do not compound resampling loss.
- The float is dropped — baking the result into the layer texture — on
  **Escape**, **`⌘D`**, or **selecting a different layer** in the Layers panel.
- The selection mask is not recomputed during the drag; it is rebuilt from the
  committed pixel alpha afterwards, which keeps it from drifting away from
  what the GPU actually rendered.
- Floating a **text** layer expands the buffer to the layer's diagonal so
  rotation doesn't clip the glyphs.

### Quick transforms

- **Flip Horizontal / Flip Vertical** (options bar, next to the mode buttons)
  apply instantly to the selected content: float → composite the flip matrix →
  drop → re-select from the committed alpha. They require an active selection.
- **Rotate 90° CW / CCW** sit in the Move tool's own options-bar group and are
  **dual-purpose** — with a selection active they rotate the selected content,
  with no selection they rotate the entire active layer.

---

## Other Tools

### Move
- Drag to reposition layers
- Arrow key nudge — 1 px by default; when grid + snap-to-grid is enabled, each key press nudges by exactly one grid cell. Arrow keys also nudge the active marquee bounds when a selection tool is active — but the responding set is an explicit list of **five** tools (rectangular marquee, elliptical marquee, lasso, magnetic lasso, magic wand). **Quick Selection is not in it**, so arrow keys do not nudge a selection while that tool is active; switch to any other selection tool and the same selection nudges fine. Under every other tool the arrow keys fall through untouched.
- Snap to grid
- Snap to guides
- **Snap to layers** (View menu → "Snap to Layers"): while dragging, the moving layer's left/right/top/bottom edges and X/Y centers attract to the matching edges and centers of every other visible layer within a 5 px threshold. Magenta alignment guides span the document while a snap is engaged and clear on mouse-up.
- **Align**: left, center-h, right, top, center-v, bottom
- **Fit** (options-bar button): scales the active raster layer so its longest side matches the canvas — preserving aspect ratio — and centers it on the artboard. Useful for bringing an oversized pasted/dropped image into view; reuses the GPU `scaleLayerTexture` path so no pixel data round-trips through JS.
- **Alt/Option+drag (no active marquee)**: duplicates the active layer in place, then moves the new copy — leaves the original layer untouched.
- **Alt/Option+drag (with an active marquee)**: copies the selected pixels of the active layer into a floating duplicate and moves that copy, leaving the original pixels under the selection intact (Photoshop-style "alt-drag the selection").
- **Cmd/Meta+drag (transform handles)**: forces a uniform scale (by averaging the two axis scales) and snaps rotation to 15° increments. Grid + snap-to-grid applies the same rotation snap automatically, and additionally snaps the pointer to grid cells while scaling. The Move tool is the only tool whose handle drags transform pixels — see [Transform](#transform).

### Paste / Drop behavior

Paste takes one of two routes depending on where the image came from.

- **Pasting back content copied inside Lopsy** (`⌘C` / `⌘X` / `⇧⌘C`, then `⌘V`) **pastes in place**: the new layer lands at the offset the content was copied from, not at the canvas origin. Copy/cut also mirror the pixels to the system clipboard as a plain PNG so they can be pasted into other apps, and that position-less PNG is what a real browser hands back on paste — so Lopsy compares the incoming image against the GPU-resident internal clipboard and uses the internal (positioned) copy only when the dimensions **and** pixels both match. The comparison samples up to ~4096 pixels, tolerates the small RGB drift a clipboard round-trip introduces under partial alpha, and decodes with `colorSpaceConversion: 'none'` so a wide-gamut round-trip doesn't push values past the match tolerance. A same-size but genuinely different external image (say, a document-sized screenshot pasted after Copy Merged) fails the pixel check and is treated as external.
- **Pasting or dropping an external image** creates a new raster layer at the image's natural dimensions, positioned at the canvas origin, and **auto-selects** the new layer's non-transparent pixels (loads the alpha as a marquee selection). Combined with the **Fit** button, oversized images can be quickly scaled in to fit without first hunting for a transform handle off-canvas.
- File → New and opening an image drop the internal clipboard, since resetting the engine frees the GPU clipboard texture that an in-place paste would read from. A copy made before a New therefore pastes as an external image afterward.
- When duplicating a layer that is wider or taller than the canvas, the +10/+10 visual offset is clamped so the duplicate's far edge never moves past the canvas edge that the original was within (prevents already-oversized layers from being shoved further out of view).

### Eyedropper
- Click (or click-drag) to set the foreground color from the composited pixel under the cursor — samples the on-screen result, not just the active layer.
- **Sample size**: point, 3×3, and 5×5 area-averaging modes are implemented in the sampling logic, but the live canvas eyedropper currently always samples a single pixel — there is no options-bar control to switch sample size yet.
- In **Lab** documents the sample is decoded to sRGB *before* averaging, since the Lab transform is non-linear and averaging encoded values would not match what is under the cursor. The picked value lands in the foreground swatch **as sampled** — it is not snapped to the mode there — but painting with it is constrained on the way to the texture, so eyedropping a stray color in a Grayscale or Indexed document still paints a legal one (see Color Modes).

### Fill (Paint Bucket)
- **Tolerance**: 0 - 255 (default 32)
- **Contiguous**: on/off (default on). Turning it **off** is the "fill by color" mode — instead of flooding outward from the click point, every pixel in the layer within tolerance of the clicked color is filled, whether or not it connects to the click.
- These two are the tool's entire surface: there is no opacity, blend mode, anti-alias, or "all layers" option, and no modifier-key behavior. Shortcut: `G`.
- Fills honor the active selection mask, and route into the quick mask instead of the layer while Quick Mask is on (see Quick Mask Mode).
- **GPU fast paths**: three routes, chosen automatically —
  - *Empty layer or full-coverage fill* → filled directly on the GPU from a synthesized full-coverage (or selection-derived) mask, with no readback.
  - *Non-contiguous ("fill by color")* → a single per-pixel shader that samples the clicked color and fills everywhere within tolerance, optionally clipped by the selection. No readback.
  - *Contiguous fill on real content* → still a CPU flood fill (the BFS is inherently sequential), paying a GPU readback and re-upload.

### Gradient
- **Type**: linear, radial — these are the only two types; there is no angular, reflected, or diamond gradient.
- **Stops**: 2 - 16 color stops with position (0-1), edited in the **Gradient modal** (opened by clicking either the gradient swatch or the "Advanced…" button in the options bar — both go to the same place). Click an empty spot on the handle row to insert a stop there, drag a handle to reposition it, and select a handle to drive a full ColorPicker (HSV square + hue strip + RGB/HSV/hex fields, including alpha) with a percent position readout. Delete is gated at the 2-stop minimum; the 16-stop cap matches the GPU uniform limit. Stops are re-sorted by position on every edit. `Escape` or an overlay click closes the modal.
- **Reverse**: on/off (default off)
- There is no dither, opacity, or blend-mode option, and — unlike Fill (`G`) and every neighbouring tool — **the gradient tool has no keyboard shortcut**; it is reachable only from the toolbox.
- **Cmd/Meta+drag**: snaps the gradient angle to 15° increments while dragging (handy for aligning a gradient to a horizontal, vertical, or 45° axis without having to drag a perfectly straight line). Note this reads `metaKey` only, with no Ctrl fallback, so on Windows/Linux the snap is effectively unreachable.
  - **The snap is linear-only in effect.** It rotates the endpoint about the drag origin while *preserving its distance*, and a radial gradient consumes nothing but `radius = |end − start|` — so in radial mode Cmd changes the rendered result not at all. The on-canvas guide line is drawn from the snapped endpoint either way, so holding Cmd during a radial drag visibly rotates the guide while the gradient underneath stays put.
  - If a symmetry mode is active, pressing Cmd *before* the pointer goes down never starts a gradient at all — the canvas intercepts Cmd+click to reposition the symmetry center (see [Symmetry](#symmetry)). Start the drag first, then hold Cmd.
- **Shift** does nothing in this tool, despite being the angle-constraint convention in Photoshop / GIMP / Figma / Krita.
- **Mask edit mode**: when the active layer's mask is being edited, gradient drags paint into the mask texture instead of the layer pixels.
- **Quick Mask mode**: when Quick Mask is active, gradient drags paint into the GPU quick-mask texture in document space — produces smooth selection falloffs.

### Crop
- **Modes**: Normal (rectangular) or Perspective (4-point quadrilateral correction). The mode dropdown lives in the options bar; switching to Perspective shows Apply / Cancel buttons next to the dropdown.
- **Normal mode**: interactive drag to define crop rectangle. The options bar exposes an **Aspect Ratio** control (W : H number inputs plus a lock toggle, the shared `AspectRatioControl`); when locked, the crop rectangle is constrained to the entered ratio while dragging.
- **Perspective mode**: on first activation a quadrilateral is seeded over the full document. Dragging any of the four corner handles repositions that corner; on Apply, every raster layer is warped by the inverse homography (8×8 DLT solver, bilinear inverse-warp) and the document is resized to the inferred output dimensions (edge-length heuristic). Lets you rectify perspective-distorted photographs of paintings, documents, signs, etc.
- **Edit → Crop**: when a marquee selection is active, the Edit menu's **Crop** item crops the canvas to the selection bounds in one click (equivalent to dragging out the same rectangle with the Crop tool). Disabled when nothing is selected.

---

## Layer Effects

### Drop Shadow
- **Color**: RGBA
- **Offset X/Y**: pixels
- **Blur**: radius
- **Spread**: radius
- **Opacity**: 0 - 1

### Outer Glow
- **Color**: RGBA
- **Size**: radius
- **Spread**: radius
- **Opacity**: 0 - 1

### Inner Glow
- **Color**: RGBA
- **Size**: radius
- **Spread**: radius
- **Opacity**: 0 - 1

### Stroke (Outline)
- **Color**: RGBA
- **Width**: pixels
- **Position**: outside, inside, center

### Color Overlay
- **Color**: RGBA

### Effects on Groups
Layer effects can be attached to **group** layers, not just leaf layers. New groups default to **Normal** (isolated) compositing, so the children pre-composite into a group buffer and the effects (drop shadow, glow, stroke, color overlay) attach to that combined surface — effects render around the group as a whole rather than around each child individually. When a group is switched to **Pass Through** the compositor still allocates an intermediate buffer for the same reason, so effects work in either mode.

---

## Image Adjustments (Non-Destructive)

The Adjustments panel is a reorderable, stackable list of adjustment **nodes** attached to a group layer. It shares the floating **effects drawer** with the Layer Effects panel rather than being one of the dockable panels: the drawer shows the adjustment list when the active layer is a **group**, and the layer-effects list for every other layer type. Layer → **Adjustment Layer…** selects the document's root group, which is the route to the document-level stack. The drawer is dragged by its header (the offset resets when it closes) and resized from the native grip in its bottom-right corner — 420 px wide by default, minimum 280 × 200 px, maximum height 80vh. Because it is anchored to the inner edge of the right dock, it tracks the dock's width as that is resized.

The Add menu is filtered by the document's color mode: outside RGB, the chroma-producing types (Hue / Saturation, Color Balance, Channel Mixer, Photo Filter, Gradient Map, Black & White, Saturation & Vibrance) are hidden, and Curves shows only the composite curve instead of its R/G/B tabs. The filter applies to the **Add menu only** — a node that is already on the stack keeps its full controls whatever the mode. See Color Modes.

Per-node controls (header):
- **Eye** icon — enable / disable this node without removing it
- **Trash** — remove
- **Chevron** — expand / collapse the node's body. Expansion is **exclusive**: only one node is open at a time, and opening a second collapses the first. The open-node state is panel-local, so closing the drawer forgets which node was expanded.
- Drag the header (grip) to reorder; sliders inside the body don't trigger the reorder drag
- New nodes auto-expand on creation

Panel footer: **Add Adjustment** opens the type menu, and the eye button beside it is a **group-wide bypass** that mutes the entire stack in one click without changing any individual node's enabled state — the whole group is skipped before it reaches the engine, so a bypassed stack costs nothing to render. The bypass is per-group and is saved in the `.lopsy` project, so a document reopens with the same groups muted. An empty stack reads *"No adjustments yet. Add one below."*

Available node types (Add menu — labels as they appear in the menu and node headers):
- **Exposure** — stops, -5 to +5 (multiplier = 2^value)
- **Contrast** — -100 to +100
- **Highlights & Shadows** — Highlights -100 to +100, Shadows -100 to +100, Whites -100 to +100, Blacks -100 to +100
- **Saturation & Vibrance** — Saturation -100 to +200, Vibrance -100 to +200 (the -100 floor is full desaturation; the cap extrapolates past 1× saturation distance from gray and only clips at the gamut edge)
- **Vignette** — 0 to 100 (now correctly piped through the per-group adjustment pipeline)
- **Curves** — per-channel tone curves (RGB master + R / G / B), evaluated as
  monotone cubic Hermite splines. Master applies to every channel first,
  then per-channel curves remap their own value. Runs as a single 256×1 RGBA
  LUT texture sampled in the GPU adjustments shader; identity curves bypass
  the lookup.
  - **Editing** (`CurveEditor`): click empty space to add a point — the new point is picked up for dragging in the same gesture; drag to move; double-click a point to remove it; or *yank* it out by dragging it clear of the top or bottom edge. The two **endpoints are pinned** to x=0 and x=1 — they move vertically only and cannot be removed. The canvas draws quarter gridlines plus a diagonal identity reference, and the curve itself is plotted from the same 256-entry LUT the GPU samples, so the preview cannot drift from the render. A hint line under the canvas reads *"Click to add a point · Drag to move · Double-click to remove"*.
  - **Reset** button, one per channel — resets only the channel whose tab is active, and is disabled while that channel is already identity.
  - **Histogram background**: R / G / B histograms render behind the curve. On the **RGB master** tab all three draw as translucent red / green / blue fills composited additively, so overlapping ranges read brighter; on a **per-channel** tab the selected channel is drawn in its own color and the other two are muted to dark gray.
- **Levels** — Photoshop-style visual editor with a layered RGB histogram and handle-driven controls (no sliders). Per-channel input/output remap with RGB master + R / G / B tabs:
  - **Input black / gamma / white**: three rectangular handles below the histogram strip drive Input Black, Gamma (0.1 – 10, log scale), and Input White. Drag the handles directly; numeric readouts update live.
  - **Output black / white**: two handles on a gradient bar drive Output Black and Output White. Handles cannot cross: input black stays at least 1/255 below input white, and output black cannot pass output white.
  - **Readouts** sit under each axis — input/output black and white in 0 – 255, gamma to two decimals.
  - **Histogram visualization**: R, G, and B histograms render layered as distinct shades of gray with additive ("lighter") compositing, so common ranges read brighter. RGB tab shows all three layers; per-channel tabs draw the active channel in its own color and mute the others. With nothing readable yet the strip prints *"No image data"*.
  - **Reset** button — unlike Curves' per-channel reset, this one restores **all four channels** at once, and is disabled only while every channel is already identity.
  - Master is applied first, then per-channel levels. Compiled to a 256×1 LUT and shares the GPU adjustments path with Curves; identity levels bypass the lookup.
  - Note that Levels keeps its R / G / B tabs in **every** color mode — the capability flag meant to hide them outside RGB has no consumer (see Color Modes → Declared but not enforced), so Levels and Curves disagree here.
- **Invert** — single toggle (no numeric controls); inverts RGB at composite time.
- **Hue / Saturation** — Hue -180° to +180°, Saturation -100 to +100, Lightness -100 to +100. Operates per-pixel in HSL space.
- **Color Balance** — tone-range tabs (Shadows, Midtones, Highlights) each with Cyan — Red, Magenta — Green, and Yellow — Blue sliders (-100 to +100). Per-pixel weighting determines how much each tonal range contributes to the shift. The selected tab is view state, not node state: it always opens on **Midtones**, so re-expanding a node does not return to the range you were last editing.
- **Photo Filter** — a "Filter color" swatch (native color input, default warm amber `#ffa000`), Density 0 - 100 (default 25), and Preserve Luminosity (checkbox, **on** by default). Blends a tinted overlay over the pixel; when Preserve Luminosity is on, the tinted result is re-luminance-matched to the source.
- **Black & White** — six channel sliders (Reds, Yellows, Greens, Cyans, Blues, Magentas), each -200 to +300, controlling how strongly that hue contributes to the monochrome output luminance. A new node starts at Photoshop's classic mix — Reds 40, Yellows 60, Greens 40, Cyans 60, Blues 20, Magentas 80 — and those are also the per-slider double-click reset targets.
- **Channel Mixer** — color-coded output-channel tabs (R / G / B) each with Red, Green, Blue (-200 to +200), and Constant (-200 to +200) sliders. Lets a single output channel be remixed as a linear combination of the source channels plus a bias. A new node opens on the Red output at identity (Red 100, others 0); each slider's double-click reset target is 100 for the source channel matching the active output tab and 0 for the rest, so a double-click restores identity rather than zeroing the channel.
- **Gradient Map** — visual gradient editor (shared `GradientEditor` component) with draggable rectangular stop handles on a live gradient bar; clicking an empty spot on the handle row inserts a new stop at that position. The selected stop drives a full `ColorPicker` (HSV square + hue strip + RGB/HSV/hex fields), with a readout showing *Stop N of M* and its position as a percentage, plus a trash button that deletes it. A minimum of 2 stops is enforced — the delete button greys out at two. New nodes start black → white. The stop list is compiled into a 256×1 RGBA LUT at sync time and applied as a luminance-indexed lookup in the GPU adjustments shader.

**Histogram sourcing** (shared by the Curves and Levels editors via the `useGroupHistogram` hook): the histogram is not the active *layer* — it aggregates every **visible, non-group child of the active group** (falling back to the root group's children), read back from their GPU textures. Pixels with alpha below 8 are skipped so the transparent parts of a half-painted layer don't swamp the zero bin, and large layers are stride-sampled to roughly 50,000 pixels each. The vertical scale is the 99.5th percentile of the non-empty bins rather than the maximum, so one flat-fill spike can't flatten everything else. It refreshes when pixels change — paint operations show up live — but **deliberately not when an adjustment changes**, so what you see behind the curve is always the source distribution, never the graded result. If the textures aren't readable yet it retries for a few frames before falling back to the empty state.

All 14 adjustment types now have first-class UI controls and are fully GPU-accelerated. Internally the node list compiles down to the legacy flat `ImageAdjustments` shape so the GPU compositor's adjustment pass is unchanged.

**How a stack of nodes composes.** That flattening step is worth understanding, because it decides what happens when the same type appears twice:
- **Additive types accumulate.** Exposure, Contrast, Highlights & Shadows, Saturation & Vibrance, Vignette, Hue / Saturation, and Color Balance sum their values across every enabled node — two `+1` Exposure nodes equal one at `+2`.
- **Curves, Levels, Photo Filter, Black & White, and Gradient Map are last-enabled-wins.** A second node of one of these types replaces the first outright rather than chaining with it; stacking two Curves nodes does not apply one curve after the other.
- **Channel Mixer composes across output channels but not within one.** Each node writes only the output channel on its active tab, so three nodes (one on R, one on G, one on B) combine into a full mixer matrix, while two nodes on the same output tab collapse to the last one.
- **Invert toggles.** Each enabled Invert node flips the flag, so a second one cancels the first and the composite comes out uninverted.
- **Order matters only for the last-wins types.** Addition is commutative, so dragging an Exposure node above or below a Contrast node changes nothing; reordering is meaningful when two nodes compete for the same slot.
- Disabled nodes drop out of the aggregation entirely rather than contributing an identity value.

**Default adjustment stack on new documents**: every freshly created document (and every image opened or flattened) seeds the root group with four identity-state adjustment nodes — Levels, Curves, Exposure, and Hue / Saturation — so users can grade an image without first hunting through the Add menu. Identity nodes are bypassed in the GPU pipeline so there is no performance cost until a slider is moved. New Document filters that set against the chosen color mode, so a new Grayscale, Lab, or CMYK document gets three nodes rather than four (Hue / Saturation is dropped).

**Adjustment Layer… menu (Layer menu)**: a one-click entry that selects the document's root group, opens the effects/adjustments drawer, and shows a brief explanatory info modal — designed to onboard new users to Lopsy's adjustment-node model (Photoshop puts each adjustment on its own layer; Lopsy stacks them inside the group's adjustment list).

---

## Filters (Destructive, GPU-Accelerated)

### Filter Dialog (shared)

Most filters open the same generic **Filter Dialog** — a 380 px floating modal built from a per-filter parameter list. Numeric params render as sliders; a param with a small fixed value set renders as an inline **segmented toggle** instead (e.g. Add Noise's Mode and Distribution, Emboss's Type). Params flagged doc-scaled raise their slider ceiling to `1.5 × longest-document-side` (capped 5000 px). Even a zero-parameter filter (Find Edges) opens the dialog — just the Preview toggle and Apply / Cancel. The same dialog machinery also backs the Select menu's **Grow / Shrink / Feather** commands. Pattern Fill and Color LUT are the exceptions: each has its own dedicated dialog (pattern-thumbnail grid, LUT preset picker + `.cube` import).

- **Preview** checkbox (off by default): enabling it renders the filter live on the canvas *and* turns the modal's dark backdrop fully transparent and click-through, so the whole image stays visible while you tune — only the dialog itself remains interactive. Slider changes are debounced ~150 ms before the preview re-renders. Confirming with Preview on commits the exact previewed pixels.
- **Regenerate** button (randomized filters only) — see the Regenerate note under Render.
- **Enter** applies the filter; **Escape** cancels. Cancelling (or closing while a preview is live) discards the preview and restores the layer.
- **Draggable**: the title-bar header (cursor: grab) drags the dialog anywhere on screen, so it can be moved clear of the region being previewed.

### Blur
- **Gaussian Blur**: radius 1 - 400 px
- **Box Blur**: radius 1 - 100 px (auto-scales with document size)
- **Motion Blur**: angle 0 - 360°, distance 1 - 100 px (auto-scales with document size)
- **Radial Blur**: amount 1 - 100 (centered)
- **Tilt-Shift Blur**: focus position 0–100% (center of sharp band along blur axis), focus width 0–100% (width of the sharp band), blur radius 1–32 px (max blur intensity in out-of-focus regions), angle 0–360° (rotation of the focus plane). Creates selective-focus miniature photography effects by blurring areas outside a configurable focus band while leaving the focus zone sharp. **Cmd/Meta+drag** on the on-canvas angle handle snaps the focus-plane rotation to 15° increments.
- **Surface Blur**: radius 1 – 50 px (fixed range, does not auto-scale with document size), threshold 1 – 255 (max channel difference a neighbour is allowed to have before being excluded from the blur). Edge-preserving blur that smooths low-contrast regions (skin, gradients, noise) while leaving edges sharp — a Bilateral-style filter implemented as a single GPU pass.

### Sharpen
- **Unsharp Mask**: radius 1 - 50 px (auto-scales with document size), amount 0.1 - 5, threshold 0 - 255

### Color
- **Brightness / Contrast**: -100 to +100 each
- **Hue / Saturation / Lightness**: hue -180 to +180, saturation -100 to +100, lightness -100 to +100
- **Invert**: no parameters
- **Desaturate**: no parameters (Rec. 709 luminance)
- **Posterize**: levels 2 - 32
- **Threshold**: level 0 - 255

### Noise
- **Add Noise**: amount 1 - 100 (default 25), Mode: Color / Mono (monochromatic), Distribution: Uniform / Gaussian (Uniform is the classic evenly-spread noise; Gaussian clusters values near zero for a finer, film/sensor-grain look)

Add Noise runs through the standard generic filter dialog with live preview and the **Regenerate** button (see the Regenerate note under Render) — each regenerate draws a fresh random seed so users can spin through noise patterns before committing. (The former standalone "Fill with Noise" filter was just Add Noise at maximum amount and has been removed.)

### Pixelate
- **Pixelate / Mosaic**: block size 2 - 64 px

### Halftone
- **Halftone**: dot size 2 - 32 px, density 0.25 - 3 (default 1.0 — scales dot coverage/frequency relative to the cell grid), angle 0 - 180 degrees, softness 0 - 4

### Stylize
- **Find Edges**: Sobel edge detection, no parameters
- **Cel Shading**: levels 2 - 10, edge strength 0 - 100
- **Solarize**: threshold 0 - 255 (inverts tones above the threshold, classic darkroom effect)
- **Kaleidoscope**: segments 2 - 32, rotation 0 - 360 degrees (mirrors the image into a radial wedge pattern around the center)
- **Oil Paint**: radius 1 - 10, sharpness 0.1 - 5.0 (Kuwahara filter that smooths color regions while preserving edges, creating a painterly look)
- **Chromatic Aberration**: amount 1 - 50 px, direction 0 - 360 degrees (splits RGB channels along a configurable axis, creating retro lens fringing and glitch effects)
- **Bloom**: threshold 0 - 100%, soft knee 0 - 100%, radius 1 - 64 px, intensity 0 - 200% (extracts bright areas above the threshold, applies Gaussian blur, and additively blends the glow back onto the original image — creates cinematic light bloom and soft glow effects around highlights)
- **Emboss**: angle 0 - 360° (light direction), strength 1 - 100 (relief height), type: emboss or pillow emboss (creates a 3D relief effect by computing directional highlights and shadows from luminance gradients — emboss mode applies uniform relief, pillow emboss fades the effect toward edges for a raised-pillow appearance)
- **Color LUT**: 8 built-in presets (Warm Vintage, Teal & Orange, Noir, Cross Process, Faded Film, Sunset, Cool Blue, Cyberpunk), intensity 0 - 100%, .cube file import (applies 3D color lookup table color grading via a GPU shader that samples a 2D-unwrapped LUT strip texture — supports industry-standard .cube files and procedurally generated presets with trilinear interpolation between blue slices)
- **Voronoi**: cells 2 - 200, edge width 0 - 20 px, seed 0 - 999 (partitions the image into irregular Voronoi cells, each filled with the color sampled at the cell center, with configurable black edge lines between cells — creates a stained glass / crystallize effect)

### Distort
- **Pixel Stretch**: amount 1 - 200 px, bands 2 - 50, seed 0 - 999, RGB split 0 - 1.0 (shifts horizontal scan-line bands by random offsets with per-channel separation, creating glitch / VHS corruption effects)
- **Lens Distortion**: strength -100 to +100 (negative = pincushion, positive = barrel), zoom 50 - 200%, chromatic fringing 0 - 100% (applies barrel or pincushion radial distortion with optional per-channel color separation at edges, simulating real camera lens effects)
- **Mesh Warp**: interactive grid-based distortion overlaid directly on the canvas. Activated from the Move tool's options bar; grid handles are draggable in document space, with bilinear interpolation between points handled on the GPU. When a marquee selection is active, the warp is constrained to the selection's bounding box (pixels outside pass through unchanged); otherwise the warp covers the whole layer. Grid sizes 3×3 to 6×6 with live preview, reset, and undo support.
- **Liquify** (Filter menu → "Liquify…" or `⌘⇧X`): opens a floating, modal-style session that paints into a per-pixel displacement map sampled by the GPU on each frame. Apply commits the warp to a new history snapshot; Cancel discards the displacement map.
  - **Modes**: `push` (drag pixels along the cursor direction), `twirl CW` / `twirl CCW` (rotate pixels around the brush center), `bloat` (push outward), `pinch` (pull inward)
  - **Brush Size**: 4 - 500 px
  - **Pressure**: 1 - 100% (multiplier for displacement intensity)
  - Quintic radial falloff inside each dab so the warp eases off smoothly at the brush edge

### Render
- **Clouds**: scale 1 - 20, seed
- **Smoke**: scale 1 - 20, turbulence 0 - 100, seed
- **Fibers**: variance 1 - 64 (color variation between strands), strength 1 - 64 (vertical coherence — higher values produce straighter fibers, lower values produce more wavy/tangled fibers), seed. Generates random vertical fiber textures resembling paper, cloth, or hair using multi-octave 1D noise with 2D wander perturbation. GPU-accelerated GLSL shader.
- **Regenerate** button: the randomized filters (Clouds, Smoke, Fibers, and **Add Noise**) show a circular-arrow button next to the Preview checkbox in the generic filter dialog. Clicking it picks a new random seed and refreshes the preview, so users can spin through variations without re-opening the dialog. Confirming the dialog with Preview active commits the exact previewed pixels (the seed is captured at preview time and the GPU result is snapshotted, so what you see is what you get).
- **Pattern Fill**: tiles a user-defined pattern across the active layer. Reached from **Edit → Fill with Pattern…** (it is documented here with the other render filters because it shares the generic filter-dialog machinery, but it has no Filter-menu entry of its own).
  - **Define Pattern** (Edit menu): captures the active layer's pixels as a reusable pattern
  - **Scale**: 10 - 1000% (tile size relative to original pattern dimensions)
  - **Column / Row Offset**: 0 - 100% (shifts the tiling origin along X / Y)
  - Pattern selector grid with thumbnails
  - Live preview support
  - Selection mask support (fills only the selected area)

---

## Blend Modes

| Category | Modes |
|----------|-------|
| Basic | Normal |
| Darken | Multiply, Darken, Color Burn |
| Lighten | Screen, Lighten, Color Dodge |
| Contrast | Overlay, Hard Light, Soft Light |
| Inversion | Difference, Exclusion |
| HSL | Hue, Saturation, Color, Luminosity |
| Group-only | Pass Through |

The four **HSL** modes are RGB-only: they decompose RGB into HSL, so every other color mode drops them from the dropdown and coerces any layer already using one to Normal on conversion (see Color Modes).

### Pass Through (group blend mode)

- Available exclusively on **group** layers. New groups default to **Normal** (isolated) compositing — children pre-composite into a group buffer first, then the group's opacity/effects apply to the combined result, so lowering a group's opacity scales the composited result rather than attenuating each child individually (this diverges from Photoshop, which defaults groups to Pass Through). Pass Through stays as an explicit, user-selectable mode for layouts that genuinely need it.
- In **Pass Through**, children blend directly onto the surface beneath the group, so adjustment layers and effects inside the group affect underlying layers outside the group as well.
- Implemented entirely in the JS sync layer: `engine-sync` flattens pass-through groups before the WASM compositor sees them. The WASM engine itself never receives a "pass through" mode (it has no PSD index or Rust discriminant — exporting a pass-through group to PSD writes 'normal' as a safe fallback).

---

## Layer System

### Layer Types
There are exactly four layer types (`LayerType = 'raster' | 'text' | 'shape' | 'group'`):

- **Raster**: pixel layer
- **Text**: live-editable text
- **Shape**: vector shape (ellipse, polygon — see Shape Tool above)
- **Group**: folder with optional per-group adjustments

Lopsy has **no** Adjustment-layer or Fill-layer type. Adjustments are non-destructive **nodes** stacked on a group rather than layers of their own (see Image Adjustments), and fills are painted into a raster layer.

### Layer Properties
- **Opacity**: 0 - 1
- **Blend mode**: any of 16 modes (plus "Pass Through" on group layers; new groups default to Normal)
- **Visible**: on/off
- **Locked**: on/off
- **Position**: x, y
- **Clip to below**: on/off (clipping mask)
- **Effects**: drop shadow, outer glow, inner glow, stroke, color overlay
- **Mask**: grayscale mask with an `enabled` flag (see the caveat under Layer Operations — nothing in the UI can currently flip it). All mask painting (brush, eraser, pencil, gradient, fill) runs directly on the GPU mask texture — no per-frame CPU→GPU upload, so editing a mask is as fast as painting pixels.
- **Color tag**: optional swatch (red, orange, yellow, green, blue, purple, gray, or none) shown as a vertical bar on the left edge of the layer row. Set via the layer row's right-click context menu; useful for visually grouping/organizing layers in a deep stack.

### Layer Operations
- **New Layer** (`⇧⌘N`, menu-only accelerator — see Single-Key Shortcuts note): appends a blank raster layer above the active one. Refused in **Indexed** color mode (the document is a single flat surface) with an info toast pointing at converting back to RGB. The same guard covers **Group Layers** and **Duplicate Layer**, but *not* text layers — clicking with the Text tool in an Indexed document still adds one.
- **Duplicate Layer** (`⌘J`, menu-only accelerator): clones the active layer in place
- **Group Layers** (`⌘G`, menu-only accelerator): wraps the currently-selected layers in a new group
- **Merge Down** (`⌘E`): composites the active layer into the layer below (the only layer-menu accelerator actually wired to a key handler)
- **Flatten Image**: composites every visible layer into a single raster layer
- **Rasterize Layer**: bakes a **text** layer's current visual into pixels in place, reading the engine's current x/y/w/h so the result lands at the visible position even after GPU texture expansion from upstream paint ops. The button appears in the Layers panel toolbar only while a text layer is active — there is currently no rasterize entry point for shape or group layers.
- **Rasterize Layer Style**: bakes a layer's effects (drop shadow, glow, stroke, color overlay) into the layer's pixels and clears the effect descriptors
- Reorder (drag) and move to group (reparent) — both are the same gesture on the row's drag grip; see Reordering & Drag-and-Drop below
- Rename — double-click the layer's name in its row (see Row Layout)
- Align (left, center-h, right, top, center-v, bottom) — works on **group** layers too: a group has no pixels of its own, so it aligns by the combined content bounds of its descendants and shifts the group plus every child together (matching how dragging a group with the Move tool behaves)
- Add/remove mask — works on raster, text, shape, and **group** layers; group masks are sampled at composite time so the entire group is masked as a single unit (with the group's own opacity and blend mode applied on top)
- **Disabling a mask is not reachable.** Every mask carries an `enabled` flag that is fully plumbed — the engine honors it when compositing, the Layers panel dims the thumbnail when it is off, and `.lopsy` projects save and restore it — but the store action that flips it (`toggleLayerMask`, which would push a *Toggle Mask* history entry) **has no callers**. There is no menu item, button, context-menu entry, or shift-click gesture bound to it anywhere in the app. Masks are created enabled and, short of hand-editing a project file, stay enabled for the life of the document.
- **Cmd/Ctrl+click a layer thumbnail**: loads that layer's alpha as a marquee selection — each pixel's alpha becomes the selection mask value (anything below 1 is dropped), so a soft edge yields a feathered selection rather than a hard one. Any live GPU float is committed first and the layer's JS pixel cache is cleared, so the selection reflects the finished pixels. It also **seeds a transform state** from the resulting bounds and schedules a prefloat, meaning the selection comes up ready to scale/rotate. **Group rows have no thumbnail** (they show a collapse chevron in that slot), so there is no way to load a group's combined alpha this way.
- **Click a layer's mask thumbnail**: always enters mask edit mode (focus switches to the mask reliably; no toggle behavior).
- **Set layer color tag**: right-click a layer row to open a context menu with the 7 tag colors plus "None" to clear. The menu is a `role="menu"` popup at the pointer with a swatch grid, a divider, and a **Cancel** item; any mousedown elsewhere or Escape closes it. Right-clicking the **root group** row opens nothing.

### Layers Panel Row Layout

Rows are listed **top layer first** (the display list walks the layer order in reverse) and each is a fixed **36 px** tall. Nesting is shown by indentation only — **8 px of left padding per depth level** — and a layer inside a collapsed group is omitted from the list entirely, at any depth.

Controls in a row, left to right:

1. **Color tag bar** — an optional vertical bar on the row's left edge, present only when a tag is set (red, orange, yellow, green, blue, purple, gray).
2. **Drag grip** — a `GripVertical` handle, `cursor: grab` (`grabbing` while dragging). This is the **only** place a reorder drag can start; dragging the row body does nothing. Absent on the root group.
3. **Thumbnail** *(non-group layers)* — a 24 px canvas. **Group rows show a collapse chevron here instead**, followed by a folder icon; groups therefore have no thumbnail at all.
4. **Name** — double-click to rename in place. Enter commits (via blur), Escape cancels, and a blank or whitespace-only value is discarded, keeping the previous name.
5. **Opacity readout** — the layer's opacity as a rounded percentage, rendered as a button. Clicking it toggles a **slider row open beneath the layer** (0–100, one per row at a time); clicking again closes it. Pointer-down on the slider pushes a single "Change Opacity" history entry, so a whole drag is one undo step. Absent on the root group.
6. **Visibility eye** — toggles the layer on/off. Note this sits **near the end of the row, after the opacity readout** — not at the left edge. Absent on the root group.
7. **Effects button** — opens that layer's effects/adjustments drawer (see below).
8. **Lock toggle** — the far-right control; locked rows are also styled as locked.

The **root group row** is deliberately stripped down: no grip, no opacity readout, no visibility eye, and no context menu — only the effects button and the lock toggle remain.

- **Effects button**: a three-way toggle — if the drawer is already open on this layer it closes; otherwise the row's layer is made active and the drawer opens. Its icon turns **green** (`#4caf50`) to flag decorated layers at a glance. The test is `enabled` for the five effects, but for groups it is simply "has any adjustment node at all" — a group whose nodes are **all disabled still shows green**. (`hasEnabledNodes` exists in `adjustment-node-utils.ts` for exactly this check but has no callers.)
- **Row states**: the active layer takes an accent tint; other multi-selected layers get a 50 % blend of that tint so the two are distinguishable.

#### Mask Sub-Row
A layer with a mask gets its **own row beneath the layer row** (indented, on a tertiary background) — the mask thumbnail is not inline in the layer row. It holds:

- A **20 px mask thumbnail**, outlined in the accent color while mask edit mode is active on that layer and dimmed to 40 % when the mask is disabled (a state no UI control can currently produce — see Layer Operations). Clicking it selects the layer and enters mask edit mode. Unlike the layer thumbnail — which the engine downscales on the GPU (`readLayerThumbnail`, retried for up to 10 animation frames while the texture warms up, and subscribed to that one layer's pixel version so a brush dab doesn't trigger a full readback) — the mask thumbnail is drawn by a **CPU nearest-neighbour loop** over the mask array, with no store subscription.
- A **"Mask"** label.
- **Convert mask to selection** — turns the mask into a marquee (seeding a transform state from its bounds, like the alpha-selection route above) and leaves mask edit mode. It converts **inverted**: the selection value is `255 − mask`, so the region the mask *hides* becomes the selection and the visible region is excluded. Since a freshly added mask is filled with 255 (fully visible), the computed mask is empty, no bounds are found, and the button changes nothing but the mask edit mode — it produces a selection only once something has been painted **black** into the mask.
- **Delete mask** — removes the mask and exits mask edit mode.

### Reordering & Drag-and-Drop

Dragging a row's grip starts a pointer-driven reorder; there is no HTML5 drag-and-drop and no keyboard equivalent. The dragged row fades to 40 % opacity, and the drop target is previewed live:

- **Between rows** — the pointer's position within the row it is over picks a gap: above the row in the top half, below it in the bottom half. The gap is drawn as a **2 px accent line** on the neighbouring row's edge.
- **Into a group** — hovering the **middle half (25 %–75 %) of a group row** targets the group itself instead of a gap, drawn as a **2 px accent outline plus a tinted background** on that row. This is offered only when the move is legal (`canMoveToGroup` rejects dropping a group into itself or its own descendant).
- Dropping in the **same place** (the gap immediately above or below the row's original position) is a no-op, as is a drop onto a group the layer is already in.

Reparenting is inferred from the gap's neighbour rather than from indentation: the item **below** the gap decides which group the drop lands in, which is what stops a layer from being sucked into a group when it is dropped at that group's lower boundary. If that neighbour resolves to a different parent than the dragged layer's — and the move is legal — the layer is reparented; otherwise the drop is a plain reorder within the current parent.

### Layers Panel Toolbar

A row of icon buttons pinned below the list. Three entries are **conditional**, so the toolbar's contents change with selection:

- **Add Layer** and **New Group** — always present.
- **Group Layers** — appears only once **two or more** non-root layers are selected.
- **Duplicate Layer** — always present, disabled when there is no active layer or the root group is active.
- **Add Mask** — appears only when the active layer has **no** mask yet.
- **Rasterize Layer** — appears only when the active layer is a **text** layer (see Layer Operations).
- **Delete Layer** — pushed to the far right by a spacer. Deletes every selected non-root layer, and is disabled when the document is down to its last layer or nothing deletable is selected.

### Multi-Select in the Layers Panel
- **Plain click**: selects only the clicked layer (standard behavior)
- **Cmd/Ctrl+click**: toggles a layer in/out of the current multi-selection without changing which layer is "active"
- **Shift+click**: selects the contiguous range from the active layer to the clicked layer
- **Cmd/Ctrl+A**: selects every layer in the document (the root group is excluded). The handler fires when focus is inside the Layers panel **or when nothing is focused at all** (`document.body`), which is the normal state while drawing. Because the global Edit shortcut for the same chord is a separate `document` listener, in that focus-less case `⌘A` runs **both** actions at once — it selects all layers *and* runs Select All on the canvas. Only a text input swallows the chord. (Matched lower-case only, so `⇧⌘A` is not the same binding.)
- **Delete / Backspace** (Layers panel focused): removes every selected layer. The global Delete handler is not suppressed, so this also runs the canvas delete on the active layer in the same keystroke — clearing the selected pixels if a marquee is active, or removing the active layer if not. Two history entries can result from one press.
- Selected layers can be grouped or reordered together; the active layer remains the target for tool operations

### Clipboard
- **Cut** (`⌘X`) / **Copy** (`⌘C`) / **Paste** (`⌘V`): standard clipboard actions; copy/cut respect the active marquee selection
- **Copy Merged** (`⇧⌘C`): composites all visible layers within the selection bounds before copying, so the clipboard contains a flattened RGBA snapshot rather than just the active layer
- Paste external image data (PNG/JPEG/WebP from the system clipboard) creates a new raster layer with the bitmap

### Fill from Menu
- **Fill** (Edit menu, `⇧F5` — menu-only accelerator, not wired to a global key): fills the current selection (or the entire layer if no selection) on the active layer with the **foreground color**, immediately. There is no dialog and no color/pattern choice — to fill with anything else, set the foreground color first or use Fill with Pattern. The fill runs on the GPU and honors the active selection mask.
- **Fill with Pattern…** (Edit menu): opens the Pattern Fill dialog — see Filters → Render → Pattern Fill for scale / offset / selection-mask behavior. This Edit-menu item is the **only** entry point; the Filter menu has no Pattern Fill entry.
- **Define Pattern** (Edit menu): captures the active layer's pixels as a reusable pattern (used by Fill with Pattern… / the Pattern Fill dialog)
- **Define Brush…** / **Define Color Brush…** (Edit menu): captures the marquee selection as a new alpha or color brush tip (see Brush → Brush from Selection)

---

## Canvas Operations

- **Crop canvas**: by rectangle
- **Canvas Size…** (Image menu): new width/height with anchor point (extends or trims the document without resampling layer pixels)
- **Image Size…** (Image menu): new width/height that resamples all layers
- **Rotate Image 90° CW / 90° CCW** (Image menu): rotates the entire document (every layer, every mask, the selection, and the canvas size) about the document center
- **Flip Horizontal / Vertical** (Image menu): mirrors the active layer along the chosen axis (operates per-layer, not document-wide, so partial-image flips are possible)

---

## Auto Enhance (Image Menu)

One-click image correction commands that analyze the **active layer's** pixel histogram and append a non-destructive adjustment node to a **group**. The three shortcuts are real key handlers (not display-only accelerators) — they run from `edit-shortcuts.ts` and are gated on Cmd/Ctrl.

- **Auto Tone** (`⇧⌘L`): stretches each R/G/B channel independently to fill the full tonal range, clipping the darkest and brightest 0.1% of pixels per channel. Adds a Levels adjustment node that moves **only the per-channel input black/white points** — gamma stays 1, the output range stays 0–1, and the master RGB channel is left at identity.
- **Auto Contrast** (`⌥⇧⌘L`): stretches the Rec. 709 luminance histogram (`0.2126 R + 0.7152 G + 0.0722 B`) uniformly across all channels, preserving relative color balance. Adds a Levels adjustment node on the master RGB channel only, with R/G/B left at identity.
- **Auto Color** (`⇧⌘B`): neutralizes color casts by computing each channel's histogram-weighted mean and pulling all three toward a **common target — the average of the three channel means** (not a fixed mid-gray). Adds a Curves node holding, per channel, a single moved midpoint between fixed `(0,0)` and `(1,1)` endpoints.

**Auto Color does not stretch the tonal range.** The per-channel clip points are computed, but they are used only to normalize *where* the midpoint sits in curve space — the returned curve's endpoints are hard-coded to `(0,0)` and `(1,1)`, so black and white are never remapped. It is a pure midpoint (color-balance) correction; use Auto Tone or Auto Contrast for range stretching.

**Auto Color is often a no-op**, leaving a plain identity curve. The midpoint is inserted only when the channel is measurably off-target (`|midX − midY| > 0.005`) *and* the mean sits away from the ends (`0.05 < midX < 0.95`); the whole curve falls back to identity when the clipped range is narrower than 0.01. One direct consequence: on a **Grayscale** document all three channel means are equal, so the target equals every mean and Auto Color can never do anything.

Histogram details shared by all three: **fully transparent pixels (alpha 0) are skipped entirely** and don't contribute to any channel, while partially transparent pixels count at full weight from their un-premultiplied values. If a channel's clip search collapses (`black ≥ white`, e.g. a flat single-value layer) it falls back to the full 0–255 range rather than producing a degenerate stretch.

**The target is effectively always the root group.** The resolver returns the active layer's own id only when that layer *is* a group — but the pixel read (`readLayerAsImageData`) returns null for group layers, which have no GPU texture, so the command returns early before it ever gets there. Net effect: selecting a group and invoking any Auto command **does nothing at all, silently** (no toast, no history entry); in every other case the node lands on the **root** group, even when the active layer is nested inside another group. So the histogram is measured from one layer while the correction applies to the entire composite.

All three are undoable and auto-switch the target group from pass-through to normal blend mode when adding adjustments (required for the compositor to apply group-level adjustment nodes). Levels and Curves are permitted in every color mode, so none of the three is filtered out by the Image → Mode capability check.

**Caveat in Lab mode**: adjustment nodes are applied to the composite *before* the Lab→RGB decode, which lives only in the final screen blit (`final_blit.glsl`). The layer texture these commands read is likewise still encoded. So in Lab mode all three analyze and stretch the **L / a / b planes as if they were R / G / B** — Auto Tone will stretch the two chroma planes independently rather than correcting tone.

---

## Viewport & Workspace

### Viewport
- **Zoom**: 0.01x - 64x
- **Pan**: unlimited
- **Fit to view**: auto-zoom with padding
- **Space+drag** or **middle-click drag**: temporarily pan from any tool
- **Cmd/Ctrl+scroll**: zoom in / out (factor `1.002^-deltaY`, clamped to 0.01× – 64×); plain scroll pans. The zoom is anchored to the **viewport center**, not the cursor — the wheel handler only writes `viewport.zoom` and does not compensate pan. (The Reference Image drawer's wheel zoom *is* cursor-centered; the canvas is not.)
- **Two-finger pinch** (touch): pinching anywhere in the viewport scales the zoom from the gesture's start distance (clamped 0.01× – 64×) and pans by the touch-midpoint delta. The gesture is picked up even when a finger lands on surrounding UI chrome rather than the canvas, and it cancels any in-flight tool stroke first so a pinch never leaves a stray mark.
- **Cmd/Ctrl + `=`** / **Cmd/Ctrl + `-`**: zoom in / out by 1.5× (clamped to the 0.01× – 64× range)
- **Cmd/Ctrl + `0`**: fit document to view (90% of the smaller canvas-to-document ratio, pan reset to origin)
- **Cmd/Ctrl + `1`**: jump to 100% (1×) zoom and recenter
- **Pixel grid**: a 1-CSS-px translucent gray lattice rendered when the viewport zoom exceeds 800% (8×), so individual document pixels are visible during pixel-accurate editing. View → "Show Pixel Grid" toggles whether the lattice is drawn at all (default on).

### Grid
- **Show grid**: on/off
- **Grid size**: configurable (default 16 px)
- **Snap to grid**: on/off (auto-enabled with grid)
- **Cmd/Ctrl + `'`**: toggle grid visibility from anywhere in the app

### Rulers
- **Show rulers**: on/off (default on), toggled from **View → Show Rulers**. (The menu lists a `⌘R` accelerator, but unlike the grid and guide toggles it is not currently wired to a global key handler.)

### Guides
- **Show guides**: on/off
- **Orientation**: horizontal or vertical
- **Click a ruler to create**: a single click on the horizontal ruler drops a vertical guide at that position (and vice versa) — this is a click, not a drag. There is no drag-to-create, and placed guides cannot be repositioned by dragging; remove and re-place instead.
- **Click a guide on the ruler to remove it**: clicking the ruler within ±1 px of an existing guide's position deletes that guide rather than adding another.
- **Guide color**: click the **ruler corner square** (the box where the two rulers meet) to open the guide-color picker; clicking it again closes it. This is the only entry point to the picker.
- Guide creation, removal, and the color picker all require **both** Show Rulers and Show Guides to be on — with either off, ruler clicks do nothing.
- **Cmd/Ctrl + `;`**: toggle guides visibility from anywhere in the app
- **Clear Guides** (Edit menu): removes every guide currently placed on the canvas in a single action

### Snapping
- **Snap to Grid** (View menu): aligns drags to the nearest grid cell; auto-enabled whenever the grid is visible. Move-tool arrow-key nudges become one-cell hops under this mode.
- **Snap to Layers** (View menu): while dragging with the Move tool, the layer's edges and X/Y centers attract to matching edges and centers of other visible layers within a 5 px threshold. Magenta alignment guides appear during the snap and clear on mouse-up.

### Seamless Pattern Preview
- **Show Seamless Pattern** (View menu): tiles the document outside the canvas bounds so tileable textures and patterns can be previewed in context. The center tile is the actual document; surrounding tiles are repeats of the same pixels with edge wrapping (`fract(uv)`) so seams are visible immediately.
- **Dim pattern**: an options-bar checkbox (visible whenever Show Seamless Pattern is on) dims the surrounding repeat tiles so the center document stays the focal point while still showing how it tiles. Default on.
- **Wrap**: a second options-bar checkbox next to Dim pattern (also only visible while Show Seamless Pattern is on, default off). When enabled, layer compositing wraps modularly at the document edges — content dragged off one side reappears on the opposite side, so a tile can be edited across its own seam. The wrap happens in the blend shader, which shifts each layer's source offset per axis to whichever tile center is nearest the fragment; the layer texture itself is never rewritten, so repeated moves keep sampling the original pixels instead of compounding an already-wrapped result.

### UI
- **Foreground / background color**: live in the [Color panel](#color-panel) only — not in the toolbox. Swap has an icon button (and `X`); reset to black/white is keyboard-only (`D`), with no button anywhere.
- **Recent colors**: capped at 28, and seeded full with a 28-swatch starter palette — see [Recent colors](#recent-colors)
- **Panel visibility**: togglable per panel from the panel toolbar — see [Panel Docking & Layout](#panel-docking--layout). There is no separate sidebar-collapse toggle, and individual panels no longer collapse to a header; they are sized by their dock, split, or floating window instead.
- **Mask edit mode**: on/off
- **Draggable modals & drawers**: filter dialogs, pattern fill, layer effects, adjustments, the Brushes modal, and the reference image drawer can be repositioned by dragging the header bar (cursor: grab on hover; content interactions are not hijacked). Dockable panels use the docking system's own drag instead. The effects and reference drawers sit immediately to the left of the right dock and shift as that dock is resized.
- **Filter / pattern preview overlay**: when live preview is enabled the dim backdrop is removed and pointer-events on the overlay are disabled so the canvas is fully visible while the modal stays interactive

### Global UI Conventions
- **Slider double-click → reset**: every numeric slider in the UI (brush size, opacity, hardness, adjustment sliders, filter sliders, etc.) snaps back to its default value on double-click. The numeric text input inside the slider is exempt so double-clicks there select the value for editing instead.
- **Slider arrow-key step**: with a slider's numeric input focused, **↑ / ↓** increment / decrement the value by one step (log-scaled sliders like Levels gamma step proportionally), clamped to the slider's min / max. Enter blurs the input to commit.
- **Status-bar zoom double-click → 100%**: double-clicking the zoom percentage readout in the status bar resets the viewport zoom to 100% (1×).
- **Canvas cursor by tool**: exactly **seven** tools hide the system cursor and draw a size ring on the overlay instead — brush, pencil, eraser, clone stamp, healing brush, dodge/burn, and sponge. The ring is a circle for all of them **except the pencil, which draws a square** to match its hard-edged square dab. **Only the Brush's ring reflects the tip**: the custom tip bitmap and the Angle rotation are passed through for `brush` and hard-coded to none/0° for the other six, so a rotated star tip still shows a plain circle under, say, the eraser. Clone stamp and healing brush replace the ring with the live source preview once a source is set. Every remaining tool gets a standard cursor — move and text have their own, and everything else (including **Spray**) falls through to a crosshair. Liquify draws its own ring from the Liquify brush size while its modal is open.
- **Color swatch selection**: clicking the foreground or background swatch in the Color panel makes it the one the picker, hex field, and RGBA sliders edit; clicking a recent-color swatch applies that color to whichever swatch is currently active. (The old double-click-to-expand behavior went away with panel collapsing.)
- **Layer name double-click → rename**: double-clicking a layer row's name turns it into an inline text input; Enter commits, Escape cancels.
- **Menu submenus**: a menu item can carry a nested submenu, marked with a `›` arrow and opened by **hovering** the parent row (Image → Mode is the only one today). The flyout is positioned against the viewport rather than nested inside the dropdown — long menus like Filter set `overflow-y: auto`, which per CSS Overflow 3 forces the horizontal axis to `auto` too and would otherwise clip a `left: 100%` child at the padding box.

### Notifications & Error Toasts
Transient messages surface as toasts stacked in a fixed panel at the **top-right** of the window (max width 360px, newest appended at the bottom). The stack is announced to assistive tech via `role="status"` / `aria-live="polite"`.

- **Two levels**: `error` (red left border) and `info` (accent-colored left border). No title, no icon — just the message and a dismiss control.
- **Manual dismiss only**: toasts do **not** auto-expire on a timer; each stays until the user clicks its **×** button. Multiple messages accumulate in the stack rather than replacing one another.
- **Error triggers** (all routed through `notifyError`): failures to open a file, open/load or save a project, import a PSD / DNG / RAF, paste an image, or export (Quick Export PNG, Export…, or Export PSD); plus lower-level guards such as "Engine not ready", "No active layer", an empty decode result, and WebGL context init / restore failures. Messages that wrap an exception append a human-readable cause.
- **Info trigger**: importing a PSD whose unsupported layer types were rasterized posts an info toast noting the pixels are preserved but no longer editable as their original type.

### Canvas Right-Click Context Menu
Right-clicking the canvas opens a small menu with:
- **Define Brush Preset** — only shown when a marquee selection is active. Captures the selected pixels of the active layer as a new brush tip and opens the Brushes modal with the new preset selected. This is a **separate implementation** from Edit → Define Brush…, not a shared one: it names the tip "Custom Brush" without prompting and opens the modal, where the Edit-menu version prompts for a name and leaves the modal closed.
- **Deselect** — clears the active marquee selection (disabled when there is none).
- **Select All** — selects every pixel in the document (equivalent to ⌘A).

The menu is suppressed on coarse-pointer devices (touch) so long-press doesn't accidentally open it.

### Single-Key Shortcuts
In addition to per-tool toolbox shortcuts (`B`, `E`, `J`, `Y`, `R`, `S`, `H`, `O`, `G`, `I`, `V`, `M`, `L`, `W`, `T`, `N`, `U`, `P`, `C`, …) the editor ships these global keys:

- **`X`** — swap foreground and background colors
- **`D`** — reset foreground/background to the defaults (black / white)
- **`Q`** — toggle Quick Mask mode
- **`[` / `]`** — decrement / increment the active tool's size by 1. The handler is an explicit tool list, **not** a lookup of "whichever size slider the tool exposes": brush **and dodge & burn** (both write the shared `brush.size`), smudge, pencil, eraser, clone stamp, healing brush, pen-tool stroke width, and shape-tool stroke width. **Three tools ship a Size slider that the brackets ignore** — Sponge, Spray, and Quick Selection; their size is slider-only.
  - **The brackets are not bound by the slider's ceiling.** They write straight through the store clamp — **1 – 5000 px** for every pixel-size setting (1 – 50 for the pen/shape stroke widths) — without consulting the options bar's document-scaled maximum. On a small document, where the Brush Size slider stops at 200, holding `]` walks the size well past the visible end of the slider, all the way to 5000.
  - The handler reports the key as handled for *every* tool, so `[` / `]` are swallowed even when the active tool has no size to change.
- **`Shift`** (held, paint tool, after a stroke on the active layer) — previews the straight-line stroke as a hairline from the last stroke endpoint to the cursor; shift+click commits it. Adding **Cmd/Meta** snaps to 15° and turns the preview blue. See Straight-Line Strokes.
- **`Space+drag`** / **middle-click drag** — temporary pan from any tool
- **`Cmd/Ctrl+scroll`** — zoom in / out (anchored to the viewport center, not the cursor); plain scroll pans. **Two-finger pinch** on touch devices zooms and pans together.
- **`Backspace` / `Delete`** (canvas focused) — when a marquee selection is active, clears the selected pixels on the active layer (GPU clear, undoable as "Clear Selection"); when no selection is active, removes the active layer from the document. Suppressed while a text input or text-layer edit is focused.
- **`Escape`** — cancels in-progress state: clears unstroked Path-tool anchors first, otherwise clears the active selection and any pending transform; ends text editing with the prior layer state restored.
- **`Enter`** — when the Path tool is active and ≥ 2 anchors are placed, strokes the in-progress path to pixels.
- **`Cmd/Ctrl + E`** — merge the active layer down into the layer below.

**Menu accelerator labels that are *display-only* (not wired to global key handling).** Several menu items render a keyboard accelerator next to their label, but — like the `⌘R` ruler accelerator noted under Rulers — the key combo is **not** bound; the action only fires when the menu item itself is clicked. These are: **New** (`⌘N`), **Open…** (`⌘O`), **Save Project** (`⌘S`), **Export…** (`⌥⇧⌘E`), **Quick Export PNG** (`⇧⌘E`), **New Layer** (`⇧⌘N`), **Duplicate Layer** (`⌘J`), **Group Layers** (`⌘G`), and **Fill** (`⇧F5`). Among the layer/file menu accelerators, only **Merge Down** (`⌘E`) is actually bound to a global key handler.

### Help Menu
- **Keyboard Shortcuts**: opens the Keyboard Shortcuts modal (see below) — this menu item is its entry point.
- **About Lopsy**: opens the About dialog.

### Keyboard Shortcut Customization
Every tool shortcut (`B`, `E`, `J`, …) and the non-tool single-key actions (`X` swap colors, `D` reset colors, `Q` toggle quick mask) are user-rebindable through the **Keyboard Shortcuts modal** (Help → Keyboard Shortcuts).

- Each row shows the action label and its current key. Clicking a key enters **listening mode** — the next key the user presses becomes the new binding (lower-cased, single-character bindings only).
- **Conflict detection**: if the chosen key is already bound to another action, the modal flags the conflict inline; the user can confirm the swap or pick a different key.
- **Reset**: a per-row reset button reverts that one binding to its default; a "Reset All" button at the bottom of the modal clears every override at once.
- **Persistence**: custom bindings live in `localStorage` (Zustand `persist` middleware), so they survive reloads and follow the user across sessions on the same browser.
- The same store is the single source of truth for keyboard handling everywhere in the app — shortcuts dispatched from menus, the toolbox, and global key handlers all read through `useShortcutStore.getKey(actionId)` so a rebind takes effect immediately without a reload.

---

## Reference Image Drawer

A floating, draggable, resizable drawer (toggled by the **Reference** button on the panel toolbar) for keeping reference images alongside the canvas. It is *not* part of the docking system — it floats over the workspace, parked against the left edge of the right dock and tracking that dock's width as the dock is resized. Default size **300 × 300**, minimum **200 × 200**. Below a **600 px** viewport width the whole sidebar area is hidden, so the drawer is unavailable on narrow screens.

**Loading images**
- **Empty state**: a dashed drop zone reading "Drop an image here or click to browse". Click it to open the file picker, or drag image files onto it.
- The file picker accepts `image/*` and is **multi-select** — every chosen file is appended in order and the last one becomes the active reference.
- Non-image files are filtered out and any file the browser can't decode is skipped **silently** (no toast, no placeholder row).
- Once at least one image is loaded, the **+** tile at the end of the thumbnail strip is the way to add more.
- **Known gap — drag-and-drop only works in the empty state.** The drop handlers live on the drop zone, and the drop zone is replaced by the viewer as soon as an image loads. Dropping a file on a loaded drawer therefore bubbles to the app-level drop handler and **opens that file as a document / import** (PSD, DNG, `.lopsy`, or a plain image) instead of adding a reference.

**Viewing**
- **Auto-fit on load**: each newly added image is scaled with `min(containerW / w, containerH / h, 1)` and centered — it fits the drawer, but is never *upscaled* past 100 %. Switching to an image that has no stored view state fits it the same way.
- **Zoom**: mouse wheel, **1.07× per notch**, anchored on the cursor so the point under the pointer stays put, clamped to **0.05× – 20×**. The wheel event is stopped at the drawer, so scrolling over a reference never zooms the canvas underneath.
- **Pan**: click and drag anywhere in the preview (cursor turns from grab to grabbing). Pointer-downs that land on a button, input, or slider are ignored so controls still work.
- **Opacity**: a **number field (0 – 100)**, not a slider; typed values are clamped to that range.
- **Flip horizontal / vertical**: mirrors via a negative scale plus a compensating translate, so the image flips **in place** rather than sliding out of view.
- **Per-image view state**: zoom, pan, opacity, and both flips are tracked independently per image (keyed by image id), so switching references restores each one's framing.
- **Thumbnail strip**: 40 × 40 cover-cropped tiles, active tile outlined in the accent color, strip scrolls horizontally. Click a tile to switch. The **trash** button removes the *active* image (revoking its blob URL) and clamps the selection to the nearest remaining image; removing the last one returns the drawer to the drop zone.
- **Known gap**: thumbnails are click-only `<img>` elements with no `tabIndex` and no key handler, so the strip can't be reached or operated from the keyboard.

**Window chrome**
- **Drag to reposition**: the drag handler is on the whole drawer, but the preview, controls bar, thumbnail strip, and drop zone all stop the event, and inputs/buttons/labels are excluded — so in practice the **header bar** (and the thin border gutter) is what you grab.
- The drag is **unclamped**: unlike floating dock panels, nothing pulls the drawer back if you drag it off-screen.
- **Bottom-right resize handle** sets the drawer's width/height directly on the element (minimum 200 px each).
- **Closing discards everything.** The drawer is conditionally mounted, so toggling it off unmounts the panel: loaded images, their view states, the dragged position, and the resized dimensions are all gone on reopen, and the blob URLs of any images that weren't explicitly removed are never revoked.
- Images are pure client-side blob URLs — no upload, no backend.

---

## Panel Docking & Layout

Eight panels — **Navigator, Info, Color, Layers, Channels, History, Paths, Text** — live in a docking system rather than a fixed sidebar. Each is a tab that can be docked to any workspace edge, split alongside another panel, grouped into tabs, or floated as its own window. (The Reference Image drawer, layer-effects drawer, and Adjustments panel are *not* part of this system — they remain free-floating drawers.)

### Panel Toolbar
- A vertical rail on the far right with one icon per dockable panel, plus a **Reference** button for the reference-image drawer. An icon is highlighted while its panel is somewhere in the layout.
- Clicking an icon does one of three things depending on the panel's current state: **absent** → add it at its default spot; **present but not the active tab of its group** → bring that tab forward; **present and already active** → close it.
- Closing a panel is toolbar-only — tabs have no close (`×`) button.
- Panels re-added from the toolbar land in the **right dock**, inserted so the vertical order stays canonical (Navigator, Info, Color, Text, Channels, History, Paths, then Layers at the bottom, mirroring the pre-dock sidebar).

### Default Layout
- A **Color/Info** tab group above a **Layers/Channels** tab group in the right dock (50 / 50 split), with **Color** and **Layers** as the active tabs; the other four panels (Navigator, History, Paths, Text) start closed.
- Default dock thickness: left 280 px, right 312 px, top 220 px, bottom 220 px.
- On a **coarse-pointer device** (touch), a first run starts with *no* panels open so the canvas gets the whole screen.

### Dragging & Drop Targets
Dragging starts on a tab (or a floating window's tab bar) after **5 px** of pointer movement; a ghost chip follows the cursor and a translucent indicator previews exactly where the panel will land.

- **Workspace edge** — release within **28 px** of the host's left/right/top/bottom edge to dock there. The panel is appended to that dock's stack: left/right docks stack vertically, top/bottom docks stack horizontally.
- **Upper portion of an existing panel** — release over the top two-thirds of a group (where its tab bar sits, by convention) to join it as a **tab**. Groups hold at most **3 tabs**; dropping on a full group falls through to a side split instead.
- **Bottom third of an existing panel** — release over the bottom third to drop the panel as a new group **below** the target in the stack (reordering) rather than combining.
- **Open space** — release a *tab* anywhere else to **float** it in a new window, sized from the group it came from (capped at 420 × 480). A whole floating window released over open space simply stays where it was dragged.
- **Escape** during a drag cancels it; a dragged floating window snaps back to where it started.
- Self-drops are no-ops: dropping a tab back on its own group just activates it, and a lone tab can't split its own group.
- Dragging a floating window whose group is a single tab moves the **whole window**; with 2–3 tabs, dragging a tab extracts just that panel and dragging the empty part of the tab bar moves the window.

### Tab Keyboard Navigation
Tab strips follow the WAI-ARIA tabs pattern, so a group's tabs are reachable without a pointer:

- **Left/Up** and **Right/Down** move to the previous/next tab and wrap around at either end; **Home** / **End** jump to the first / last tab.
- Selection *follows focus* — arrowing onto a tab activates its panel immediately, no Enter or Space needed.
- Roving tabindex: only the active tab is in the Tab order, so a single <kbd>Tab</kbd> press enters the strip and the next one leaves it for the panel body.
- Each tab is wired to its panel with `aria-controls` / `role="tabpanel"` so screen readers announce the pairing.

### Floating Windows
- Dragged by the tab bar, resized from **all eight** edges and corners (minimum 200 × 140).
- Clicking anywhere in a window raises it above the others.
- A floating window dropped onto a docked target docks all of its tabs at once; dropped onto another floating window it merges as tabs (still subject to the 3-tab cap).
- If the browser window shrinks, stray floating panels are pulled back inside the workspace automatically.

### Resizing
- **Dock splitters** sit between each dock and the canvas: drag to set that dock's thickness, clamped to **160 – 800 px**.
- **Split dividers** inside a dock redistribute space between panes (each pane keeps at least ~90 px).
- The canvas fills whatever space the docks leave.

### Persistence
- The full layout — dock trees, tab groups, active tabs, split fractions, dock sizes, and floating window rects — is written to `localStorage` under `dock:layout:v1`, debounced ~400 ms and flushed on page unload.
- Persisted layouts are re-validated on load: unknown panel ids, duplicated panels, out-of-range sizes, and malformed nodes are dropped or clamped, and a layout that can't be repaired falls back to the default. If `localStorage` is unavailable the app still works — the layout just doesn't survive a reload.
- **Known gap**: the store exposes a `resetLayout` action that restores the default arrangement, but nothing in the UI calls it yet — there is currently no "Reset Panel Layout" menu item or button.

---

## Paths Panel

A flat list of the document's stored vector paths plus a three-button toolbar. It is a *consumer* of paths — nothing in the panel creates one.

**Where stored paths come from**
- The **Path / Pen tool**, when an in-progress anchor list is committed.
- The **Shape tool with Output = path**: finishing the drag rasterizes nothing — the raster preview drawn during the drag is rolled back with an `undo()` and a closed path is added instead. Ellipses become 4-anchor Bezier ellipses; every other mode (including a 4-sided "rectangle") becomes a straight-sided polygon, so **corner radius is not carried into path output**. A drag smaller than 1 px in both axes is discarded.
- **Select → Selection to Path**.
- **Boolean path operations** (Unite / Subtract / Intersect / Exclude), which consume both source paths and add the result.

Every new path is auto-named `Path 1`, `Path 2`, … from a counter that **never resets** — it keeps climbing for the life of the page, so opening a second document continues the numbering rather than restarting at 1.

**The list**
- Click a row to select it; **clicking the selected row again deselects it**, which disables all three toolbar buttons.
- Empty state reads "No paths".
- **Known gap — rows are keyboard-focusable but not keyboard-operable.** Each row is a `role="option"` with `tabIndex={0}` and no key handler, so Tab reaches a path but Enter / Space can't select it. (Same pattern as the Brushes modal tab rail, the color picker sliders, the layer-row drag grip, and the layer-effects list.)
- **Known gap**: the store exposes `renamePath`, but nothing in the UI calls it — there is no rename affordance (no double-click, no context menu), so path names are whatever the counter assigned.

**Toolbar** (all three disabled until a path is selected)
- **Stroke Path** opens the **Stroke Path modal** rather than stroking immediately: a **Width** number field pre-filled from the Path tool's current stroke width and auto-selected on open (clamped and rounded to **1 – 50 px** on confirm), and a read-only **Color** row showing the **foreground color** swatch — the color is not editable here. `Enter` or **Stroke** rasterizes onto the **active layer**; `Escape`, **Cancel**, or a click on the backdrop dismisses it.
- **Path to Selection** rasterizes the path's Bezier outline into a full-document mask on a 2D canvas and installs it as the selection. Notes: it needs **≥ 2 anchors**; the mask keeps the fill's **anti-aliased edges** (alpha is copied straight into the mask, so the selection has soft borders); an **open path is implicitly closed** before filling, so converting one selects the chord-closed region; and the resulting selection's bounds are the **whole document**, not the path's bounding box.
- **Delete Path** removes the selected path and clears the selection.

---

## Navigator Panel

### Minimap Thumbnail
- A live thumbnail of the **composited document**, sized to the panel's width with the document's aspect ratio preserved and capped at **300 px tall**.
- The image is produced by the engine, not by copying the on-screen canvas: `readCompositeThumbnail` downscales the composite texture **on the GPU** (blit shader, LINEAR filtering) into a small RGBA8 texture and reads back only that, returning an 8-byte header (`width`, `height` as u32 LE) followed by RGBA pixels, which the panel unpacks and `putImageData`s onto a 2D canvas. Only the thumbnail-sized result crosses the GPU boundary, so the cost is independent of document size — a full-composite readback would be ~67 MB per tick at 4K. The composite texture is flipped to LINEAR filtering for the downscale and restored to NEAREST afterwards so the compositor's final blit never samples bilinearly.
- **Refresh cadence**: a 200 ms interval (5 Hz), but ticks are **skipped entirely while any pointer gesture is in progress**. The readback stalls the GPU pipeline, so painting, panning, moving, transforming, marquee-dragging, gradients, crop, mesh warp, and tilt-shift all suppress it. When the gesture ends, one **catch-up tick** fires on the next event-loop turn so the thumbnail reflects the final pixels without waiting out the interval.

### Viewport Indicator
- A translucent blue rectangle (`rgba(74, 158, 255, …)`) showing the visible viewport bounds within the document.
- **Click or drag anywhere on the minimap** to recenter the viewport on that point — pointer-down recenters immediately and captures the pointer, so a drag scrubs the view continuously. The indicator itself is **not** a draggable object: it is `pointer-events: none`, so there is no separate "grab the rectangle" affordance and no way to drag it relative to where you grabbed it. The minimap shows a crosshair cursor.
- The rectangle is floored at **4 px** in each axis so it stays visible when zoomed far out, and the computed rect is not clamped to the thumbnail — the wrapper's `overflow: hidden` is what keeps it from escaping.

### Zoom Slider
- **Range: 10 % – 600 %**, not the full canvas zoom range. The slider is log-scaled as `0.1 × 60^(position/100)` over a 0–100 track (step 0.5).
- Because the viewport itself allows 0.01× – 64×, the slider **cannot reach most of that range**: its reported position clamps to the 0.1× – 6× window, so at any zoom above 600 % (or below 10 %) the handle pins to the end of the track while the readout keeps showing the true zoom.
- **Double-click the slider** to snap back to 100 %.
- **Zoom readout**: the current zoom as a rounded percentage.

---

## Channels Panel

A per-layer view of the active layer's RGBA channels, modeled on Photoshop's Channels palette.

- **Rows**: RGB (composite), Red, Green, Blue, Alpha. Each row has a colored swatch dot, a label, a live thumbnail, and — on the four single-channel rows — an eye toggle. A row whose channel is hidden is dimmed. With no active layer the rows still render, minus their thumbnails.
- **Per-channel visibility**: the eye toggles feed a `vec4` channel mask that is applied in **`final_blit.glsl`**, the very last step that puts the composite on screen (`rgb *= mask.rgb`, `a *= mask.a`). Two consequences: hiding a channel **zeroes** it rather than isolating it (hide Red and you see the cyan-ish remainder, not a red separation), and because it lands after compositing it is a **view-only** filter — export, flatten, layer thumbnails, and saved projects are unaffected. Hiding **Alpha** multiplies the whole composite's alpha by 0, which blanks the on-screen document to the transparency checkerboard.
- **Thumbnails**: **40 × 20**, produced on the **GPU**. `readChannelThumbnail` / `readLayerThumbnail` blit the active layer's texture down into a small RGBA8 texture and read back only that, returning an 8-byte header (`width`, `height` as u32 LE) followed by RGBA pixels; the panel unpacks it into `ImageData` and letterboxes it into the 40 × 20 canvas when the aspect doesn't match. The CPU per-pixel extraction loop this replaced moved ~67 MB **per channel** per update on a 4K layer (#683). Reads are retried on up to **10** animation frames while the engine is still warming up, then give up and leave the tile blank.
- Thumbnails re-render whenever the layer's pixel-data version increments, so the panel tracks painting live.
- Rows are keyboard-operable: `tabIndex={0}` plus an Enter / Space handler (unlike the Paths and layer-effects lists).
- **Known gap — the active channel does nothing.** Clicking a row sets `activeChannel` in the UI store and highlights that row, but **nothing reads it**: it has no consumers outside the panel, so it does not scope the eyedropper, curves, filters, or painting to a single channel. It is a selection highlight only.
- **Known gap**: the RGB composite row's thumbnail is a plain layer thumbnail — it does **not** reflect the R / G / B visibility toggles, because the channel mask is applied at the screen blit and the thumbnail path samples the layer texture directly.

---

## Info Panel

A compact heads-up readout that mirrors what Photoshop's Info panel surfaces.

- **Cursor X / Y**: current pointer position in document coordinates.
- **Canvas W / H**: document dimensions.
- **Layer X / Y / W / H**: the active layer's origin and (when applicable) its raster width and height.
- **Selection X / Y / W / H**: the active marquee's bounding box, only shown when a selection is active. When a selection is active, the Cursor X / Y readout switches to the selection's top-left so the values stay coherent during transform / move operations.

---

## Text Panel

A dockable typography panel (a superset of the text options bar) for styling the active/selected committed text layer. Grouped into four sections:

- **Font**: the same searchable font browser as the options bar, a **weight** dropdown (only the weights the family ships), a **style** dropdown (Normal / Italic), and a row of **recent fonts** used this session (session-only, click to re-apply).
- **Character**: **Size** (1 – 500 px), **Line height** (0.5 – 4×, step 0.05, default 1.4), **Letter spacing** (−20 – 200 px, step 0.5, default 0).
- **Paragraph**: an **alignment** button group (left / center / right / justify) and **Paragraph spacing** (0 – 200 px, default 0).
- **Decoration**: **underline (U)** and **strikethrough (S)** toggles.

Panel edits and options-bar edits share the same apply path (`apply-text-setting.ts`): changing a control updates the tool default *and*, when a committed text layer is active, re-styles that layer and records one history entry per edit (slider drags coalesce into a single entry). Letter spacing and paragraph spacing are applied inside the WASM engine because cosmic-text implements neither.

---

## Symmetry

- **Axes**: horizontal, vertical, both (4-way), or radial. Radial symmetry mirrors each dab into **2 - 32 evenly-rotated copies** around the center (kaleidoscope-style) and takes precedence over the horizontal/vertical mirrors when its segment count is ≥ 2.
- **Radial segment count**: the Radial Symmetry button is a toggle that switches radial **on at 8 segments** and off by zeroing the count. While it is on, a number input appears; the store rounds and clamps whatever it receives to **0 - 32**, so a typed value above 32 is pulled back down, and 0 or 1 simply turns radial off (the count must reach 2 before any mirroring happens).
- **Center**: configurable, defaulting to the canvas center. The center is resolved **once at pointer-down** and stored in layer-local coordinates for the whole stroke, so moving the symmetry center mid-stroke is not possible.
- Available on brush, pencil, and eraser. The symmetry config (axes, center, radial segment count) is global, so it applies to whichever of these tools is active. Only the Brush options bar exposes the **Radial Symmetry** toggle and its segment-count number input; the Pencil options bar exposes just the horizontal/vertical toggles (radial set from the Brush still applies to pencil/eraser strokes), and the Eraser inherits the active config without its own toggles.
- **Cmd/Meta+click** on the canvas while any symmetry mode (horizontal, vertical, or radial with 2+ segments) is active moves the symmetry center to the click point without painting a dab. Lets the user reposition the mirror axis directly from the canvas without opening a settings panel.
- **Caveat — this intercept is global, not brush-only.** The check runs at the top of the canvas pointer-down handler, before the tool guards and before any tool dispatch, and it is not scoped to the paint tools. So while *any* symmetry axis is enabled, a Cmd/Meta+click is swallowed by the symmetry-center move for **every** tool — which suppresses the other documented Cmd/Meta gestures (shape and marquee 1:1 lock, gradient 15° snap, transform snap, Path anchor convert, the Cmd+shift 15° snap on straight-line brush/pencil/eraser strokes, and the Cmd half of the Clone Stamp / Healing source-set). Alt/Option still sets the stamp and healing source. Turn symmetry off to get those gestures back.

---

## Color

- **Color spaces**: sRGB, Display P3, Rec. 2020, Linear sRGB
- **FP16 / wide gamut**: RGBA16F textures when GPU supports `EXT_color_buffer_float`
- **EDR passthrough**: unclamped values for extended dynamic range displays

### Color Panel

The only surface that edits the foreground and background colors directly — there are **no foreground/background swatches in the toolbox**. With the panel closed, the swatches can still be changed by the eyedropper, the `X` / `D` shortcuts, a double-click on a shape's fill/stroke swatch, or clicking an existing text layer with the Text tool (which adopts that layer's color).

- **Swatch stack**: a 32px square holding the **foreground** swatch (24px, top-left, drawn over) and the **background** swatch (16px, bottom-right, behind) — the overlapping Photoshop arrangement. Clicking either one makes it the *active* swatch, marked with an accent border plus a 1px accent ring. Active-swatch choice is panel-local React state, so it is not persisted and reverts to the foreground whenever the panel remounts.
- **Swap** sits beside the stack as an icon button (`ArrowUpDown`, labelled *Swap Colors (X)*). **There is no reset button** — restoring black/white is keyboard-only, via `D`.
- **Every swatch in the panel is a real `<button>`** with `aria-label="Color: rgb(r, g, b)"`, painted over an 8px conic-gradient checkerboard so partial alpha reads visually. The label reports RGB only; alpha is not announced.
- The active swatch is what the picker, the hex field, and the sliders all read and write — the panel has a single editing target rather than separate controls per swatch.

### Color Picker (shared component)

Used by the Color panel, the Gradient modal, Gradient Map stops, the shape fill/stroke popover, and the guide-color picker. Every surface is a `<canvas>` redrawn on color change and on resize (via `ResizeObserver`), allocated with the app's wide-gamut `contextOptions`.

- **SV square**: white → full-hue horizontally, transparent → black vertically. Drag sets saturation from x and brightness from `1 - y`, both clamped to the box.
- **Hue bar**: 0 – 360° across the six primaries.
- **Alpha bar**: 0 – 100% over the current color, quantized to two decimals (`round(x * 100) / 100`).
- **Hue is preserved through neutrals**: when the incoming color has `r === g === b` the picker keeps the hue it already had instead of letting the RGB→HSV round-trip collapse it to 0. Dragging brightness down to black and back up returns the same hue rather than snapping to red.
- **Grayscale documents** get a different picker entirely: the SV square and hue bar are replaced by a single black → white value ramp that emits a neutral `r = g = b`, with the alpha bar below it.
- **Indexed documents** replace the picker with the **document palette** as a swatch grid (up to 256 entries, capped at 160px tall and scrolling so it can't push the sliders out of the panel). The entry matching the active color gets the accent ring — matched on RGB only, so alpha is ignored for that highlight.

### Hex field and sliders

- **Hex**: a 6-character monospace input rendered uppercase, prefixed by a static `#`. Commits on **Enter** or blur; unparseable input silently reverts to the current color. The parser also accepts 3- and 8-digit forms, but `maxLength={6}` puts the 8-digit RGBA form out of reach here, and the commit deliberately **keeps the swatch's existing alpha** rather than taking one from the hex.
- **Sliders follow the document color mode**: RGB → **R / G / B** 0 – 255; Grayscale → a single **K** 0 – 255; Lab → **L** 0 – 100 and **a** / **b** −128 – 127; CMYK → **C / M / Y / K** 0 – 100. The **Alpha** slider (0 – 100) is always present, in every mode including Indexed.
- Indexed documents keep the ordinary **R / G / B sliders and hex field** even though the picker is gone, so an arbitrary color can still be typed — it just snaps to the nearest palette entry on the way in.
- The Lab and CMYK sliders hold no state of their own: they are derived from the active sRGB color on every render and converted straight back on change, so a long series of small drags can round-trip a unit or two away from where it started.
- **Every write path is funnelled through `convertColorToDocMode`** — the picker, the hex field, each slider, and the recent/palette swatches alike. Grayscale clamps to luminance and Indexed snaps to the palette; Lab and CMYK pass through untouched, since those modes are sRGB-backed in the swatch model (see [Color Modes](#color-modes)).

### Recent colors

- A wrapping strip of 16px swatches at the top-right of the panel, capped at **28**. Clicking one applies it to whichever swatch is currently active.
- The store **ships all 28 slots pre-filled** with a fixed starter palette (neutrals, saturated primaries, pastels, earth tones), so the strip is never empty and adding a color always evicts the oldest.
- "Recent" means *painted with*, not *picked*: entries are appended when a stroke, path stroke, fill, spray, text commit, or shape lands — the shape tool pushes fill and stroke separately, and the gradient tool pushes **both** the foreground and background color on commit. **Choosing a color in the Color panel does not record it, and neither does the eyedropper.**
- Re-using a color moves it back to the front rather than duplicating it. The dedupe compares **alpha too**, so the same RGB at two different opacities occupies two separate slots.

### Gaps in the picker

- **It is mouse-only.** Every surface binds `mousedown` plus window-level `mousemove` / `mouseup`, with no pointer or touch events — so the picker cannot be operated by touch or stylus at all, even though the app ships a touch-first default layout (no panels open on a coarse-pointer device) and supports pinch-zoom on canvas.
- **The surfaces are focusable but keyboard-inoperable.** The SV square, hue bar, alpha bar, and value ramp each carry `role="slider"` and `tabIndex={0}` with full ARIA value attributes, but no key handler is attached — tabbing to one and pressing an arrow key does nothing.
- **`compact` is dead code.** The prop switches the picker to a single spectrum bar that can only pick at 100% saturation and 100% brightness (no SV square, no alpha), but no call site passes it, so that branch is unreachable in the app.

---

## Color Modes

**Image → Mode** sets a document-level color mode, Photoshop-style: **RGB Color**, **Grayscale**, **Indexed Color…**, **CMYK Color**, **Lab Color**. The current mode carries a checkmark. Only Indexed opens a dialog (it needs a palette size up front); the rest convert on click. Any mode other than RGB also shows its name in the **status bar**, left of the color-space readout.

A single capability table (`getColorModeCapabilities()`) is the source of truth for what each mode permits, so panels, menus, and tools agree instead of each running its own ad-hoc check.

| Mode | Layers | Chroma adjustments | R/G/B curve tabs | HSL blend modes | Color panel shows |
|------|--------|--------------------|------------------|-----------------|-------------------|
| RGB | yes | yes | yes | yes | HSV picker + R/G/B/A sliders |
| Grayscale | yes | no | no | no | value ramp + **K** slider (0 – 255) |
| Indexed | **no** — single flat surface | no | no | no | the document palette as a swatch grid |
| CMYK | yes | no | no | no | **C/M/Y/K** sliders (0 – 100 each) |
| Lab | yes | no | no | no | **L** (0 – 100) + **a** / **b** (−128 – 127) sliders |

The hex field stays available in every mode.

### Converting between modes

A conversion snapshots history *before* it bakes, so the whole thing — including Indexed's flatten — is **one undo step**. In-flight strokes are flushed into their layer textures first, so nothing half-painted survives in the old space. Alongside the pixels:

- **Text and shape colors, and all five effect colors** (stroke, drop shadow, outer glow, inner glow, color overlay) go through the same constraint the pixels do — a grayscale document is not left with a colored drop shadow.
- **Chroma-producing adjustment nodes are stripped** from group stacks: Hue/Saturation, Color Balance, Channel Mixer, Photo Filter, Gradient Map, Black & White, plus Saturation. Otherwise a Color Balance node would simply reintroduce the color the bake just removed. The same nodes disappear from the Adjustments panel's Add menu.
- **Hue / Saturation / Color / Luminosity blend modes coerce to Normal** and drop out of the blend-mode dropdown in every mode but RGB — they decompose RGB into HSL, which is meaningless once a texture holds something else.
- The **foreground and background swatches** are re-expressed in the new mode's value space, so the next stroke matches what the picker shows.

Every paint entry point — brush/pencil/eraser, spray, fill, gradient (per stop), shape (fill and stroke), and text — routes its color through a shared `toDocumentColor()`. The mode's constraint therefore holds even for colors that arrived from a brush preset, the eyedropper, or tool settings saved under a previous mode.

### Per-mode notes

- **Grayscale** — pixels are baked on the GPU to Rec. 709 luma (`0.2126 R + 0.7152 G + 0.0722 B`). The bake covers the **whole layer even under an active selection**: a mode change must not leave part of a layer in the old space. The picker collapses from the HSV square to a black→white value ramp.
- **Indexed** — flattens the document, then builds a palette of at most **256 colors** via a median-cut quantizer and snaps every pixel to the nearest entry. The dialog collects **Colors** (2 – 256, default 256) and a **Dither (Floyd–Steinberg)** checkbox (off by default), warns up front when more than one layer will be flattened, and takes **Enter** to convert / **Escape** to cancel. Palette building subsamples on a fixed stride above 262,144 pixels so a 4K canvas stays bounded — the snap itself still visits every pixel. The palette is stored on the document, shown in the Color panel as a swatch grid, and persisted in the `.lopsy` manifest. **Adding a layer is refused** while Indexed is active, with an info toast: *"Indexed mode does not support layers. Convert to RGB first."*
- **Lab** — the only mode whose layer textures hold something other than sRGB. Pixels are stored as encoded CIELAB (L in R, a in G, b in B), and the engine decodes for display (`u_docColorMode == 1` in `final_blit.glsl`), for the export composite, and for the eyedropper — which decodes *before* averaging its sample square, since the transform is non-linear. The panel's L/a/b sliders drive a TypeScript mirror of the Rust math, used for single colors only so the two can't drift on bulk pixel work. Stored 8-bit, matching Photoshop's 8-bit Lab; a/b quantization costs a few sRGB units at saturated gamut corners.
- **CMYK** — sRGB-backed. The C/M/Y/K sliders are a unit system over sRGB rather than stored ink, and **a CMYK document does not yet render any differently from an RGB one**. The naive ink model is a bijection with sRGB — its round trip is lossless across the whole cube — so there is no gamut to clip; a real difference needs profile-based conversion with ink limits. Native ink storage is blocked on the paint pipeline owning the alpha channel (dabs write coverage there and premultiply by it), leaving no fourth channel free for black.

### Declared but not enforced

The capability table also declares that Indexed has no gradients and no anti-aliasing, and that the non-RGB modes hide the Levels R/G/B channel tabs. Nothing reads those three flags. In practice: the **Gradient tool still works in an Indexed document** (each stop snaps to the palette, but the GPU interpolates freely *between* snapped stops), paint tools still anti-alias, and the **Levels editor still shows its R / G / B tabs in every mode** — it never consults the capability table at all, so a Grayscale or Lab document can still be given a per-channel Levels remap even though the adjacent Curves editor correctly collapses to the composite curve alone. The layer guard has a matching hole — it covers New Layer, Group, and Duplicate, but not the Text tool, so an Indexed document can still gain a second layer.

The chroma-node filter has a hole of the same shape. **New Document** filters the default node set against the chosen mode, and converting a document strips the chroma nodes it no longer allows — but **Flatten Image** re-seeds the root group with the unfiltered default set while keeping the document's mode. Flattening a Grayscale, Lab, or CMYK document therefore gives it a fresh **Hue / Saturation** node, one the mode's own Add menu would refuse to offer. It arrives at identity, so nothing changes until a slider moves, but its controls are live.

More generally, the palette snap runs **only at conversion time**. Pixels painted afterwards are constrained just at the *color* level (via `toDocumentColor`), not per-pixel, so anti-aliased edges, gradient interpolation, and soft brushes all put off-palette pixels into an Indexed document as you keep working in it.

---

## History

- Undo/redo with labeled snapshots (the 50 most recent states are kept — each push keeps the last 49 plus the new one, and the oldest silently falls off)
- **Undo** (`⌘Z`) / **Redo** (`⇧⌘Z`) from the Edit menu or keyboard
- RLE-compressed GPU texture snapshots; metadata-only snapshots for lightweight operations (visibility toggles, blend-mode changes, etc.) so the history list stays cheap even after long sessions

### History Panel
- Rows are numbered from **0 — "Original"**, the state before the first recorded edit; every later row shows the label of the action that produced it (`Brush`, `Merge Down`, `Clear Selection`, …).
- The row matching the current state is highlighted. Clicking any row jumps there by replaying `undo`/`redo` one step at a time until it is reached — so it is a fast scrub through history, not a random-access restore.
- **Undone steps stay in the list** below the current position, dimmed as future states, and clicking one redoes forward into it. They are discarded the moment a new edit is pushed (the redo stack is cleared on every push).
- The list auto-scrolls to the newest entry as you work, and shows a plain **"No history"** placeholder until the first snapshot is recorded.

---

## Document

- **Name**: configurable (default "Untitled")
- **Dimensions**: width x height
- **Background**: solid color or transparent
- **Color mode**: RGB (default), Grayscale, Indexed, Lab, or CMYK — see Color Modes
- Entirely client-side, no backend

---

## File I/O & Export

### Open / Save
- **New** (`⌘N`, menu-only accelerator): blank document with width/height/background prompt, plus a **Color Mode** dropdown offering RGB Color / Grayscale / CMYK Color / Lab Color. Indexed is deliberately absent — as in Photoshop it is conversion-only, since a meaningful palette has to be quantized from existing pixels. The initial fill is written already encoded for the chosen mode — a new document is created before the canvas mounts, so there is no engine to bake through, and a literal white buffer would open as maximum chroma in Lab. The default adjustment-node set is filtered to what the mode allows, so a new Grayscale document does not ship with chroma nodes, and the toolbox swatches are normalized into the mode's value space the same way a conversion does. Resets the viewport zoom and pan so the fresh canvas always lands fit-to-view, even after working on a much larger document.
- **Open…** (`⌘O`, menu-only accelerator): open a PNG/JPEG/GIF (first frame)/BMP/WebP/PSD/DNG/RAF/.lopsy from disk. The picker lists every supported extension explicitly rather than `image/*` — mixing the two makes Chrome on macOS collapse the dialog down to a single filter.
- **Two routing paths, not one.** The File-menu picker routes inline **by extension** (`.lopsy` → project loader, `.psd` → PSD importer, `.dng` / `.raf` → the Rust RAW decoders, anything else → browser `<img>` decode). The pre-document flow — the New Document modal's "Open file" button and drag-and-drop — instead uses the shared `classifyOpenFile` helper, which checks the same four extensions but falls back to the **MIME type** (`image/*`) rather than attempting a decode. The practical difference is at the edges: a file with an image MIME type but an odd extension opens on drop and fails from the menu picker, while an unrecognized file dropped on the canvas is silently ignored (the New Document modal's button surfaces a friendly error instead).
- **Drag-and-drop is always live**, not just before a document exists — the drop target is the whole app shell as well as the canvas. Dropping an image onto an open document adds it as a layer (see Paste / Drop behavior); dropping a `.psd`, `.dng`, `.raf`, or `.lopsy` **replaces** the open document.
- **Unsaved-changes guard**: **New**, **Open…**, and **Open Project…** check the document's dirty flag and put up a browser `confirm()` — "You have unsaved changes. Are you sure you want to continue?" — before discarding work. Closing or reloading the tab triggers the browser's own `beforeunload` warning. The drop path performs **no** such check: a `.psd` or `.lopsy` dropped onto a dirty document replaces it immediately.
- The dirty flag is cleared by **Save Project** and by **PSD import** — and also by any **export**, since the shared download helper marks the document clean. Exporting a PNG therefore silences the unsaved-changes warnings even though nothing was saved to a project file.
- **Open PSD**: rebuilds layers, masks, blend modes, and effects from the PSD reader (Rust). **Grayscale**, **RGB**, and **CMYK** files are accepted at 8-bit and 16-bit depth. Grayscale files carry a single color plane, which is replicated across G and B on import, and the document opens *in* Grayscale mode; CMYK files are converted to RGB (naive `(1−C)(1−K)` channel math) for both the per-layer and merged-composite paths and open as RGB. Remaining color modes (indexed, Lab, duotone, …) are rejected with an unsupported-color-mode error.
- **Export PSD** (File menu): serialises the current document via the PSD writer at 16-bit precision (pass-through groups are written as `normal` since PSD has no pass-through discriminant). A Grayscale document writes header mode 1 with one color channel per layer; **every other mode — including Lab and CMYK — is written as RGB**.

### Native Project Format (.lopsy)
- **Save Project** (`⌘S`, menu-only accelerator): writes the full editor state to a `.lopsy` file and triggers a browser download. Round-trips every layer (raster pixels, text, shape, group), masks, blend modes, opacity, position, clip-to-below, layer effects, color tags, group adjustment node stacks, the active layer, the document's name / size / background / **color mode** (plus the **Indexed palette** when there is one), and the workspace's stored vector paths (Paths panel) and canvas guides. (Files saved before paths/guides were serialized simply omit those fields and load with an empty path/guide set; likewise the color mode is an optional manifest field, so projects saved before color modes existed load as RGB.)
- **Open Project…**: file picker filtered to `.lopsy`. Restores all of the above; pixel data is gzip-compressed inside the file.
- **Format**: binary container — `LOPSY\0` magic + uint16 version + uint32 manifest-length + UTF-8 JSON manifest + per-layer gzipped RGBA blobs + per-mask raw byte blobs (referenced from the manifest by index). Entirely client-side; no server round-trip.

### Export Dialog (`⌥⇧⌘E`)
Opened from File → Export… The `⌥⇧⌘E` shown next to the menu item is a display-only accelerator (not wired to a global key handler). A modal dialog with a live thumbnail preview (debounced ~200 ms) and inline options:

- **Format**: PNG, JPEG, WebP, BMP
- **Quality** (JPEG / WebP only): 1 - 100% slider, default 92
- **PNG Quality**: two-button toggle —
  - **Regular** — 8-bit PNG via `canvas.toBlob`
  - **High** — 16-bit PNG via the Rust engine, preserving FP16 precision for wide-gamut workflows
- **Filename**: editable text field; the document name is used by default and the format-appropriate extension (`.png`, `.jpg`, `.webp`, `.bmp`) is appended automatically
- A live pixel-dimension readout (`W × H px`) sits under the preview
- **Enter** confirms; **Escape** cancels (the handler is on the dialog, so it responds once focus is inside it)

**Color-managed output**: when the document is in a wide-gamut working space (Display P3), exports carry the correct color metadata so other apps interpret the pixels faithfully — PNG and JPEG are tagged with a colorimetrically-correct Display P3 ICC profile (Bradford-adapted colorants, true piecewise-sRGB transfer curve), PSD embeds the matching working-space profile, and BMP (which cannot carry a profile) is converted P3 → sRGB before encoding. sRGB documents keep their historical sRGB tagging unchanged. WebP is tagged by its own encoder.

**Embedded credit**: PNG exports carry a `Software: Lopsy` text chunk plus a `Comment` of "Made with Lopsy — http://lopsy.art"; JPEG exports carry the same note as a JPEG comment segment. WebP and BMP carry no note.

### Quick Export PNG (`⇧⌘E`)
One-shot PNG export through the GPU compositor — no dialog, no preview, uses the document name as the filename and quality 92. (The `⇧⌘E` shown in the menu is a display-only accelerator, not wired to a global key handler.)

### DNG / RAW Import
Camera RAW files are decoded entirely in Rust before being uploaded to a GPU layer — JS never touches the raw sensor data.

- **DNG**: demosaic, LJPEG, TIFF parsing in Rust.
- **Fujifilm RAF**: decodes uncompressed X-Trans and Bayer sensor files and renders them with camera-JPEG-style color. Pipeline: parse the RAF container → CFA TIFF (Fuji tags) → decode 16-bit sensor data → gray-world auto white balance → demosaic (X-Trans uses an edge-directed Markesteijn-style 3-pass demosaic that reconstructs green from four directional candidates weighted by local homogeneity, then fills R/B from the smooth color-difference planes; Bayer uses bilinear) → per-camera camera→sRGB color matrix (row-normalized from the DNG ColorMatrix values, so neutral input stays neutral) → exposure boost → film base curve (Provia / Velvia / Astia / Classic Chrome / DR400 curves are compiled in, Velvia is the default) → sRGB gamma → EXIF orientation applied to the final image (portrait shots auto-rotate). White-balance presets for 49 Fuji bodies ship compiled in. (Lossless-compressed RAF and DCP camera profiles are decoded internally but not yet wired to UI.)
