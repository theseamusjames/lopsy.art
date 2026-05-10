# Feature Parity Analysis: Lopsy vs. Major Image Editors

## Context

Lopsy is a GPU-first, browser-based image editor with a strong foundation: 20+ tools, 16 blend modes, layer effects, a full filter library, GPU-accelerated compositing via Rust/WASM+WebGL2, and solid painting capabilities. The goal here is to identify what standard (non-AI) image editing features exist in Photoshop, Affinity Photo, and GIMP that Lopsy is still missing or incomplete on.

Comparators: **Adobe Photoshop**, **Affinity Photo**, **GIMP**, **Procreate** (painting focus).

---

## What Lopsy Already Has (Verified against code + FEATURES.md)

- **Tools**: Move, Brush (with ABR import + presets + symmetry), Pencil (with symmetry), Eraser (with symmetry), Spray, Fill (paint bucket), Gradient (Linear + Radial only — not 5 types), Clone Stamp, Dodge/Burn, Smudge, Marquee (Rect/Ellipse), Lasso, Magnetic Lasso, Magic Wand, Shape (ellipse + N-sided polygon — rect = 4 sides), Text (point + area, with native Rust font engine — see below), Pen/Path (with anchor toggle, path→selection, stroke path), Free Transform (free/skew/distort/perspective), Crop, Eyedropper, Mesh Warp (interactive grid 3×3–6×6, selection-bound)
- **Native Text Engine**: Text rendering uses cosmic-text + swash in the Rust/WASM engine with a GPU glyph atlas (1024×1024, etagere shelf-packed). Supports TTF, OTF, and WOFF2 font loading (WOFF2 decoded to SFNT in Rust via custom Brotli decompressor). Fonts loaded dynamically via font-loader.ts (TTF from CDN preferred, WOFF2 fallback). Inter Regular bundled as fallback. Canvas2D `fillText` is no longer used — all text is shaped and rasterized engine-side.
- **Filters**: Gaussian/Box/Motion/Radial Blur, Tilt-Shift Blur (interactive canvas overlay with draggable focal lines + angle control), Unsharp Mask, Find Edges, Cel Shading, Pixelate, Halftone, Kaleidoscope, Oil Paint, Chromatic Aberration, Pixel Stretch, Lens Distortion, Bloom/Soft Glow, Add/Fill Noise, Clouds, Smoke, Pattern Fill (with custom pattern definition), Brightness/Contrast, Hue/Saturation, Invert, Desaturate, Posterize, Threshold, Solarize
- **Adjustments** (per-group, non-destructive GPU pass): Exposure, Contrast, Highlights, Shadows, Whites, Blacks, Vignette, Saturation, Vibrance, Curves (per-channel, monotone cubic Hermite), Levels (per-channel with gamma)
- **Layer Effects**: Drop Shadow, Outer Glow, Inner Glow, Color Overlay, Stroke (EDT)
- **16 Blend Modes**: Full standard set including HSL modes
- **Layer types**: Raster, Text, Shape, Group only — *FEATURES.md lists "Adjustment" and "Fill" as layer types but they don't exist in the actual type union (`src/types/layers.ts`); aspirational docs*
- **Layer masks** (grayscale pixel), **Clipping masks** (clip-to-below)
- **Rulers, Guides, Grid** with toggle; **Snap-to-grid** and **Snap-to-guides** working on Move and Transform tools (`ui-store.ts` has `snapToGrid` + toggle)
- **Import**: PNG, JPEG, WebP, GIF, BMP, PSD, DNG
- **Export**: PNG, JPEG, WebP, BMP, PSD, PNG-16bit (with ICC/wide-gamut). Confirmed: `ExportFormat = 'png' | 'jpeg' | 'webp' | 'bmp'`
- **Color spaces**: sRGB, Display P3, Rec. 2020, Linear sRGB; FP16 textures with `EXT_color_buffer_float`; EDR passthrough; ICC profile on export
- **Symmetry** on brush/pencil/eraser: horizontal, vertical, both (4-way) — fully wired with configurable center
- **Hold-to-smooth** line: pause mid-stroke for auto-smooth re-rasterization
- **Undo/Redo**: unlimited, RLE-compressed GPU texture snapshots, labeled, with metadata-only snapshots for lightweight ops
- **Copy/Paste** with merge (Cmd+Shift+C copy merged), clipboard, external paste/drop
- **Reference Image Drawer**: floating, draggable, multiple images with per-image zoom/pan/opacity/flip
- **Path → Selection** (one-way only, no Selection → Path)

---

## Design Decisions (from review session)

### Group Adjustments replace Adjustment Layers

Lopsy deliberately avoids floating Adjustment Layers in the stack. Instead, adjustments are a property of a `GroupLayer` — applied as a GPU pass to the group's composited FBO before it's blended into its parent. This means:

- Moving a group moves its content and its grade together (no accidental adjustment layer orphaning)
- The engine's `syncGroupAdjustments` already scopes each group's adjustments to its `children` IDs
- Nesting groups achieves the equivalent of stacked adjustment layers

**Group adjustments need two improvements:**
1. **Dynamic adjustment list** — Replace the flat `ImageAdjustments` object with `AdjustmentNode[]` where each entry is `{ type, params, enabled }`. Types can be added from a dropdown, reordered, and individually toggled. This unblocks Color Balance, Gradient Map, Hue/Saturation, Channel Mixer, etc. as first-class options without changing the data model each time.
2. **Group masks** — `GroupLayer` already extends `LayerBase` (which carries `mask`), but the compositor doesn't sample it yet. The group mask should be applied to the composited group FBO before blending into the parent — same path as layer masks.

**The sky/land split problem** (same background layer needing two different regional grades): resolved by selection-based destructive adjustment. This is the correct raster editing answer; trying to handle it structurally adds complexity that doesn't compose well.

### Group nesting depth

Hard limit: **2 levels beyond the project root**. Root → Group → Sub-group → layers. This covers all real composition needs without panel depth problems. Note for PSD import: anything deeper than 2 levels should be flattened on import rather than errored — PSD feature mismatch is a known limitation (PSD has no 1:1 match with Lopsy's model across adjustment layers, smart objects, etc.).

---

## Feature Gaps by Category

### 1. Layer System

| Feature | PS | Affinity | GIMP | Lopsy |
|---|---|---|---|---|
| **Dynamic adjustment list on groups** (reorderable `AdjustmentNode[]`) | — | — | — | ✗ (flat object today) |
| **Group masks** | ✓ | ✓ | ✓ | ✗ (type exists, compositor doesn't use it) |
| **Fill Layers** (solid color / gradient / pattern) | ✓ | ✓ | ✓ | ✗ |
| **Smart Objects** (linked/embedded) | ✓ | ✓ | ✗ | ✗ |
| **Vector Masks** (path-based mask per layer) | ✓ | ✓ | ✗ | ✗ |
| **Pass-through blend mode for groups** | ✓ | ✓ | ✓ | ✗ |
| **Multi-select layers** (Shift/Cmd-click) | ✓ | ✓ | ✓ | ✗ (only single activeLayerId) |
| **Layer color tags/labels** | ✓ | ✓ | ✓ | ✗ |
| **Layer comps** | ✓ | ✓ | ✗ | ✗ |
| **Blend-if sliders** (conditional compositing) | ✓ | ✓ | ✗ | ✗ |

**Highest priority**: Dynamic adjustment list and group masks unlock the full non-destructive grading workflow without introducing floating adjustment layers. Fill Layers are the other core primitive missing for design/composition work.

---

### 2. Selection

| Feature | PS | Affinity | GIMP | Lopsy |
|---|---|---|---|---|
| **Feather selection** | ✓ | ✓ | ✓ | ✗ verified missing — Grow/Shrink only |
| **Anti-alias toggle** on selection tools | ✓ | ✓ | ✓ | ✗ verified missing |
| **Magic Wand graduated mask** (vs binary today) | ✓ | ✓ | ✓ | ✗ verified — `wasmFloodFill` returns binary 0/255 |
| **Multi-point color sampling** | ✓ | ✓ | ✓ | ✗ |
| **Quick Mask Mode** | ✓ | ✓ | ✓ | ✗ verified missing |
| **Refine Edge / Select and Mask** | ✓ | ✓ | ✗ | ✗ |
| **Selection → Path** | ✓ | ✓ | ✓ | ✗ verified missing — only Path → Selection works |
| **Save / Load selections as channels** | ✓ | ✓ | ✓ | ✗ |
| **Stroke / border selection** | ✓ | ✓ | ✓ | ✗ |

**Highest priority**: Feather (Gaussian blur applied to mask), Quick Mask Mode (paint selection as red overlay), and graduated Magic Wand output (replacing the binary 0/255 today with distance-based falloff) — these are used constantly and all achievable with existing GPU machinery.

**Color Range — prior attempt (PR #244, closed unmerged)**: Implemented as a separate Select > Color Range… dialog with fuzziness slider and an in-modal preview canvas. Three problems:
1. **Binary mask** — `color-range.ts` outputs hard 0/255 only (same as today's Magic Wand). No graduated falloff. Fix: `mask[i] = clamp(255 - sqrt(distSq) / fuzziness * 255, 0, 255)`.
2. **No live canvas sampling** — requires picking color with Eyedropper *before* opening the dialog. No click-to-sample on the canvas while the dialog is open.
3. **Preview in modal** — small B&W thumbnail inside the dialog instead of a live overlay on the canvas.

**Better approach — fold into Magic Wand instead of separate tool**: Color Range is essentially Magic Wand with (a) graduated mask values, (b) multi-point sampling, (c) interactive preview. Rather than a separate dialog, enhance the existing Magic Wand: add graduated-output mode, allow Shift-click to add sample points, optionally show a live tint overlay on canvas before commit. One tool, no new dialog.

---

### 3. Adjustments & Color Corrections

Several adjustment types are missing from the group adjustment model entirely. With the dynamic list design, each becomes a new node type rather than a new field on the flat object:

| Adjustment | PS | Affinity | GIMP | Lopsy |
|---|---|---|---|---|
| **Color Balance** (shadows/mids/highlights per CMY-RGB) | ✓ | ✓ | ✓ | ✗ (in SPEC, not implemented) |
| **Gradient Map** | ✓ | ✓ | ✓ | ✗ |
| **Selective Color** | ✓ | ✓ | ✗ | ✗ |
| **Black & White** (channel-mix desaturate) | ✓ | ✓ | ✓ | ✗ (only flat desaturate) |
| **Photo Filter** (warm/cool color cast) | ✓ | ✓ | ✗ | ✗ |
| **Channel Mixer** | ✓ | ✓ | ✓ | ✗ |
| **Solid Color / Gradient / Pattern as fill type** | ✓ | ✓ | ✓ | ✗ (Fill Layers not implemented) |
| **Colorize mode in Hue/Saturation** | ✓ | ✓ | ✓ | ✗ (in SPEC, unclear if UI exposes it) |

---

### 4. Filters

| Feature | PS | Affinity | GIMP | Lopsy |
|---|---|---|---|---|
| **Liquify** (interactive push/pull warp) | ✓ | ✓ | ✓ | ✗ (SPEC: future; mesh_warp is filter-mode only) |
| **Surface Blur** (edge-preserving) | ✓ | ✓ | ✓ | ✗ (SPEC: future) |
| **Emboss** | ✓ | ✓ | ✓ | ✗ |
| **Ripple / Wave** | ✓ | ✓ | ✓ | ✗ (SPEC: future) |
| **Spherize / Pinch** | ✓ | ✓ | ✓ | ✗ (SPEC: future) |
| **Reduce Noise** | ✓ | ✓ | ✓ | ✗ (SPEC: future) |
| ~~**Tilt-Shift / Field Blur**~~ | ✓ | ✓ | ✗ | ✓ implemented — interactive canvas overlay with draggable focal lines, angle control, Cmd-snap to 15° |
| **Diffuse Glow** | ✓ | ✓ | ✓ | ✗ (Bloom/Soft Glow exists but is additive highlight bloom, not the same as Diffuse Glow's full-image softening) |
| **Filter Gallery** (stack multiple filters) | ✓ | ✓ | ✗ | ✗ |
| **Smart Filters** (non-destructive per-layer) | ✓ | ✓ | ✗ | ✗ |

**Note**: The interactive Mesh Warp exists as a mode (`mesh-warp-handlers.ts`, `MeshWarpControls.tsx`, `render-mesh-warp.ts`) but is not Liquify-style free-form. Liquify (push, pull, twirl, bloat, pucker) is the primary missing distortion tool.

**Liquify — prior attempt (PR #194, closed unmerged)**: Implemented Push Forward, Pinch, and Twirl modes via a per-dab paint tool (same pipeline as Smudge/Clone Stamp). Each dab permanently modifies the layer as you paint — no dialog, no commit/cancel. Core problem: Liquify should be a "work in preview, commit or cancel the whole warp" experience. With per-dab destructive writes there's no reference to the original, so repeated strokes degrade the image and there's no way to start over. Manual test was also left unchecked in the test plan.

**Improved approach**: Liquify needs a modal or full-canvas overlay mode. On entry, snapshot the layer. All warp operations render into a separate displacement FBO (not the layer itself). On commit, apply the accumulated displacement to the layer and push history. On cancel, discard and restore the snapshot. This gives a proper non-destructive preview experience with a single undo entry.

**Ripple/Wave filter (PR #202, closed unmerged)**: Had merge conflicts (`mergeable_state: dirty`) when closed. The implementation itself looks correct — sinusoidal UV displacement shader, 4 parameters (amplitude, wavelength, direction, phase). Likely just went stale. Good candidate to reopen/rebase.

**Radial Symmetry / Mandala mode (PR #183, closed unmerged)**: Extends existing `symmetry.ts` with N-fold radial rotation (2–32 segments). Adds toggle to BrushOptions/PencilOptions bars. Looks technically solid with unit tests and E2E. No obvious quality issue — likely closed as lower-priority. Good candidate to reopen.

---

### 5. Tools

| Tool | PS | Affinity | GIMP | Lopsy |
|---|---|---|---|---|
| **Healing Brush** (clone + texture blend) | ✓ | ✓ | ✓ | ✗ |
| **Spot Healing Brush** | ✓ | ✓ | ✓ | ✗ |
| **Patch Tool** | ✓ | ✓ | ✗ | ✗ |
| **Quick Selection** (paint-to-select) | ✓ | ✓ | ✓ | ✗ |
| **Sponge Tool** (saturate/desaturate brush) | ✓ | ✓ | ✓ | ✗ |
| **Blur / Sharpen as brush tools** | ✓ | ✓ | ✓ | ✗ (only as filters) |
| **Color Replacement Tool** | ✓ | ✓ | ✓ | ✗ |
| **Background Eraser** | ✓ | ✓ | ✓ | ✗ |
| **Perspective Crop** | ✓ | ✓ | ✓ | ✗ |
| **Measure / Ruler Tool** | ✓ | ✓ | ✓ | ✗ |
| **Zoom Tool** (dedicated, in toolbox) | ✓ | ✓ | ✓ | ✗ (keyboard only) |
| **Hand/Pan Tool** (dedicated) | ✓ | ✓ | ✓ | ✗ (spacebar only) |
| **Symmetry as active tool toggle** | ✓ (PS CC) | ✓ | ✓ | partial (logic exists, toolbox unclear) |

**Highest priority**: Healing Brush (photo retouching cornerstone) and Quick Selection (the fastest way to select complex objects).

---

### 6. Vector / Path

| Feature | PS | Affinity | GIMP | Lopsy |
|---|---|---|---|---|
| **Boolean path ops** (union/subtract/intersect/exclude) | ✓ | ✓ | ✓ | ✗ (SPEC: future) |
| **Direct Selection Tool** (white arrow, separate from pen) | ✓ | ✓ | ✓ | ✗ |
| **Add/Delete Anchor Point tools** | ✓ | ✓ | ✓ | ✗ |
| **Convert Anchor Point tool** (smooth ↔ corner) | ✓ | ✓ | ✓ | ✗ |
| **Convert selection → path** | ✓ | ✓ | ✓ | ✗ (in SPEC, unclear if implemented) |
| **Custom shape library / presets** | ✓ | ✓ | ✓ | ✗ |
| **Stroke path with pressure simulation** | ✓ | ✓ | ✓ | ✓ (StrokePathModal exists) |

---

### 7. Text

**Foundation resolved — native font engine is in place.** Text in Lopsy now uses a Rust-side pipeline: cosmic-text for text shaping and layout, swash for unhinted glyph rasterization, and a GPU glyph atlas (1024×1024, etagere shelf-packed) for rendering. Supports TTF, OTF, and WOFF2 (decoded to SFNT via custom Brotli decompressor in `woff2.rs`). Fonts loaded dynamically via `font-loader.ts`; 1700+ Google Fonts available via the font picker. Inter Regular bundled as fallback. Canvas2D `fillText` is no longer in the rendering path.

**What this unlocked:**
- **Cross-browser consistency** — Engine-side rasterization produces identical output regardless of browser.
- **Arbitrary font weights** — cosmic-text accepts any u16 weight, not just 400/700.
- **Resolution-independent rendering** — Glyph atlas with shelf packing renders at arbitrary sizes; no zoom-level blur.
- **Engine-controlled shaping** — cosmic-text uses Advanced shaping (HarfBuzz-equivalent) for proper kerning and complex scripts.

**Remaining text feature gaps** are now independent features, not symptoms of a missing foundation:

| Feature | PS | Affinity | GIMP | Lopsy |
|---|---|---|---|---|
| ~~**Native font handling in engine**~~ | ✓ | ✓ | ✓ | ✓ cosmic-text + swash + GPU glyph atlas; TTF/OTF/WOFF2 |
| **Embedded fonts in saved projects** | ✓ | ✓ | ✓ | ✗ (needs project save format first — Tier 1 #9) |
| ~~**Resolution-independent text**~~ | ✓ | ✓ | partial | ✓ glyph atlas renders at arbitrary size |
| **OpenType features** (ligatures, alternates, contextual) | ✓ | ✓ | ✓ | ✗ (cosmic-text uses Advanced shaping but no per-feature toggle API exposed) |
| **Variable fonts** (weight/width/optical-size axes) | ✓ | ✓ | partial | ✗ (only discrete weights loaded; no variation axis support) |
| **Text on path** | ✓ | ✓ | ✓ | ✗ |
| **Warped text** (arc, bulge, flag, etc.) | ✓ | ✓ | ✗ | ✗ |
| **Baseline shift** | ✓ | ✓ | ✓ | ✗ |
| **Underline / Strikethrough** | ✓ | ✓ | ✓ | ✗ (not on TextLayer type) |
| **Text decoration (upper/lower/title case)** | ✓ | ✓ | ✗ | ✗ |
| **Paragraph / Character styles** | ✓ | ✓ | ✗ | ✗ |
| **Text wrap around shapes** | ✓ | ✓ | ✗ | ✗ |
| **Per-pair kerning adjustment** | ✓ | ✓ | ✗ | ✗ (cosmic-text handles auto kerning; no manual override UI) |

---

### 8. Canvas & Workspace

| Feature | PS | Affinity | GIMP | Lopsy |
|---|---|---|---|---|
| **Artboards** (multiple export regions) | ✓ | ✓ | ✗ | ✗ verified absent (zero code refs) |
| **Navigator panel** (minimap) | ✓ | ✓ | ✓ | ✗ verified absent |
| **Snap to grid / guides** | ✓ | ✓ | ✓ | ✓ verified working (`snapToGrid` in ui-store, Move + Transform) |
| **Snap to layer edges** | ✓ | ✓ | ✓ | ✗ |
| **Canvas rotation** (non-destructive view) | ✓ | ✓ | ✓ | ✗ |
| **Multi-document tabs** | ✓ | ✓ | ✓ | ✗ single document only |
| **Pixel grid at high zoom** | ✓ | ✓ | ✓ | ✗ verified absent (no `pixelGrid` refs) — SPEC claims it but unimplemented |
| **Proof Setup / Soft Proofing** | ✓ | ✓ | ✓ | ✗ |

---

### 9. Color Management & Modes

| Feature | PS | Affinity | GIMP | Lopsy |
|---|---|---|---|---|
| **Channels panel** (R/G/B/A individual view) | ✓ | ✓ | ✓ | ✗ |
| **CMYK mode** | ✓ | ✓ | ✓ | ✗ |
| **Lab color mode** | ✓ | ✓ | ✓ | ✗ |
| **Grayscale document mode** | ✓ | ✓ | ✓ | ✗ |
| **Gamut Warning** (out-of-sRGB highlight) | ✓ | ✓ | ✓ | ✗ |
| **Soft Proofing** | ✓ | ✓ | ✓ | ✗ |
| **Swatches panel** (dedicated, not just recent colors) | ✓ | ✓ | ✓ | ✗ (ColorSwatch component exists but no panel) |
| **Palette import** (ASE, GPL, ACO) | ✓ | ✓ | ✓ | ✗ (in SPEC: future) |

---

### 10. Import / Export

| Feature | PS | Affinity | GIMP | Lopsy |
|---|---|---|---|---|
| **TIFF export** | ✓ | ✓ | ✓ | ✗ |
| **AVIF export** | ✓ | ✓ | ✗ | ✗ |
| **SVG export** (vector layers) | ✗ | ✓ | ✓ | ✗ |
| **Export dialog with format/quality/scale** | ✓ | ✓ | ✓ | ✗ (quick export only, no dialog) |
| **Export per artboard** | ✓ | ✓ | ✗ | ✗ |
| **Save project format** (all layers + metadata) | ✓ | ✓ | ✓ | ✗ (in SPEC, IndexedDB not confirmed) |
| **Auto-save / recovery** | ✓ | ✓ | ✓ | ✗ (in SPEC: future) |
| **Batch export** | ✓ | ✓ | ✓ | ✗ |

---

### 11. Workflow / UX

| Feature | PS | Affinity | GIMP | Lopsy |
|---|---|---|---|---|
| **Actions / Macros** (record + replay) | ✓ | ✓ | ✓ | ✗ |
| **Tool presets** (save tool config) | ✓ | ✓ | ✓ | ✗ |
| **Brush preset panel/library** | ✓ | ✓ | ✓ | partial (BrushModal but no panel) |
| **Gradient preset panel/library** | ✓ | ✓ | ✓ | partial (GradientModal) |
| **Pattern preset panel/library** | ✓ | ✓ | ✓ | partial (pattern-store.ts) |
| **Custom workspaces** (save panel layout) | ✓ | ✓ | ✓ | ✗ |
| **Keyboard shortcut customization** | ✓ | ✓ | ✓ | ✗ (KeyboardShortcutsModal is read-only reference) |

---

## Prioritized Implementation Roadmap

### Tier 1 — Core Editing Gaps (Blocks common workflows)

1. **Dynamic adjustment list on groups** — Replace flat `ImageAdjustments` with `AdjustmentNode[]` on `GroupLayer`. New node types: Color Balance, Gradient Map, Hue/Saturation (non-destructive), Black & White, Photo Filter, Channel Mixer, Invert. UI becomes a reorderable list with per-node toggle. Unblocks: full non-destructive grading.
2. **Group masks** — Wire `GroupLayer.mask` into the compositor (apply mask to group FBO after compositing children, same path as layer masks). `LayerBase.mask` already carries the field; compositor doesn't sample it yet.
3. **Fill Layers** (Solid Color, Gradient, Pattern) — New `LayerType`. *FEATURES.md already lists these but they're not in the type union — bring docs and code into alignment.* GPU fill primitives already implemented.
4. **Feather selection + graduated Magic Wand** — Gaussian blur pass on the selection mask (Feather menu item); change Magic Wand output from binary 0/255 to distance-based falloff so soft selections work without a separate Color Range tool.
5. **Quick Mask Mode** — Toggle to paint selection as red overlay using existing layer-mask machinery and brush tools.
6. **Healing Brush** — Clone stamp variant that blends texture by sampling surrounding context (GPU shader). Cornerstone of photo retouching.
7. **Navigator Panel** — Minimap showing viewport position. Needed for large canvas navigation. New panel.
8. **Export dialog** — Format/quality/scale options in a proper dialog (currently quick-export only). TIFF/AVIF can be added here.
9. **Save/load project format** — Custom JSON+binary blob format persisted to IndexedDB + downloadable file. No project format exists today — only image/PSD/DNG export. Auto-save can land alongside.

### Tier 2 — Workflow Completeness

10. **Quick Selection tool** — Paint-to-select with edge detection (distinct from enhanced Magic Wand).
11. **Pass-through blend mode for groups** — Groups that don't pre-composite before blending.
12. **Multi-select layers** — Add `activeLayerIds: string[]` alongside `activeLayerId`. Verified missing.
13. **Liquify** — Interactive push/pull/twirl warp via accumulating displacement FBO with commit/cancel (PR #194 attempted as destructive paint tool, was rejected).
14. **Underline / Strikethrough** — Add properties to `TextLayer`, render in `text_gpu.rs` using font metrics from cosmic-text. Straightforward now that the native font engine is in place.
15. **Text on path** — Position glyphs along a Bezier path. The glyph atlas + per-glyph positioning in the engine makes this tractable.
16. **Boolean path operations** — Union/subtract/intersect/exclude on path anchors.
17. **Selection → Path** — Trace selection contour to Bezier path (inverse of existing Path → Selection).
18. **Artboards** — Multiple export regions. Verified absent in code.
19. **Canvas rotation** — Non-destructive view rotation (Procreate/GIMP feature, important for drawing).
20. **Snap to layer edges** — Snap to grid + guides already works on Move/Transform; extend to layer edges.
21. **Pixel grid at high zoom** — SPEC claims this (>800% zoom) but no `pixelGrid` reference in code.
22. **Ripple/Wave filter** — PR #202 is essentially complete, just had merge conflicts. Rebase candidate.
23. **Radial symmetry / mandala mode** — PR #183 is essentially complete. Reopen candidate.

### Tier 3 — Advanced / Polish

24. **Channels panel** — View and edit individual R/G/B/A channels.
25. **Swatches panel** — Dedicated panel beyond recent-colors in ColorPanel.
26. **OpenType feature controls** — Expose ligature toggles, stylistic sets, alternates via cosmic-text's shaping API. Foundation is in place; needs UI and API plumbing.
27. **Variable font axes** — Load variable fonts and expose weight/width/optical-size sliders. Requires fontdb variation support.
28. **Warped text** (arc, bulge, flag) — Displace glyph positions via parametric deformation. Engine has per-glyph positioning; needs deformation math + UI.
29. **Baseline shift** — Per-line or per-glyph vertical offset. Add to TextLayer props, apply in text_gpu.rs layout.
30. **Sponge Tool** — Saturate/desaturate brush.
31. **Color Replacement Tool** — Paint color while preserving texture.
32. **Smart Objects** — Embed layer non-destructively (complex; requires virtual layer with source document).
33. **Vector Masks** — Path-based mask (requires intersection of path geometry with layer alpha in compositor).
34. **Perspective Crop** — Crop + correct perspective in one operation.
35. **Soft Proofing / Gamut Warning** — Color management view modes.
36. **Layer color tags** — color-coded layer organization.
37. **Keyboard shortcut customization** — Edit bindings via settings.
38. **Actions/Macros** — Record and replay sequences.
39. **Surface Blur**, **Emboss**, **Spherize/Pinch** — Fill out filter library.
40. **Tile/Offset filter** — PR #265 attempted, see if reopen candidate.
41. **History Brush** — PR #159 attempted; paint from a prior history state.
42. **Paragraph / Character styles** — Named style presets for text properties.
43. **Per-pair kerning adjustment** — Manual kerning override UI on top of cosmic-text's automatic kerning.

---

## Files to Modify for Tier 1

| Feature | Key Files |
|---|---|
| Dynamic adjustment list | `src/types/layers.ts` (new `AdjustmentNode` type, replace `ImageAdjustments` on `GroupLayer`), `src/filters/image-adjustments.ts`, `src/engine-wasm/engine-sync.ts` (`syncGroupAdjustments`), `src/panels/AdjustmentsPanel/`, `engine-rs/.../compositor.rs` |
| Group masks | `engine-rs/.../compositor.rs` (sample group mask FBO after child composite), `engine-rs/.../layer_manager.rs`, `src/engine-wasm/wasm-bridge.ts` |
| Group nesting depth limit | `src/app/store/actions/add-layer.ts` (enforce max depth on group creation), `src/io/psd.ts` (flatten on import beyond depth 2) |
| Fill Layers | `src/types/layers.ts` (new `FillLayer` type), `src/app/store/document-slice.ts`, `src/panels/LayerPanel/`, `engine-rs/.../layer_manager.rs`, **and update FEATURES.md to match reality** |
| Feather selection + graduated Wand | `src/selection/selection.ts`, `src/app/MenuBar/menus/select-menu.ts`, `src/tools/wand/` (graduated output mode), GPU: `engine-rs/.../selection_gpu.rs`, `engine-rs/.../api/fill.rs` (flood fill output) |
| Quick Mask Mode | `src/app/ui-store.ts` (mode flag), `src/panels/LayerPanel/` (toggle UI), `engine-rs/.../compositor.rs` (red overlay rendering — already used for mask edit mode) |
| Healing Brush | New `src/tools/healing/`, new GLSL shader, `engine-rs/.../lib.rs` API surface |
| Navigator Panel | New `src/panels/NavigatorPanel/` |
| Export Dialog | New `src/components/ExportDialog/` + `src/app/MenuBar/menus/file-menu.ts` (extend `ExportFormat` for TIFF/AVIF) |
| Save/Load Project | New `src/io/project.ts`, `src/app/MenuBar/menus/file-menu.ts` |

---

## Verification Status

This plan was verified against the actual codebase (not just SPEC.md or FEATURES.md, which sometimes diverge). Confirmed via direct search:

- **FEATURES.md is partly aspirational** — it lists Adjustment and Fill as layer types, but `src/types/layers.ts` only defines Raster/Text/Shape/Group. The compositor wires per-group adjustments but there are no standalone adjustment/fill layer instances.
- **SPEC.md is also partly aspirational** — it claims pixel grid at high zoom, artboards, 5 gradient types, and 50-step max history. None of these match the code: no pixel grid implementation, no artboards (zero refs), only Linear/Radial gradient, unlimited history.
- **Snap to grid/guides is real** — `ui-store.ts` has `snapToGrid` + toggle, used by Move and Transform. Don't include in gap list.
- **Magic Wand outputs binary 0/255** — confirmed in the flood fill path. The graduated-output enhancement is the simpler answer than a separate Color Range tool.
- **Mesh Warp is interactive but grid-based** (3×3 to 6×6) — different category from Liquify's free-form push/pull/twirl brush.

---

## Recently Completed (removed from gap lists)

These features were identified as gaps in the original analysis but have since been implemented:

- **Native font handling in engine** (was Tier 2 #10) — Implemented via cosmic-text + swash + GPU glyph atlas in `engine-rs/crates/lopsy-wasm/`. Commits: `d25f3b2`, `9bd58e5`. Supports TTF/OTF/WOFF2, 1700+ Google Fonts, resolution-independent rendering. This was the single highest-payoff item on the roadmap — it deletes the entire "architectural gap" in Section 7 and unblocks text-on-path, underline/strikethrough, and other text features as independent items rather than blocked dependencies.
- **Tilt-Shift Blur** (was in Section 4 Filters gap table) — Implemented with interactive canvas overlay: draggable focal boundary lines, circular angle control at document center, floating panel for blur radius + apply/cancel. Cmd-drag snaps angle to 15° increments. Commit: `5b200e7` (feature branch, pending merge to main).
- **Bloom / Soft Glow** — GPU filter with threshold, soft knee, radius, and intensity controls. Commit: `c4545b6` (PR #272, on main).

### Tier 1 Implementation (PRs #277–#290, 2026-05-03)

All 9 Tier 1 items implemented and PRs opened:

- **#277** Quick Mask Mode — paint selections via brush/eraser with red overlay (Q shortcut)
- **#278** Feather Selection + Graduated Magic Wand — Gaussian blur on selection mask + distance-based wand falloff
- **#279** Healing Brush — clone stamp variant with texture-aware color correction
- **#280** Fill Layers — solid color, gradient, and pattern fill layer types
- **#281** Navigator Panel — minimap with viewport tracking and click-to-pan
- **#283** Dynamic Adjustment List — replaces flat ImageAdjustments with reorderable AdjustmentNode[] (14 types)
- **#289** Export Dialog — format/quality/scale options with live preview
- *Project Save/Load — in progress*

### Tier 2 Implementation (PRs #282–#290, 2026-05-03)

- **#282** Selection → Path — marching squares + Douglas-Peucker + Catmull-Rom → Bezier
- **#284** Snap to Layer Edges — magenta alignment guide lines, 5px threshold
- **#285** Canvas Rotation — non-destructive CSS transform with inverse coordinate mapping
- **#286** Pixel Grid — 1px grid at zoom >800%, batched stroke rendering
- **#287** Text Decorations — underline + strikethrough via Rust-side rendering in text_gpu.rs
- **#288** Quick Selection — paint-to-select with Sobel edge detection
- **#290** Multi-Select Layers — Cmd/Shift+click, group selected, delete selected
- **#292** Text on Path — Bezier path walking + per-glyph tangent rotation via Canvas2D
- **#293** Boolean Path Ops — raster-based union/subtract/intersect/exclude with contour tracing
- **#298** Pass-Through Blend — group children blend directly with layers below
- **#300** Liquify — displacement map with push/twirl/bloat/pinch, commit/cancel workflow

### Tier 3 Implementation (PRs #295–#302, 2026-05-03)

- **#295** Layer Color Tags — 7 color tags with context menu + visual indicators
- **#296** Shortcut Customization — editable bindings with conflict detection + localStorage
- **#299** Swatches Panel — named color swatch grid with add/rename/delete
- **#301** Channels Panel — R/G/B/A grayscale thumbnails with visibility toggles
- **#302** Sponge Tool — saturate/desaturate brush with HSL conversion
