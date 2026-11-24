# Photonamous: setup

How to run, test and ship the Photonamous proof of concept. The design is
in `photonamous-spec.md`; the app's rules are in
`apps/photonamous/CLAUDE.md`. Every command runs from the repository root
unless it says otherwise.

## 1. Run it locally, without a Google account

```bash
npm ci
npm run wasm:build          # the engine's WebGL build; or wasm:build:noopt where wasm-opt cannot be downloaded
npm run wasm:build:wgpu     # its WebGPU build, which the app uses where the browser has WebGPU (optional: WebGL without it)
npm run dev:photonamous     # http://localhost:5174 (npm run dev starts Lopsy with it, section 2)
```

The engine build needs Rust and `wasm-pack` (root `CLAUDE.md`). It is
needed once, and again after engine changes.

The dev server's start screen offers, under "Development builds only",
two kinds of storage on this computer. A production build offers neither:
it is Google Drive or nothing, unless it is built with
`VITE_LOCAL_LIBRARIES=true`, as `npm run test:e2e:site` builds it.

- **This browser**: the browser's private file system (OPFS). Nothing is
  visible on disk.
- **A folder on this computer**: a folder you pick (Chromium browsers
  only). It fills with real files laid out like the Drive library:
  `Photonamous/Originals/2026/2026-11-14/…`, plus a hidden
  `.lopsy-storage.json` index and a `.lopsy-trash/` folder.

`http://localhost:5174/?backend=fake` runs the UI on an in-memory library
of 240 generated photos (`&seed=N` for another count). Nothing is saved.

**Where the data lives** (all per origin, so `localhost:5174` is separate
from `photonamous.com`):

| What | Where |
|---|---|
| Files, "This browser" | OPFS folder `photonamous/` |
| Library state and outbox | IndexedDB `photonamous:<kind>:<account or folder name>` |
| The picked folder's handle | IndexedDB `photonamous-folders` |
| Drive upload sessions | IndexedDB `photonamous-uploads:<account>` |
| Downloaded originals and previews (Drive) | OPFS `<Drive's ID for the account>/originals/`, `…/previews/` |
| Last storage used | localStorage `photonamous.last-connection` (for Drive: Drive's ID for the account, never an email) |

**To wipe it:** DevTools > Application > Storage > **Clear site data**,
with the page open at `http://localhost:5174`. Files in a picked folder
stay; delete the folder yourself. Lopsy is on another origin, so its data
is never touched.

## 2. Lopsy and Photonamous together (the handoff)

```bash
npm run dev    # Lopsy on http://localhost:5173, Photonamous on http://localhost:5174
```

`npm run dev` (`scripts/dev.mjs`) starts both dev servers and tells each
the other's URL. The ports are fixed, because each app trusts only the
other's origin: if one is taken, both stop and say which. Ctrl+C stops
both. `npm run dev:lopsy` and `npm run dev:photonamous` start one alone.

Lopsy talks to Photonamous only when its build names Photonamous' URL in
`VITE_PHOTONAMOUS_URL`. Without it (`npm run dev:lopsy`, `npm run build`, and
production while Photonamous is not deployed) Lopsy is exactly as before: File →
Add to Photonamous is hidden and `?photos-handoff=` is ignored. `npm run dev`
sets it to `http://localhost:5174/`, and the deploy workflow to
`https://photonamous.com/` when `DEPLOY_PHOTONAMOUS` is `true` (section 4).
A value in the shell or in `apps/lopsy-web/.env.local` wins over the one
`npm run dev` sets, and keeps the handoff on under `npm run dev:lopsy` too.

| Variable | In | Unset | `npm run dev` | Deployed |
|---|---|---|---|---|
| `VITE_LOPSY_URL` | `apps/photonamous/.env.local` | `http://localhost:5173/` in dev, `https://lopsy.art/` in a build | `http://localhost:5173/` | `https://lopsy.art/` |
| `VITE_PHOTONAMOUS_URL` | `apps/lopsy-web/.env.local` | no handoff | `http://localhost:5174/` | `https://photonamous.com/` |

Both directions run over this channel: Edit in Lopsy and Save to
Photonamous, and Lopsy's Grade in Photonamous, which opens Photonamous at
`?grade=<id>` straight into the Edit view on one layer (no library needed).

Only the configured URL's origin is trusted for handoff messages. The two
apps are on different origins in production (lopsy.art and
photonamous.com), as the two dev servers are on different ports. The
round-trip e2e (`apps/photonamous/e2e/roundtrip.config.ts`) starts both
dev servers with each other's URL set, on 5173 and 5174. Where those are
taken, move both and tell the Grade test where Lopsy is:

```bash
cd apps/photonamous
ROUNDTRIP_LOPSY_PORT=5186 ROUNDTRIP_PHOTOS_PORT=5187 ROUNDTRIP_LOPSY_URL=http://localhost:5186/ \
  npx playwright test -c e2e/roundtrip.config.ts      # Photonamous on WebGPU; PHOTONAMOUS_RENDERER=webgl for WebGL
```

## 3. Google Cloud setup

What the code asks for (`packages/photos-core/src/auth/google-token-source.ts`):
the Google Identity Services token model with one scope,
`https://www.googleapis.com/auth/drive.file`. It does not ask who the user
is. The one thing it reads about the account is Drive's opaque ID for it
(`about.get` with `fields=user(permissionId)`), which keeps one account's
data on a device apart from another's.

1. **Project.** In the Google Cloud console, create a project (for example
   "Photonamous").
2. **APIs.** APIs & Services > Library: enable **Google Drive API** and
   **Google Picker API**.
3. **Consent screen.** APIs & Services > OAuth consent screen (Google Auth
   Platform):
   - User type **External**; app name **Photonamous**, support email,
     developer contact.
   - Authorized domain `photonamous.com`.
   - App domain: home page `https://photonamous.com`, privacy policy
     `https://photonamous.com/privacy`, terms of service
     `https://photonamous.com/terms` (`apps/photonamous/privacy.html` and
     `terms.html`). Google's review wants the policy on the app's own
     domain, linked from the home page (the start screen links to it), at
     the same address as given here.
   - Data access (scopes): `.../auth/drive.file` and nothing else. Remove
     `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile`
     if the project has them from before 2026-11-21: the app no longer
     asks for them. `drive.file` is non-sensitive, so no verification is
     needed for Testing.
   - Publishing status **Testing**. Add every Google account that will
     sign in as a **test user** (at most 100). In Testing, a grant expires
     after seven days.
4. **OAuth client.** Credentials > Create credentials > OAuth client ID,
   type **Web application**. Authorized JavaScript origins:
   - `https://photonamous.com`
   - `http://localhost:5174` (the Photonamous dev server)

   Authorized redirect URIs, for **Add from Google Drive** in a Google
   window (sign-in itself needs none: the token model uses a popup):
   - `https://photonamous.com/drive-picked`
   - `http://localhost:5174/drive-picked`

   Copy the **client ID**. The client secret Google shows is never used:
   keep it out of the app and the repository.
5. **Picker API key.** Credentials > Create credentials > API key, then
   edit it:
   - Application restrictions: **Websites (HTTP referrers)**:
     `https://photonamous.com/*`, `http://localhost:5174/*` **and
     `https://docs.google.com/*`**. The Picker runs in
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

   Restart `npm run dev` or `npm run dev:photonamous`. The start screen now offers **Google
   Drive** too. The library is created as `Photonamous/` in your My Drive.

**The start screen's video** (`apps/photonamous/src/components/DemoReel/`)
is a trailer recorded from the app itself, not edited by hand.
`docs/photonamous-demo-reel.md` says how it is made, what each of its
files is, and how to record it again or change it.

**Add from Google Drive** shows Google's Picker in one of two ways
(`apps/photonamous/src/import/drive-picker.ts` chooses):

- **In the page**, when both `VITE_GOOGLE_API_KEY` and
  `VITE_GOOGLE_APP_ID` are set (`picker.ts` in photos-core). The app ID
  is required with the `drive.file` scope: it is what grants the app the
  files the user picks. This is the quick way: it opens straight onto the
  user's Drive. But the Picker is a frame on docs.google.com that needs
  Google's cookies there, and a browser that blocks cross-site cookies
  gives it none: it shows "Sign in to your Google Account" and no files.
  Brave does this as it comes (seen 2026-11-22).
- **In a Google window** (`picker-window.ts`), always available: a pop-up
  on Google's authorization page with `trigger_onepick=true`, asking for
  `drive.file` alone. The user chooses an account, agrees, and picks;
  Google sends the pop-up to `/drive-picked` with the picked file IDs,
  and that page tells the app's window and closes. Picking is what grants
  the files, so the token the library already has reads them, and the
  authorization code Google also sends is never used. It works in every
  browser and costs the account chooser and consent screen each time.

The page is used first, except in Brave. While the Picker is open in the
page a prompt under it offers the window ("Google asking you to sign
in?"), and taking it is remembered on the device; Settings has the same
choice. **The window is not yet tried against Google** as of 2026-11-22:
it is tested against a stand-in for Google's page.

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
  x-upload-content-length`; `alt=media` reads allow `range`; userinfo (no
  longer called) and `oauth2.googleapis.com/revoke` allow the app's origin. Repeated on
  2026-11-19 from `https://photonamous.com`, with the same answers. Whether a
  successful initiation exposes `Location`, and a 308 exposes `Range`,
  needs a signed-in request: an unauthenticated 401 exposes neither. The
  adapter now gives up with an error, instead of resending a chunk for
  ever, if Drive's progress cannot be read.
- *Google Identity Services*, against `@types/google.accounts` 0.0.18 and
  the live `accounts.google.com/gsi/client`: `initTokenClient` takes
  `client_id`, `scope`, `callback`, `error_callback`, `prompt` (`''`,
  `none`, `consent`, `select_account`) and `login_hint` (an email or the
  account's `sub`; `hint` is deprecated; the app passes none, having
  neither); `hasGrantedAllScopes(response, scope)` exists. The token client opens `accounts.google.com/o/oauth2/v2/auth`
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
- *The Picker in a window*, on 2026-11-22, against Google's guide
  "Integrate the Google Picker into desktop and mobile apps"
  (developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker):
  the authorization URL takes `prompt=consent` and `trigger_onepick=true`
  (both required), `allow_multiple`, `mimetypes`, `file_ids` and
  `allow_folder_selection`; only `drive.file` is permitted, combined with
  no other scope; the answer at the redirect URI carries
  `picked_file_ids`, `code`, `scope`, or `error` when the user cancels.

Still to check with a real account (section 6): `permissions.create` with
`type: anyone` on an app-created folder under `drive.file`, and that files
in a link-shared folder are visible through the link.

## 4. Deploying on Cloudflare

Production deploys run from `.github/workflows/deploy.yml` on every push to
`main`. Lopsy goes to the Pages project `lopsy-art` (lopsy.art), as before.
Photonamous goes to a Pages project of its own at photonamous.com, but only
once you switch it on. Until then nothing in production changes. Set it up
once, in this order:

1. **Create the Pages project.** It is published by the workflow (Direct
   Upload), not by Cloudflare's Git integration. With wrangler, logged in
   to the account that has `lopsy-art`:

   ```bash
   npx wrangler pages project create photonamous --production-branch main
   ```

   Or in the dashboard: Workers & Pages > Create > Pages > **Upload
   assets**, named `photonamous`. The upload can be any placeholder folder,
   since the first workflow run replaces it. Another name works too: set
   the repository variable `PHOTONAMOUS_PAGES_PROJECT` to it.
2. **Add the domain.** The project > **Custom domains** > Set up a custom
   domain > `photonamous.com`. With the domain's DNS on Cloudflare, Pages
   adds the record itself; a bare domain like this one needs its zone on
   Cloudflare. Then send `www.photonamous.com` to it: a proxied DNS record
   for `www`, and a redirect rule (Rules > Redirect Rules > the "Redirect
   from WWW to root" template).

   Use the app only at `https://photonamous.com`. Google sign-in and Lopsy
   trust that origin alone. The `photonamous.pages.dev` address and preview
   deployments load, but cannot sign in to Google or hand off to Lopsy.
3. **The API token.** The workflow deploys with the repository secrets
   Lopsy's deploy already uses, `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID`. The token's **Account > Cloudflare Pages >
   Edit** permission is for every Pages project in the account, so it
   covers the new one.
4. **Google.** Section 3, with `https://photonamous.com` as the JavaScript
   origin and the API key's referrer, and
   `https://photonamous.com/drive-picked` as a redirect URI.
5. **GitHub variables.** GitHub > the repository > Settings > Secrets and
   variables > Actions > **Variables** > New repository variable:
   - `DEPLOY_PHOTONAMOUS` = `true`
   - `PHOTONAMOUS_GOOGLE_CLIENT_ID` = the client ID
   - `PHOTONAMOUS_GOOGLE_API_KEY` = the Picker API key
   - `PHOTONAMOUS_GOOGLE_APP_ID` = the project number

   The Google ones are optional. Without the client ID, Photonamous offers
   local storage only. They are public identifiers, so they are variables,
   not secrets.

   Three more variables are optional, each with a default:

   | Variable | Default | What it sets |
   |---|---|---|
   | `PHOTONAMOUS_PAGES_PROJECT` | `photonamous` | The Pages project the workflow deploys to |
   | `PHOTONAMOUS_URL` | `https://photonamous.com/` | Where Lopsy hands off |
   | `LOPSY_URL` | `https://lopsy.art/` | Where Photonamous hands off |
6. **Deploy.** Run the **Deploy to Cloudflare Pages** workflow (Actions >
   Run workflow), or push to `main`. It first builds and publishes Lopsy,
   with File > Add to Photonamous and Grade in Photonamous pointing at
   photonamous.com. Then it builds and publishes Photonamous. A failing
   Photonamous step never holds Lopsy's deploy back.
7. **Check.**
   - `https://photonamous.com/` shows the start screen, and the DevTools
     console has no CSP errors.
   - A photo's **Edit in Lopsy** opens lopsy.art with the photo.
   - Lopsy's **Save to Photonamous** brings it back.

**Rollback.** Set `DEPLOY_PHOTONAMOUS` to `false` (or delete it) and run
the workflow again. Lopsy is then built without the handoff, exactly as
before. Photonamous keeps its last deployment until you remove its custom
domain or delete the project. Either project can also be rolled back to
an earlier deployment at once (Pages > the project > Deployments).

To see the production build before pushing:

```bash
npm run build:photos        # apps/photonamous/dist; the engine must be built (section 1)
npm run serve:photos        # http://127.0.0.1:4180 (SITE_HOST=0.0.0.0 to share it), served the way Pages serves it
```

## 5. Tests

```bash
npm run typecheck:photos
npm run lint:photos
npm run test:photos                          # Vitest: photos-core, then the app
npm run test -w @lopsy/handoff               # the handoff protocol
npm run test:e2e -w @lopsy/photos-core       # photos-core's browser-only classes in Chromium (Vite harness)
npm run test:e2e:photos                      # the app in Chromium; *.drive.spec.ts run against the fake Drive
npm run test:e2e:site                        # the production build as Pages serves it: headers, deep links, offline start, Edit in Lopsy
cd apps/photonamous && A11Y_REPORT=/tmp/a11y.json npx playwright test e2e/accessibility.spec.ts   # axe-core (WCAG 2.2 AA) on every view; the JSON lists any violation
cd apps/lopsy-web && npx playwright test e2e/photos-handoff.spec.ts --project=chromium   # Lopsy's side of the handoff
```

No test talks to Google: the Drive tests use photos-core's fake Drive.

**Renderers.** The app runs the engine's wgpu build (WebGPU) where the
browser offers WebGPU and its WebGL build otherwise
(`apps/photonamous/src/engine/renderer-choice.ts`). The e2e suite runs on
WebGPU, the app's default; `PHOTONAMOUS_RENDERER=webgl` runs it on WebGL.
The variable sets the dev server's (or a build's) default and the
browser's flags together (`apps/photonamous/e2e/gpu-args.ts`), and
`e2e/renderer.spec.ts` checks the page really runs that build. Both run
headless on SwiftShader. Both engine builds must be current:
`npm run wasm:build` and `npm run wasm:build:wgpu` (Lopsy's `npm run build`
makes both, as the deploy does). Without the wgpu build the app runs WebGL
only, and the suite should then be run with `PHOTONAMOUS_RENDERER=webgl`.

```bash
npm run test:e2e:photos                                  # on WebGPU
PHOTONAMOUS_RENDERER=webgl npm run test:e2e:photos       # on WebGL
PHOTONAMOUS_RENDERER=webgl npm run test:e2e:site         # the production build, made and tested on WebGL
cd apps/photonamous && PHOTONAMOUS_RENDERER=webgl npx playwright test e2e/edit-view.spec.ts   # one spec on WebGL
```

In a browser, `?renderer=webgl` or `?renderer=wgpu` on any page chooses
the build for that page load, for support and for trying one out; a
browser without WebGPU runs WebGL either way. A tab where WebGPU failed to
start keeps to WebGL until it is closed (the `photonamous:renderer-failed`
flag in sessionStorage); open a new tab to try WebGPU again.

**Colour.** Headless Chromium's display is sRGB. `e2e/display-p3.spec.ts`
starts its browser with `--force-color-profile=display-p3-d65`, which gives
it a Display P3 display (`(color-gamut: p3)` matches), and checks that the
canvas becomes Display P3 on either build and that previews and sRGB
exports stay sRGB. It cannot show what a person sees on a real wide-gamut
screen: look at one by eye after a change to colour. `e2e/export-color.spec.ts`
checks each export's tag and that a Rec. 2020 file holds Rec. 2020 numbers.

`test:e2e:site` builds Photonamous without the settings in `.env.local`,
runs `site.spec.ts` and `offline.spec.ts` against the build
(`apps/photonamous/playwright.site.config.ts`), then deletes it. To run one
of them, run its build step yourself, then for example
`npm exec -w photonamous -- playwright test -c playwright.site.config.ts offline.spec.ts`.

**Browsers.** Playwright uses its own Chromium when `npx playwright
install chromium` has installed it. Where a different revision is
preinstalled (some sandboxes and CI images):

- photos-core's browser tests: `PW_CHROMIUM_PATH=<path to chrome or chrome-headless-shell>`.
- The Photonamous app and site tests: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=<path>`,
  or `PLAYWRIGHT_BROWSERS_PATH=<dir>` when that directory has a
  `chromium_headless_shell` link.
- Lopsy's tests have no fallback: point `PLAYWRIGHT_BROWSERS_PATH` at a
  directory where `chromium_headless_shell-<the revision Playwright
  asks for>` is a link to the installed one.

**Ports.** The Photonamous e2e suite starts its own dev servers on 5174 and
5175 and fails if they are taken; `VITE_PORT=<port>` moves them (the
second is `VITE_PORT + 1`). The site test uses 4180; `SITE_PORT` moves it.
Lopsy's suite picks a port from the checkout's path.

The RAF editing test reads real camera files from `LOPSY_RAF_SAMPLES` and
is skipped without it (samples:
https://github.com/theseamusjames/sample-raf-images).

## 6. What needs a real Google account to verify

The code is tested against a fake Drive and a stub of Google sign-in.

**Checked with a real account (2026-11-21, Brave, `http://localhost:5174`,
consent screen in Testing):**

- Sign-in with the four scopes, and the library created as `Photonamous/`
  in My Drive.
- `files.get` on `root` answers 404 ("File not found: <My Drive's ID>")
  under `drive.file`: My Drive is not a file the app may read. The adapter
  no longer asks for it. It creates in My Drive by naming no parent, and
  the fake Drive now answers the same 404.
- The storage quota, a 203 KB import (multipart upload) and a 9.0 MB one.
  The second goes up resumably in two chunks, so the upload's `Location`
  and the 308's `Range` are readable under CORS (part of S1).
- After a reload, **Continue as …** reopened the library with both photos
  and no consent screen.

Not exercised that day: an upload resuming after a reload, the token
refresh near expiry, the Picker, sharing, a RAW file, and the production
CSP.

These still need a real account, in a real browser, before Phase 1
(spec 12, spikes S1 to S3; Appendix A):

- **S1, uploads and CSP.** That the browser can read the resumable upload's
  `Location` header under CORS, and that chunks resume after a reload.
  That the CSP in `apps/photonamous/public/_headers` lets sign-in, the
  Picker and the Drive API through on photonamous.com: watch the console for
  CSP errors. Its `style-src 'unsafe-inline'` is there on the assumption
  that the Picker and the sign-in UI insert inline styles; drop it if
  they work without.
- **S2, the token.** Whether refreshing the token near expiry flashes a
  popup, and how often an unattended import stops for **Reconnect**.
  `getToken` tries a silent refresh (`prompt: 'none'`) in the last five
  minutes, which is untested against Google.
- **S3, `drive.file` and the Picker.** What picking a file or a folder
  grants, and whether a picked file can be moved into the library. Also
  that the Picker in a window (section 3) comes back to `/drive-picked`
  as Google's guide says, for a web client with no code exchange, and
  what Google's own "Sign in" button in the page's Picker does in a
  browser that blocks cross-site cookies.
- **Appendix A facts:** `sha256Checksum` on Drive files (the app compares
  it with its own checksum); the `appProperties` limits (30 per file,
  124 bytes per key plus value; the adapters enforce them); the
  per-user request limits (the Drive adapter paces itself at 10 requests
  a second); the seven-day expiry of Testing grants; `hasGrantedAllScopes`
  catching an unticked Drive box.
- **Real Drive behaviour the fake approximates:** `files.generateIds` with
  a later create (idempotent creates), the 409 on a reused ID, and the
  change feed's tokens.
