# Contributing to Lopsy with AI Agents

Lopsy welcomes AI-assisted contributions. This guide explains how the project is organized and how to submit useful work.

## What is Lopsy?

Lopsy is a browser-based image editor at [lopsy.art](https://lopsy.art). Everything runs client-side — there is no server. The rendering pipeline is GPU-accelerated via a Rust/WASM engine using WebGL 2. The UI is built with React and TypeScript. State management uses Zustand.

## Design philosophy

Lopsy is not a clone of any existing software. Do not replicate the UI patterns, terminology, or feature design of Photoshop, GIMP, Figma, or any other specific program. We design for usability first — interfaces should be intuitive and simple, not familiar to users of other tools. If you're adding a feature, think about the clearest way to present it to someone who has never used an image editor before.

## Project layout

The codebase has two main parts: a TypeScript frontend and a Rust rendering engine.

### TypeScript (`src/`)

- `app/` — App shell, menu bar, canvas interaction, and the Zustand store (document model, history, selection, UI state). Store actions live in `app/store/actions/`.
- `tools/` — One directory per tool (brush, eraser, move, shape, text, etc.). Each tool has a pure logic module (`tool.ts`) that handles input and produces document operations, plus an options bar component (`ToolOptions.tsx`). Tool logic must not import React or DOM APIs.
- `components/` — Reusable UI components (Button, Slider, Modal, etc.). One component per directory with a co-located CSS Module and Storybook story.
- `panels/` — Right sidebar panels (Layers, Color, History, Paths, etc.).
- `filters/` and `adjustments/` — Image filter and adjustment implementations.
- `engine-wasm/` — The JS/WASM bridge. `wasm-bridge.ts` wraps WASM exports with typed functions. `engine-sync.ts` diffs Zustand state against engine state each frame and pushes changes. `gpu-pixel-access.ts` handles reading pixel data back from the GPU.
- `layers/`, `history/`, `selection/` — Layer model, undo/redo system, and selection operations.
- `styles/` — Design tokens in CSS custom properties (`tokens.css`). All colors, spacing, radii, and font sizes come from here.

### Rust engine (`engine-rs/`)

Two crates:

- `lopsy-core` — Pure Rust utilities with no web dependencies: blend mode math, brush geometry, color conversions, flood fill, selection masks, pixel buffer operations.
- `lopsy-wasm` — The WebGL 2 engine compiled to WASM. Contains the compositor pipeline, layer texture management, GPU brush/shape/gradient/filter rendering, overlay rendering (grid, rulers, marching ants), and all GLSL shaders.

The WASM bridge exposes functions like `addLayer`, `updateLayer`, `uploadLayerPixels`, `setViewport`, etc. The compositor runs each frame: iterate layers, blend with effects, apply adjustments, blit to screen.

### Pixel data stays on the GPU

All pixel data lives in FP16 (RGBA16F) GPU textures managed by the Rust engine. TypeScript never creates, manipulates, or stores pixel buffers. Any operation that touches pixels — painting, filters, transforms, compositing — must happen in Rust/GLSL. The only time pixel data crosses into JS is for undo snapshots and export, via `gpu-pixel-access.ts`, and even then it's treated as an opaque blob.

Do not introduce `ImageData`, `Uint8ClampedArray`, `Float32Array` pixel buffers, or any per-pixel loops in TypeScript. If your feature needs to read or write pixels, add the operation to the Rust engine and expose it through the WASM bridge.

A small set of known exceptions predates this rule and is tracked in [`docs/pixel-data-debt.md`](docs/pixel-data-debt.md). New code must not introduce new violations. When you remove a violation, update that doc in the same PR.

### Data flow

1. User input hits tool logic, which updates the Zustand store.
2. `engine-sync.ts` diffs the store against tracked state and calls WASM functions for anything that changed.
3. The Rust engine drives WebGL 2 to render the composited result to the canvas.
4. When JS needs pixel data (undo snapshots, export), `gpu-pixel-access.ts` reads it back from GPU textures as opaque blobs.

## How to contribute

### Process

1. **Open a GitHub issue first.** Describe what you want to do and why. For features, explain the user-facing behavior. For bugs, include reproduction steps.
2. **Wait for acknowledgment.** The maintainer may have context that affects your approach.
3. **Submit a PR that references the issue.** Keep PRs focused — one logical change per PR.

### What we're looking for

- **Text handling** — Better text layout, rich text editing, font management, text-on-path.
- **Rust engine improvements** — Performance optimizations, new blend modes, better texture management, memory efficiency.
- **More effects** — Bevel/emboss, pattern overlay, gradient overlay, additional filter types.
- **Better transforms** — Perspective transform, warp/distort, content-aware scaling.
- **Selection improvements** — Pen tool / bezier path selection, magnetic lasso, color range selection.
- **Bug fixes** — Anything you find. Undo/redo edge cases, rendering glitches, memory leaks.
- **Testing** — Unit tests for tool logic, E2E tests for workflows.

### Rules

- **TypeScript only** on the frontend. Strict mode, no `any`.
- **CSS Modules only** for styling. No inline styles, no CSS-in-JS, no frameworks.
- **Separate logic from UI.** Tool logic goes in pure `.ts` files. React components call into them.
- **No new dependencies** without a strong reason. If it can be done in under 50 lines, do it yourself.
- **Unit tests are required** for tool logic and engine utilities. Use Vitest.
- **No TODO comments** — open an issue instead.

### Build and test

```bash
npm install
npm run wasm:build          # Build the Rust/WASM engine
npm run dev                 # Start dev server
npm run test                # Unit tests (Vitest)
npm run typecheck           # tsc --noEmit
npm run lint                # ESLint
npm run test:e2e            # E2E tests (Playwright)
```

The WASM build requires [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/). Use `npm run wasm:build`, not `wasm-pack` directly.

### Commit style

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add brush pressure sensitivity
fix: correct undo positioning for cropped layers
refactor: extract blend mode dispatch to separate module
perf: pre-allocate dab buffer in brush hot path
test: add unit tests for flood fill edge cases
docs: update AGENTS.md with pixel data policy
chore: update wasm-pack to 0.14
style: fix CSS token usage in layers panel
```

- Use a scope when it adds clarity: `feat(brush): add scatter control`.
- Keep the subject line under 72 characters.
- One logical change per commit.
- Branch names: `<your-name>/<short-description>`.
