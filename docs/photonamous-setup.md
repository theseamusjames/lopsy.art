# Lopsy Photos: setup

How to run, test and ship the Lopsy Photos proof of concept. The design is
in `photonamous-spec.md`; the app's rules are in
`apps/photonamous/CLAUDE.md`. Every command runs from the repository root
unless it says otherwise.

## 1. Run it locally, without a Google account

```bash
npm ci
npm run wasm:build          # the engine; or wasm:build:noopt where wasm-opt cannot be downloaded
npm run dev:photos          # http://localhost:5174
```

The engine build needs Rust and `wasm-pack` (root `CLAUDE.md`). It is
needed once, and again after engine changes.

With no Google client ID configured, the start screen offers two kinds of
storage:

- **This browser**: the browser's private file system (OPFS). Nothing is
  visible on disk.
- **A folder on this computer**: a folder you pick (Chromium browsers
  only). It fills with real files laid out like the Drive library:
  `Lopsy Photos/Originals/2026/2026-11-14/…`, plus a hidden
  `.lopsy-storage.json` index and a `.lopsy-trash/` folder.

`http://localhost:5174/?backend=fake` runs the UI on an in-memory library
of 240 generated photos (`&seed=N` for another count). Nothing is saved.

**Where the data lives** (all per origin, so `localhost:5174` is separate
from `lopsy.art`):

| What | Where |
|---|---|
| Files, "This browser" | OPFS folder `photonamous/` |
| Library state and outbox | IndexedDB `photonamous:<kind>:<account or folder name>` |
| The picked folder's handle | IndexedDB `photonamous-folders` |
| Drive upload sessions | IndexedDB `photonamous-uploads:<account>` |
| Downloaded originals and previews (Drive) | OPFS `<Google account id>/originals/`, `…/previews/` |
| Last storage used, last Google email | localStorage `photonamous.last-connection`, `photonamous.google-email` |

**To wipe it:** DevTools > Application > Storage > **Clear site data**,
with the page open at `http://localhost:5174`. Files in a picked folder
stay; delete the folder yourself. On lopsy.art, clearing site data also
clears Lopsy's own data, because the two apps share that origin.

## 2. Lopsy and Photos together (the handoff)

```bash
VITE_PHOTOS_URL=http://localhost:5174/ npm run dev   # Lopsy, http://localhost:5173
npm run dev:photos                                  # Photos, http://localhost:5174 (a second terminal)
```

Lopsy talks to Photos only when its build names Photos' URL in
`VITE_PHOTOS_URL`. Without it (plain `npm run dev`, `npm run build`, and
production while Photos is not deployed) Lopsy is exactly as before: File →
Add to Lopsy Photos is hidden and `?photos-handoff=` is ignored. The site
build (`npm run build:site`, `build:site:noopt`, and the deploy workflow
when `DEPLOY_PHOTOS` is `true`) sets it to `/photos/`. Put it in
`apps/lopsy-web/.env.local` to keep it on in development.

| Variable | In | Unset | Site build |
|---|---|---|---|
| `VITE_LOPSY_URL` | `apps/photonamous/.env.local` | `http://localhost:5173/` in dev, `/` in a build | `/` |
| `VITE_PHOTOS_URL` | `apps/lopsy-web/.env.local` | no handoff | `/photos/` |

Both directions run over this channel: Edit in Lopsy and Save to Lopsy
Photos, and Lopsy's Grade in Lopsy Photos, which opens Photos at
`?grade=<id>` straight into the Edit view on one layer (no library needed).

Only the configured URL's origin is trusted for handoff messages. The
round-trip e2e (`apps/photonamous/e2e/roundtrip.config.ts`) starts both
dev servers with each other's URL set.

## 3. Google Cloud setup

What the code asks for (`packages/photos-core/src/auth/google-token-source.ts`):
the Google Identity Services token model with the scopes
`openid email profile https://www.googleapis.com/auth/drive.file`, and the
userinfo endpoint for the account.

1. **Project.** In the Google Cloud console, create a project (for example
   "Lopsy Photos").
2. **APIs.** APIs & Services > Library: enable **Google Drive API** and
   **Google Picker API**.
3. **Consent screen.** APIs & Services > OAuth consent screen (Google Auth
   Platform):
   - User type **External**; app name, support email, developer contact.
   - Authorized domain `lopsy.art` (and your own domain if Photos gets
     one).
   - Data access (scopes): `openid`, `.../auth/userinfo.email`,
     `.../auth/userinfo.profile`, `.../auth/drive.file`. All are
     non-sensitive, so no verification is needed for Testing.
   - Publishing status **Testing**. Add every Google account that will
     sign in as a **test user** (at most 100). In Testing, a grant expires
     after seven days.
4. **OAuth client.** Credentials > Create credentials > OAuth client ID,
   type **Web application**. Authorized JavaScript origins:
   - `http://localhost:5174` (the Photos dev server)
   - `https://lopsy.art`
   - your own domain, if Photos is deployed on one.

   No redirect URIs: the token model uses a popup. Copy the **client ID**.
5. **Picker API key.** Credentials > Create credentials > API key, then
   edit it:
   - Application restrictions: **Websites (HTTP referrers)**:
     `http://localhost:5174/*`, `https://lopsy.art/photos/*` (or your
     domain's `/*`) **and `https://docs.google.com/*`**. The Picker runs in
     an iframe on docs.google.com and uses the key from there; without
     that referrer it shows "The API developer key is invalid" (the app
     then reports a Picker error).
   - API restrictions: **Google Picker API** and **Google Drive API**.
6. **App ID.** The **project number** (Dashboard, or IAM & Admin >
   Settings). It is the Picker's app ID.
7. **Local settings.** Copy `apps/photonamous/env.example` to
   `apps/photonamous/.env.local` (git ignores it) and fill in:

   ```bash
   VITE_GOOGLE_CLIENT_ID=<client ID>.apps.googleusercontent.com
   VITE_GOOGLE_API_KEY=<API key>
   VITE_GOOGLE_APP_ID=<project number>
   ```

   Restart `npm run dev:photos`. The start screen now offers **Google
   Drive** too. The library is created as `Lopsy Photos/` in your My Drive.

**Add from Google Drive** (the Picker) is offered when both
`VITE_GOOGLE_API_KEY` and `VITE_GOOGLE_APP_ID` are set. The app ID is
required with the `drive.file` scope: it is what grants the app the files
the user picks.

**What was checked, and how (2026-11-18).** Google's documentation sites
(developers.google.com, .cn) were not reachable from the build machine, so
these were checked against what was:

- *Drive API v3*, against its live discovery document
  (`https://www.googleapis.com/discovery/v1/apis/drive/v3/rest`): every
  parameter the adapter sends exists (`files.list` `q`, `pageSize`,
  `pageToken`, `spaces`; `files.update` `addParents`, `removeParents`;
  `files.generateIds` `count`, `space`, `type`; `changes.list`
  `pageToken`, `pageSize` (max 1000), `includeRemoved`, `spaces`;
  `changes.getStartPageToken`; `permissions.create`/`list`; the global
  `fields` and `alt`), and every field it reads exists (`sha256Checksum`
  and `headRevisionId` for binary files only, `version`, `webViewLink`,
  `appProperties`, `trashed` (also true from a trashed parent), `parents`
  (one per file), `ChangeList.nextPageToken`/`newStartPageToken`,
  `Change.removed`/`file`, `about.storageQuota.limit`/`usage`,
  `Permission` `type: anyone` with `allowFileDiscovery`).
- *CORS*, by live preflight requests from `https://lopsy.art` and
  `http://localhost:5174`: the resumable-upload initiation allows
  `authorization, content-type, x-upload-content-type,
  x-upload-content-length`; `alt=media` reads allow `range`; userinfo and
  `oauth2.googleapis.com/revoke` allow the app's origin. Whether a
  successful initiation exposes `Location`, and a 308 exposes `Range`,
  needs a signed-in request: an unauthenticated 401 exposes neither. The
  adapter now gives up with an error, instead of resending a chunk for
  ever, if Drive's progress cannot be read.
- *Google Identity Services*, against `@types/google.accounts` 0.0.18 and
  the live `accounts.google.com/gsi/client`: `initTokenClient` takes
  `client_id`, `scope`, `callback`, `error_callback`, `prompt` (`''`,
  `none`, `consent`, `select_account`) and `login_hint` (an email or the
  account's `sub`; `hint` is deprecated); `hasGrantedAllScopes(response,
  scope)` exists. The token client opens `accounts.google.com/o/oauth2/v2/auth`
  in a popup and may frame `accounts.google.com/o/oauth2/iframe`; the
  CSP allows both.
- *The Picker*, against `@types/google.picker` 0.0.52 and Google
  Workspace's `@googleworkspace/drive-picker-element` README: `setAppId`
  (the project number, required for `drive.file`), `setOAuthToken`,
  `setDeveloperKey`, `DocsView` with `setIncludeFolders`,
  `setSelectFolderEnabled` and `setMimeTypes`, `Feature.MULTISELECT_ENABLED`,
  and the callback's `picked`, `cancel` and `error` actions. Its example CSP
  adds `frame-src https://drive.google.com` and `font-src
  https://fonts.gstatic.com`, which `public/_headers` now has.

Still to check with a real account (section 6): `permissions.create` with
`type: anyone` on an app-created folder under `drive.file`, and that files
in a link-shared folder are visible through the link.

## 4. Deploying on Cloudflare

Production deploys run from `.github/workflows/deploy.yml` on every push to
`main`, into the existing Pages project `lopsy-art`. Photos is included
only when you switch it on:

1. GitHub > the repository > Settings > Secrets and variables > Actions >
   **Variables** > New repository variable:
   - `DEPLOY_PHOTOS` = `true`
   - `PHOTOS_GOOGLE_CLIENT_ID` = the client ID
   - `PHOTOS_GOOGLE_API_KEY` = the Picker API key
   - `PHOTOS_GOOGLE_APP_ID` = the project number

   The Google ones are optional; without the client ID, Photos offers
   local storage only. They are public identifiers, so they are
   variables, not secrets.
2. Run the **Deploy to Cloudflare Pages** workflow (Actions > Run
   workflow), or push to `main`. It runs `npm run build:site`: Lopsy at
   `/`, Photos at `https://lopsy.art/photos/`.
3. Check `https://lopsy.art/` and `https://lopsy.art/photos/`.

**Rollback:** set `DEPLOY_PHOTOS` to `false` (or delete it) and run the
workflow again. It then builds and publishes Lopsy alone, exactly as
before. Cloudflare's dashboard can also roll back to an earlier
deployment at once (Pages > lopsy-art > Deployments).

To see the deployed site before pushing:

```bash
npm run build:site          # or build:site:noopt where wasm-opt cannot be downloaded
npm run serve:site          # http://127.0.0.1:4180 (SITE_HOST=0.0.0.0 to share it), served the way Pages serves it
```

## 5. Tests

```bash
npm run typecheck:photos
npm run lint:photos
npm run test:photos                          # Vitest: photos-core, then the app
npm run test -w @lopsy/handoff               # the handoff protocol
npm run test:e2e -w @lopsy/photos-core       # photos-core's browser-only classes in Chromium (Vite harness)
npm run test:e2e:photos                      # the app in Chromium; *.drive.spec.ts run against the fake Drive
npm run test:e2e:site                        # smoke test of the assembled dist/ (build it first)
npm run test:e2e:offline                     # Photos' production build started offline (builds, runs, cleans up)
cd apps/lopsy-web && npx playwright test e2e/photos-handoff.spec.ts --project=chromium   # Lopsy's side of the handoff
```

No test talks to Google: the Drive tests use photos-core's fake Drive.

**Browsers.** Playwright uses its own Chromium when `npx playwright
install chromium` has installed it. Where a different revision is
preinstalled (some sandboxes and CI images):

- photos-core's browser tests: `PW_CHROMIUM_PATH=<path to chrome or chrome-headless-shell>`.
- The Photos app and site tests: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=<path>`,
  or `PLAYWRIGHT_BROWSERS_PATH=<dir>` when that directory has a
  `chromium_headless_shell` link.
- Lopsy's tests have no fallback: point `PLAYWRIGHT_BROWSERS_PATH` at a
  directory where `chromium_headless_shell-<the revision Playwright
  asks for>` is a link to the installed one.

**Ports.** The Photos e2e suite starts its own dev servers on 5174 and
5175 and fails if they are taken; `VITE_PORT=<port>` moves them (the
second is `VITE_PORT + 1`). The site test uses 4180; `SITE_PORT` moves it.
Lopsy's suite picks a port from the checkout's path.

The RAF editing test reads real camera files from `LOPSY_RAF_SAMPLES` and
is skipped without it (samples:
https://github.com/theseamusjames/sample-raf-images).

## 6. What needs a real Google account to verify

The code is tested against a fake Drive and a stub of Google sign-in.
These need a real account, in a real browser, before Phase 1
(spec 12, spikes S1 to S3; Appendix A):

- **S1, uploads and CSP.** That the browser can read the resumable upload's
  `Location` header under CORS, and that chunks resume after a reload.
  That the CSP in `apps/photonamous/public/_headers` lets sign-in, the
  Picker and the Drive API through on lopsy.art: watch the console for
  CSP errors. Its `style-src 'unsafe-inline'` is there on the assumption
  that the Picker and the sign-in UI insert inline styles; drop it if
  they work without.
- **S2, the token.** Whether refreshing the token near expiry flashes a
  popup, and how often an unattended import stops for **Reconnect**.
  `getToken` tries a silent refresh (`prompt: 'none'`) in the last five
  minutes, which is untested against Google.
- **S3, `drive.file` and the Picker.** What picking a file or a folder
  grants, and whether a picked file can be moved into the library. Needs
  the Picker wired into the UI first (section 3).
- **Appendix A facts:** `sha256Checksum` on Drive files (the app compares
  it with its own checksum); the `appProperties` limits (30 per file,
  124 bytes per key plus value; the adapters enforce them); the
  per-user request limits (the Drive adapter paces itself at 10 requests
  a second); the seven-day expiry of Testing grants; `hasGrantedAllScopes`
  catching an unticked Drive box.
- **Real Drive behaviour the fake approximates:** `files.generateIds` with
  a later create (idempotent creates), the 409 on a reused ID, and the
  change feed's tokens.
