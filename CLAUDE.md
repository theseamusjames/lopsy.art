# Lopsy — Development Rules

Read SPEC.md for the full product specification.

## Language & Types

- TypeScript only. No `.js` or `.jsx` files. All source is `.ts` or `.tsx`.
- Strict mode (`"strict": true` in tsconfig).
- No `any`. Use `unknown` and narrow, or define proper types.
- Prefer interfaces for object shapes, type aliases for unions/intersections.
- Export types from the file that defines them. Don't re-export from barrel files.

## Project Structure

```
src/
  app/              # App shell, layout, routing (single page)
    store/          # Zustand slices: document, history, selection, UI
      actions/      # Store actions: align-layer, flatten-image, move-layer, etc.
  components/       # Reusable UI components (Button, Slider, etc.)
    ComponentName/
      ComponentName.tsx
      ComponentName.module.css
      ComponentName.stories.tsx
      ComponentName.test.tsx
  panels/           # Right sidebar panels (Layers, Color, History, etc.)
  toolbox/          # Left sidebar tool icons and tool selection
  tools/            # Tool logic — one directory per tool
    brush/
      brush.ts          # Pure logic (no DOM, no React)
      brush.test.ts     # Unit tests for the logic
      BrushOptions.tsx   # Options bar UI for this tool
      BrushOptions.module.css
  engine/           # Legacy JS engine utilities (color-space detection, etc.)
  engine-wasm/      # WASM bridge layer (see Rust/WASM Engine section below)
    engine-state.ts   # Engine lifecycle: create, destroy, get current engine
    engine-sync.ts    # Syncs Zustand state → WASM engine each frame
    gpu-pixel-access.ts  # GPU texture readback/upload helpers
    wasm-bridge.ts    # Typed wrappers around WASM exports
    pkg/              # wasm-pack build output (generated, do not edit)
  layers/           # Layer model, blend modes, masks
  history/          # Undo/redo system
  selection/        # Selection model and operations
  filters/          # Filter implementations (blur, sharpen, noise, etc.)
  adjustments/      # Image adjustment implementations
  icons/            # Custom SVG icon components (Lucide style)
  styles/           # Global CSS: tokens.css, reset.css, fonts.css
  types/            # Shared TypeScript type definitions
  utils/            # Small pure utility functions
public/
  fonts/            # Self-hosted woff2 font files
e2e/                # Playwright end-to-end tests
engine-rs/          # Rust/WASM rendering engine (see below)
```

## Styling

- **CSS Modules only**. Every component gets a co-located `.module.css` file.
- No inline styles. No `style` props. No CSS-in-JS. No style objects in TypeScript. Zero styling logic in `.ts`/`.tsx` files.
- Use CSS custom properties from `src/styles/tokens.css` for all colors, spacing, radii, shadows, font sizes, and z-index values.
- No CSS frameworks (no Tailwind, no Bootstrap, no styled-components).
- Dark theme is the default. Light theme toggles via `.theme-light` on the root element.

## Architecture

- **Separate logic from UI**. Each tool has a pure logic module (`tool.ts`) that is framework-agnostic — no React, no DOM. React components call into the logic module.
- **GPU-first rendering via Rust/WASM**. The rendering pipeline is a Rust crate (`engine-rs/`) compiled to WASM via `wasm-pack`. All pixel data lives in GPU textures managed by the Rust engine. JS never touches raw pixels in the render path.
- **State**: Zustand store holds the document model (layers, history, selection, UI). Each frame, `engine-sync.ts` diffs the Zustand state against tracked engine state and pushes only what changed to the WASM engine via typed bridge functions.
- **No backend**. Everything runs in the browser. No API calls for core functionality.
- **Web Workers** for heavy computation (filters, image encode/decode). Keep the main thread free.

## Rust/WASM Engine (`engine-rs/`)

The rendering engine is split into two crates:

```
engine-rs/
  crates/
    lopsy-core/       # Pure Rust utilities (no web dependencies)
      src/
        blend.rs        # Blend mode math
        brush.rs        # Brush dab geometry
        color.rs        # Color space conversions
        compress.rs     # RLE compression for undo snapshots
        layer.rs        # Layer descriptor types (GlowDesc, ShadowDesc, etc.)
        pixel_buffer.rs # crop_to_content_bounds, pixel utilities
        sparse.rs       # Sparse pixel storage (from_sparse, to_sparse)
        flood_fill.rs   # Bucket fill algorithm
        selection.rs    # Selection mask operations
    lopsy-wasm/       # WebGL2 engine, compiled to WASM
      src/
        lib.rs            # #[wasm_bindgen] API surface — all JS-callable functions
        engine.rs         # EngineInner struct: holds all GPU state
        compositor.rs     # Per-frame compositing pipeline
        layer_manager.rs  # Texture upload/read/duplicate for layers
        brush_gpu.rs      # Brush & eraser dab rendering (GPU)
        clone_stamp_gpu.rs # Clone stamp per-dab rendering
        filter_gpu.rs     # GPU filter dispatch (blur, invert, etc.)
        gradient_gpu.rs   # Linear/radial gradient rendering
        shape_gpu.rs      # Shape rasterization (rect, ellipse, polygon)
        selection_gpu.rs  # Selection mask GPU operations
        dodge_burn_gpu.rs # Dodge/burn tool
        overlay_renderer.rs # Grid, rulers, marching ants, brush cursor
        color_mgmt.rs     # ICC profile, wide-gamut support
        gpu/
          context.rs      # WebGL2 context wrapper, extension detection
          texture_pool.rs # Texture allocation, RGBA8/RGBA16F, upload/read
          framebuffer.rs  # FBO pool for render-to-texture
          shader.rs       # Shader compilation, program linking
          shaders/        # GLSL source files (see below)
```

### Key GLSL Shaders

```
gpu/shaders/
  blend.glsl              # Layer compositing (all blend modes, mask sampling)
  final_blit.glsl         # Composite → screen (viewport transform, EDR passthrough)
  blit.glsl               # Texture-to-texture copy
  brush/
    brush_dab.glsl        # Brush dab with selection mask support
    eraser_dab.glsl       # Eraser dab with selection mask support
    clone_stamp.glsl      # Per-dab clone with bounds checking
    dodge_burn.glsl       # Dodge/burn dab
  effects/
    glow.glsl             # Inner/outer glow (distance field based)
    shadow.glsl           # Drop shadow
    stroke_edt.glsl       # Stroke effect (EDT outline)
    color_overlay.glsl    # Color overlay
  filters/
    adjustments.glsl      # Exposure, contrast, highlights, shadows, whites, blacks
    vignette.glsl         # Vignette effect
    gaussian_blur.glsl    # Two-pass Gaussian blur
    box_blur.glsl         # Box blur
    invert.glsl, hue_sat.glsl, sharpen.glsl, noise.glsl, posterize.glsl, threshold.glsl
  gradient/
    gradient_linear.glsl, gradient_radial.glsl
  selection/
    marching_ants.glsl    # Animated selection outline
```

### Build

```bash
cd engine-rs && wasm-pack build crates/lopsy-wasm --target web --out-dir ../../src/engine-wasm/pkg
```

Output goes to `src/engine-wasm/pkg/` (gitignored generated files). The JS bridge in `src/engine-wasm/wasm-bridge.ts` re-exports typed functions from the pkg.

### Data Flow

1. **JS → Engine**: `engine-sync.ts` runs before each frame. It diffs Zustand state against `TrackedState` and calls WASM functions (`addLayer`, `updateLayer`, `uploadLayerPixels`, `setViewport`, etc.) only when values change. `resetTrackedState()` forces a full re-sync (used after undo/redo).
2. **Engine → GPU**: The Rust engine owns all WebGL2 state. `compositor.rs` runs the per-frame pipeline: clear → iterate layers → blend with effects → apply image adjustments → final blit to screen.
3. **GPU → JS**: `gpu-pixel-access.ts` provides `readLayerAsImageData()` and `readLayerCompressed()` for when JS needs pixel data (undo snapshots, content bounds, export).

### Compositor Pipeline (`compositor.rs`)

Each frame: clear composite FBO → for each visible layer: render behind-effects (outer glow, drop shadow) → blend layer texture onto composite (with mask, blend mode, opacity) → blend active stroke texture → render mask edit overlay → render above-effects (inner glow, stroke) → apply image adjustments (exposure/contrast/vignette) → final blit to screen with viewport transform.

### Undo/Redo and GPU Textures

- `pushHistory()` flushes pending JS pixel data to GPU, then snapshots each layer's GPU texture via `readLayerCompressed()`.
- Compressed blobs use a 24-byte header: `[crop_x, crop_y, crop_w, crop_h, full_w, full_h]` (all i32 LE) + raw cropped RGBA pixels. The crop is local to the texture, not document space.
- On restore, `uploadLayerPixelsCompressed()` reconstructs the full-size texture from the cropped blob, placing content at the correct offset. This ensures the document's layer position (set by `syncLayers`) renders correctly.
- `resetTrackedState()` is called after restore so `syncLayers` re-pushes all layer descriptors.

### Layer Masks

- Stored as grayscale `Uint8ClampedArray` in the Zustand layer model (`layer.mask`).
- Uploaded to GPU as RGBA textures via `uploadLayerMask()`.
- Sampled in `blend.glsl` during compositing: mask value multiplies layer alpha.
- When mask edit mode is active, `compositor.rs` renders a translucent blue overlay.

### Selection Mask

- Selection mask is uploaded to a GPU texture via `setSelectionMask()`.
- Brush, eraser, and pencil shaders sample the selection mask to constrain painting.
- `u_hasSelection` uniform controls whether the mask is checked.

### FP16 / Wide Gamut

- `texture_pool.rs` detects `EXT_color_buffer_float` and uses `RGBA16F` textures when available.
- `engine-state.ts` sets `drawingBufferColorSpace = 'display-p3'` on capable displays.
- `final_blit.glsl` passes values through without clamping for EDR headroom.

## Tools

Each tool follows this pattern:
1. `src/tools/<name>/<name>.ts` — pure logic. Handles input events (as plain data, not DOM events), produces operations on the document model. Fully unit-testable without a browser.
2. `src/tools/<name>/<name>.test.ts` — unit tests for the logic.
3. `src/tools/<name>/<Name>Options.tsx` — React component for the tool's options bar. Reads/writes tool settings via Zustand.
4. `src/tools/<name>/<Name>Options.module.css` — styles for the options bar.

Tool logic modules must not import React, DOM APIs, or any rendering code.

## Components

- One component per directory. Directory name matches component name (PascalCase).
- Every component has a `.stories.tsx` file for Storybook.
- Props interfaces are defined in the component file, not in a separate types file.
- Prefer composition over configuration. Small, focused components over large ones with many props.
- No default exports. Use named exports.

## Icons

- Use Lucide React (`lucide-react`) for standard icons.
- Custom editor icons (brush, eraser, lasso, etc.) go in `src/icons/` as React components.
- Custom icons follow Lucide conventions: 24x24 viewBox, 2px stroke, round linecap/linejoin, no fill.

## Testing

- **Unit tests**: Vitest. Co-located with source files (`foo.test.ts` next to `foo.ts`).
- **E2E tests**: Playwright. Located in `e2e/` directory.
- **Storybook**: Storybook 8+. Stories co-located with components.
- Tool logic must have unit tests. Test the math, not the rendering.
- Every new component needs a Storybook story before it's considered complete.

## Commands

```bash
npm run dev          # Start Vite dev server
npm run build        # Production build
npm run test         # Run Vitest unit tests
npm run test:e2e     # Run Playwright E2E tests
npm run storybook    # Start Storybook dev server
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit

# Rust/WASM engine — ALWAYS use npm run, never call wasm-pack directly
npm run wasm:build
```

## Code Style

- No default exports (except where required by frameworks, e.g. Storybook meta).
- Prefer `const` over `let`. Never use `var`.
- Prefer early returns over nested conditionals.
- Functions should do one thing. If a function is longer than ~40 lines, consider splitting it.
- Name booleans with `is`/`has`/`should` prefixes.
- Name event handlers with `handle` prefix in components (`handleClick`, `handleDrag`).
- Name callbacks passed as props with `on` prefix (`onClick`, `onDrag`).
- No comments explaining *what* code does. Comments only for *why* something non-obvious is done.
- No TODO comments in committed code — use GitHub issues.

## Git

- Branch names: `theseamusjames/<short-description>`.
- One logical change per commit.
- **Semantic commit messages** using the [Conventional Commits](https://www.conventionalcommits.org/) format:
  - `feat: add brush pressure sensitivity` — new feature or capability.
  - `fix: correct undo positioning for cropped layers` — bug fix.
  - `refactor: extract blend mode dispatch to separate module` — code change that doesn't add features or fix bugs.
  - `perf: pre-allocate dab buffer in brush hot path` — performance improvement.
  - `test: add unit tests for flood fill edge cases` — adding or updating tests.
  - `docs: update AGENTS.md with pixel data policy` — documentation only.
  - `chore: update wasm-pack to 0.14` — build, CI, dependency updates.
  - `style: fix CSS token usage in layers panel` — formatting, styling, no logic change.
- Use a scope when it adds clarity: `feat(brush): add scatter control`, `fix(compositor): correct mask sampling order`.
- Keep the subject line under 72 characters. Use the body for details if needed.

## Dependencies

- Minimize dependencies. Before adding a package, consider if it can be done in < 50 lines of code.
- Current stack: React, Vite, Vitest, Playwright, Storybook, Zustand, Lucide React, Rust/wasm-pack (engine).
- No CSS frameworks. No UI component libraries (no MUI, Chakra, Radix, etc.).
- Fonts: Inter (UI), JetBrains Mono (monospace). Self-hosted woff2 in `public/fonts/`.

## Performance

- Never block the main thread with heavy computation. Use Web Workers.
- Rendering hot paths (brush strokes, pan/zoom) must not allocate objects in tight loops — pre-allocate and reuse.
- Lazy-load features that aren't needed on startup (filters, adjustment dialogs, font browser).
- Target: 60fps for pan, zoom, and brush strokes on a 4000x4000 canvas with 20 layers.
