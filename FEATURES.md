# Lopsy Feature Catalog

## Drawing & Painting Tools

### Brush

The toolbar exposes Size, Opacity, Hardness, Fade, and the symmetry toggle. Everything else (preset gallery, brush-tip import, dynamics, texture) lives in the **Brushes modal** opened from the toolbar.

**Core parameters**
- **Size**: 1 - 2000 px (auto-scaled by document size)
- **Opacity**: 1 - 100%
- **Hardness**: 0 - 100%
- **Fade**: 0 - 2000 px (opacity fade-out distance, exposed on the options bar)
- **Taper**: 0 - 2000 px base range, auto-scaled by document size like Size (the modal's Shape-tab slider max is `1.5 × longest-document-side`, capped at 5000 px) — size taper-out distance: brush dabs shrink toward zero over this many pixels of stroke length, independent of the Fade opacity rolloff
- **Spacing**: 1 - 200% of brush size
- **Scatter**: 0 - 100%
- **Angle**: 0 - 360 degrees (set via the modal's angle dial)
- **Symmetry**: horizontal, vertical, both (4-way), or radial (2 - 32 segments). The horizontal/vertical toggles and the **Radial Symmetry** control (with its segment-count number input) all live in the Brush options bar; see the Symmetry section for full behavior.

**Dynamics** (Brushes modal → Dynamics section). Per-dab randomization is performed GPU-side, seeded by each dab's center position so strokes are deterministic for a given path.
- **Size Jitter**: 0 - 100% — per-dab size randomization
- **Hardness Jitter**: 0 - 100% — per-dab hardness randomization (varies the softness of each dab's falloff)
- **Angle Jitter**: 0 - 100% — per-dab rotation randomization (most visible with non-circular tips)
- **Opacity Jitter**: 0 - 100% — per-dab transparency randomization
- **Speed Size**: stroke velocity modulates brush size. A `Faster is` toggle picks the direction (`Thinner`: faster strokes shrink toward 1 px, range 0 – 100%; `Wider`: faster strokes grow up to 3× the base size, range 0 – 300%). A `Sensitivity` toggle (Low / Med / High) tunes how aggressively the velocity-to-size mapping responds to small velocity changes. Velocity is exponentially smoothed (α=0.3) so the size doesn't twitch from noisy pointer deltas.

**Texture** (Brushes modal → Texture section)
- **Built-in textures**: Noise, Canvas, Grain (128×128 grayscale tiles generated procedurally) — `No Texture` disables texturing
- **Import custom texture**: load any grayscale image (PNG/JPG/WebP) as a brush texture; imported textures show up in the dropdown next to the built-ins and can be deleted again from the same row
- **Texture blend mode**: Multiply, Subtract, or Overlay (against the brush color)
- **Scale**: 10 - 300% (tile size relative to the source tile)
- Texture tiles in document space so adjacent strokes line up across the same pattern grid

**Sub-brushes** (Brushes modal → Sub-brushes section). Each sub-brush emits an additional dab co-located with every primary dab, so a single stroke can layer multiple textures, sizes, and rotations at once. A tip can carry any number of sub-brushes; each sub-brush picks its own tip from the same preset grid as the primary brush.
- **Size Ratio**: 10 - 200% (sub-brush size relative to the primary brush)
- **Hardness**: 0 - 100% (independent hardness for the sub-brush)
- **Opacity Ratio**: 1 - 100% of the primary brush opacity
- **Angle Offset**: 0 - 360° relative to the primary brush angle
- **Size / Angle / Opacity Jitter**: 0 - 100% per-dab randomization, independent from the primary brush's dynamics

**Tips & presets** (Brushes modal — left panel)
- **Tip kinds**: procedural circle (no bitmap), **alpha tip** (1 byte/pixel grayscale, brush color tints the dab), or **color tip** (4 byte/pixel RGBA, color comes from the bitmap itself). Color-tip dabs use premultiplied-alpha "over" compositing so overlapping rotated dabs layer correctly.
- **Custom brush tips**: import grayscale bitmaps as alpha tips. PNG/JPG/WebP supported.
- **Brush from Selection** (Edit menu → "Define Brush from Selection"): captures the current marquee selection as a new brush tip. Two variants:
  - **Grayscale (alpha) capture**: inverts the source so dark pixels paint opaquely (Photoshop convention) and the selection mask crops to the marquee bounds.
  - **Color capture**: preserves full RGBA so the tip stamps the original colors of the selection (useful for stamp-pattern brushes).
- **ABR import**: Adobe Brush file support — drops every brush in the file into the preset grid as new tips.
- **Preset import / export**: dumps the user's custom presets to `lopsy-brushes.json` (Base64-encoded bitmap data plus every dynamic / sub-brush parameter); the same file can be re-imported on any machine to restore the preset library.
- **Built-in presets** (loaded from the Rust engine; current set): Hard Round, Soft Round, Airbrush, Square, Cross Hatch, Diamond, Star, Slash, Chalk, Spray, Leaf. All built-in presets ship with spacing standardized to 1% of brush size so they paint smooth strokes by default.
- **Delete**: removes the active preset (only enabled for user-imported custom presets, never built-ins)

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
- **Size**: 1 - 200 px (base range; auto-scaled by document size)
- **Shift+click**: applies dodge/burn along a straight line from the previous stroke endpoint

### Sponge
- **Mode**: saturate or desaturate
- **Strength**: 1 - 100 (saturation delta applied per dab)
- **Size**: 1 px – document-scaled max (default cap 200 px)
- Shortcut: `Y`
- Converts each affected pixel to HSL, shifts the saturation channel by the configured delta with a Gaussian falloff (1.0 at the dab center, 0 at the edge), and writes back to RGB. Internal hardness is fixed at 0.5; dab spacing is 25% of the brush size.
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
- **Feather**: 0 - 250 px (soft edge applied after the marquee is committed; three-pass separable box blur on the GPU approximating Gaussian falloff)
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
- Paint over the canvas to grow (or shrink) the selection: each pointer-move samples the seed color under the cursor and runs a flood-fill region-grow constrained by the brush radius, the tolerance, and the edge strength. Strokes accumulate across many sample points so dragging across a region progressively absorbs it. The pre-stroke mask is preserved so a single undo restores the prior selection.

### Selection Operations
- Add, subtract, intersect (combine modes)
- Invert selection (`⇧⌘I`)
- Select all (`⌘A`)
- Deselect (`⌘D`)
- **Move the selection outline**: with a rectangular or elliptical marquee tool active, press-drag from *inside* an existing selection to translate the selection mask itself — the marching-ants outline moves while the underlying pixels stay put (any active floating selection is dropped first). Arrow keys nudge the same marquee bounds.
- **Click to deselect**: a single click (drag < 2 px) with a marquee tool clears the active selection, the same as `⌘D`.
- Selection from layer alpha — `Cmd/Ctrl+click` a layer thumbnail (non-transparent pixels become the selection)
- Path → Selection (from the Paths panel)
- **Selection → Path**: traces the selection mask with marching squares, simplifies the contour with Douglas-Peucker, and fits smooth cubic Bezier anchors using Catmull-Rom tangents. The result is added to the Paths panel as a new path. Disabled when nothing is selected.
- **Grow…**: expands the selection by an integer pixel amount (1 - 100 px)
- **Shrink…**: contracts the selection (1 - 100 px)
- **Feather…**: softens the selection edge with a Gaussian-approximation blur (radius 1 - 250 px)

### Quick Mask Mode
- Shortcut: `Q` (toggle)
- Paints the active selection as a translucent red overlay on the canvas; brush, pencil, and eraser then edit the selection mask directly
- White paint adds to the selection, black (or the eraser) subtracts; intermediate gray values produce partial selection coverage
- Exiting Quick Mask reads the painted mask back from the GPU and replaces the selection (with feather applied if a feather radius is set on the marquee)
- Works regardless of the active layer — painting only affects the selection mask, not pixels
- **Fill (paint bucket) and Gradient tools route into the quick mask** instead of the active layer while quick mask is on, so smooth selection falloffs (linear or radial gradients) and bucket fills of the selection mask are first-class operations. Quick mask mode takes precedence over layer-mask edit mode if both are somehow active.

---

## Transform

- **Modes**: free, skew, distort, perspective
- **Scale**: X and Y independently
- **Rotation**: arbitrary angle
- **Translation**: X and Y
- **Skew**: X and Y
- **Corner manipulation**: 4-point distort/perspective
- **Quick transforms**: flip horizontal, flip vertical, rotate 90 CW, rotate 90 CCW
- **Cmd/Meta+drag a rotation handle**: snaps rotation to 15° increments (the same snap kicks in automatically when grid + snap-to-grid are enabled)
- **Cmd/Meta+drag a scale handle**: constrains the scale to a uniform aspect ratio

---

## Other Tools

### Move
- Drag to reposition layers
- Arrow key nudge — 1 px by default; when grid + snap-to-grid is enabled, each key press nudges by exactly one grid cell. Arrow keys also nudge the active marquee bounds when a selection tool is active.
- Snap to grid
- Snap to guides
- **Snap to layers** (View menu → "Snap to Layers"): while dragging, the moving layer's left/right/top/bottom edges and X/Y centers attract to the matching edges and centers of every other visible layer within a 5 px threshold. Magenta alignment guides span the document while a snap is engaged and clear on mouse-up.
- **Align**: left, center-h, right, top, center-v, bottom
- **Fit** (options-bar button): scales the active raster layer so its longest side matches the canvas — preserving aspect ratio — and centers it on the artboard. Useful for bringing an oversized pasted/dropped image into view; reuses the GPU `scaleLayerTexture` path so no pixel data round-trips through JS.
- **Alt/Option+drag (no active marquee)**: duplicates the active layer in place, then moves the new copy — leaves the original layer untouched.
- **Alt/Option+drag (with an active marquee)**: copies the selected pixels of the active layer into a floating duplicate and moves that copy, leaving the original pixels under the selection intact (Photoshop-style "alt-drag the selection").
- **Cmd/Meta+drag (transform handles)**: constrains aspect ratio when scaling and snaps rotation to 15° increments. Grid + snap-to-grid also forces snapping automatically during the transform.

### Paste / Drop behavior

Paste takes one of two routes depending on where the image came from.

- **Pasting back content copied inside Lopsy** (`⌘C` / `⌘X` / `⇧⌘C`, then `⌘V`) **pastes in place**: the new layer lands at the offset the content was copied from, not at the canvas origin. Copy/cut also mirror the pixels to the system clipboard as a plain PNG so they can be pasted into other apps, and that position-less PNG is what a real browser hands back on paste — so Lopsy compares the incoming image against the GPU-resident internal clipboard and uses the internal (positioned) copy only when the dimensions **and** pixels both match. The comparison samples up to ~4096 pixels, tolerates the small RGB drift a clipboard round-trip introduces under partial alpha, and decodes with `colorSpaceConversion: 'none'` so a wide-gamut round-trip doesn't push values past the match tolerance. A same-size but genuinely different external image (say, a document-sized screenshot pasted after Copy Merged) fails the pixel check and is treated as external.
- **Pasting or dropping an external image** creates a new raster layer at the image's natural dimensions, positioned at the canvas origin, and **auto-selects** the new layer's non-transparent pixels (loads the alpha as a marquee selection). Combined with the **Fit** button, oversized images can be quickly scaled in to fit without first hunting for a transform handle off-canvas.
- File → New and opening an image drop the internal clipboard, since resetting the engine frees the GPU clipboard texture that an in-place paste would read from. A copy made before a New therefore pastes as an external image afterward.
- When duplicating a layer that is wider or taller than the canvas, the +10/+10 visual offset is clamped so the duplicate's far edge never moves past the canvas edge that the original was within (prevents already-oversized layers from being shoved further out of view).

### Eyedropper
- Click (or click-drag) to set the foreground color from the composited pixel under the cursor — samples the on-screen result, not just the active layer.
- **Sample size**: point, 3×3, and 5×5 area-averaging modes are implemented in the sampling logic, but the live canvas eyedropper currently always samples a single pixel — there is no options-bar control to switch sample size yet.

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

The Adjustments panel is a reorderable, stackable list of adjustment **nodes** attached to a group layer (the root group acts as the document-level adjustment stack when no group is active). Each node has its own enable toggle, expand/collapse state, and per-type controls. The panel is resizable from its bottom-left corner.

Per-node controls (header):
- **Eye** icon — enable / disable this node without removing it
- **Trash** — remove
- **Chevron** — expand / collapse the node's body
- Drag the header (grip) to reorder; sliders inside the body don't trigger the reorder drag
- New nodes auto-expand on creation

Available node types (Add menu):
- **Exposure** — stops, -5 to +5 (multiplier = 2^value)
- **Contrast** — -100 to +100
- **Highlights / Shadows** — Highlights -100 to +100, Shadows -100 to +100, Whites -100 to +100, Blacks -100 to +100
- **Saturation** — Saturation -100 to +200, Vibrance -100 to +200 (the -100 floor is full desaturation; the cap extrapolates past 1× saturation distance from gray and only clips at the gamut edge)
- **Vignette** — 0 to 100 (now correctly piped through the per-group adjustment pipeline)
- **Curves** — per-channel tone curves (RGB master + R / G / B), evaluated as
  monotone cubic Hermite splines. Master applies to every channel first,
  then per-channel curves remap their own value. Edited via the
  `CurveEditor` (drag points, click to add, double-click or yank to remove).
  Runs as a single 256×1 RGBA LUT texture sampled in the GPU adjustments
  shader; identity curves bypass the lookup.
  - **Histogram background**: the active layer's R / G / B histograms render behind the curve as colored channel shading (red/green/blue translucent fills on per-channel tabs, neutral gray on the RGB master). Sampled live from the GPU via the shared `useGroupHistogram` hook so the histogram tracks paint operations in real time.
- **Levels** — Photoshop-style visual editor with a layered RGB histogram and handle-driven controls (no sliders). Per-channel input/output remap with RGB master + R / G / B tabs:
  - **Input black / gamma / white**: three rectangular handles below the histogram strip drive Input Black, Gamma (0.1 – 10, log scale), and Input White. Drag the handles directly; numeric readouts update live.
  - **Output black / white**: two handles on a gradient bar drive Output Black and Output White.
  - **Histogram visualization**: R, G, and B histograms render layered as distinct shades of gray with additive ("lighter") compositing, so common ranges read brighter; histogram is sampled live from the active layer's GPU pixels and refreshes as paint operations advance. RGB tab shows all three layers; per-channel tabs focus the active channel and mute the others.
  - Master is applied first, then per-channel levels. Compiled to a 256×1 LUT and shares the GPU adjustments path with Curves; identity levels bypass the lookup.
- **Invert** — single toggle (no numeric controls); inverts RGB at composite time.
- **Hue / Saturation** — Hue -180° to +180°, Saturation -100 to +100, Lightness -100 to +100. Operates per-pixel in HSL space.
- **Color Balance** — tone-range tabs (Shadows, Midtones, Highlights) each with Cyan ↔ Red, Magenta ↔ Green, and Yellow ↔ Blue sliders (-100 to +100). Per-pixel weighting determines how much each tonal range contributes to the shift.
- **Photo Filter** — Color (color picker), Density 0 - 100, Preserve Luminosity (checkbox). Blends a tinted overlay over the pixel; when Preserve Luminosity is on, the tinted result is re-luminance-matched to the source.
- **Black & White** — six channel sliders (Reds, Yellows, Greens, Cyans, Blues, Magentas), each -200 to +300, controlling how strongly that hue contributes to the monochrome output luminance.
- **Channel Mixer** — output-channel tabs (R / G / B) each with Red, Green, Blue (-200 to +200), and Constant (-200 to +200) sliders. Lets a single output channel be remixed as a linear combination of the source channels plus a bias.
- **Gradient Map** — visual gradient editor (shared `GradientEditor` component) with draggable rectangular stop handles on a live gradient bar; clicking an empty spot on the handle row inserts a new stop at that position. The selected stop drives a full `ColorPicker` (HSV square + hue strip + RGB/HSV/hex fields). A minimum of 2 stops is enforced. The stop list is compiled into a 256×1 RGBA LUT at sync time and applied as a luminance-indexed lookup in the GPU adjustments shader.

All 14 adjustment types now have first-class UI controls and are fully GPU-accelerated. Internally the node list compiles down to the legacy flat `ImageAdjustments` shape so the GPU compositor's adjustment pass is unchanged.

**Default adjustment stack on new documents**: every freshly created document (and every image opened or flattened) seeds the root group with four identity-state adjustment nodes — Levels, Curves, Exposure, and Hue/Saturation — so users can grade an image without first hunting through the Add menu. Identity nodes are bypassed in the GPU pipeline so there is no performance cost until a slider is moved.

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
- **Mask**: grayscale mask with enable/disable toggle. All mask painting (brush, eraser, pencil, gradient, fill) runs directly on the GPU mask texture — no per-frame CPU→GPU upload, so editing a mask is as fast as painting pixels.
- **Color tag**: optional swatch (red, orange, yellow, green, blue, purple, gray, or none) shown as a vertical bar on the left edge of the layer row. Set via the layer row's right-click context menu; useful for visually grouping/organizing layers in a deep stack.

### Layer Operations
- **New Layer** (`⇧⌘N`, menu-only accelerator — see Single-Key Shortcuts note): appends a blank raster layer above the active one
- **Duplicate Layer** (`⌘J`, menu-only accelerator): clones the active layer in place
- **Group Layers** (`⌘G`, menu-only accelerator): wraps the currently-selected layers in a new group
- **Merge Down** (`⌘E`): composites the active layer into the layer below (the only layer-menu accelerator actually wired to a key handler)
- **Flatten Image**: composites every visible layer into a single raster layer
- **Rasterize Layer**: bakes a **text** layer's current visual into pixels in place, reading the engine's current x/y/w/h so the result lands at the visible position even after GPU texture expansion from upstream paint ops. The button appears in the Layers panel toolbar only while a text layer is active — there is currently no rasterize entry point for shape or group layers.
- **Rasterize Layer Style**: bakes a layer's effects (drop shadow, glow, stroke, color overlay) into the layer's pixels and clears the effect descriptors
- Reorder (drag)
- Move to group (reparent)
- Rename
- Align (left, center-h, right, top, center-v, bottom) — works on **group** layers too: a group has no pixels of its own, so it aligns by the combined content bounds of its descendants and shifts the group plus every child together (matching how dragging a group with the Move tool behaves)
- Add/remove/toggle mask — works on raster, text, shape, and **group** layers; group masks are sampled at composite time so the entire group is masked as a single unit (with the group's own opacity and blend mode applied on top)
- **Cmd/Ctrl+click a layer thumbnail**: loads that layer's alpha as a marquee selection (non-transparent pixels become the selection)
- **Click a layer's mask thumbnail**: always enters mask edit mode (focus switches to the mask reliably; no toggle behavior).
- **Set layer color tag**: right-click a layer row to open a context menu with the 7 tag colors plus "None" to clear.

### Layers Panel Row Layout
- Each layer row shows (left to right): the visibility eye, the layer thumbnail (plus mask thumbnail if a mask is present), the layer name, an **Effects button**, and the lock toggle on the far right.
- **Effects button**: opens that layer's effects/adjustments drawer. The icon turns green when the layer has at least one active effect or adjustment node, so it's possible to spot effected layers at a glance from anywhere in the stack.
- **Color tag bar**: optional swatch (set via right-click → color tag) appears as a vertical bar on the left edge of the row.

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

One-click image correction commands that analyze the active layer's pixel histogram and apply non-destructive adjustment nodes to the active group.

- **Auto Tone** (`⇧⌘L`): stretches each R/G/B channel independently to fill the full tonal range, clipping the darkest and brightest 0.1% of pixels per channel. Adds a Levels adjustment node with per-channel input black/white points.
- **Auto Contrast** (`⌥⇧⌘L`): stretches the luminance histogram uniformly across all channels, preserving relative color balance. Adds a Levels adjustment node on the master RGB channel only.
- **Auto Color** (`⇧⌘B`): neutralizes color casts by computing each channel's weighted mean and mapping it toward a neutral gray target, then stretching the tonal range. Adds a Curves adjustment node with per-channel midpoint correction.

All three operations are fully undoable, read pixels from the GPU via `readLayerAsImageData`, and auto-switch the target group from pass-through to normal blend mode when adding adjustments (required for the compositor to apply group-level adjustment nodes).

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
- **Foreground / background color**: with swap and reset
- **Recent colors**: up to 28
- **Panel visibility**: togglable per panel from the panel toolbar — see [Panel Docking & Layout](#panel-docking--layout). There is no separate sidebar-collapse toggle, and individual panels no longer collapse to a header; they are sized by their dock, split, or floating window instead.
- **Mask edit mode**: on/off
- **Draggable modals & drawers**: filter dialogs, pattern fill, layer effects, adjustments, and the reference image drawer can be repositioned by dragging the header bar (cursor: grab on hover; content interactions are not hijacked). Dockable panels use the docking system's own drag instead. The effects and reference drawers sit immediately to the left of the right dock and shift as that dock is resized.
- **Filter / pattern preview overlay**: when live preview is enabled the dim backdrop is removed and pointer-events on the overlay are disabled so the canvas is fully visible while the modal stays interactive

### Global UI Conventions
- **Slider double-click → reset**: every numeric slider in the UI (brush size, opacity, hardness, adjustment sliders, filter sliders, etc.) snaps back to its default value on double-click. The numeric text input inside the slider is exempt so double-clicks there select the value for editing instead.
- **Slider arrow-key step**: with a slider's numeric input focused, **↑ / ↓** increment / decrement the value by one step (log-scaled sliders like Levels gamma step proportionally), clamped to the slider's min / max. Enter blurs the input to commit.
- **Status-bar zoom double-click → 100%**: double-clicking the zoom percentage readout in the status bar resets the viewport zoom to 100% (1×).
- **Color swatch selection**: clicking the foreground or background swatch in the Color panel makes it the one the picker, hex field, and RGBA sliders edit; clicking a recent-color swatch applies that color to whichever swatch is currently active. (The old double-click-to-expand behavior went away with panel collapsing.)
- **Layer name double-click → rename**: double-clicking a layer row's name turns it into an inline text input; Enter commits, Escape cancels.

### Notifications & Error Toasts
Transient messages surface as toasts stacked in a fixed panel at the **top-right** of the window (max width 360px, newest appended at the bottom). The stack is announced to assistive tech via `role="status"` / `aria-live="polite"`.

- **Two levels**: `error` (red left border) and `info` (accent-colored left border). No title, no icon — just the message and a dismiss control.
- **Manual dismiss only**: toasts do **not** auto-expire on a timer; each stays until the user clicks its **×** button. Multiple messages accumulate in the stack rather than replacing one another.
- **Error triggers** (all routed through `notifyError`): failures to open a file, open/load or save a project, import a PSD / DNG / RAF, paste an image, or export (Quick Export PNG, Export…, or Export PSD); plus lower-level guards such as "Engine not ready", "No active layer", an empty decode result, and WebGL context init / restore failures. Messages that wrap an exception append a human-readable cause.
- **Info trigger**: importing a PSD whose unsupported layer types were rasterized posts an info toast noting the pixels are preserved but no longer editable as their original type.

### Canvas Right-Click Context Menu
Right-clicking the canvas opens a small menu with:
- **Define Brush Preset** — only shown when a marquee selection is active. Captures the selected pixels of the active layer as a new brush tip and opens the Brushes modal with the new preset selected. Same code path as Edit → "Define Brush from Selection".
- **Deselect** — clears the active marquee selection (disabled when there is none).
- **Select All** — selects every pixel in the document (equivalent to ⌘A).

The menu is suppressed on coarse-pointer devices (touch) so long-press doesn't accidentally open it.

### Single-Key Shortcuts
In addition to per-tool toolbox shortcuts (`B`, `E`, `J`, `Y`, `R`, `S`, `H`, `O`, `G`, `I`, `V`, `M`, `L`, `W`, `T`, `N`, `U`, `P`, `C`, …) the editor ships these global keys:

- **`X`** — swap foreground and background colors
- **`D`** — reset foreground/background to the defaults (black / white)
- **`Q`** — toggle Quick Mask mode
- **`[` / `]`** — decrement / increment the active tool's size by 1 (works for brush, dodge & burn, smudge, pencil, eraser, clone stamp, healing brush, pen-tool stroke width, and shape-tool stroke width — the bracket maps to whichever size slider the current tool exposes)
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

A floating, draggable, resizable modal (toggled from the toolbar) for keeping reference images alongside the canvas.

- Load reference images via file picker or drag-and-drop onto the drawer
- **Multiple images**: thumbnail strip with add/remove, click to switch between references
- **Zoom**: mouse-wheel zoom with cursor-centered scaling (0.05x – 20x)
- **Pan**: click and drag inside the preview to reposition
- **Per-image view state**: zoom, pan, opacity, and horizontal/vertical flip are tracked independently for each loaded image
- **Drag the header bar** to reposition the drawer; **bottom-right resize handle** to resize
- Images are pure client-side blob URLs — no upload, no backend

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

- Named stored paths
- Operations: add, remove, select, rename, update anchors
- Stroke path to pixels
- Convert path to selection

---

## Navigator Panel

- Live thumbnail of the composited canvas (refreshed by copying the main WebGL canvas; throttled to ~5 Hz so it stays cheap during heavy strokes)
- **Viewport indicator**: a translucent rectangle showing the current viewport bounds inside the document; click anywhere on the minimap to recenter the viewport, or drag the indicator rectangle to pan
- **Zoom slider**: log-scaled, mapping slider position to `64^(value/100)` so the full 0.01× – 64× zoom range is reachable without coarse jumps
- **Zoom readout**: displays the current zoom as a percentage

---

## Channels Panel

A per-layer view of the active layer's RGBA channels, modeled on Photoshop's Channels palette.

- **Rows**: RGB (composite), Red, Green, Blue, Alpha. Each row has a colored swatch dot, a label, and a live grayscale thumbnail of that channel sampled from the active layer's GPU texture.
- **Active channel**: clicking a row marks that channel as the active view — used by tools like the eyedropper / curves to operate on a single channel.
- **Per-channel visibility**: each non-composite row has an eye/eye-off toggle that hides or shows that channel in the composite output. The composite RGB row reflects the current visibility mask of R / G / B.
- **Thumbnails**: extracted on the JS side from the layer's RGBA bytes (red, green, blue, or alpha mapped into a grayscale image) and re-rendered whenever the layer's pixel-data version increments, so the panel stays in sync with painting.

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
- **Center**: configurable (defaults to canvas center)
- Available on brush, pencil, and eraser. The symmetry config (axes, center, radial segment count) is global, so it applies to whichever of these tools is active. Only the Brush options bar exposes the **Radial Symmetry** toggle and its segment-count number input; the Pencil options bar exposes just the horizontal/vertical toggles (radial set from the Brush still applies to pencil/eraser strokes), and the Eraser inherits the active config without its own toggles.
- **Cmd/Meta+click** on the canvas while any symmetry mode (horizontal, vertical, or radial with 2+ segments) is active moves the symmetry center to the click point without painting a dab. Lets the user reposition the mirror axis directly from the canvas without opening a settings panel.
- **Caveat — this intercept is global, not brush-only.** The check runs at the top of the canvas pointer-down handler, before the tool guards and before any tool dispatch, and it is not scoped to the paint tools. So while *any* symmetry axis is enabled, a Cmd/Meta+click is swallowed by the symmetry-center move for **every** tool — which suppresses the other documented Cmd/Meta gestures (shape and marquee 1:1 lock, gradient 15° snap, transform snap, Path anchor convert, the Cmd+shift 15° snap on straight-line brush/pencil/eraser strokes, and the Cmd half of the Clone Stamp / Healing source-set). Alt/Option still sets the stamp and healing source. Turn symmetry off to get those gestures back.

---

## Color

- **Color spaces**: sRGB, Display P3, Rec. 2020, Linear sRGB
- **FP16 / wide gamut**: RGBA16F textures when GPU supports `EXT_color_buffer_float`
- **EDR passthrough**: unclamped values for extended dynamic range displays

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
- Entirely client-side, no backend

---

## File I/O & Export

### Open / Save
- **New** (`⌘N`, menu-only accelerator): blank document with width/height/background prompt. Resets the viewport zoom and pan so the fresh canvas always lands fit-to-view, even after working on a much larger document.
- **Open…** (`⌘O`, menu-only accelerator): open a PNG/JPEG/GIF (first frame)/BMP/WebP/PSD/DNG/RAF/.lopsy from disk. The picker lists every supported extension explicitly rather than `image/*` — mixing the two makes Chrome on macOS collapse the dialog down to a single filter.
- **Two routing paths, not one.** The File-menu picker routes inline **by extension** (`.lopsy` → project loader, `.psd` → PSD importer, `.dng` / `.raf` → the Rust RAW decoders, anything else → browser `<img>` decode). The pre-document flow — the New Document modal's "Open file" button and drag-and-drop — instead uses the shared `classifyOpenFile` helper, which checks the same four extensions but falls back to the **MIME type** (`image/*`) rather than attempting a decode. The practical difference is at the edges: a file with an image MIME type but an odd extension opens on drop and fails from the menu picker, while an unrecognized file dropped on the canvas is silently ignored (the New Document modal's button surfaces a friendly error instead).
- **Drag-and-drop is always live**, not just before a document exists — the drop target is the whole app shell as well as the canvas. Dropping an image onto an open document adds it as a layer (see Paste / Drop behavior); dropping a `.psd`, `.dng`, `.raf`, or `.lopsy` **replaces** the open document.
- **Unsaved-changes guard**: **New**, **Open…**, and **Open Project…** check the document's dirty flag and put up a browser `confirm()` — "You have unsaved changes. Are you sure you want to continue?" — before discarding work. Closing or reloading the tab triggers the browser's own `beforeunload` warning. The drop path performs **no** such check: a `.psd` or `.lopsy` dropped onto a dirty document replaces it immediately.
- The dirty flag is cleared by **Save Project** and by **PSD import** — and also by any **export**, since the shared download helper marks the document clean. Exporting a PNG therefore silences the unsaved-changes warnings even though nothing was saved to a project file.
- **Open PSD**: rebuilds layers, masks, blend modes, and effects from the PSD reader (Rust). Both **RGB** and **CMYK** color modes are accepted at 8-bit and 16-bit depth — CMYK files are converted to RGB on import (naive `(1−C)(1−K)` channel math) for both the per-layer and merged-composite paths. Other color modes (grayscale, indexed, Lab, etc.) are rejected with an unsupported-color-mode error.
- **Export PSD** (File menu): serialises the current document via the PSD writer at 16-bit precision (pass-through groups are written as `normal` since PSD has no pass-through discriminant)

### Native Project Format (.lopsy)
- **Save Project** (`⌘S`, menu-only accelerator): writes the full editor state to a `.lopsy` file and triggers a browser download. Round-trips every layer (raster pixels, text, shape, group), masks, blend modes, opacity, position, clip-to-below, layer effects, color tags, group adjustment node stacks, the active layer, the document's name / size / background, and the workspace's stored vector paths (Paths panel) and canvas guides. (Files saved before paths/guides were serialized simply omit those fields and load with an empty path/guide set.)
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
