# Lopsy Feature Catalog

## Drawing & Painting Tools

### Brush
- **Size**: 1 - 2000 px
- **Opacity**: 1 - 100%
- **Hardness**: 0 - 100%
- **Fade**: 0 - 2000 px (fade-out distance)
- **Spacing**: 0 - 200% of brush size
- **Scatter**: 0 - 100%
- **Angle**: 0 - 360 degrees
- **Symmetry**: horizontal, vertical, or both (4-way)
- **Custom brush tips**: grayscale bitmap or procedural circle
- **ABR import**: Adobe Brush file support
- **Built-in presets**: Hard Round, Soft Round, Airbrush, Square, Cross Hatch, Diamond, Star, Slash, Chalk, Spray, Leaf
- **Shift+click**: draws a straight line from the previous stroke endpoint to the click point
- **Hold-to-smooth**: pause the cursor mid-stroke and the recorded freehand path is auto-smoothed and re-rasterized in place (undo restores the freehand version first, then the pre-stroke state)

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

### Path / Pen Tool
- **Stroke width**: 1 - 50 px
- Bezier anchors with in/out handles
- Close path, split segment, convert anchor
- Stroke path to pixels
- Convert path to selection
- **Cmd/Meta+click an anchor**: toggles between corner (no handles) and smooth spline (double-click does the same)

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

---

## Selection Tools

### Rectangular Marquee
- **Aspect ratio lock**: width/height constraint
- **Feather**: 0 - 250 px (soft edge applied after the marquee is committed; three-pass separable box blur on the GPU approximating Gaussian falloff)

### Elliptical Marquee
- **Aspect ratio lock**: width/height constraint
- **Feather**: 0 - 250 px (same GPU feather pipeline as the rectangular marquee)

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
- Drag to reposition layers
- Arrow key nudge
- Snap to grid
- Snap to guides
- **Snap to layers** (View menu → "Snap to Layers"): while dragging, the moving layer's left/right/top/bottom edges and X/Y centers attract to the matching edges and centers of every other visible layer within a 5 px threshold. Magenta alignment guides span the document while a snap is engaged and clear on mouse-up.
- **Align**: left, center-h, right, top, center-v, bottom
- **Alt/Option+drag**: with no active selection, duplicates the active layer before moving; with an active marquee, leaves the original pixels behind and moves a floating copy
- **Cmd/Meta+drag (transform handles)**: constrains aspect ratio when scaling and snaps rotation to 15° increments. Grid + snap-to-grid also forces snapping automatically during the transform.

### Eyedropper
- **Sample size**: point, 3x3, 5x5

### Fill (Paint Bucket)
- **Tolerance**: 0 - 255
- **Contiguous**: on/off

### Gradient
- **Type**: linear, radial
- **Stops**: multiple color stops with position (0-1)
- **Reverse**: on/off
- **Cmd/Meta+drag**: snaps the gradient angle to 15° increments while dragging

### Crop
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

### Distort
- **Pixel Stretch**: amount 1 - 200 px, bands 2 - 50, seed 0 - 999, RGB split 0 - 1.0 (shifts horizontal scan-line bands by random offsets with per-channel separation, creating glitch / VHS corruption effects)
- **Lens Distortion**: strength -100 to +100 (negative = pincushion, positive = barrel), zoom 50 - 200%, chromatic fringing 0 - 100% (applies barrel or pincushion radial distortion with optional per-channel color separation at edges, simulating real camera lens effects)
- **Mesh Warp**: interactive grid-based distortion overlaid directly on the canvas. Activated from the Move tool's options bar; grid handles are draggable in document space, with bilinear interpolation between points handled on the GPU. When a marquee selection is active, the warp is constrained to the selection's bounding box (pixels outside pass through unchanged); otherwise the warp covers the whole layer. Grid sizes 3×3 to 6×6 with live preview, reset, and undo support.

### Render
- **Clouds**: scale, seed
- **Smoke**: scale, seed, turbulence
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
- **Blend mode**: any of 16 modes
- **Visible**: on/off
- **Locked**: on/off
- **Position**: x, y
- **Clip to below**: on/off (clipping mask)
- **Effects**: drop shadow, outer glow, inner glow, stroke, color overlay
- **Mask**: grayscale mask with enable/disable toggle

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
- **Foreground / background color**: with swap and reset
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

## Navigator Panel

- Live thumbnail of the composited canvas (refreshed by copying the main WebGL canvas; throttled to ~5 Hz so it stays cheap during heavy strokes)
- **Viewport indicator**: a translucent rectangle showing the current viewport bounds inside the document; click anywhere on the minimap to recenter the viewport, or drag the indicator rectangle to pan
- **Zoom slider**: log-scaled, mapping slider position to `64^(value/100)` so the full 0.01× – 64× zoom range is reachable without coarse jumps
- **Zoom readout**: displays the current zoom as a percentage
- Collapsible; collapsed state persists in localStorage

---

## Symmetry

- **Mirror axes**: horizontal, vertical, or both (4-way)
- **Radial/Mandala symmetry**: N-fold rotational symmetry (2–32 segments)
  - Creates N-1 rotated copies of each stroke at evenly spaced angles around the center
  - Toggle with snowflake icon; segment count adjustable via slider
  - When active, overrides mirror axes; disable radial to use mirror mode
- **Center**: configurable (defaults to canvas center)
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
- **Open…** (`⌘O`): open a PNG/JPEG/WebP/BMP/PSD from disk
- **Open PSD**: rebuilds layers, masks, blend modes, and effects from the PSD reader (Rust)
- **Save PSD**: serialises the current document via the PSD writer

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
