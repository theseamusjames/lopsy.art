# Photonamous — development rules

A photo library and RAW editor that keeps originals in the user's Google
Drive (or a local folder) and renders edits with the Lopsy engine. This is
a proof of concept of `docs/photonamous-spec.md`; read the spec before
changing the design. The repository's map and the rules that apply
everywhere are in the root `CLAUDE.md`. Running, Google setup, deploying
and testing: `docs/photonamous-setup.md`. What the app does today, feature
by feature: `FEATURES.md` (current behaviour only; keep it up to date when
you change what users see).

## Where things are

| Path | What |
|---|---|
| `apps/photonamous/` | The app: React, TypeScript, Vite |
| `packages/photos-core/` | Storage adapters, the library database, import, export, caches, search, XMP. Plain TypeScript, no React; its tests run in Node |
| `packages/photos-core/README.md` | The maintainer's guide: module map, on-storage format, invariants, undo, untrusted input, testing |
| `packages/photos-core/src/storage/types.ts` | The storage contract every backend implements |
| `packages/photos-core/src/library/types.ts` | The data model and `LibrarySession`, the only way the UI changes the library |
| `packages/photos-core/src/library/recipe.ts` | The edit recipe |
| `packages/photos-core/src/import/types.ts` | Import contracts |

The engine is the wasm package `npm run wasm:build` (or `wasm:build:dev`)
writes into `apps/lopsy-web/src/engine-wasm/pkg/`; this app imports it as
`@lopsy/engine-pkg/…`. Design tokens, the reset and fonts are imported
from `apps/lopsy-web/src/styles/`. Both move to shared packages in Phase 0
of the spec; until then, read them where they are and do not change them
for this app's sake.

## Rules

- Everything in `apps/lopsy-web/CLAUDE.md` under Language & Types,
  Styling, Components, Icons and Code Style applies here too: strict
  TypeScript with no `any`, CSS Modules on the shared tokens, named
  exports, one component per directory, no new dependencies.
- **Storage only through `StorageAdapter`.** Only `storage/google-drive/`
  and `auth/` know about Google. Everything else must work unchanged on
  the local-folder and memory adapters.
- **The library only through `LibrarySession`.** UI code never writes
  journal files or IndexedDB itself.
- **Pixels stay out of TypeScript** (root `AGENTS.md`). Decode and encode
  through browser APIs (`createImageBitmap`, `OffscreenCanvas.convertToBlob`)
  or the engine; no `ImageData` and no per-pixel loops.
- **Originals are never modified or permanently deleted.** Delete means
  the adapter's `trash`.
- **Tests never talk to Google.** Unit tests use the memory adapter or
  the fake Drive in `packages/photos-core`. E2E tests use the local
  adapter in the browser.

## Storybook

Every component has a `.stories.tsx` beside it (`apps/lopsy-web/CLAUDE.md`).
Components that read the library use `src/stories/fake-library.tsx`: the
`?backend=fake` library, seeded and opened in the store, never real
storage. Known gap: `LibraryScreen` (the whole screen, made of storied
parts). `DocumentList`, `DropZone` and `ImportStrip` render nothing until
there is a document, a drag or an import.

## Commands

```bash
npm run wasm:build:dev     # the engine, once (or after engine changes)
npm run dev:photos         # http://localhost:5174
npm run test:photos        # Vitest: photos-core, then the app
npm run typecheck:photos
npm run lint:photos
npm run storybook:photos        # Storybook on port 6007
npm run build-storybook:photos  # static build (storybook-static/; delete it after)
npm run test:e2e:photos    # Playwright

# The production build, as photonamous.com serves it (spec 6.3)
npm run build:photos       # apps/photonamous/dist; the engine must be built first
npm run serve:photos       # that dist/ the way Cloudflare Pages serves it (_redirects, _headers), port 4180
npm run test:e2e:site      # builds, runs site.spec.ts and offline.spec.ts against it (playwright.site.config.ts), cleans up
```

The service worker (`src/sw/`, emitted as `/sw.js` by
`scripts/vite-plugin-service-worker.ts`) runs only in production builds.
It precaches the app shell and never handles Google hosts or Drive content.

Photonamous is served at `/` on its own origin, photonamous.com, by its own
Cloudflare Pages project; Lopsy is on lopsy.art, and the two talk only
through handoff messages. Pages serves `public/_redirects` and
`public/_headers` as written. The Content-Security-Policy is there: a new
Google host or script source goes in `public/_headers`, and
`test:e2e:site` fails on any CSP violation. Production deploys
Photonamous, and Lopsy hands off to it, only when the repository variable
`DEPLOY_PHOTONAMOUS` is `true` (`.github/workflows/deploy.yml`, setup
guide §4).
