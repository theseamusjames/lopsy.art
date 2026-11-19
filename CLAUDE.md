# Lopsy — where to look

Lopsy is a browser-based image editor and the rendering engine it is built
on. This file is the map, and holds the rules that apply everywhere. Each
part has its own `CLAUDE.md` with the rules for working in it: read the
one for the directory you are changing before you change it.

## Where things are

| Path | What it is | Rules |
|---|---|---|
| `apps/lopsy-web/` | The web app: React, TypeScript, Vite. `src/`, `e2e/`, `public/`, the build and test configs, and the site's `tutorials/` and `blog/` | `apps/lopsy-web/CLAUDE.md` |
| `apps/photonamous/` | Photonamous, a photo library and RAW editor on the engine (proof of concept of `docs/photonamous-spec.md`) | `apps/photonamous/CLAUDE.md` |
| `packages/photos-core/` | Photonamous' storage adapters (Google Drive, local folder, memory), library database and import; plain TypeScript | `apps/photonamous/CLAUDE.md` |
| `packages/handoff/` | The postMessage protocol between Lopsy and Photonamous (Edit in Lopsy, Save and Add to Photonamous, Grade in Photonamous); plain TypeScript used by both apps | `apps/photonamous/CLAUDE.md` |
| `packages/ui/` | `@lopsy/ui`, the UI both apps share: design tokens, reset and fonts, the Slider, the Menu and the keyboard and focus helpers; React and CSS Modules (`packages/ui/README.md`) | `apps/lopsy-web/CLAUDE.md` |
| `engine/` | The Rust rendering engine: the engine crate at its top, `core/`, `shaderc/`, and the hosts that embed it (`hosts/wasm` for the browser, `hosts/cli` for the command line) | `engine/CLAUDE.md` |
| `docs/` | Documents about the repository as a whole | — |
| `.github/`, `.githooks/` | CI, deploy and the pre-push hook | — |

What you may be looking for:

- **The product spec**: `apps/lopsy-web/SPEC.md`.
- **The feature catalog**: `apps/lopsy-web/FEATURES.md`. Current behaviour
  only; bugs live in GitHub issues.
- **The guide for agents that drive the UI**: `apps/lopsy-web/SKILL.md`
  (published at `/SKILL.md`).
- **How to write e2e tests**: `apps/lopsy-web/e2e/GUIDE.md`. Read it before
  writing one.
- **What HDR support exists and what it would take to finish**:
  `apps/lopsy-web/docs/hdr-support.md`.
- **The engine migration (WebGL to a pass layer to wgpu) and this layout**:
  `docs/engine-migration-plan.md`.
- **The spec for Photonamous**, a photo library and RAW editor that
  stores originals in the user's Google Drive and hands off to Lopsy:
  `docs/photonamous-spec.md`. Its proof of concept: what it does,
  `apps/photonamous/FEATURES.md`; how to run, test and deploy it,
  `docs/photonamous-setup.md`.
- **Where pixel buffers still live in JavaScript**:
  `docs/pixel-data-debt.md`.
- **Contributor workflow for AI-assisted PRs**: `AGENTS.md`.
- **Small facts about the codebase worth remembering**: `MEMORY.md`.
  Consider adding to it when you discover a helpful technique or fact.

## Commands

Run `npm` scripts from the repository root: the root `package.json` is an
npm workspace whose scripts forward to Lopsy unless the name says otherwise
(`:photos` or `:photonamous` for Photonamous, `:ui` for `packages/ui`).

```bash
npm run dev          # Both apps' dev servers, set up to hand off: Lopsy :5173, Photonamous :5174
npm run dev:lopsy    # One app's dev server alone; also dev:photonamous
npm run build        # Production build (both engine builds, then the app)
npm run test         # Vitest unit tests
npm run test:e2e     # Playwright E2E tests
npm run lint         # ESLint, plus the pixel-debt and GL-debt checks
npm run typecheck    # tsc --noEmit
npm run wasm:build   # Build the engine to WASM. ALWAYS npm run, never wasm-pack directly
npm run wasm:test    # cargo test for the engine
npm run test:ui      # Vitest for packages/ui; also typecheck:ui, lint:ui
```

Tools run directly, not through `npm run` (`npx playwright test`,
`npx tsc`, `npx vitest`), must be run from `apps/lopsy-web/`, where their
configs are. `cargo` is run from `engine/`.

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

## Example Images
Sometimes you'll need example images to test image editing, particularly when working with RAW image formats. 
- For RAF images, I have an open source, free to use library of sample images available at https://github.com/theseamusjames/sample-raf-images.
- Never try to create RAW image for testing. You need real sample images because the file formats vary significantly.
- For other images, you can use https://placecats.com/1920/1080 where 1920 and 1080 are values you can adjust to get a photo in those dimensions.

## Visual design

- Never use a coloured left border (or any edge stripe) as an indicator
  of state or kind. Choose what fits the context instead: a dot beside
  the label, an icon, a check, a fill or a word. `MEMORY.md` has examples.

## Dependencies

- Minimize dependencies. Before adding a package, consider if it can be done in < 50 lines of code.
- Current stack: React, Vite, Vitest, Playwright, Storybook, Zustand, Lucide React, Rust/wasm-pack (engine).
- No CSS frameworks. No UI component libraries (no MUI, Chakra, Radix, etc.).
- UI that more than one app uses lives in `packages/ui` (`@lopsy/ui`): put a
  new shared component there rather than in one app for another to import.
- Fonts: Inter (UI), JetBrains Mono (monospace). Self-hosted woff2 in each
  app's `public/fonts/`, declared in `@lopsy/ui/styles/fonts.css`.
