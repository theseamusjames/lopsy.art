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

### Pencil
- **Size**: 1 - 100 px
- **Symmetry**: horizontal, vertical, or both
- Pixel-perfect Bresenham lines (no anti-aliasing)

### Eraser
- **Size**: 1 - 200 px
- **Opacity**: 1 - 100%
- **Hardness**: 0 - 100% (internal)

### Dodge / Burn
- **Mode**: dodge or burn
- **Exposure**: 1 - 100%
- **Size**: 1 - 200 px

### Clone Stamp
- **Size**: 1 - 200 px
- Alt/Cmd+click to set source point

---

## Shape & Vector Tools

### Shape Tool
- **Shape types**: rectangle, ellipse, polygon, line, arrow, star
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

### Text Tool
- **Font size**: 1 - 500
- **Font family**: Inter, Arial, Helvetica, Georgia, Times New Roman, Courier New, JetBrains Mono, Verdana, Trebuchet MS, Impact, Comic Sans MS, Palatino, Garamond, Brush Script
- **Font weight**: normal (400) or bold (700)
- **Font style**: normal or italic
- **Text align**: left, center, right, justify
- **Line height**: configurable
- **Letter spacing**: configurable
- **Mode**: point text (no wrap) or area text (fixed width with wrapping)

---

## Selection Tools

### Rectangular Marquee
- **Aspect ratio lock**: width/height constraint

### Elliptical Marquee
- **Aspect ratio lock**: width/height constraint

### Lasso (Freehand)
- No configurable parameters

### Polygonal Lasso
- Click-to-place-points polygon selection

### Magnetic Lasso
- **Width**: 1 - 40 px (perpendicular search radius from the cursor path)
- **Contrast**: 1 - 100% (minimum edge strength to snap onto)
- **Frequency**: 0 - 200 px (distance between auto-placed anchors; 0 disables auto-anchoring)
- Edge detection runs in WASM against the active layer's GPU texture; only snapped coordinates cross back to JS

### Magic Wand
- **Tolerance**: 0 - 255
- **Contiguous**: on/off

### Selection Operations
- Add, subtract, intersect (combine modes)
- Invert selection
- Select all
- Deselect
- Selection from layer alpha (non-transparent pixels)
- Path to selection

---

## Transform

- **Modes**: free, skew, distort, perspective
- **Scale**: X and Y independently
- **Rotation**: arbitrary angle
- **Translation**: X and Y
- **Skew**: X and Y
- **Corner manipulation**: 4-point distort/perspective
- **Quick transforms**: flip horizontal, flip vertical, rotate 90 CW, rotate 90 CCW

---

## Other Tools

### Move
- Drag to reposition layers
- Arrow key nudge
- Snap to grid
- Snap to guides
- **Align**: left, center-h, right, top, center-v, bottom

### Eyedropper
- **Sample size**: point, 3x3, 5x5

### Fill (Paint Bucket)
- **Tolerance**: 0 - 255
- **Contiguous**: on/off

### Gradient
- **Type**: linear, radial
- **Stops**: multiple color stops with position (0-1)
- **Reverse**: on/off

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

Applied globally or per-group. All default to 0.

- **Exposure**: stops (multiplier = 2^value)
- **Contrast**: -100 to +100
- **Highlights**: -100 to +100
- **Shadows**: -100 to +100
- **Whites**: -100 to +100
- **Blacks**: -100 to +100
- **Saturation**: -100 to +100
- **Vibrance**: -100 to +100
- **Vignette**: 0 to 100
- **Curves**: per-channel tone curves (RGB master + R / G / B), evaluated as
  monotone cubic Hermite splines. Master applies to every channel first,
  then per-channel curves remap their own value. Edited via the
  `CurveEditor` (drag points, click to add, double-click or yank to remove).
  Runs as a single 256×1 RGBA LUT texture sampled in the GPU adjustments
  shader; identity curves bypass the lookup.

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

### Render
- **Clouds**: scale, seed
- **Smoke**: scale, seed, turbulence

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
- **Shape**: vector shape (rectangle, ellipse, polygon, line, arrow, star)
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
- Add/remove/toggle mask

### Clipboard
- Copy, cut, paste (respects selection)
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

---

## Paths Panel

- Named stored paths
- Operations: add, remove, select, rename, update anchors
- Stroke path to pixels
- Convert path to selection

---

## Symmetry

- **Axes**: horizontal, vertical, or both (4-way)
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
