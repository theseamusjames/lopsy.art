# Lopsy — Development Rules

Read SPEC.md for the full product specification.

## Additional Guides
- `AGENTS.md` — contributor workflow for AI-assisted PRs (process,
  commit style, what's wanted).
- `e2e/GUIDE.md` — read this before writing any e2e tests.
- `MEMORY.md` — small facts about the codebase worth remembering. Consider adding to this when you discover a helpful technique or fact about the codebase.
- `SKILL.md` — public guide for agents that create images by driving the
  UI (published at `/SKILL.md`, along with `FEATURES.md`; indexed by
  `public/llms.txt`). Its driver and selectors are tested against
  lopsy.art, so update it when you change a label, aria-label or flow it
  relies on.
- `FEATURES.md` — the feature catalog. Describe current behaviour only: no
  bug tracking ("Known defect" notes, issue/PR numbers, "fixed in #N"
  history). Bugs live in GitHub issues; fix history lives in commits and PRs.
- `docs/pixel-data-debt.md` — authoritative tracker for places where
  pixel buffers still live on the JS side, with the migration plan
  for each.

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
  engine/           # JS engine utilities that remain CPU-side: color-space
                    # detection, PixelBuffer / PixelDataManager, bitmap cache,
                    # canvas-ops (wide-gamut ImageData plumbing). Shrinks
                    # as features migrate into engine-wasm/.
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
                    # Adjustment node definitions also live here (see
                    # adjustment-node-utils.ts and the per-type LUT
                    # builders in curves.ts / levels.ts). The Adjustments
                    # UI lives at panels/AdjustmentsPanel/ — there is no
                    # separate src/adjustments/ directory.
  icons/            # Custom SVG icon components (Lucide style)
  styles/           # Global CSS: tokens.css, reset.css, fonts.css
  types/            # Shared TypeScript type definitions
  utils/            # Small pure utility functions
  site/tutorials/   # Static tutorial page generator (pure: parse, render).
                    # Also holds the shared page layout and Markdown subset.
  site/blog/        # Static blog generator (posts, list page, Atom feed).
                    # Both are wired into Vite by scripts/vite-plugin-site.ts.
tutorials/          # Tutorial content: <slug>/index.md + screenshots. Copy
                    # _template/ to start one; see tutorials/README.md.
blog/               # Blog posts: <slug>/index.md + images. Copy _template/
                    # to start one; see blog/README.md.
public/
  fonts/            # Self-hosted woff2 font files
e2e/                # Playwright end-to-end tests
engine/             # Builds the Rust/WASM engine (lop-engine, a git dependency) into src/engine-wasm/pkg
```

## Styling

- **CSS Modules only**. Every component gets a co-located `.module.css` file.
- No inline styles. No CSS-in-JS. No style objects in TypeScript. Exception: a `style` prop may set **CSS custom properties only** (e.g. `style={{ '--menu-x': `${x}px` } as React.CSSProperties}`) to feed runtime-computed values (positions, swatch colors, drag offsets) into module CSS — never direct CSS properties.
- Use CSS custom properties from `src/styles/tokens.css` for all colors, spacing, radii, shadows, font sizes, and z-index values.
- No CSS frameworks (no Tailwind, no Bootstrap, no styled-components).
- Dark theme is the default. Light theme toggles via `.theme-light` on the root element.

## Architecture

- **Separate logic from UI**. Each tool has a pure logic module (`tool.ts`) that is framework-agnostic — no React, no DOM. React components call into the logic module.
- **GPU-first rendering via Rust/WASM**. The rendering pipeline is the Rust engine [Lop Engine](https://github.com/theseamusjames/lop-engine) (its own repository), compiled to WASM via `wasm-pack`. All pixel data lives in GPU textures managed by the Rust engine. JS never touches raw pixels in the render path.
- **State**: Zustand store holds the document model (layers, history, selection, UI). Each frame, `engine-sync.ts` diffs the Zustand state against tracked engine state and pushes only what changed to the WASM engine via typed bridge functions.
- **No backend**. Everything runs in the browser. No API calls for core functionality.
- **Web Workers** for heavy computation (filters, image encode/decode). Keep the main thread free.

## Rust/WASM Engine ([Lop Engine](https://github.com/theseamusjames/lop-engine))

The rendering engine lives in its own repository,
[theseamusjames/lop-engine](https://github.com/theseamusjames/lop-engine),
so other apps can use it. It has two crates:

- `lop-engine-core` — pure Rust, no web dependencies: blend math, brush
  geometry, colour spaces, flood fill, selection masks, compression, PSD /
  DNG / RAF codecs.
- `lop-engine-wasm` — the WebGL2 engine compiled to WASM: the
  `#[wasm_bindgen]` API surface, compositor, layer textures, GPU brushes,
  filters, text, overlays and all GLSL shaders.

Its `CLAUDE.md` documents the engine internals and the invariants for
changing them: crate layout, shaders, the compositor pipeline
(`needs_present` vs `needs_recomposite`), the effect cache (every layer- or
mask-texture writer must call `mark_layer_dirty`), the snapshot store and
the blob formats. Read it before you touch engine code.

Lopsy builds the engine through `engine/`, a one-line `cdylib` crate:

```
engine/
  Cargo.toml   # git dependency on lop-engine-wasm pinned to a release tag; release profile + wasm-opt flags
  Cargo.lock   # pins the exact engine commit and every crate version
  src/lib.rs   # pub use lop_engine_wasm::*;  (re-exports the whole wasm-bindgen API)
```

The crate is named `lopsy-wasm`, so the generated package is
`src/engine-wasm/pkg/lopsy_wasm.*`.

### Build

```bash
npm run wasm:build       # release build → src/engine-wasm/pkg/
npm run wasm:build:dev   # debug build
```

Output goes to `src/engine-wasm/pkg/` (gitignored generated files). The JS bridge in `src/engine-wasm/wasm-bridge.ts` re-exports typed functions from the pkg.

### Changing the engine

1. Make the change in a lop-engine checkout and run its tests
   (`cargo test --workspace`).
2. To try it in Lopsy before releasing, point `engine/` at your checkout
   with a `engine/.cargo/config.toml` (gitignored). Paths are relative to
   `engine/`:
   ```toml
   [patch."https://github.com/theseamusjames/lop-engine"]
   lop-engine-wasm = { path = "../../lop-engine/crates/lop-engine-wasm" }
   ```
   `npm run wasm:build` now builds your checkout. This rewrites
   `engine/Cargo.lock`; don't commit that.
3. To ship it, merge and tag a release in lop-engine, bump `tag` in
   `engine/Cargo.toml`, run `cargo update -p lop-engine-wasm` in `engine/`,
   rebuild, and commit `engine/Cargo.toml` and `engine/Cargo.lock`
   together.

### Data Flow

1. **JS → Engine**: `engine-sync.ts` runs before each frame. It diffs Zustand state against `TrackedState` and calls WASM functions (`addLayer`, `updateLayer`, `uploadLayerPixels`, `setViewport`, etc.) only when values change. `resetTrackedState()` forces a full re-sync (used after undo/redo).
2. **Engine → GPU**: The Rust engine owns all WebGL2 state. Its compositor runs the per-frame pipeline: clear → iterate layers → blend with effects → apply image adjustments → final blit to screen.
3. **GPU → JS**: `gpu-pixel-access.ts` provides `readLayerAsImageData()` and `readLayerCompressed()` for when JS needs pixel data (undo snapshots, content bounds, export).

### Undo/Redo and GPU Textures

- `pushHistory()` flushes pending JS pixel data to GPU, then snapshots each layer by **duplicating its GPU texture** — `snapshotLayerGpu()` blits into a pooled texture and returns an opaque `u32` handle. No readback, no compression. Only layers in `dirtyLayerIds` are re-snapshotted; the rest reuse the previous snapshot's handle when position and raster dimensions are unchanged.
- On undo/redo, `restoreFromGpuSnapshot()` blits the handle back into the layer texture, re-acquiring that texture at the snapshot's size when the dimensions differ. The `EMPTY_HANDLE` sentinel (`0xFFFFFFFF`) restores as a 1x1 transparent upload.
- Snapshot textures live in the engine (`snapshot_textures` + free list) and are freed only by `releaseGpuSnapshot()` / `clearGpuSnapshots()`. Handles held by history are owned by a mark-and-sweep ledger (`app/store/snapshot-ledger.ts`): every undo/redo-stack change releases the handles no stack entry or the last-restored snapshot still references. Never `releaseGpuSnapshot()` a handle once it is in a history entry — the sweep owns it — and never share a handle between history and a holder that releases it itself (the pre-snapshot cache, a Move pre-float, a text pre-edit capture) unless ownership passes to history on push. `__gpuSnapshotCount()` (dev) reports the engine's live snapshot count.
- Layer masks are snapshotted the same way: `snapshotMaskGpu()` / `restoreMaskFromGpuSnapshot()` share the snapshot store, and each pixel snapshot's `maskSnapshots` maps layer id → `{ handle, isDataStale }` (logic in `app/store/mask-history.ts`). Masks untouched since the previous snapshot reuse its handle (`engine-wasm/mask-gpu-dirty.ts`, marked by the mask-writing wasm-bridge wrappers). `layer.mask.data` lags the GPU mask and is refreshed lazily (`app/mask-data-sync.ts`); anything that needs current bytes calls `materializeMaskData()` — never drain mask reads on a pointer-down path.
- `resetTrackedState(engine, { preserveContentRefs: true })` is called after restore so `syncLayers` re-pushes all layer descriptors without re-uploading (possibly lagging) mask bytes over the restored GPU masks; pointer-down mask tools upload only through `uploadLayerMaskIfChanged`.
- The compressed-blob path (`readLayerCompressed()` / `uploadCompressed()`) is **not** part of undo any more; its only callers are the filter and Color-LUT preview commits. Blobs open with a 24-byte geometry header `[crop_x, crop_y, crop_w, crop_h, full_w, full_h]` (all i32 LE) — the crop is local to the texture, not document space — and the u16 variant adds `flags` + `uncompressed_size` for a 32-byte header (flags 0 = raw, 1 = RLE, 2 = LZ4).

### Layer Masks

- Stored as grayscale `Uint8ClampedArray` in the Zustand layer model (`layer.mask`).
- Uploaded to GPU via `uploadLayerMask()`: the bytes go up as an R8 texture and a GPU pass (`mask_expand.glsl`) expands them into the pooled RGBA mask texture (`EngineInner::upload_mask_texture`). The selection mask uses the same path.
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

Tool logic modules must not import React, DOM APIs, or any rendering
code. A small set of pre-rule files still violate this (path/path.ts,
path/boolean-ops.ts, text/render-text-on-path.ts, brush/preset-io.ts)
and are tracked for cleanup — new code must not extend the list.

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
- New components should ship with a Storybook story. A handful of legacy
  components (BrushModal, CanvasSizeModal, ModalHost, etc.) predate this
  rule and are tracked for backfill — see the GitHub issue for the list.
- IMPORTANT: e2e tests should always test the UI, not manipulate the zustand stores directly. When we make UI changes, we update the test for the new UI. This is critical to making sure the UI works as the user would experience it.

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

## Tutorial PRs

- Every PR that adds or changes a tutorial must open with the complete
  final image as the first element of the PR description.

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
- **Diagnosing perf issues**: write a benchmark e2e test that reproduces
  the scenario on a large canvas (4K+), profile with CDP
  (`Profiler.start/stop`), collect per-event timestamps, and analyze
  self-time per function. Fix one bottleneck at a time and re-run the
  same test to verify. See `MEMORY.md` for the full workflow and
  `e2e/brush-perf-6k.spec.ts` for an example.
