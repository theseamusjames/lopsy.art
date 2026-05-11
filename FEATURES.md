# Lopsy Feature Catalog

## Drawing & Painting Tools

### Brush

Shortcut: `B`. The toolbar exposes Size, Opacity, Hardness, Fade, and the symmetry toggle. Everything else (preset gallery, brush-tip import, dynamics, texture) lives in the **Brushes panel** opened from the toolbar — a floating, draggable panel (no backdrop) with four tabs (**Presets**, **Shape**, **Dynamics**, **Texture**) and a live full-width stroke preview at the bottom that re-renders 200 ms after the last setting change.

**Core parameters**
- **Size**: 1 - 2000 px typed range; the toolbar slider's visual track caps at 300 so the useful range isn't crammed at the left end (typed values above 300 still work, they pin at the right edge of the track)
- **Opacity**: 1 - 100%
- **Hardness**: 0 - 100% (Photoshop-style curve — at 0 the entire dab is a smooth gradient, at 50 the inner half is solid with a soft edge, at 100 the tip renders fully hard with no clipping for non-circular tips)
- **Fade**: 0 - 2000 px (fade-out distance)
- **Spacing**: 1 - 200% of brush size
- **Scatter**: 0 - 100%
- **Angle**: 0 - 360 degrees (set via the Shape tab's angle dial; the on-canvas brush cursor outline rotates to match)
- **Taper**: 0 - 2000 px — linearly reduces brush size from full to zero over the configured distance, creating a pointed tail. Dynamic spacing keeps the dab density constant as the brush shrinks. Works for both drag strokes and shift-click lines (round and bitmap tips).
- **Symmetry**: horizontal, vertical, or both (4-way)

**Dynamics** (Brushes panel → Dynamics tab). Per-dab randomization runs GPU-side, seeded by each dab's center position so strokes are deterministic for a given path.
- **Size Jitter**: 0 - 100% — smooth random walk along the stroke. Picks a random target size multiplier and transitions toward it over 30–120 px with smoothstep easing, then picks a new target. Produces visible thick-thin variation instead of high-frequency noise.
- **Hardness Jitter**: 0 - 100% — same smooth random walk over hardness, with a longer 80–280 px transition so soft-to-hard variation is gradual.
- **Angle Jitter**: 0 - 100% — per-dab rotation randomization (most visible with non-circular tips). Rotates the texture sample with the dab so the pattern follows the tip orientation.
- **Opacity Jitter**: 0 - 100% — per-dab transparency randomization
- **Speed Size**: 0 - 100% (Thinner) or 0 - 300% (Wider) — stroke velocity scales brush size. **Faster is** toggle picks the direction (Thinner = fast strokes shrink, Wider = fast strokes grow). **Sensitivity** segmented toggle picks the smoothing window for the speed signal: **Low** = 6-sample moving average (smooth, slow response), **Med** = 3 samples (default), **High** = 2 samples (reactive, fast changes). Per-frame size changes are blended at 0.25 for fluid transitions.

**Texture** (Brushes panel → Texture tab)
- **Built-in textures**: Noise, Canvas, Grain — seamlessly tileable 128×128 grayscale tiles generated as torus-wrapped value noise (4–5 octaves) so adjacent tiles match without seams. `No Texture` disables texturing.
- **Custom textures**: import any image file via the **Import** button. The image is converted to grayscale on load and stored in the panel's texture list; custom textures can be deleted (built-ins cannot).
- **Texture blend mode**: Multiply, Subtract, or Overlay (against the brush color)
- **Scale**: 10 - 300% (tile size relative to the source tile)
- Texture tiles in document space so adjacent strokes line up across the same pattern grid. Modulation is applied at stroke-composite time (not per-dab) so the pattern survives MAX-blended overlapping dabs.

**Presets** (Brushes panel → Presets tab)
- **Built-in procedural presets**: Hard Round, Soft Round, Airbrush, Square, Cross Hatch, Diamond, Star, Slash, Chalk, Spray, Leaf
- **Built-in bitmap tips** (auto-discovered from `engine-rs/brushes/*.png` at WASM build time): Bubbles, Calligraphic-Angle, Calligraphic-Rounded, Calligraphic-Split, Light-Offset, Oblong, Smooth, Star, Triangle. Drop a new PNG into that directory and rebuild — no Rust or JS code changes needed.
- **Save Current**: footer button that captures every current brush setting (size, hardness, spacing, scatter, angle, opacity, all dynamics, fade, taper, tip) as a named custom preset.
- **Import**: single button that accepts both `.abr` (Adobe Brush) files — every brush in the file becomes a new tip in the gallery — and `.json` files exported from Lopsy.
- **Export**: footer button opens a modal with a multi-select gallery of every preset (Select All / Select None toggles) and downloads the chosen ones as `lopsy-brushes.json` (tip data base64-encoded; full dynamics included).
- **Delete**: prompts for confirmation; only enabled for user-imported custom presets, never built-ins.
- **Shape tab gallery**: the same gallery, but clicking a preset only swaps the **tip shape** — size, spacing, opacity, dynamics, etc. stay put. Useful for trying different tip shapes against your current dynamics setup.
- **Brush cursor**: renders the actual tip shape (rotated by the brush angle) as a dark/light double-stroke outline rather than a plain circle, so non-round tips show their real silhouette on the canvas. Hidden when the pointer leaves the canvas.

**Stroke modifiers**
- **Shift+click**: draws a straight line from the previous stroke endpoint to the click point. The pending stroke is reused (rather than baked and restarted) so MAX blending prevents the connecting line from double-compositing over the origin dab. Size jitter, hardness jitter, scatter, and taper are all applied along shift-click lines using the same dynamic-spacing walk as freehand drag, so dab density and variation match.
- **Hold-to-smooth**: pause the cursor mid-stroke for 1.5 s and the recorded freehand path is auto-smoothed (sampled at the brush's spacing) and re-rasterized in place. Undo restores the raw freehand version first, then the pre-stroke state.
- **`[` / `]`**: decrease / increase brush size by 1 px without leaving the canvas (also works for pencil, eraser, dodge/burn, smudge, stamp, healing, path stroke width, and shape stroke width — applies to whichever paint-class tool is active).

### Pencil
- Shortcut: `N`
- **Size**: 1 - 100 px
- **Symmetry**: horizontal, vertical, or both
- Pixel-perfect Bresenham lines (no anti-aliasing)
- **Shift+click**: draws a straight pixel-perfect line from the previous stroke endpoint

### Eraser
- Shortcut: `E`
- **Size**: 1 px – document-scaled max (slider track caps at 300; typed values up to the document max still work and pin at the right edge)
- **Opacity**: 1 - 100%
- **Hardness**: 0 - 100% (internal)
- **Shift+click**: erases a straight line from the previous stroke endpoint

### Dodge / Burn
- Shortcut: `O`
- **Mode**: dodge or burn
- **Exposure**: 1 - 100%
- **Size**: 1 px – document-scaled max (slider track caps at 300)
- **Shift+click**: applies dodge/burn along a straight line from the previous stroke endpoint

### Clone Stamp
- Shortcut: `S`
- **Size**: 1 px – document-scaled max (slider track caps at 300)
- **Alt/Cmd+click**: set the source sample point
- **Shift+click**: stamps along a straight line from the previous stroke endpoint, preserving source offset

### Healing Brush
- Shortcut: `H`
- **Size**: 1 px – document-scaled max (default cap 200 px, scales with canvas size)
- **Opacity**: 1 - 100%
- **Alt/Cmd+click**: set the healing source sample point
- **Shift+click**: heals along a straight line from the previous stroke endpoint, preserving source offset
- Color-correction healing: subtracts the source mean color and adds the destination mean color, so texture is borrowed from the source while tone matches the destination
- Soft quadratic falloff at the dab edge for seamless blending

### Smudge
- **Size**: 1 px – document-scaled max (slider track caps at 300)
- **Strength**: 0 - 100% (how far pixels are pulled along the stroke)
- Shortcut: `R`
- Pulls colors along the stroke direction, blending neighbouring pixels.
- **Shift+click**: smudges along a straight line from the previous stroke endpoint

### Spray
- **Size**: 1 px – document-scaled max (slider track caps at 500)
- **Density**: 1 - 100 (number of dots emitted per dab)
- **Opacity**: 1 - 100%
- **Softness**: 0 - 100% (per-dot hardness falloff)
- Shortcut: `J`
- Holding the cursor still keeps emitting dots at ~6 Hz so paint accumulates over time, mimicking an airbrush. Dragging spreads dots along the path with automatic spacing scaled to brush size.

### Sponge
- **Mode**: saturate or desaturate
- **Strength**: 1 - 100% (per-stroke saturation push; uses a quadratic curve so 50% is gentle rather than instantly clipping)
- **Size**: 1 px – document-scaled max (slider track caps at 300)
- Shortcut: `Y`
- GPU-accelerated using the same coverage-accumulation pipeline as Dodge/Burn: dabs MAX-blend strength into a coverage texture, the live preview composites on the fly, and on stroke end a single GPU pass bakes the HSL saturation adjustment back into the layer (no per-pixel JS readback). Renders a round brush cursor sized to the tool.

---

## Shape & Vector Tools

### Shape Tool
- Shortcut: `U`
- **Shape types**: ellipse, polygon. A rectangle/square is drawn as a
  4-sided polygon (set sides to 4); triangles use sides=3, etc.
- **Output**: pixels or path
- **Fill color**: any color or none
- **Stroke color**: any color or none
- **Stroke width**: 1 - 50 px
- **Polygon sides**: 3 - 64
- **Corner radius**: 0 - 200 px
- **Aspect ratio lock**: width/height ratio constraint
- **Cmd/Meta+drag**: temporarily forces a 1:1 square ratio while dragging, overriding the persistent aspect-ratio toggle for the duration of the press

### Path / Pen Tool
- Shortcut: `P`
- **Stroke width**: 1 - 50 px
- Bezier anchors with in/out handles
- Close path, split segment, convert anchor
- Stroke path to pixels
- Convert path to selection
- **Cmd/Meta+click an anchor**: toggles between corner (no handles) and smooth spline (double-click does the same)
- **Boolean path operations** (Path options bar buttons + **Path** menu in the menu bar): Unite, Subtract, Intersect, Exclude. Operates between the selected path and the most recently added other path; both source paths are consumed and replaced by the result. Implemented by flattening Bezier paths to polygons, rasterizing to binary masks, combining pixel-wise, then tracing contours with marching squares and refitting Catmull-Rom/Bezier anchors. Buttons are disabled until the document contains at least 2 paths and one is selected.

### Text Tool
- Shortcut: `T`
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
- **Commit**: `Shift+Enter` or `Tab` bakes the text edit (Tab also swallows the browser default focus change). **Cancel**: `Escape` aborts; if the layer was newly created for this edit it is removed.

---

## Selection Tools

### Rectangular Marquee
- Shortcut: `M`
- **Aspect ratio lock**: width/height constraint
- **Feather**: 0 - 250 px (soft edge applied after the marquee is committed; three-pass separable box blur on the GPU approximating Gaussian falloff)
- **Cmd/Meta+drag**: holding meta while dragging temporarily forces a 1:1 (square) aspect ratio for the duration of the press, regardless of the persistent aspect-ratio toggle. Releasing meta returns to the unconstrained or persistently-locked behavior immediately.
- **Click+drag inside an existing selection**: with the marquee tool active, pressing inside the current selection (any non-zero mask coverage) and dragging moves the selection outline itself — the mask is translated by the integer drag delta, the underlying pixels are not touched. Use the Move tool instead to drag the pixels.

### Elliptical Marquee
- **Aspect ratio lock**: width/height constraint
- **Feather**: 0 - 250 px (same GPU feather pipeline as the rectangular marquee)
- **Cmd/Meta+drag**: holding meta forces a 1:1 (circle) aspect ratio while dragging, identical to the rectangular marquee transient lock.
- **Click+drag inside an existing selection**: same selection-outline move behavior as the rectangular marquee.

### Lasso (Freehand)
- Shortcut: `L`
- No configurable parameters

### Magnetic Lasso
- **Width**: 1 - 40 px (perpendicular search radius from the cursor path)
- **Contrast**: 1 - 100% (minimum edge strength to snap onto)
- **Frequency**: 0 - 200 px (distance between auto-placed anchors; 0 disables auto-anchoring)
- Edge detection runs in WASM against the active layer's GPU texture; only snapped coordinates cross back to JS

### Magic Wand
- Shortcut: `W`
- **Tolerance**: 0 - 255
- **Contiguous**: on/off
- **Graduated**: on/off — when enabled, the wand uses a gradient-aware flood fill that produces partial-coverage selection edges across smooth color transitions, instead of a hard threshold cut
- **Feather**: 0 - 250 px (shared marquee feather slider; applied after the wand fill)

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
- Shortcut: `V`
- Drag to reposition layers
- Arrow key nudge
- Snap to grid
- Snap to guides
- **Snap to layers** (View menu → "Snap to Layers"): while dragging, the moving layer's left/right/top/bottom edges and X/Y centers attract to the matching edges and centers of every other visible layer within a 5 px threshold. Magenta alignment guides span the document while a snap is engaged and clear on mouse-up.
- **Align**: left, center-h, right, top, center-v, bottom
- **Fit** (options-bar button): scales the active raster layer so its longest side matches the canvas — preserving aspect ratio — and centers it on the artboard. Useful for bringing an oversized pasted/dropped image into view; reuses the GPU `scaleLayerTexture` path so no pixel data round-trips through JS.
- **Alt/Option+drag**: with no active selection, duplicates the active layer before moving; with an active marquee, leaves the original pixels behind and moves a floating copy
- **Cmd/Meta+drag (transform handles)**: constrains aspect ratio when scaling and snaps rotation to 15° increments. Grid + snap-to-grid also forces snapping automatically during the transform.

### Paste / Drop behavior
- Pasting from the clipboard or drag-and-dropping an image file onto the canvas creates a new raster layer at the image's natural dimensions and **auto-selects** the new layer's non-transparent pixels (loads the alpha as a marquee selection). Combined with the **Fit** button, oversized images can be quickly scaled in to fit without first hunting for a transform handle off-canvas.
- When duplicating a layer that is wider or taller than the canvas, the +10/+10 visual offset is clamped so the duplicate's far edge never moves past the canvas edge that the original was within (prevents already-oversized layers from being shoved further out of view).

### Eyedropper
- Shortcut: `I`
- **Sample size**: point, 3x3, 5x5

### Fill (Paint Bucket)
- Shortcut: `G`
- **Tolerance**: 0 - 255
- **Contiguous**: on/off

### Gradient
- **Type**: linear, radial
- **Stops**: multiple color stops with position (0-1)
- **Reverse**: on/off
- **Cmd/Meta+drag**: snaps the gradient angle to 15° increments while dragging

### Crop
- Shortcut: `C`
- Interactive drag to define crop rectangle

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
- **Levels** — per-channel input/output remap (RGB master + R / G / B) with
  Input Black, Input White, Gamma (0.01 – 10, log slider), Output Black,
  and Output White controls. Master is applied first, then per-channel
  levels. Compiled to a 256×1 LUT and shares the GPU adjustments path with
  Curves; identity levels bypass the lookup.
- **Hue / Saturation**, **Color Balance**, **Invert**, **Black & White**, **Photo Filter**, **Channel Mixer**, **Gradient Map** — listed in the Add menu and addable to the stack; their detailed controls are still landing (the node body shows a "Controls coming soon" note while the engine wiring matures).

Internally the node list compiles down to the legacy flat `ImageAdjustments` shape so the GPU compositor's adjustment pass is unchanged.

---

## Filters (Destructive, GPU-Accelerated)

### Blur
- **Gaussian Blur**: radius
- **Box Blur**: radius
- **Motion Blur**: angle (degrees), distance (px)
- **Radial Blur**: amount (centered)
- **Tilt-Shift Blur**: focus position 0–100% (center of sharp band along blur axis), focus width 0–100% (width of the sharp band), blur radius 1–32 px (max blur intensity in out-of-focus regions), angle 0–360° (rotation of the focus plane). Creates selective-focus miniature photography effects by blurring areas outside a configurable focus band while leaving the focus zone sharp.
- **Surface Blur**: radius 1–50 px (document-scaled max), threshold 1–255 (max RGB color distance for neighbors to be included). Bilateral-style edge-preserving blur — smooths flat regions while keeping hard edges crisp. Implemented as a single-pass GLSL ES 3.00 shader that combines spatial and range (smoothstep) weights so neighbors whose color distance exceeds the threshold are excluded from the average.

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
- **Add Noise**: amount 0 - 255, monochrome on/off
- **Fill with Noise**: monochrome on/off

### Pixelate
- **Pixelate / Mosaic**: block size 2 - 64 px

### Halftone
- **Halftone**: dot size 2 - 32 px, angle 0 - 180 degrees, softness 0 - 4

### Stylize
- **Find Edges**: Sobel edge detection, no parameters
- **Cel Shading**: levels, edge strength
- **Solarize**: threshold 0 - 255 (inverts tones above the threshold, classic darkroom effect)
- **Kaleidoscope**: segments 2 - 32, rotation 0 - 360 degrees (mirrors the image into a radial wedge pattern around the center)
- **Oil Paint**: radius 1 - 10, sharpness 0.1 - 5.0 (Kuwahara filter that smooths color regions while preserving edges, creating a painterly look)
- **Chromatic Aberration**: amount 1 - 50 px, direction 0 - 360 degrees (splits RGB channels along a configurable axis, creating retro lens fringing and glitch effects)
- **Bloom**: threshold 0 - 100%, soft knee 0 - 100%, radius 1 - 64 px, intensity 0 - 200% (extracts bright areas above the threshold, applies Gaussian blur, and additively blends the glow back onto the original image — creates cinematic light bloom and soft glow effects around highlights)
- **Emboss**: angle 0 - 360° (light direction), strength 1 - 100 (relief height), type: emboss or pillow emboss (creates a 3D relief effect by computing directional highlights and shadows from luminance gradients — emboss mode applies uniform relief, pillow emboss fades the effect toward edges for a raised-pillow appearance)
- **Voronoi**: cells 2 - 200, edge width 0 - 20 px, seed 0 - 999 (partitions the image into irregular Voronoi cells, each filled with the color sampled at the cell center, with configurable black edge lines between cells — creates a stained glass / crystallize effect)

### Distort
- **Pixel Stretch**: amount 1 - 200 px, bands 2 - 50, seed 0 - 999, RGB split 0 - 1.0 (shifts horizontal scan-line bands by random offsets with per-channel separation, creating glitch / VHS corruption effects)
- **Lens Distortion**: strength -100 to +100 (negative = pincushion, positive = barrel), zoom 50 - 200%, chromatic fringing 0 - 100% (applies barrel or pincushion radial distortion with optional per-channel color separation at edges, simulating real camera lens effects)
- **Mesh Warp**: interactive grid-based distortion overlaid directly on the canvas. Activated from the Move tool's options bar; grid handles are draggable in document space, with bilinear interpolation between points handled on the GPU. When a marquee selection is active, the warp is constrained to the selection's bounding box (pixels outside pass through unchanged); otherwise the warp covers the whole layer. Grid sizes 3×3 to 6×6 with live preview, reset, and undo support.
- **Liquify** (Filter menu → Liquify…, `⌘⇧X`): interactive brush-based mesh warp on the active raster layer. Opens a floating, draggable Liquify panel and switches the canvas into a session where every paint stroke nudges a per-pixel displacement field instead of pixels.
  - **Modes**: Push Forward (drags pixels along the brush direction), Twirl CW, Twirl CCW (rotates pixels around the brush center), Bloat (pushes pixels outward), Pinch (pulls pixels toward center)
  - **Brush Size**: configurable in panel; round brush cursor overlay tracks the cursor while a session is active
  - **Pressure**: 0 - 100% (scales the per-dab strength; pinch/bloat use a softened pressure curve and quintic falloff so gentle dabs are subtle rather than abrupt)
  - **Apply / Cancel**: commit bakes the warped pixels back into the layer; cancel restores the original layer texture from the GPU-side filter preview backup
  - GPU pipeline: a persistent RGBA8 displacement texture is allocated for the session and only the dirty sub-rectangle around each dab is encoded on the CPU and uploaded via `texSubImage2D`, then `liquify_warp.glsl` samples the original texture at `(x + dx, y + dy)` to render the live preview. Auto-cancels on new document / open file.

### Render
- **Clouds**: scale, seed
- **Smoke**: scale, seed, turbulence
- **Regenerate** button: randomized filters (Clouds, Smoke) show a circular-arrow button next to the Preview checkbox in the filter dialog. Clicking it picks a new random seed and refreshes the preview, so users can spin through variations without re-opening the dialog. Confirming the dialog with Preview active commits the exact previewed pixels (the seed is captured at preview time and the GPU result is snapshotted, so what you see is what you get).
- **Pattern Fill**: tiles a user-defined pattern across the active layer
  - **Define Pattern** (Edit menu): captures the active layer's pixels as a reusable pattern
  - **Scale**: 10 - 1000% (tile size relative to original pattern dimensions)
  - **Offset X / Y**: 0 - 100% (shifts the tiling origin)
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

### Pass Through (group default)

- Available exclusively on **group** layers, where it is the default blend mode (matching Photoshop).
- Children blend directly onto the surface beneath the group, so adjustment layers and effects inside the group affect underlying layers outside the group as well.
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
- **Blend mode**: any of 16 modes (plus "Pass Through" on group layers)
- **Visible**: on/off
- **Locked**: on/off
- **Position**: x, y
- **Clip to below**: on/off (clipping mask)
- **Effects**: drop shadow, outer glow, inner glow, stroke, color overlay
- **Mask**: grayscale mask with enable/disable toggle. All mask painting (brush, eraser, pencil, gradient, fill) runs directly on the GPU mask texture — no per-frame CPU→GPU upload, so editing a mask is as fast as painting pixels.
- **Color tag**: optional swatch (red, orange, yellow, green, blue, purple, gray, or none) shown as a vertical bar on the left edge of the layer row. Set via the layer row's right-click context menu; useful for visually grouping/organizing layers in a deep stack.

### Layer Operations
- Add, remove, duplicate
- Merge down
- Flatten image
- Rasterize layer style (bake effects)
- Reorder (drag)
- Move to group (reparent)
- Rename
- Align (left, center-h, right, top, center-v, bottom)
- Add/remove/toggle mask — works on raster, text, shape, and **group** layers; group masks are sampled at composite time so the entire group is masked as a single unit (with the group's own opacity and blend mode applied on top)
- **Cmd/Ctrl+click a layer thumbnail**: loads that layer's alpha as a marquee selection (non-transparent pixels become the selection)
- **Click a layer's mask thumbnail**: always enters mask edit mode (focus switches to the mask reliably; no toggle behavior).
- **Set layer color tag**: right-click a layer row to open a context menu with the 7 tag colors plus "None" to clear.

### Multi-Select in the Layers Panel
- **Plain click**: selects only the clicked layer (standard behavior)
- **Cmd/Ctrl+click**: toggles a layer in/out of the current multi-selection without changing which layer is "active"
- **Shift+click**: selects the contiguous range from the active layer to the clicked layer
- **Cmd/Ctrl+A** (Layers panel focused): selects every layer in the document
- **Delete / Backspace** (Layers panel focused): removes every selected layer
- Selected layers can be grouped or reordered together; the active layer remains the target for tool operations

### Clipboard
- Copy, cut, paste (respects selection)
- **Cmd+Shift+C**: copy merged (composites all visible layers within the selection bounds before copying, so the clipboard contains a flattened RGBA snapshot rather than just the active layer)
- Paste external image data

---

## Canvas Operations

- **Crop canvas**: by rectangle
- **Resize canvas**: new width/height with anchor point
- **Resize image**: new width/height (resamples all layers)

---

## Viewport & Workspace

### Viewport
- **Zoom**: 0.01x - 64x
- **Pan**: unlimited
- **Fit to view**: auto-zoom with padding
- **Space+drag** or **middle-click drag**: temporarily pan from any tool
- **Cmd/Ctrl+scroll**: zoom centered on the cursor; plain scroll pans
- **Pixel grid**: automatically rendered as a 1-CSS-px translucent gray lattice when the viewport zoom exceeds 800% (8×), so individual document pixels are visible while pixel-accurate editing

### Grid
- **Show grid**: on/off
- **Grid size**: configurable (default 16 px)
- **Snap to grid**: on/off (auto-enabled with grid)

### Rulers
- **Show rulers**: on/off (default on)

### Guides
- **Show guides**: on/off
- **Guide color**: configurable
- **Orientation**: horizontal or vertical
- Drag from ruler to create

### UI
- **Foreground / background color**: with swap and reset. **`X`** swaps the foreground and background colors; **`D`** resets the pair to the default black / white. Double-clicking the foreground or background swatch (or any recent-color swatch) selects that swatch *and* expands the Color panel if it is collapsed, so the picker is reachable from anywhere in the chrome with a single double-click.
- **Recent colors**: up to 20
- **Sidebar collapsed**: on/off
- **Panel visibility**: togglable per panel (color, layers, etc.)
- **Mask edit mode**: on/off
- **Draggable modals & panels**: filter dialogs, pattern fill, layer effects, adjustments, and the reference image drawer can be repositioned by dragging the header bar (cursor: grab on hover; content interactions are not hijacked)
- **Filter / pattern preview overlay**: when live preview is enabled the dim backdrop is removed and pointer-events on the overlay are disabled so the canvas is fully visible while the modal stays interactive

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

## Channels Panel

A lightweight per-channel viewer for the active layer.

- Five rows: **RGB**, **Red**, **Green**, **Blue**, **Alpha**, each with a small thumbnail of the active layer's contribution to that channel. Thumbnails refresh whenever the underlying pixel data changes (driven by `usePixelDataVersion`); the row is disabled when its channel is hidden.
- **Active channel**: clicking a row sets the active channel for the panel (used by the channel-extract preview and reflected by an active highlight).
- **Visibility toggle**: each non-RGB row has an Eye / EyeOff button. Hiding a channel clamps it to zero on output via the `u_channelMask` uniform in `final_blit.glsl` — the channel mask is synced from the Zustand UI store through `engine-sync` into the WASM compositor, so the effect is global to the document, not just the panel preview.
- Collapsible; collapsed state persists in localStorage like the other side-panels.

---

## Navigator Panel

- Live thumbnail of the composited canvas (refreshed by copying the main WebGL canvas; throttled to ~5 Hz so it stays cheap during heavy strokes)
- **Viewport indicator**: a translucent rectangle showing the current viewport bounds inside the document; click anywhere on the minimap to recenter the viewport, or drag the indicator rectangle to pan
- **Zoom slider**: log-scaled, mapping slider position to `64^(value/100)` so the full 0.01× – 64× zoom range is reachable without coarse jumps
- **Zoom readout**: displays the current zoom as a percentage
- Collapsible; collapsed state persists in localStorage

---

## Symmetry

- **Axes**: horizontal, vertical, or both (4-way)
- **Radial symmetry**: 2 - 32 segments — toggled via the **Snowflake** button in BrushOptions; segment count is set with a number input rather than a slider so you can dial exact petal counts. When enabled it overrides the horizontal/vertical mirrors and rotates each input point around the symmetry center by `2π · k / n` for every segment.
- **Center**: configurable per document and persisted in the tool-settings store (defaults to the canvas center when unset). **Cmd/Meta+click** anywhere on the canvas relocates the symmetry center.
- **Center overlay**: a circle + crosshair drawn in the active guide color appears at the symmetry center whenever any symmetry mode (horizontal, vertical, or radial) is active, so you always know where mirrors will originate.
- Available on brush, pencil, and eraser

---

## Color

- **Color spaces**: sRGB, Display P3, Rec. 2020, Linear sRGB
- **FP16 / wide gamut**: RGBA16F textures when GPU supports `EXT_color_buffer_float`
- **EDR passthrough**: unclamped values for extended dynamic range displays

---

## History

- Unlimited undo/redo with labeled snapshots
- RLE-compressed GPU texture snapshots
- Metadata-only snapshots for lightweight operations

---

## Document

- **Name**: configurable (default "Untitled")
- **Dimensions**: width x height
- **Background**: solid color or transparent
- Entirely client-side, no backend

---

## File I/O & Export

### Open / Save
- **New** (`⌘N`): blank document with width/height/background prompt
- **Open…** (`⌘O`): open a PNG/JPEG/WebP/BMP/PSD/DNG/.lopsy from disk (the picker auto-routes by extension)
- **Open PSD**: rebuilds layers, masks, blend modes, and effects from the PSD reader (Rust)
- **Save PSD**: serialises the current document via the PSD writer

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
Camera RAW (DNG) files are decoded entirely in Rust (demosaic, LJPEG, TIFF) before being uploaded to a GPU layer.

---

## Keyboard Shortcuts (Quick Reference)

Consolidates the per-tool and per-section shortcuts above into a single lookup.

### Tools
| Key | Tool |
|-----|------|
| `V` | Move |
| `B` | Brush |
| `N` | Pencil |
| `E` | Eraser |
| `G` | Fill (Paint Bucket) |
| `I` | Eyedropper |
| `S` | Clone Stamp |
| `H` | Healing Brush |
| `O` | Dodge / Burn |
| `Y` | Sponge |
| `R` | Smudge |
| `M` | Rectangular Marquee |
| `L` | Lasso |
| `W` | Magic Wand |
| `U` | Shape |
| `T` | Text |
| `C` | Crop |
| `P` | Path / Pen |
| `J` | Spray |

### Painting size & color
| Key | Action |
|-----|--------|
| `[` / `]` | Decrease / increase active paint-class tool size by 1 px (brush, pencil, eraser, dodge, smudge, stamp, healing, path stroke width, shape stroke width) |
| `X` | Swap foreground and background colors |
| `D` | Reset colors to black / white |
| `Q` | Toggle Quick Mask mode |

### Selection
| Key | Action |
|-----|--------|
| `⌘A` | Select all |
| `⌘D` | Deselect |
| `⇧⌘I` | Invert selection |
| Arrow keys | Nudge selection (or move layer when Move is active); steps by grid size if grid + snap-to-grid are on |

### Layers panel (when focused)
| Key | Action |
|-----|--------|
| `⌘A` | Select every layer |
| `Delete` / `Backspace` | Remove every selected layer |

### Text editing
| Key | Action |
|-----|--------|
| `⇧Enter` or `Tab` | Commit the edit |
| `Escape` | Cancel (and remove the layer if it was newly created for this edit) |

### Viewport
| Key | Action |
|-----|--------|
| `Space + drag` | Temporary pan from any tool |
| Middle-click drag | Temporary pan from any tool |
| `⌘ / Ctrl + scroll` | Zoom centered on the cursor |
| Plain scroll | Pan |

### File I/O
| Key | Action |
|-----|--------|
| `⌘N` | New document |
| `⌘O` | Open file (PNG / JPEG / WebP / BMP / PSD / DNG / .lopsy) |
| `⌘S` | Save Project (.lopsy) |
| `⇧⌘E` | Quick Export (PNG) |
| `⌥⇧⌘E` | Export dialog |
| `⌘⇧X` | Liquify… |
| `⌘⇧C` | Copy merged |

### Modifier gestures (mouse + keyboard)
| Gesture | Effect |
|---------|--------|
| `Shift+click` on brush / pencil / eraser / dodge / smudge / stamp / healing / spray | Straight line from previous stroke endpoint |
| `Alt` or `⌘+click` (Stamp, Healing) | Set the source sample point |
| Hold cursor still mid-stroke (1.5 s) | Auto-smooth the recorded freehand path |
| `⌘+drag` on Gradient | Snap angle to 15° increments |
| `⌘+drag` on Shape | Force 1:1 square ratio for the duration of the press |
| `⌘+drag` on Rectangular / Elliptical Marquee | Force 1:1 (square / circle) aspect ratio |
| Click+drag inside an existing marquee selection | Move the selection outline (not pixels) |
| `⌘+click` a path anchor | Toggle between corner and smooth spline (same as double-click) |
| `Alt+drag` (Move) | Duplicate the active layer with no selection; float a copy with an active selection |
| `⌘+drag` on a Transform scale handle | Constrain to uniform aspect ratio |
| `⌘+drag` on a Transform rotation handle | Snap rotation to 15° increments |
| `⌘ / Ctrl+click` a layer thumbnail | Load that layer's alpha as a marquee selection |
| `⌘ / Ctrl+click` on the canvas with symmetry active | Relocate the symmetry center |
| `⌘ / Ctrl+click` a layer row | Add / remove the row from the multi-selection |
| `Shift+click` a layer row | Range-select from active to clicked |
