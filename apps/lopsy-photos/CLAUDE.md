# Lopsy Photos — development rules

A photo library and RAW editor that keeps originals in the user's Google
Drive (or a local folder) and renders edits with the Lopsy engine. This is
a proof of concept of `docs/lopsy-photos-spec.md`; read the spec before
changing the design. The repository's map and the rules that apply
everywhere are in the root `CLAUDE.md`. Running, Google setup, deploying
and testing: `docs/lopsy-photos-setup.md`. What the app does today, feature
by feature: `FEATURES.md` (current behaviour only; keep it up to date when
you change what users see).

## Where things are

| Path | What |
|---|---|
| `apps/lopsy-photos/` | The app: React, TypeScript, Vite |
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

## Commands

```bash
npm run wasm:build:dev     # the engine, once (or after engine changes)
npm run dev:photos         # http://localhost:5174
npm run test:photos        # Vitest: photos-core, then the app
npm run typecheck:photos
npm run lint:photos
npm run test:e2e:photos    # Playwright

# The lopsy.art site: Lopsy at /, Photos at /photos/ (spec 6.3)
npm run build:site         # engine + Lopsy, Photos with PHOTOS_BASE=/photos/, then scripts/assemble-site.mjs into dist/
npm run build:site:noopt   # the same with wasm:build:noopt, where wasm-opt cannot be downloaded
npm run assemble:site      # only the assembly, from both apps' existing dist/
npm run serve:site         # dist/ the way Cloudflare Pages serves it (_redirects, _headers), port 4180
npm run test:e2e:site      # Playwright smoke test of dist/ (playwright.site.config.ts)
npm run test:e2e:offline   # builds Photos alone at /photos/, starts it offline (service worker), cleans up
```

The service worker (`src/sw/`, emitted as `<base>sw.js` by
`scripts/vite-plugin-service-worker.ts`) runs only in production builds.
It precaches the app shell and never handles Google hosts or Drive content.

Photos' `public/_redirects` and `public/_headers` are written for serving
it at `/` on its own domain; `assemble-site.mjs` moves them under
`/photos/`. The Content-Security-Policy is there: a new Google host or
script source goes in `public/_headers`, and `test:e2e:site` fails on
any CSP violation. Production deploys Photos only when the repository
variable `DEPLOY_PHOTOS` is `true` (`.github/workflows/deploy.yml`).
