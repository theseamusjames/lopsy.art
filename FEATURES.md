# Lopsy Feature Catalog

## Drawing & Painting Tools

### Brush

The toolbar exposes Size, Opacity, Hardness, Fade, and the symmetry toggle. Everything else (preset gallery, brush-tip import, dynamics, texture) lives in the **Brushes modal** opened from the toolbar.

**Core parameters**
- **Size**: 1 - 2000 px (auto-scaled by document size)
- **Opacity**: 1 - 100%
- **Hardness**: 0 - 100%
- **Fade**: 0 - 2000 px (opacity fade-out distance, exposed on the options bar)
- **Taper**: 0 - 2000 px (size taper-out distance, exposed in the modal's Shape tab — brush dabs shrink toward zero over this many pixels of stroke length, independent of the Fade opacity rolloff)
- **Spacing**: 1 - 200% of brush size
- **Scatter**: 0 - 100%
- **Angle**: 0 - 360 degrees (set via the modal's angle dial)
- **Symmetry**: horizontal, vertical, or both (4-way)

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
- **Shift+click**: draws a straight line from the previous stroke endpoint to the click point
- **Hold-to-smooth**: pause the cursor mid-stroke for ~1500 ms and the recorded freehand path is auto-smoothed (Ramer-Douglas-Peucker simplification + Catmull-Rom interpolation, straight-line detection within a 4 px tolerance) and re-rasterized in place. Undo restores the freehand version first, then the pre-stroke state.

### Pencil
- **Size**: 1 - 100 px
- **Symmetry**: horizontal, vertical, or both
- Pixel-perfect Bresenham lines (no anti-aliasing)
- **Shift+click**: draws a straight pixel-perfect line from the previous stroke endpoint

### Eraser
- **Size**: 1 - 200 px
- **Opacity**: 1 - 100%
- **Hardness**: 0 - 100% (internal)
- **Shift+click**: erases a straight line from the previous stroke endpoint

### Dodge / Burn
- **Mode**: dodge or burn
- **Exposure**: 1 - 100%
- **Size**: 1 - 200 px
- **Shift+click**: applies dodge/burn along a straight line from the previous stroke endpoint

### Sponge
- **Mode**: saturate or desaturate
- **Strength**: 1 - 100 (saturation delta applied per dab)
- **Size**: 1 px – document-scaled max (default cap 200 px)
- Shortcut: `Y`
- Converts each affected pixel to HSL, shifts the saturation channel by the configured delta with a Gaussian falloff (1.0 at the dab center, 0 at the edge), and writes back to RGB. Internal hardness is fixed at 0.5; dab spacing is 25% of the brush size.
- **Shift+click**: applies the sponge along a straight line from the previous stroke endpoint

### Clone Stamp
- **Size**: 1 - 200 px
- **Alt/Cmd+click**: set the source sample point
- **Shift+click**: stamps along a straight line from the previous stroke endpoint, preserving source offset

### Healing Brush
- **Size**: 1 px – document-scaled max (default cap 200 px, scales with canvas size)
- **Opacity**: 1 - 100%
- **Alt/Cmd+click**: set the healing source sample point
- **Shift+click**: heals along a straight line from the previous stroke endpoint, preserving source offset
- Color-correction healing: subtracts the source mean color and adds the destination mean color, so texture is borrowed from the source while tone matches the destination
- Soft quadratic falloff at the dab edge for seamless blending

### Smudge
- **Size**: 1 - 200 px
- **Strength**: 0 - 100% (how far pixels are pulled along the stroke)
- Shortcut: `R`
- Pulls colors along the stroke direction, blending neighbouring pixels.
- **Shift+click**: smudges along a straight line from the previous stroke endpoint

### Spray
- **Size**: 1 - 500 px
- **Density**: 1 - 100 (number of dots emitted per dab)
- **Opacity**: 1 - 100%
- **Softness**: 0 - 100% (per-dot hardness falloff)
- Shortcut: `J`
- Holding the cursor still keeps emitting dots at ~6 Hz so paint accumulates over time, mimicking an airbrush. Dragging spreads dots along the path with automatic spacing scaled to brush size.

---

## Shape & Vector Tools

### Shape Tool
- **Shape types**: ellipse, polygon. A rectangle/square is drawn as a
  4-sided polygon (set sides to 4); triangles use sides=3, etc.
- **Output**: pixels or path
- **Fill color**: any color or none
- **Stroke color**: any color or none
- **Stroke width**: 1 - 50 px
- **Polygon sides**: 3 - 64
- **Corner radius**: 0 - 200 px
- **Aspect ratio lock**: width/height ratio constraint
- **Cmd/Meta+drag**: holding meta while dragging temporarily forces a 1:1 aspect ratio (perfect square / circle / regular polygon) regardless of the persistent aspect-ratio toggle. Releasing meta returns to the unconstrained or persistently-locked behavior.

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
- **Font family**: Inter, Arial, Helvetica, Georgia, Times New Roman, Courier New, JetBrains Mono, Verdana, Trebuchet MS, Impact, Comic Sans MS, Palatino, Garamond, Brush Script
- **Font weight**: normal (400) or bold (700)
- **Font style**: normal or italic
- **Text align**: left, center, right, justify
- **Line height**: configurable
- **Letter spacing**: configurable
- **Underline (`U`)**: toggle a horizontal stroke 10% of the font size below the baseline, 8% of font-size thick
- **Strikethrough (`S`)**: toggle a horizontal stroke 32% of the font size above the baseline, 8% of font-size thick
- **Mode**: point text (no wrap) or area text (fixed width with wrapping)
- **Bind to path**: a Path dropdown in the text options bar lists every stored path. Once bound, glyphs are placed one by one along the path's arc-length and rotated to match the local Bezier tangent (works on both open and closed paths). Live editing (typing) re-flows the type along the curve in real time, and editing the path's anchors invalidates the cached layout so the text follows. Selecting "None" unbinds and restores the layer's pre-bind position.

**Editing keys** (active while a text layer is being edited)
- **Shift+Enter** or **Tab**: commit the edit and exit text editing (plain Enter inserts a newline). Tab also swallows the browser's default focus change so the next single-key shortcut isn't captured by a newly-focused element.
- **Escape**: cancel the edit. If the layer was newly created in this editing session, it is removed entirely; otherwise the layer keeps its prior text.
- **Cmd/Ctrl + A**: jumps the cursor to the end of the buffer (simplified select-all — no highlighted-selection support).
- Arrow keys, Home / End, Backspace / Delete behave as standard text-input keys against the editing buffer.

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
- Pasting from the clipboard or drag-and-dropping an image file onto the canvas creates a new raster layer at the image's natural dimensions and **auto-selects** the new layer's non-transparent pixels (loads the alpha as a marquee selection). Combined with the **Fit** button, oversized images can be quickly scaled in to fit without first hunting for a transform handle off-canvas.
- When duplicating a layer that is wider or taller than the canvas, the +10/+10 visual offset is clamped so the duplicate's far edge never moves past the canvas edge that the original was within (prevents already-oversized layers from being shoved further out of view).

### Eyedropper
- **Sample size**: point, 3x3, 5x5

### Fill (Paint Bucket)
- **Tolerance**: 0 - 255
- **Contiguous**: on/off

### Gradient
- **Type**: linear, radial
- **Stops**: multiple color stops with position (0-1)
- **Reverse**: on/off
- **Cmd/Meta+drag**: snaps the gradient angle to 15° increments while dragging (handy for aligning a gradient to a horizontal, vertical, or 45° axis without having to drag a perfectly straight line)
- **Mask edit mode**: when the active layer's mask is being edited, gradient drags paint into the mask texture instead of the layer pixels.
- **Quick Mask mode**: when Quick Mask is active, gradient drags paint into the GPU quick-mask texture in document space — produces smooth selection falloffs.

### Crop
- **Modes**: Normal (rectangular) or Perspective (4-point quadrilateral correction). The mode dropdown lives in the options bar; switching to Perspective shows Apply / Cancel buttons next to the dropdown.
- **Normal mode**: interactive drag to define crop rectangle.
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
- **Exposure** — stops (multiplier = 2^value)
- **Contrast** — -100 to +100
- **Highlights / Shadows** — Highlights -100 to +100, Shadows -100 to +100, Whites -100 to +100, Blacks -100 to +100
- **Saturation** — Saturation -100 to +100, Vibrance -100 to +100
- **Vignette** — 0 to 100 (now correctly piped through the per-group adjustment pipeline)
- **Curves** — per-channel tone curves (RGB master + R / G / B), evaluated as
  monotone cubic Hermite splines. Master applies to every channel first,
  then per-channel curves remap their own value. Edited via the
  `CurveEditor` (drag points, click to add, double-click or yank to remove).
  Runs as a single 256×1 RGBA LUT texture sampled in the GPU adjustments
  shader; identity curves bypass the lookup.
  - **Histogram background**: the active layer's R / G / B histograms render behind the curve as colored channel shading (red/green/blue translucent fills on per-channel tabs, neutral gray on the RGB master). Sampled live from the GPU via the shared `useGroupHistogram` hook so the histogram tracks paint operations in real time.
- **Levels** — Photoshop-style visual editor with a layered RGB histogram and handle-driven controls (no sliders). Per-channel input/output remap with RGB master + R / G / B tabs:
  - **Input black / gamma / white**: three rectangular handles below the histogram strip drive Input Black, Gamma (0.01 – 10, log scale), and Input White. Drag the handles directly; numeric readouts update live.
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

### Blur
- **Gaussian Blur**: radius
- **Box Blur**: radius
- **Motion Blur**: angle (degrees), distance (px)
- **Radial Blur**: amount (centered)
- **Tilt-Shift Blur**: focus position 0–100% (center of sharp band along blur axis), focus width 0–100% (width of the sharp band), blur radius 1–32 px (max blur intensity in out-of-focus regions), angle 0–360° (rotation of the focus plane). Creates selective-focus miniature photography effects by blurring areas outside a configurable focus band while leaving the focus zone sharp. **Cmd/Meta+drag** on the on-canvas angle handle snaps the focus-plane rotation to 15° increments.
- **Surface Blur**: radius 1 – 50 px (auto-scales with document size), threshold 1 – 255 (max channel difference a neighbour is allowed to have before being excluded from the blur). Edge-preserving blur that smooths low-contrast regions (skin, gradients, noise) while leaving edges sharp — a Bilateral-style filter implemented as a single GPU pass.

### Sharpen
- **Unsharp Mask**: radius, amount, threshold

### Color
- **Brightness / Contrast**: -100 to +100 each
- **Hue / Saturation / Lightness**: hue -180 to +180, saturation -100 to +100, lightness -100 to +100
- **Invert**: no parameters
- **Desaturate**: no parameters (Rec. 709 luminance)
- **Posterize**: levels (min 2)
- **Threshold**: level 0 - 255

### Noise
- **Add Noise**: amount 1 - 100 (default 25), monochromatic on/off
- **Fill with Noise**: monochromatic on/off

Both noise filters open a dedicated dialog (separate from the generic filter dialog) with Cancel / Apply only — no live preview. Each press of Apply draws a fresh random seed, so re-running the filter produces a different pattern (see the Regenerate note under Render).

### Pixelate
- **Pixelate / Mosaic**: block size 2 - 64 px

### Halftone
- **Halftone**: dot size 2 - 32 px, density 0.25 - 3 (default 1.0 — scales dot coverage/frequency relative to the cell grid), angle 0 - 180 degrees, softness 0 - 4

### Stylize
- **Find Edges**: Sobel edge detection, no parameters
- **Cel Shading**: levels, edge strength
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
- **Clouds**: scale, seed
- **Smoke**: scale, seed, turbulence
- **Fibers**: variance 1 - 64 (color variation between strands), strength 1 - 64 (vertical coherence — higher values produce straighter fibers, lower values produce more wavy/tangled fibers), seed. Generates random vertical fiber textures resembling paper, cloth, or hair using multi-octave 1D noise with 2D wander perturbation. GPU-accelerated GLSL shader.
- **Regenerate** button: the randomized **render** filters (Clouds, Smoke, Fibers) show a circular-arrow button next to the Preview checkbox in the generic filter dialog. Clicking it picks a new random seed and refreshes the preview, so users can spin through variations without re-opening the dialog. Confirming the dialog with Preview active commits the exact previewed pixels (the seed is captured at preview time and the GPU result is snapshotted, so what you see is what you get). The **Add Noise** / **Fill with Noise** filters live in their own simpler dialog without a preview or regenerate button; they instead draw a fresh random seed on every Apply, so re-running the filter yields a different noise pattern each time.
- **Pattern Fill**: tiles a user-defined pattern across the active layer
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
- **Raster**: pixel layer
- **Text**: live-editable text
- **Shape**: vector shape (ellipse, polygon — see Shape Tool above)
- **Group**: folder with optional per-group adjustments
- **Adjustment**: adjustment layer
- **Fill**: fill layer

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
- **New Layer** (`⇧⌘N`): appends a blank raster layer above the active one
- **Duplicate Layer** (`⌘J`): clones the active layer in place
- **Group Layers** (`⌘G`): wraps the currently-selected layers in a new group
- **Merge Down** (`⌘E`): composites the active layer into the layer below
- **Flatten Image**: composites every visible layer into a single raster layer
- **Rasterize Layer**: for non-raster layers (text, shape, group with effects), bakes the current visual into pixels in place. For text layers, reads the engine's current x/y/w/h so the rasterized result lands at the visible position even after GPU texture expansion from upstream paint ops.
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
- **Cmd/Ctrl+A** (Layers panel focused): selects every layer in the document
- **Delete / Backspace** (Layers panel focused): removes every selected layer
- Selected layers can be grouped or reordered together; the active layer remains the target for tool operations

### Clipboard
- **Cut** (`⌘X`) / **Copy** (`⌘C`) / **Paste** (`⌘V`): standard clipboard actions; copy/cut respect the active marquee selection
- **Copy Merged** (`⇧⌘C`): composites all visible layers within the selection bounds before copying, so the clipboard contains a flattened RGBA snapshot rather than just the active layer
- Paste external image data (PNG/JPEG/WebP from the system clipboard) creates a new raster layer with the bitmap

### Fill from Menu
- **Fill…** (Edit menu, `⇧F5`): opens a small modal that fills the current selection (or the entire layer if no selection) on the active layer with foreground color, background color, black, white, 50% gray, or a chosen pattern. Honors the selection mask and layer opacity.
- **Fill with Pattern…** (Edit menu): opens the Pattern Fill dialog directly (same dialog as the Filter-menu entry — see Filters → Render → Pattern Fill for scale / offset / selection-mask behavior).
- **Define Pattern** (Edit menu): captures the active layer's pixels as a reusable pattern (used by Fill… and the Pattern Fill filter)
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
- **Cmd/Ctrl+scroll**: zoom centered on the cursor; plain scroll pans
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
- **Show rulers**: on/off (default on)
- **Cmd/Ctrl + `R`**: toggle ruler visibility from anywhere in the app

### Guides
- **Show guides**: on/off
- **Guide color**: configurable
- **Orientation**: horizontal or vertical
- Drag from ruler to create
- **Cmd/Ctrl + `;`**: toggle guides visibility from anywhere in the app
- **Clear Guides** (Edit menu): removes every guide currently placed on the canvas in a single action

### Snapping
- **Snap to Grid** (View menu): aligns drags to the nearest grid cell; auto-enabled whenever the grid is visible. Move-tool arrow-key nudges become one-cell hops under this mode.
- **Snap to Layers** (View menu): while dragging with the Move tool, the layer's edges and X/Y centers attract to matching edges and centers of other visible layers within a 5 px threshold. Magenta alignment guides appear during the snap and clear on mouse-up.

### Seamless Pattern Preview
- **Show Seamless Pattern** (View menu): tiles the document outside the canvas bounds so tileable textures and patterns can be previewed in context. The center tile is the actual document; surrounding tiles are repeats of the same pixels with edge wrapping (`fract(uv)`) so seams are visible immediately.
- **Dim pattern**: a per-tool options-bar checkbox (visible whenever Show Seamless Pattern is on) dims the surrounding repeat tiles so the center document stays the focal point while still showing how it tiles. Default on.

### UI
- **Foreground / background color**: with swap and reset
- **Recent colors**: up to 20
- **Sidebar collapsed**: on/off
- **Panel visibility**: togglable per panel (color, layers, etc.)
- **Mask edit mode**: on/off
- **Draggable modals & panels**: filter dialogs, pattern fill, layer effects, adjustments, and the reference image drawer can be repositioned by dragging the header bar (cursor: grab on hover; content interactions are not hijacked)
- **Filter / pattern preview overlay**: when live preview is enabled the dim backdrop is removed and pointer-events on the overlay are disabled so the canvas is fully visible while the modal stays interactive

### Global UI Conventions
- **Slider double-click → reset**: every numeric slider in the UI (brush size, opacity, hardness, adjustment sliders, filter sliders, etc.) snaps back to its default value on double-click. The numeric text input inside the slider is exempt so double-clicks there select the value for editing instead.
- **Slider arrow-key step**: with a slider's numeric input focused, **↑ / ↓** increment / decrement the value by one step (log-scaled sliders like Levels gamma step proportionally), clamped to the slider's min / max. Enter blurs the input to commit.
- **Status-bar zoom double-click → 100%**: double-clicking the zoom percentage readout in the status bar resets the viewport zoom to 100% (1×).
- **Color swatch double-click**: double-clicking the foreground or background swatch in the Color panel both selects that swatch and auto-expands the Color panel (useful when the panel is collapsed). Recent-color swatches behave the same way.
- **Layer name double-click → rename**: double-clicking a layer row's name turns it into an inline text input; Enter commits, Escape cancels.

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
- **`Space+drag`** / **middle-click drag** — temporary pan from any tool
- **`Cmd/Ctrl+scroll`** — zoom centered on the cursor; plain scroll pans
- **`Backspace` / `Delete`** (canvas focused) — when a marquee selection is active, clears the selected pixels on the active layer (GPU clear, undoable as "Clear Selection"); when no selection is active, removes the active layer from the document. Suppressed while a text input or text-layer edit is focused.
- **`Escape`** — cancels in-progress state: clears unstroked Path-tool anchors first, otherwise clears the active selection and any pending transform; ends text editing with the prior layer state restored.
- **`Enter`** — when the Path tool is active and ≥ 2 anchors are placed, strokes the in-progress path to pixels.
- **`Cmd/Ctrl + E`** — merge the active layer down into the layer below.

### Keyboard Shortcut Customization
Every tool shortcut (`B`, `E`, `J`, …) and the non-tool single-key actions (`X` swap colors, `D` reset colors, `Q` toggle quick mask) are user-rebindable through the **Keyboard Shortcuts modal**.

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
- Collapsible; collapsed state persists in localStorage

---

## Channels Panel

A per-layer view of the active layer's RGBA channels, modeled on Photoshop's Channels palette.

- **Rows**: RGB (composite), Red, Green, Blue, Alpha. Each row has a colored swatch dot, a label, and (when expanded) a live grayscale thumbnail of that channel sampled from the active layer's GPU texture.
- **Active channel**: clicking a row marks that channel as the active view — used by tools like the eyedropper / curves to operate on a single channel.
- **Per-channel visibility**: each non-composite row has an eye/eye-off toggle that hides or shows that channel in the composite output. The composite RGB row reflects the current visibility mask of R / G / B.
- **Thumbnails**: extracted on the JS side from the layer's RGBA bytes (red, green, blue, or alpha mapped into a grayscale image) and re-rendered whenever the layer's pixel-data version increments, so the panel stays in sync with painting.
- Collapsible; collapsed state persists in localStorage.

---

## Info Panel

A compact heads-up readout that mirrors what Photoshop's Info panel surfaces.

- **Cursor X / Y**: current pointer position in document coordinates.
- **Canvas W / H**: document dimensions.
- **Layer X / Y / W / H**: the active layer's origin and (when applicable) its raster width and height.
- **Selection X / Y / W / H**: the active marquee's bounding box, only shown when a selection is active. When a selection is active, the Cursor X / Y readout switches to the selection's top-left so the values stay coherent during transform / move operations.
- Collapsible; the collapsed view drops Canvas / Selection rows and keeps the most-load-bearing layer fields.

---

## Symmetry

- **Axes**: horizontal, vertical, or both (4-way)
- **Center**: configurable (defaults to canvas center)
- Available on brush, pencil, and eraser
- **Cmd/Meta+click** on the canvas while any symmetry mode (horizontal, vertical, or radial with 2+ segments) is active moves the symmetry center to the click point without painting a dab. Lets the user reposition the mirror axis directly from the canvas without opening a settings panel.

---

## Color

- **Color spaces**: sRGB, Display P3, Rec. 2020, Linear sRGB
- **FP16 / wide gamut**: RGBA16F textures when GPU supports `EXT_color_buffer_float`
- **EDR passthrough**: unclamped values for extended dynamic range displays

---

## History

- Unlimited undo/redo with labeled snapshots
- **Undo** (`⌘Z`) / **Redo** (`⇧⌘Z`) from the Edit menu or keyboard
- History panel lists every snapshot with its label; clicking a row jumps the document to that state
- RLE-compressed GPU texture snapshots; metadata-only snapshots for lightweight operations (visibility toggles, blend-mode changes, etc.) so the history list stays cheap even after long sessions

---

## Document

- **Name**: configurable (default "Untitled")
- **Dimensions**: width x height
- **Background**: solid color or transparent
- Entirely client-side, no backend

---

## File I/O & Export

### Open / Save
- **New** (`⌘N`): blank document with width/height/background prompt. Resets the viewport zoom and pan so the fresh canvas always lands fit-to-view, even after working on a much larger document.
- **Open…** (`⌘O`): open a PNG/JPEG/GIF/BMP/TIFF/WebP/HEIC/PSD/DNG/RAF/.lopsy from disk (the picker auto-routes by extension via a shared `classifyOpenFile` helper). The same routing backs the pre-document flow — the New Document modal's "Open file" button and drag-and-drop onto a fresh app accept the same formats, including `.lopsy` project files.
- **Open PSD**: rebuilds layers, masks, blend modes, and effects from the PSD reader (Rust)
- **Export PSD** (File menu): serialises the current document via the PSD writer at 16-bit precision (pass-through groups are written as `normal` since PSD has no pass-through discriminant)

### Native Project Format (.lopsy)
- **Save Project** (`⌘S`): writes the full editor state to a `.lopsy` file and triggers a browser download. Round-trips every layer (raster pixels, text, shape, group), masks, blend modes, opacity, position, clip-to-below, layer effects, color tags, group adjustment node stacks, the active layer, and the document's name / size / background.
- **Open Project…**: file picker filtered to `.lopsy`. Restores all of the above; pixel data is gzip-compressed inside the file.
- **Format**: binary container — `LOPSY\0` magic + uint16 version + uint32 manifest-length + UTF-8 JSON manifest + per-layer gzipped RGBA blobs + per-mask raw byte blobs (referenced from the manifest by index). Entirely client-side; no server round-trip.

### Export Dialog (`⌥⇧⌘E`)
A modal dialog with a live thumbnail preview (debounced ~200 ms) and inline options:

- **Format**: PNG, JPEG, WebP, BMP
- **Quality** (JPEG / WebP only): 1 - 100% slider, default 92
- **PNG Quality**: two-button toggle —
  - **Regular** — 8-bit PNG via `canvas.toBlob`
  - **High** — 16-bit PNG via the Rust engine, preserving FP16 precision for wide-gamut workflows
- **Filename**: editable text field; the document name is used by default and the format-appropriate extension (`.png`, `.jpg`, `.webp`, `.bmp`) is appended automatically
- **Enter** confirms; **Escape** cancels

### Quick Export (`⇧⌘E`)
One-shot PNG export through the GPU compositor — no dialog, no preview, uses the document name as the filename and quality 92.

### DNG / RAW Import
Camera RAW files are decoded entirely in Rust before being uploaded to a GPU layer — JS never touches the raw sensor data.

- **DNG**: demosaic, LJPEG, TIFF parsing in Rust.
- **Fujifilm RAF**: decodes uncompressed X-Trans and Bayer sensor files and renders them with camera-JPEG-style color. Pipeline: parse the RAF container → CFA TIFF (Fuji tags) → decode 16-bit sensor data → gray-world auto white balance → demosaic (X-Trans uses an edge-directed Markesteijn-style 3-pass demosaic that reconstructs green from four directional candidates weighted by local homogeneity, then fills R/B from the smooth color-difference planes; Bayer uses bilinear) → per-camera camera→sRGB color matrix (row-normalized from the DNG ColorMatrix values, so neutral input stays neutral) → exposure boost → film base curve (Provia / Velvia / Astia / Classic Chrome / DR400 curves are compiled in, Velvia is the default) → sRGB gamma → EXIF orientation applied to the final image (portrait shots auto-rotate). White-balance presets for 49 Fuji bodies ship compiled in. (Lossless-compressed RAF and DCP camera profiles are decoded internally but not yet wired to UI.)
