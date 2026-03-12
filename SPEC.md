# Loppsy — Image Editor Spec

Loppsy is a browser-based image editor at loppsy.art. It runs entirely client-side as a single-page application. The goal is a capable, modern image editor — not a Photoshop clone, but one that covers the same core workflows: photo retouching, digital painting, compositing, and graphic design.

---

## 1. Canvas & Workspace

### Infinite Canvas
- The workspace is unbounded (or very large, e.g. 32,000 x 32,000 px). Users can pan freely in any direction.
- Content can exist anywhere on the canvas. The "document" has a defined export boundary (artboard) but work can happen outside it.

### Zoom
- Smooth zoom from ~1% to 6400%.
- Zoom to fit, zoom to selection, zoom to actual pixels (100%).
- Keyboard shortcuts: `Cmd +` / `Cmd -` / `Cmd 0` (fit) / `Cmd 1` (100%).
- Scroll wheel + modifier to zoom. Pinch-to-zoom on trackpad.
- Pixel grid visible at high zoom levels (e.g. > 800%).

### Pan / Navigation
- Spacebar + drag to pan (standard).
- Two-finger scroll on trackpad.
- Navigator minimap panel showing viewport position on the full canvas.

### Rulers & Guides
- Pixel rulers along top and left edges. Toggle on/off.
- Draggable guides from rulers. Snap-to-guide behavior.
- Grid overlay (configurable spacing). Toggle on/off.

### Artboards
- One or more rectangular export regions on the canvas.
- Each artboard has its own dimensions and name.
- Artboards can be resized, moved, duplicated.
- Export targets individual artboards or all at once.

---

## 2. Layers

### Layer Types
- **Raster layers** — pixel data, the default.
- **Text layers** — editable text with font/size/color properties.
- **Shape layers** — vector shapes (rect, ellipse, polygon, path) with fill/stroke.
- **Group layers** — folders that contain other layers. Groups can be nested.
- **Adjustment layers** — non-destructive adjustments (brightness, contrast, etc.) that affect all layers below within the same group.
- **Fill layers** — solid color, gradient, or pattern.

### Layer Properties
- Name, visibility (eye icon), lock (prevent edits).
- Opacity: 0–100%.
- Blend mode: Normal, Multiply, Screen, Overlay, Darken, Lighten, Color Dodge, Color Burn, Hard Light, Soft Light, Difference, Exclusion, Hue, Saturation, Color, Luminosity.
- Clip to layer below (clipping mask).

### Layer Panel
- Drag to reorder. Drag into groups.
- Thumbnail preview per layer.
- Multi-select layers (shift-click, cmd-click).
- Right-click context menu: duplicate, merge down, flatten, delete, convert to smart object (future).
- Merge visible, flatten image.

### Layer Masks
- Each layer can have a grayscale mask (white = visible, black = hidden, gray = partial).
- Paint on the mask with any brush/tool.
- Toggle mask view (show mask as red overlay or solo).
- Disable/enable mask without deleting it.
- Vector masks using paths (future consideration).

---

## 3. Selection Tools

### Marquee Select
- **Rectangular marquee** — click and drag a rectangle.
- **Elliptical marquee** — click and drag an ellipse.
- Hold `Shift` to constrain to square / circle.
- Hold `Alt/Option` to draw from center.

### Free Select (Lasso)
- **Freehand lasso** — draw a freeform selection boundary.
- **Polygonal lasso** — click to place points, close the polygon.
- Double-click or click start point to close.

### Magic Wand
- Click to select contiguous pixels of similar color.
- Tolerance setting (0–255).
- Contiguous toggle (flood fill vs. global color match).
- Sample from current layer or all layers.

### Selection Operations
- Add to selection (`Shift`), subtract (`Alt`), intersect (`Shift + Alt`).
- Select all, deselect, invert selection.
- Feather selection (radius in px).
- Expand / contract selection by N pixels.
- Selection from layer transparency (Cmd-click layer thumbnail).
- Save / load selections as channels.
- Marching ants animation on active selection.

---

## 4. Drawing & Painting Tools

### Pencil
- Hard-edged, 1px aliased drawing tool.
- Configurable size (1–100 px).
- Draws with foreground color.
- Hold `Shift` after first click to draw a straight line to next click.

### Brush
- Anti-aliased, soft-edged brush.
- Size: 1–1000 px. Hardness: 0–100%.
- Opacity: 1–100%. Flow: 1–100%.
- Brush presets (round, textured, scatter).
- Pressure sensitivity support (for pen tablets / Apple Pencil).
- Spacing setting (distance between dabs as % of brush size).
- Hold `Shift` to draw straight line between clicks.

### Eraser
- Works like brush but removes pixels (makes transparent) or paints with background color.
- Same size/hardness/opacity settings as brush.
- Eraser presets matching brush presets.

### Fill (Paint Bucket)
- Flood-fill contiguous area with foreground color, pattern, or gradient.
- Tolerance setting. Contiguous toggle.
- Anti-alias toggle.
- Fill selection if one is active.

### Gradient
- Click and drag to define gradient direction and length.
- Gradient types: Linear, Radial, Angular, Reflected, Diamond.
- Gradient editor: add/remove color stops, adjust positions, opacity stops.
- Preset gradients (foreground-to-background, foreground-to-transparent, etc.).
- Reverse, dither options.

### Stamp (Clone Stamp)
- `Alt`-click to set source point.
- Paint to clone pixels from source location.
- Aligned mode (source moves with brush) vs. fixed mode (source resets each stroke).
- Size, hardness, opacity, flow settings (like brush).
- Sample from current layer, current & below, or all layers.

### Dodge / Burn
- **Dodge** — lighten areas.
- **Burn** — darken areas.
- Range: Shadows, Midtones, Highlights.
- Exposure: 1–100%.
- Brush size and hardness settings.

---

## 5. Shape Tool

### Shapes
- Rectangle, rounded rectangle, ellipse, polygon, line, arrow, star.
- Custom corner radius for rounded rectangles.
- Configurable number of sides for polygons.

### Shape Properties
- Fill: solid color, gradient, pattern, or none.
- Stroke: color, width (px), dash pattern.
- Creates a shape layer by default. Option to rasterize immediately.

### Drawing Modifiers
- Hold `Shift` to constrain aspect ratio (square, circle).
- Hold `Alt/Option` to draw from center.
- Hold `Shift` while drawing line/arrow to snap to 45-degree increments.

---

## 6. Text Tool

### Text Entry
- Click to place a text cursor (point text — no wrapping).
- Click and drag to create a text box (area text — wraps at boundary).
- Double-click text layer to re-edit.

### Text Properties
- Font family (system fonts + web fonts).
- Font size, weight, style (italic).
- Color (foreground color by default).
- Line height, letter spacing, paragraph spacing.
- Alignment: left, center, right, justify.
- Text decoration: underline, strikethrough.
- Text transform: uppercase, lowercase, title case.
- Anti-aliasing method: none, sharp, smooth.

### Text Layer Behavior
- Text layers are non-destructive — text remains editable.
- Can be rasterized (converts to pixel layer, loses editability).
- Can be transformed (scale, rotate) without rasterizing.

---

## 7. Path Tool (Pen Tool)

### Drawing Paths
- Click to place anchor points (straight segments).
- Click and drag to place anchor points with Bezier handles (curves).
- Close path by clicking the start point.
- `Esc` to end an open path.

### Editing Paths
- Direct selection tool to move individual anchor points and handles.
- Add / delete anchor points on existing segments.
- Convert between smooth and corner points.

### Path Operations
- Stroke path (apply brush/pencil along the path).
- Fill path.
- Convert path to selection.
- Convert selection to path.
- Path boolean operations: union, subtract, intersect, exclude (future).

---

## 8. Transform & Move

### Move Tool
- Click and drag to move selected layer(s).
- Arrow keys for 1px nudge. `Shift` + arrow for 10px nudge.
- Show bounding box with handles for quick scale/rotate.
- Auto-select layer on click (toggle in options bar).
- Snap to guides, grid, other layers, artboard edges.

### Free Transform
- `Cmd + T` to enter transform mode.
- Drag corners to scale. Hold `Shift` to constrain proportions.
- Drag outside bounding box to rotate.
- Hold `Cmd` to skew / perspective warp.
- Enter exact values in options bar (width, height, rotation, x, y).
- Apply or cancel.

### Crop Tool
- Drag handles to define crop region.
- Preset aspect ratios (1:1, 4:3, 16:9, custom).
- Crop to selection.
- Option to crop all layers or just current.

---

## 9. Color

### Foreground / Background Colors
- Two active colors: foreground (draw color) and background (erase/fill color).
- Click to swap (`X` shortcut). Click to reset to black/white (`D` shortcut).

### Color Picker
- HSB / RGB / Hex input.
- Color wheel or square picker.
- Eyedropper to sample from canvas (or screen).
- Recent colors history.

### Color Dropper (Eyedropper)
- Click anywhere on canvas to pick a color and set as foreground.
- Hold `Alt` to set as background color.
- Sample size: point, 3x3, 5x5 average.
- Sample from current layer or all layers.

### Swatches Panel
- Preset color palettes.
- User-created swatches.
- Import/export palettes (ASE, GPL formats — future).

---

## 10. Filters

### Blur
- **Gaussian Blur** — radius in px. Live preview.
- **Box Blur** — uniform blur.
- **Motion Blur** — angle + distance.
- **Radial Blur** — spin or zoom from a center point.
- **Surface Blur** — preserves edges (future).

### Sharpen
- **Unsharp Mask** — amount, radius, threshold.
- **Sharpen** — simple one-click sharpen.

### Noise
- **Add Noise** — amount, uniform/gaussian, monochromatic toggle.
- **Reduce Noise** — basic noise reduction (future).

### Distort (Future)
- Liquify (interactive push/pull warp).
- Ripple, wave, pinch, spherize.

### Stylize (Future)
- Emboss, find edges, oil paint.

### Filter Application
- All filters apply to the current layer (or selection if active).
- Live preview toggle.
- Filters on adjustment layers are non-destructive (future).

---

## 11. Image Adjustments

All adjustments can be applied destructively (to the layer directly) or as adjustment layers (non-destructive, editable).

### Brightness / Contrast
- Brightness slider: -100 to +100.
- Contrast slider: -100 to +100.

### Hue / Saturation / Lightness
- Hue shift: -180 to +180 degrees.
- Saturation: -100 to +100.
- Lightness: -100 to +100.
- Colorize mode (maps all hues to a single hue).
- Target specific color ranges (reds, yellows, greens, cyans, blues, magentas).

### Levels
- Histogram display.
- Input levels: black point, midtone (gamma), white point.
- Output levels: min, max.
- Per-channel (R, G, B) or composite.
- Auto levels.

### Curves (Future)
- Tone curve graph with draggable control points.
- Per-channel or composite.
- Presets.

### Color Balance
- Shadows / midtones / highlights adjustment.
- Cyan–Red, Magenta–Green, Yellow–Blue sliders.

### Invert
- Invert all colors (negative).

### Desaturate
- Convert to grayscale (keeping RGB mode).

### Posterize
- Reduce number of tonal levels per channel.

### Threshold
- Convert to pure black and white based on luminance cutoff.

---

## 12. History & Undo

### Undo / Redo
- `Cmd + Z` to undo. `Cmd + Shift + Z` to redo.
- Deep undo stack (50+ steps, configurable).

### History Panel
- Visual list of all actions taken.
- Click any history state to jump back.
- Non-linear history: making changes after jumping back branches the history (older forward states are grayed out but retained until the branch is too old).

### Snapshots
- Save named snapshots of the current state.
- Restore from any snapshot.

---

## 13. Import / Export

### Import
- Open image files: PNG, JPEG, WebP, GIF, BMP, TIFF, SVG (rasterized on import), PSD (basic support — future).
- Drag and drop images onto canvas (creates new layer).
- Paste from clipboard.
- Import as new layer or new document.

### Export
- **Quick export**: PNG (default), JPEG, WebP.
- **Export dialog**:
  - Format: PNG, JPEG, WebP, GIF, BMP, TIFF, SVG (vector layers only).
  - Quality slider (JPEG, WebP).
  - Scale: 1x, 2x, 0.5x, custom.
  - Export selected artboard(s), entire canvas, or selection.
  - Transparency: preserve (PNG, WebP) or flatten to background color.
- **Save project**: custom format (JSON + binary blobs) preserving all layers, masks, history, and metadata. Stored in browser (IndexedDB) or downloaded as a file.
- **Auto-save**: periodic save to IndexedDB with recovery on reload.

---

## 14. Keyboard Shortcuts & UX Conventions

### Standard Shortcuts
| Action | Shortcut |
|---|---|
| Undo | `Cmd + Z` |
| Redo | `Cmd + Shift + Z` |
| Cut / Copy / Paste | `Cmd + X / C / V` |
| Select All | `Cmd + A` |
| Deselect | `Cmd + D` |
| Invert Selection | `Cmd + Shift + I` |
| Free Transform | `Cmd + T` |
| Zoom In / Out | `Cmd + / Cmd -` |
| Fit to Screen | `Cmd + 0` |
| Actual Size | `Cmd + 1` |
| New Layer | `Cmd + Shift + N` |
| Duplicate Layer | `Cmd + J` |
| Merge Down | `Cmd + E` |
| Save | `Cmd + S` |
| Export | `Cmd + Shift + E` |

### Tool Shortcuts
Single letter to select tool (e.g., `V` move, `B` brush, `E` eraser, `G` gradient/fill, `T` text, `P` pen, `M` marquee, `L` lasso, `W` magic wand, `S` stamp, `C` crop, `I` eyedropper, `O` dodge/burn, `U` shape).

### Drawing Modifiers (Consistent Across Tools)
- `Shift` while dragging: constrain to straight line / square / circle / 45-degree angles.
- `Shift` + click (after first click): draw straight line from last point.
- `Alt/Option` while dragging: draw from center (shapes, marquees).
- `[` / `]`: decrease / increase brush size.
- `Shift + [` / `Shift + ]`: decrease / increase brush hardness.
- Number keys: set tool opacity (1 = 10%, 5 = 50%, 0 = 100%).

---

## 15. UI Layout

### Header Bar
- Menu bar: File, Edit, Image, Layer, Select, Filter, View, Window.
- Active tool options bar (context-sensitive settings for the selected tool).

### Left Sidebar — Toolbox
- Vertically stacked tool icons. Grouped tools in flyout menus (click and hold to see alternatives, e.g., marquee group).

### Right Sidebar — Panels
- **Layers panel** — always visible.
- **Properties panel** — shows settings for selected layer/object.
- **Color panel** — color picker + swatches.
- **History panel** — collapsible.
- **Navigator panel** — minimap, collapsible.
- Panels are collapsible, reorderable, and can be detached (future).

### Center — Canvas
- The main workspace. Takes up all remaining space.
- Artboard(s) displayed on a neutral gray background.

### Footer / Status Bar
- Current zoom level.
- Canvas/cursor coordinates.
- Document dimensions.
- Memory/layer count indicators.

---

## 16. Performance Considerations

- **Rendering**: WebGL (via GPU) for canvas compositing. Fall back to Canvas 2D where WebGL isn't supported.
- **Large canvases**: tile-based rendering — only render tiles visible in the viewport.
- **Offscreen layers**: skip compositing for layers that don't intersect the viewport.
- **Brush rendering**: stamp-based approach with interpolation between input points. GPU-accelerated where possible.
- **Web Workers**: offload filter computations, image decode/encode, and heavy processing to workers to keep UI responsive.
- **Memory management**: lazy-load layer pixel data. Compress or page out inactive layers to IndexedDB if memory pressure is high.
- **Target**: 60fps pan/zoom, 60fps brush strokes on a 4000x4000 canvas with 20 layers on a mid-range laptop.

---

## 17. Technology

- **Language**: TypeScript exclusively — no `.js` or `.jsx` files. Strict mode enabled (`"strict": true`). All source files are `.ts` or `.tsx`.
- **Framework**: React (UI), WebGL 2 (rendering), Canvas 2D (fallback).
- **State management**: Zustand or similar lightweight store for UI state. Custom layer/document model for the editor core.
- **Build**: Vite.
- **File handling**: File System Access API where supported, fallback to download links.
- **Persistence**: IndexedDB for project auto-save. Custom binary project format for save/load.
- **No server required**: everything runs in the browser. No backend dependencies for core editing.

---

## 18. Design System — Styles, Icons, Fonts

### CSS & Styling

- **CSS Modules** (`.module.css`) for all component styles. One module per component, co-located with the component file. All styles live in CSS — no inline styles, no `style` props, no CSS-in-JS, no style objects in TypeScript. TypeScript files contain zero styling logic.
- Vite generates typed CSS module imports automatically (or via `typed-css-modules`), so `import styles from './Foo.module.css'` is fully typed.
- **CSS custom properties** (variables) for theming — colors, spacing, radii, shadows defined in a single `tokens.css` file. Dark theme by default (standard for image editors); light theme via a `.theme-light` class on the root element.
- No CSS framework (Tailwind, Bootstrap, etc.). The UI is specialized enough that utility classes add more noise than value. Keep styles close to components.
- **Design tokens**:
  - Spacing scale: 4px base (`--space-1` = 4px, `--space-2` = 8px, ... `--space-8` = 32px).
  - Color palette: neutral grays for chrome, accent color for active/selected states, semantic colors for error/warning/success.
  - Border radii, font sizes, z-index layers — all tokenized.

### Fonts

#### UI Fonts
- **UI font**: [Inter](https://fonts.google.com/specimen/Inter) — clean, highly legible at small sizes, excellent for dense tool UIs.
- **Monospace font** (for numeric inputs, coordinates, hex values): [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) or [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono).
- Both are open source (OFL). Self-host the woff2 files — no third-party requests, works offline.
- Subset to Latin + common symbols to minimize payload.

#### Text Tool Fonts
The text tool needs a broad, curated library of fonts users can apply to text layers.

- **Bundled starter set** (~20–30 fonts): a curated selection of Google Fonts shipped with the app, covering the essentials:
  - **Sans-serif**: Inter, Open Sans, Roboto, Lato, Montserrat, Poppins, Nunito.
  - **Serif**: Playfair Display, Merriweather, Lora, Source Serif Pro, EB Garamond.
  - **Display / decorative**: Bebas Neue, Righteous, Pacifico, Lobster, Permanent Marker.
  - **Monospace**: JetBrains Mono, Fira Code, Source Code Pro.
  - **Handwriting**: Caveat, Dancing Script, Satisfy.
- All bundled fonts are open source (OFL / Apache 2.0). Self-hosted as woff2.
- **Google Fonts integration**: browse and load any of the ~1,500 Google Fonts on demand. Fonts are fetched when selected and cached locally (IndexedDB or Cache API) for future sessions.
  - Font list metadata loaded once (lightweight JSON) and cached.
  - Preview in the font picker by loading only the font name in the selected font (subset on demand).
  - Full font file loaded when the user commits to a font for a text layer.
- **Local font access**: use the [Local Font Access API](https://developer.chrome.com/docs/capabilities/web-apis/local-fonts) (Chromium) to let users pick from fonts installed on their system. Graceful fallback — feature simply hidden in browsers that don't support it.
- **Custom font upload**: drag-and-drop or file picker to upload .ttf / .otf / .woff2 files. Loaded via `FontFace` API, stored in IndexedDB for the project.
- **Font rendering**: text layers render using the browser's native text layout (`CanvasRenderingContext2D.fillText` or DOM-based measurement) then rasterize to the WebGL layer. This ensures correct kerning, ligatures, and OpenType features.
- **Export consideration**: when exporting to PNG/JPEG, text is rasterized — no font embedding needed. For the project save format, store a reference to the font source (bundled, Google Fonts ID, or the uploaded font file itself) so text remains editable on reload.

### Icons

- **[Lucide](https://lucide.dev/)** — open source (ISC license), consistent 24x24 stroke icons, tree-shakeable React components. Good coverage of editor-relevant icons (layers, eye, lock, move, type, pen, crop, sliders, etc.).
- For tool icons that Lucide doesn't cover (brush, eraser, stamp, dodge, burn, gradient, lasso, magic wand), create custom SVG icons following Lucide's style: 24x24 viewbox, 2px stroke, round caps/joins, no fill.
- Custom icons live in `src/icons/` as React components for consistency with Lucide's API.

### Storybook

- **Storybook 8+** for component development and documentation.
- Every UI component gets a story file (`ComponentName.stories.tsx`) co-located with the component.
- Story categories:
  - **Primitives**: Button, IconButton, Slider, NumberInput, Select, Checkbox, Toggle, ColorSwatch, Tooltip, Popover, Divider.
  - **Panels**: LayerPanel, ColorPanel, HistoryPanel, PropertiesPanel, NavigatorPanel.
  - **Toolbox**: ToolIcon, ToolGroup, Toolbox (full sidebar).
  - **Options Bar**: per-tool options bar variants (brush options, shape options, text options, etc.).
  - **Dialogs**: ExportDialog, NewDocumentDialog, FilterDialog, AdjustmentDialog.
  - **Composed**: full editor layout with mock data, demonstrating panel arrangements.
- Use Storybook's `args` / `controls` for interactive prop exploration.
- **Chromatic** or Storybook's visual test addon for visual regression on component-level changes (complements the Playwright visual regression in the Testing section).
- Storybook deployed as a static site alongside the app (e.g. `storybook.loppsy.art`) for team reference.

---

## 19. Deployment

### Architecture

Loppsy is a fully static, client-side application. No backend, no server-side rendering, no API. The entire build output is HTML + JS + CSS + static assets.

### Hosting: Cloudflare Pages

- **Primary host**: Cloudflare Pages. Free tier covers the needs (unlimited bandwidth, 500 builds/month).
- Deploy from GitHub: push to `main` triggers a production build. Push to any other branch creates a preview deploy with a unique URL.
- Build command: `npm run build` (Vite produces a `dist/` folder).
- Output directory: `dist`.

### Domain & DNS

- Domain: `loppsy.art`, DNS managed through Cloudflare.
- `loppsy.art` → production deploy.
- `storybook.loppsy.art` → Storybook deploy (separate Cloudflare Pages project or subdirectory).
- Preview deploys get auto-generated URLs (e.g. `abc123.loppsy-art.pages.dev`).

### Build & CI Pipeline

- **GitHub Actions**:
  1. On every PR: lint, type-check, unit tests (Vitest), build, E2E tests (Playwright against the build preview).
  2. On merge to `main`: Cloudflare Pages auto-deploys production.
  3. Storybook build and deploy on merge to `main`.
- Build output is small (target < 500KB gzipped for initial load, excluding user-loaded images).

### Caching & Performance

- Vite produces hashed filenames — set long cache headers (`Cache-Control: public, max-age=31536000, immutable`) for all assets in `dist/assets/`.
- `index.html` gets short cache (`max-age=60`) or `no-cache` so updates propagate quickly.
- Cloudflare's edge CDN handles global distribution automatically.

### Offline Support (Future)

- Service worker (via `vite-plugin-pwa`) to cache the app shell and assets for offline use.
- The editor is already fully client-side, so offline editing works naturally once assets are cached.
- Only limitation: Google Fonts won't load offline unless self-hosted (another reason to self-host).

---

## 20. Testing

### Unit Tests

Unit tests cover the editor's core logic independent of the DOM or rendering pipeline. Run with Vitest.

#### Tool Logic
Each tool has a pure logic module separate from its UI/rendering. Unit tests validate:
- **Brush / Pencil / Eraser**: stroke generation from input points, interpolation between samples, shift-click straight line calculation, size/opacity/hardness parameter application.
- **Fill**: flood-fill algorithm correctness — tolerance boundary, contiguous vs. global mode, stop at selection edges.
- **Gradient**: color stop interpolation, correct output for linear/radial/angular/reflected/diamond types.
- **Clone Stamp**: source offset calculation, aligned vs. fixed mode behavior.
- **Dodge / Burn**: pixel value adjustment for shadows/midtones/highlights ranges.
- **Marquee / Lasso / Magic Wand**: selection mask generation — shape correctness, shift-constrain, add/subtract/intersect operations, feathering.
- **Shape**: geometry generation for all shape types, constraint modifiers.
- **Text**: text layout calculation, property application.
- **Move / Transform**: translation, scale, rotation, skew matrix math. Snap-to-guide calculations.
- **Crop**: boundary calculation, aspect ratio constraints.
- **Pen / Path**: Bezier curve math, anchor point manipulation, path-to-selection conversion.
- **Eyedropper**: color sampling at point and averaged area (3x3, 5x5).

#### Layer System
- Layer ordering: add, remove, reorder, group/ungroup.
- Blend mode compositing: verify pixel output for each blend mode against reference values.
- Opacity application.
- Clipping mask behavior.
- Layer mask application (white/black/gray mask values).
- Merge down, flatten.

#### Adjustments & Filters
- Brightness/contrast, HSL, levels, color balance, invert, desaturate, posterize, threshold: verify pixel-level output against known input/output pairs.
- Gaussian blur, unsharp mask, noise: verify kernel application and output within acceptable tolerance.
- Adjustment layer stacking: correct order of operations when multiple adjustments are layered.

#### History / Undo
- Undo/redo stack integrity: operations push correctly, undo restores prior state, redo re-applies.
- History branching: making a change after undo discards the forward branch.
- Snapshot save/restore.

#### Selection Operations
- Select all, deselect, invert.
- Expand, contract, feather.
- Selection from layer transparency.
- Boolean operations between selections (union, subtract, intersect).

#### Import / Export
- Encode/decode round-trip: export an image, re-import, verify pixel data matches.
- Project format save/load: verify all layer data, masks, and metadata survive serialization.
- Export scale and quality parameters applied correctly.

### End-to-End Tests

E2E tests run in a real browser via Playwright. They validate complete user workflows through the actual UI.

#### Core Workflows
- **Open and edit**: Import an image, apply a filter, export. Verify the exported file is valid and contains expected modifications.
- **Layer workflow**: Create multiple layers, reorder them, toggle visibility, adjust opacity, merge down. Verify canvas renders correctly at each step.
- **Draw and erase**: Select brush, draw strokes on canvas, switch to eraser, erase part of the stroke. Verify pixel changes on the canvas element.
- **Selection and fill**: Draw a rectangular selection, fill with a color, deselect. Verify filled region and unfilled region.
- **Text placement**: Select text tool, click canvas, type text, change font size, move the text layer. Verify text renders and remains editable.
- **Transform**: Place content, enter free transform, scale and rotate, apply. Verify bounding box and pixel output.
- **Undo chain**: Perform a sequence of 10+ operations, undo all, redo all. Verify canvas state matches at each step.

#### Tool Interaction Tests
- Verify shift-click straight line works across brush, pencil, eraser, and clone stamp.
- Verify shift-constrain works for marquee (square/circle), shape, and crop tools.
- Verify keyboard shortcuts activate the correct tools and trigger the correct actions.
- Verify brush size changes with `[` / `]` keys.
- Verify foreground/background color swap with `X`, reset with `D`.

#### UI & Panel Tests
- Layer panel: drag to reorder, right-click context menu, rename, delete.
- Color picker: pick color via wheel, input hex, verify foreground updates.
- History panel: click a prior state, verify canvas reverts. Make a new change, verify branch behavior.
- Zoom: Cmd+/Cmd- zoom in/out, Cmd+0 fit, Cmd+1 actual size. Verify zoom level display updates.
- Panels collapse and expand correctly.

#### Edge Cases & Regression
- Empty canvas operations: fill, select all, export on a blank document.
- Maximum zoom in/out: verify rendering at 1% and 6400%.
- Large layer count (50+ layers): verify panel scrolls, reorder still works, export still succeeds.
- Rapid undo/redo (mash Cmd+Z): no state corruption.
- Browser reload with auto-save: reopen and verify project state is restored.

### Testing Technology
- **Unit tests**: Vitest. Mock canvas/WebGL contexts where needed. Use `OffscreenCanvas` or headless canvas polyfills for pixel-level assertions.
- **E2E tests**: Playwright (Chromium, Firefox, WebKit).
- **Visual regression**: Screenshot comparison for rendering tests where pixel-exact output matters (filters, blend modes, brush rendering). Playwright's built-in screenshot diffing or a tool like `pixelmatch`.
- **CI**: Run unit tests on every PR. Run E2E suite on every PR against a preview deploy. Visual regression runs nightly or on release branches.

---

## 21. Scope & Phasing

### Phase 1 — Foundation
- Canvas rendering (WebGL), pan, zoom.
- Layer system: raster layers, ordering, visibility, opacity, blend modes.
- Basic tools: move, brush, eraser, pencil, fill.
- Color picker, foreground/background colors, eyedropper.
- Undo/redo.
- Import (open image file), export (PNG, JPEG).

### Phase 2 — Core Tools
- Selection tools: rectangular/elliptical marquee, lasso, polygonal lasso, magic wand.
- Selection operations (add, subtract, feather, invert).
- Shape tool, text tool.
- Gradient tool, clone stamp.
- Free transform, crop.
- Layer masks.
- Rulers, guides, grid, snap.

### Phase 3 — Adjustments & Filters
- Adjustment layers: brightness/contrast, hue/saturation, levels, color balance.
- Filters: gaussian blur, unsharp mask, noise.
- History panel with snapshots.
- Artboards.

### Phase 4 — Polish & Advanced
- Brush engine (presets, texture, scatter, pressure sensitivity).
- Pen tool / path editing.
- Curves adjustment.
- Additional filters (motion blur, radial blur, distort).
- Save/load project format.
- Auto-save and recovery.
- Performance optimizations for very large canvases.

### Future Considerations
- PSD import/export.
- Plugin/extension system.
- Collaborative editing.
- AI-powered tools (generative fill, background removal, upscaling).
- Animation timeline (frame-by-frame or tween-based).
