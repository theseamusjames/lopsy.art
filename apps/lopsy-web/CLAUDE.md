# Lopsy web app — development rules

The browser app: React, TypeScript, Vite. Paths in this file are relative
to this directory (`apps/lopsy-web/`). The repository's map and the rules
that apply everywhere (git, dependencies) are in the root `CLAUDE.md`;
the Rust engine's rules are in `engine/CLAUDE.md`.

Read `SPEC.md` for the full product specification.

## Additional Guides
- `e2e/GUIDE.md` — read this before writing any e2e tests.
- `SKILL.md` — public guide for agents that create images through the
  agent page's command API (published at `/SKILL.md`, along with
  `FEATURES.md`; indexed by `public/llms.txt`).
  `e2e/skill-recipes.spec.ts` runs its driver and every recipe against the
  agent page and checks that every command id it names exists, so update
  it in the same change when you rename a command or change what a recipe
  relies on (a param, a refusal, an ambient-state rule).
- `FEATURES.md` — the feature catalog. Describe current behaviour only: no
  bug tracking ("Known defect" notes, issue/PR numbers, "fixed in #N"
  history). Bugs live in GitHub issues; fix history lives in commits and PRs.
- `docs/hdr-support.md` — what HDR the app has (rendering) and what full
  HDR support would need from the engine (editing).
- `docs/ui-surface-differences.md` — operations reachable from more than
  one surface (menu, key, panel, dialog) that do not do the same thing
  there; the `D<n>` ids in the `e2e/surface-*` specs point into it.
- `../../docs/pixel-data-debt.md` — authoritative tracker for places where
  pixel buffers still live on the JS side, with the migration plan
  for each.
- `../../AGENTS.md` and `../../MEMORY.md` — contributor workflow, and small
  facts about the codebase worth remembering.

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
    interactions/
      gesture-session.ts  # Canvas pointer down/move/up state machine, shared by
                          # the canvas hook and the gesture commands
  agent/            # The agent page (agent/index.html, served at /agent/):
                    # the canvas alone, with the command API as window.lopsy
  commands/         # Command registry and the commands, one directory per
                    # family (layer/, filter/, ui/, ...); see Commands below
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
```

The Rust engine is not in this directory: it is `../../engine/`, built
into `src/engine-wasm/pkg/` by `npm run wasm:build`.

## Styling

- **CSS Modules only**. Every component gets a co-located `.module.css` file.
- No inline styles. No CSS-in-JS. No style objects in TypeScript. Exception: a `style` prop may set **CSS custom properties only** (e.g. `style={{ '--menu-x': `${x}px` } as React.CSSProperties}`) to feed runtime-computed values (positions, swatch colors, drag offsets) into module CSS — never direct CSS properties.
- Use CSS custom properties from `src/styles/tokens.css` for all colors, spacing, radii, shadows, font sizes, and z-index values.
- No CSS frameworks (no Tailwind, no Bootstrap, no styled-components).
- Dark theme is the default. Light theme toggles via `.theme-light` on the root element.

## Architecture

- **Separate logic from UI**. Each tool has a pure logic module (`tool.ts`) that is framework-agnostic — no React, no DOM. React components call into the logic module.
- **GPU-first rendering via Rust/WASM**. The rendering pipeline is a Rust crate (`engine/`) compiled to WASM via `wasm-pack`. All pixel data lives in GPU textures managed by the Rust engine. JS never touches raw pixels in the render path.
- **State**: Zustand store holds the document model (layers, history, selection, UI). Each frame, `engine-sync.ts` diffs the Zustand state against tracked engine state and pushes only what changed to the WASM engine via typed bridge functions.
- **No backend**. Everything runs in the browser. No API calls for core functionality.
- **Web Workers** for heavy computation (filters, image encode/decode). Keep the main thread free.

## The engine bridge

The rendering pipeline is the Rust crate in `../../engine/`, compiled to
WASM. What is here is the bridge to it (`src/engine-wasm/`). The engine's
own rules, including how to add a function JS can call, are in
`../../engine/CLAUDE.md`.

### Two builds, one page

`npm run build` builds the engine twice: WebGL (`pkg/`, the default) and
wgpu (`pkg-wgpu/`). `wasm-bridge.ts` imports `./pkg/lopsy_wasm`, which
Vite resolves to a generated module (`scripts/vite-plugin-renderer.ts`,
source in `src/engine-wasm/renderer-selector.ts`) that forwards each call
to the build this page load chose (`renderer-choice.ts`: `?renderer=`,
then View > Renderer, then `LOPSY_RENDERER`, else WebGL). Code that must
differ by backend asks `isWgpuRenderer()` in `engine-state.ts`; there
should be very little of it.

### Data Flow

1. **JS → Engine**: `engine-sync.ts` runs before each frame. It diffs Zustand state against `TrackedState` and calls WASM functions (`addLayer`, `updateLayer`, `uploadLayerPixels`, `setViewport`, etc.) only when values change. `resetTrackedState()` forces a full re-sync (used after undo/redo).
2. **Engine → GPU**: The Rust engine owns all WebGL2 state. `compositor.rs` (in the engine) runs the per-frame pipeline: clear → iterate layers → blend with effects → apply image adjustments → final blit to screen.
3. **GPU → JS**: `gpu-pixel-access.ts` provides `readLayerAsImageData()` and `readLayerThumbnail()` for when JS needs pixel data. Readbacks return a Promise (`asyncReadback` in `wasm-bridge.ts`), which on wgpu resolves a frame or more later: re-read the store after awaiting one, and do not act on state captured before it; when pixels would only come straight back, add an engine command that keeps them on the GPU instead (`flattenIntoLayer`, `bakeLayerEffects`, `clipboardCopyMerged`).

### Undo/Redo and GPU Textures

- `pushHistory()` flushes pending JS pixel data to GPU, then snapshots each layer by **duplicating its GPU texture** — `snapshotLayerGpu()` blits into a pooled texture and returns an opaque `u32` handle. No readback, no compression. Only layers in `dirtyLayerIds` are re-snapshotted; the rest reuse the previous snapshot's handle when position and raster dimensions are unchanged.
- On undo/redo, `restoreFromGpuSnapshot()` blits the handle back into the layer texture, re-acquiring that texture at the snapshot's size when the dimensions differ. The `EMPTY_HANDLE` sentinel (`0xFFFFFFFF`) restores as a 1x1 transparent upload.
- Snapshot textures live in the engine (`snapshot_textures` + free list) and are freed only by `releaseGpuSnapshot()` / `clearGpuSnapshots()`. Handles held by history are owned by a mark-and-sweep ledger (`app/store/snapshot-ledger.ts`): every undo/redo-stack change releases the handles no stack entry or the last-restored snapshot still references. Never `releaseGpuSnapshot()` a handle once it is in a history entry — the sweep owns it — and never share a handle between history and a holder that releases it itself (the pre-snapshot cache, a Move pre-float, a text pre-edit capture) unless ownership passes to history on push. `__gpuSnapshotCount()` (dev) reports the engine's live snapshot count.
- Layer masks are snapshotted the same way: `snapshotMaskGpu()` / `restoreMaskFromGpuSnapshot()` share the snapshot store, and each pixel snapshot's `maskSnapshots` maps layer id → `{ handle, isDataStale }` (logic in `app/store/mask-history.ts`). Masks untouched since the previous snapshot reuse its handle (`engine-wasm/mask-gpu-dirty.ts`, marked by the mask-writing wasm-bridge wrappers). `layer.mask.data` lags the GPU mask and is refreshed lazily (`app/mask-data-sync.ts`); anything that needs current bytes awaits `materializeMaskData()` — never on a pointer-down path. Prefer leaving the mask on the GPU: copy its texture (Duplicate Layer), keep it as a history snapshot (Remove Mask), or mark it stale after a GPU resample (`remapLayerMaskThrough`), where `mask.data` may briefly not match the mask's new size.
- `resetTrackedState(engine, { preserveContentRefs: true })` is called after restore so `syncLayers` re-pushes all layer descriptors without re-uploading (possibly lagging) mask bytes over the restored GPU masks; pointer-down mask tools upload only through `uploadLayerMaskIfChanged`.
- The compressed-blob path (`readLayerBackupBlob()` / `uploadCompressed()`) is **not** part of undo; its only caller is the CPU-side layer backup (`app/gpu-layer-backup.ts`). A filter or Color-LUT preview commit keeps the preview in a GPU snapshot (`commitFilterPreview`). Blobs open with a 24-byte geometry header `[crop_x, crop_y, crop_w, crop_h, full_w, full_h]` (all i32 LE) — the crop is local to the texture, not document space — and the u16 variant adds `flags` + `uncompressed_size` for a 32-byte header (flags 0 = raw, 1 = RLE, 2 = LZ4).

### Layer Masks

- Stored as grayscale `Uint8ClampedArray` in the Zustand layer model (`layer.mask`).
- Uploaded to GPU via `uploadLayerMask()`: the bytes go up as an R8 texture and a GPU pass (`mask_expand.wgsl`) expands them into the pooled RGBA mask texture (`EngineInner::upload_mask_texture`). The selection mask uses the same path.
- Sampled in `blend.wgsl` during compositing: mask value multiplies layer alpha.
- When mask edit mode is active, `compositor.rs` (in the engine) renders a translucent blue overlay.

### Selection Mask

- Selection mask is uploaded to a GPU texture via `setSelectionMask()`.
- Brush, eraser, and pencil shaders sample the selection mask to constrain painting.
- `u_hasSelection` uniform controls whether the mask is checked.

## Tools

Each tool follows this pattern:
1. `src/tools/<name>/<name>.ts` — pure logic. Handles input events (as plain data, not DOM events), produces operations on the document model. Fully unit-testable without a browser.
2. `src/tools/<name>/<name>.test.ts` — unit tests for the logic.
3. `src/tools/<name>/<Name>Options.tsx` — React component for the tool's options bar. Reads/writes tool settings via Zustand.
4. `src/tools/<name>/<Name>Options.module.css` — styles for the options bar.

Tool logic modules must not import React, DOM APIs, or any rendering
code. A small set of pre-rule files still violate this
(path/boolean-ops.ts, text/render-text-on-path.ts, brush/preset-io.ts)
and are tracked for cleanup — new code must not extend the list.

## Commands (`src/commands/`)

A command is a named operation with validated params:
`defineCommand({ id, summary, surface, params, run })` in a family's
module registers it with the registry (`registry.ts`). Each has a
`surface`. `document` commands are what API callers are offered
(`describeCommands('document')`): they take explicit params and return a
result. `ui` commands (`src/commands/ui/`, ids `ui.*`) do what a menu item
does that is not a document edit (open a dialog, toggle a view setting,
zoom, prompt, download, open a file picker), so a menu can bind them.

**The UI starts commands; it does not call the stores.** Every menu item
(`commandItem` in `src/app/MenuBar/menus/`), every global key handler
(`src/app/shortcuts/key-bindings.ts`, through `runKeyCommand`), the
dialogs' Apply buttons where a command is exactly what the dialog does,
and the Layers panel toolbar buttons call `invokeFromUi(id, params)`.
`menus.test.ts` (in `src/app/MenuBar/menus/`) requires every menu leaf to
name a registered command, and a `document` command only where it runs
what the item does. `src/app/shortcuts/key-bindings.test.ts` requires every
key handler to be bound to a command or exempt with a reason. A new menu
item, key or toolbar button gets a command (or a key exemption in that
table), never a direct store call.

**`run` does its work before its first `await`.** `window.confirm`, a
file-input click, `window.open` and system-clipboard writes only work
inside the user's click, and a key's undo must apply in the key's tick,
so the registry starts `run` synchronously in the caller's tick (`start`
is deliberately not `async`).

**Settling.** For an API call (`run`, `runInvocation`, `runAll`), after
`run` the registry waits for the engine to settle (`settled.ts`): a pass
of the render loop that rendered nothing with no readback parked and no
deferred layer crop pending (`deferred-crop-on-switch.ts`), or 30 passes
in a row that rendered with none of those outstanding (something, such as
the pointer over the canvas, keeps the canvas dirty). It rejects
`unavailable` while the graphics context is lost; on the same path, a
preflight (`setPreflight`, wired in `index.ts` to `gpuContextPreflight`
in `context.ts`) refuses a call before `run` while an engine exists and
its context is lost. `start`, the UI's path, consults neither, so a menu
item or key still runs its function then. It only waits: it never runs a crop or a readback
itself. `settles` changes this: `false` for commands that never touch the
document or the engine, only tool settings, colours, guides or the UI
(zoom, view toggles, `color.*`, `tool.*`, `guide.*`), which must work with
no document open; `'before'` for read-only commands that must see what
earlier commands left. A `'before'` command starts after a wait, so it
must never be bound to a user gesture, and it gives a `check` that
rejects at once when the wait could never end (no document open). The UI
does not settle: `invokeFromUi` starts the command with
`start(id, params, { settle: false })`, since nothing in the UI waits for
a command and a key on auto-repeat would stack the waits up.

When the wait after a command's own work times out, the work has
happened: the registry rejects with code `'unsettled'`, the command's
result on the error's `result`, and a message saying not to run it
again. `runAll` puts the results of the steps that completed before a
failure on the error's `completed`; when a step throws something that is
not a `CommandError` (a bug), it rejects with a `StepFailure` carrying the
same, the step's `index` and the original as `cause`.

**Wrap, never re-implement.** A command calls the same function the UI
calls, so the two cannot drift; when that function lives in a component
or hook, it moves to a plain module first. Where that function does work even
when there is nothing to do (Undo finalizes a pending stroke, Select >
Inverse commits a live Move float, Merge Down flushes layer data), the
command calls it first and refuses afterwards; a refusal checked first
would skip that work.

**Refusals.** A command refuses by throwing a `CommandError`. A guard that
can refuse returns a `Refusal` (`refusal.ts`: the reason and the `notice`
the UI shows, `'info'`, `'error'` or `null` for silent);
`refusalError(refusal)` turns it into the error. `invokeFromUi` toasts a
`CommandError` as its `notice` asks and swallows it; anything else is a
bug and propagates. The user sees exactly one toast: when the wrapped
function has already toasted, the command throws with `notice` null;
when the command refuses before calling it, it carries the notice the
UI's own refusal had.

**Ambient state.** Tool options and colours are set by their own commands
(`tool.set`, `color.set`, `tool.select`) and read by the commands that
paint, fill and select, as the options bar and Color panel are read by
the tools. Do not add per-call overrides of them.

**Gestures.** Commands that drive a tool (`paint.stroke`, `tool.gesture`,
`layer.move`, the selection tools) go through `runGesture`
(`src/commands/gesture/run-gesture.ts`), which feeds
`gestureDown`/`gestureMove`/`gestureUp` in
`src/app/interactions/gesture-session.ts`, the same dispatcher the canvas
pointer uses. Never call a tool's handlers directly. `runGesture` refuses
while a Liquify, Tilt-Shift or Mesh Warp session is open (they would take
the press), and once the press has landed it always releases and clears
the interacting flag, even when a move throws. Document coordinates and
offsets in params use the shared specs in `context.ts`
(`coordinateSpec`, `boundedPointSpec`, `offsetSpec`, `extentSpec`), which
bound them to the largest document's side beyond each edge: an unbounded
point can hang a tool's interpolation. A key from a caller's `record`
param is looked up with `ownEntry` / `hasOwnKey`, never `table[key]` or
`key in table`, which find Object.prototype's names.

**Imports.** Command modules import stores and plain modules, never
React components or hooks: they must run with no UI mounted.

### Adding a command

1. Define it in its family's module (`src/commands/<family>/<family>.ts`,
   or a new file in that directory). The id is dotted lowercase,
   `family.name` with hyphenated words (`filter.gaussian-blur`); the
   registry rejects anything else. `params` is a schema of `ParamSpec`s
   (`params.ts`: number, string, boolean, color, point, array, object,
   record); the registry validates calls against it, and `run` receives
   the typed result. The `summary` is one sentence an agent reads: say
   which UI surface it matches, its history label and what it returns.
2. A new module is imported for its side effect in
   `src/commands/index.ts`, and the id goes in the full id list that
   `e2e/api/document.spec.ts` checks.
3. Tests: a unit test beside the module; an API spec in `e2e/api/` that
   fails if the command does nothing, and one per refusal; and, where a
   UI surface does the same operation, a comparison spec
   (`compareUiAndApi`). `e2e/GUIDE.md` describes all three.

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
- Specs under `e2e/api/` are the one exception: they test the command
  API, and are the only specs that may call it (`window.__lopsyCommands`,
  through `e2e/api/harness.ts`). Every other spec drives the UI.
- The `e2e/surface-*.spec.ts` characterization specs pin what each menu
  item, key handler and Layers-panel control does. When you change one of
  those behaviours on purpose, update its spec in the same change, and
  `docs/ui-surface-differences.md` if the change touches an entry there.

## Commands

Every `npm run` script works from here or from the repository root, which
forwards to this package. Tools run directly (`npx playwright test`,
`npx tsc`, `npx vitest`) must be run from this directory: the configs are
here.

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
npm run wasm:build:wgpu   # the wgpu backend, into src/engine-wasm/pkg-wgpu. A page loads it for
                          # /?renderer=wgpu, or every page does with LOPSY_RENDERER=wgpu

LOPSY_RENDERER=wgpu npm run test:e2e   # the e2e suite on the wgpu build
LOPSY_GPU=hardware npx playwright test e2e/brush-perf-6k.spec.ts   # on the real GPU, either renderer
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

## Tutorial PRs

- Every PR that adds or changes a tutorial must open with the complete
  final image as the first element of the PR description.

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
