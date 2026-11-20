---
name: lopsy
description: >
  Make images with Lopsy (https://lopsy.art), a free, open-source image editor
  that runs entirely in the browser: layers, masks, blend modes, layer effects,
  gradients, brushes, shapes, text with Google Fonts, filters, adjustments and
  PNG/JPEG/WebP export. Its agent page runs every editing operation as a named
  command with checked parameters. Use this when you need to make a poster,
  illustration, logo, cover, social image or any other raster artwork
  programmatically, from a browser you control with Playwright.
---

# Making images with Lopsy

Lopsy is an image editor that runs entirely in the browser. Its **agent page**,
<https://lopsy.art/agent/>, shows the document canvas and nothing else: no
menus, panels or tools to click. You make an image by calling commands on it,
through `window.lopsy`, from a browser you control with Playwright. There is
no backend and no account: the image is made in that browser tab, and you
take the files away with export and save commands.

This file covers everything you need to do that reliably:

1. [Setup](#setup): install Playwright, save the driver, start it.
2. [The loop](#the-loop): plan, build in stages, look, checkpoint, export.
3. [The contract](#the-contract): invocations, results, errors, coordinates,
   layers, and the ambient state every painting command reads.
4. [Command families](#command-families): what there is, and how to read the
   full parameter list.
5. [Recipes](#recipes): tested invocation lists for shapes, light, gradients,
   brushes, type, effects, filters, masks, adjustments, transforms and a
   complete poster.
6. [What the API does not offer](#what-the-api-does-not-offer).
7. [Behaviours worth knowing](#behaviours-worth-knowing).

Related resources:

- **Feature catalog:** <https://lopsy.art/FEATURES.md>. It's long and
  exhaustive: every tool, filter, effect and adjustment, and exactly how each
  behaves. The commands do what the editor's UI does, so it describes them too.
- **Driving the editor's UI instead:** <https://lopsy.art/SKILL-UI.md>, for
  testing the UI as a person uses it and for the few things the command API
  does not offer.
- **Index for agents:** <https://lopsy.art/llms.txt>
- **Tutorials** (step-by-step compositions made in Lopsy): <https://lopsy.art/tutorials/>
- **Source:** <https://github.com/theseamusjames/lopsy.art>. Open issues list
  current bugs, so search them when something looks wrong.
- **Contributing:** we accept pull requests written by AI agents. If you hit a
  bug or a missing command, you're welcome to fix it: read
  [AGENTS.md](https://github.com/theseamusjames/lopsy.art/blob/main/AGENTS.md)
  for the workflow first.

## Setup

You need Node 18+ and Playwright's Chromium.

```bash
mkdir lopsy-work && cd lopsy-work
npm init -y
npm install --save-exact playwright@1.58.2
npx playwright install chromium
```

Save [the driver](#the-driver) below as `lopsy-driver.mjs`, then start it
in the background and leave it running for the whole session:

```bash
node lopsy-driver.mjs > driver.log 2>&1 &
```

It opens <https://lopsy.art/agent/> headless and listens on
`http://127.0.0.1:47391`. It is **local-only**: it listens on the loopback
interface and refuses any request a web page makes, so only programs on your
machine can use it. Do not expose its port (no tunnel, port forward or proxy).
Useful environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `LOPSY_URL` | `https://lopsy.art/agent/` | Point at a local dev server instead (`http://localhost:5173/agent/`). |
| `DRIVER_PORT` | `47391` | Change if the port is taken. |
| `OUT_DIR` | `./lopsy-out` | Where renders, exports and projects are written. `$file` can read from here and from the directory the driver runs in. |
| `HEADED` | unset | `1` shows the browser window. Keep the agent page the visible tab (see [the contract](#the-page-must-be-the-visible-tab)). |
| `REAL_GPU` | unset | `1` uses the GPU instead of SwiftShader (on Linux through ANGLE's GL/EGL backend). Much faster on a machine with a GPU. |

### The driver

The driver keeps **one** page open for the whole session, so the document
lives between your requests, and turns HTTP into calls to `window.lopsy`:

- `POST /run` with a JSON body, one invocation or an array of them, runs it
  and answers with the result envelope as JSON.
- Any `base64` field in a result (renders, exports, saved projects) is written
  to `OUT_DIR` and replaced by `file`, the path it went to, so image bytes
  never land in your context. `POST /run?name=poster` names those files
  `poster-NNN.png`; a name is a plain file name (letters, digits, `-`, `_`,
  `.`), never a path.
- The other way round, `{ "$file": "path" }` anywhere in a request is
  replaced by that file's bytes as base64, for `doc.open` and
  `layer.add-image`. A relative path is relative to the directory the driver
  runs in, and the file must be inside that directory or `OUT_DIR` (after
  following symlinks): copy anything else in first.
- A failure comes back with the page's console errors since the request
  began, as `consoleErrors`. What the driver itself refuses (a body that is
  not JSON, a `$file` outside those directories, a bad `name`) comes back as
  HTTP 400 with code `driver`, before anything runs; HTTP 500 with code
  `driver` means the browser or the driver itself failed (see `driver.log`).
- `GET /describe` lists every command with its one-sentence summary;
  `GET /describe?op=layer.effects` returns one command's full parameter
  schema; `GET /describe?family=filter` every command in a family.
- `POST /quit` closes the browser and stops the driver.

Tested against lopsy.art with Playwright 1.58.2. Save it as `lopsy-driver.mjs`.

<!-- driver: lopsy-driver.mjs -->
```js
// lopsy-driver.mjs — keeps ONE Lopsy agent page open and runs the commands POSTed to it.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const LOPSY_URL = process.env.LOPSY_URL ?? 'https://lopsy.art/agent/';
const PORT = Number(process.env.DRIVER_PORT ?? 47391);
const OUT = process.env.OUT_DIR ?? './lopsy-out';
fs.mkdirSync(OUT, { recursive: true });
// $file reads only from these: the directory the driver runs in, and OUT_DIR.
const READABLE = [process.cwd(), OUT].map((dir) => fs.realpathSync(dir));

// SwiftShader makes WebGL2 work on any headless/CI machine; a real GPU is much
// faster. Headless Chromium on Linux falls back to SwiftShader unless ANGLE is
// told to use the GPU's GL driver; elsewhere no flags pick the GPU.
const GPU_ARGS = process.platform === 'linux' ? ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'] : [];
const browser = await chromium.launch({
  headless: process.env.HEADED !== '1',
  args: process.env.REAL_GPU === '1' ? GPU_ARGS : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
let consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
await page.goto(LOPSY_URL);
await page.waitForFunction(() => !!window.lopsy, null, { timeout: 60000 });
const RENDERER = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  return gl ? String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'no WebGL2';
});
console.log(`renderer: ${RENDERER}`);
if (process.env.REAL_GPU === '1' && /SwiftShader/i.test(RENDERER)) {
  console.log('warning: REAL_GPU=1 but the browser fell back to SwiftShader; adjust GPU_ARGS (see SKILL.md)');
}

// Image and project bytes never come back to you: each `base64` field in a
// result is written to OUT_DIR and replaced by `file`, the path it went to.
let fileN = 0;
function saveFiles(value, name) {
  if (Array.isArray(value)) return value.map((v) => saveFiles(v, name));
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    if (key === 'base64' && typeof v === 'string') {
      const ext = plainName(String(value.ext ?? String(value.mime).split('/').pop()), 'the file extension');
      fileN += 1;
      const file = path.join(OUT, `${name}-${String(fileN).padStart(3, '0')}.${ext}`);
      fs.writeFileSync(file, Buffer.from(v, 'base64'));
      out.file = file;
    } else {
      out[key] = saveFiles(v, name);
    }
  }
  return out;
}
// The other way: { "$file": "path" } anywhere in a request is replaced by that
// file's bytes as base64, for doc.open and layer.add-image.
function loadFiles(value) {
  if (Array.isArray(value)) return value.map(loadFiles);
  if (value === null || typeof value !== 'object') return value;
  if (typeof value.$file === 'string') return fs.readFileSync(readablePath(value.$file)).toString('base64');
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, loadFiles(v)]));
}
class DriverError extends Error {}
function readablePath(file) {
  let real;
  try { real = fs.realpathSync(file); } catch (err) { throw new DriverError(`$file ${file}: ${err.message}`); }
  if (READABLE.some((dir) => real === dir || real.startsWith(dir + path.sep))) return real;
  throw new DriverError(`$file ${file} is outside the driver's directory and OUT_DIR: copy it into one of them`);
}
// A name from a request becomes part of a file name in OUT_DIR, never a path.
function plainName(name, what) {
  if (/^[\w.-]+$/.test(name) && !name.includes('..')) return name;
  throw new DriverError(`${what} ${JSON.stringify(name)} must be letters, digits, '-', '_' and '.', with no path in it`);
}

// GET /describe: one line per command. ?op=layer.effects: that command's full
// schema. ?family=filter: every filter command's.
async function describe(query) {
  const all = await page.evaluate(() => window.lopsy.describe());
  const op = query.get('op');
  const family = query.get('family');
  if (op) return all.find((c) => c.id === op) ?? { error: `no command ${op}; GET /describe lists them` };
  if (family) return all.filter((c) => c.id.startsWith(`${family}.`));
  return all.map((c) => `${c.id}: ${c.summary}`).join('\n') + '\n';
}

// Only this machine may use the driver. It listens on 127.0.0.1, and refuses a
// request addressed to any other host name (a web page reaching it by DNS
// rebinding) or sent by a web page (browsers add Origin or Sec-Fetch-Site).
const HOSTS = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
function isFromThisMachine(req) {
  const site = req.headers['sec-fetch-site'];
  return HOSTS.includes(req.headers.host) && req.headers.origin === undefined
    && (site === undefined || site === 'none' || site === 'same-origin');
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  // Decoded once: a character split between two chunks would not survive decoding each.
  const body = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(body); } catch (err) { throw new DriverError(`the body is not JSON: ${err.message}`); }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const send = (status, body) => {
    const isText = typeof body === 'string';
    res.writeHead(status, { 'content-type': isText ? 'text/plain' : 'application/json' });
    res.end(isText ? body : JSON.stringify(body, null, 1) + '\n');
  };
  if (!isFromThisMachine(req)) return send(403, 'refused: the driver serves only requests from this machine, not web pages\n');
  const route = `${req.method} ${url.pathname}`;
  try {
    if (route === 'GET /describe') return send(200, await describe(url.searchParams));
    if (route === 'POST /quit') {
      send(200, 'bye\n');
      await browser.close();
      process.exit(0);
    }
    if (route !== 'POST /run') return send(['/run', '/quit', '/describe'].includes(url.pathname) ? 405 : 404, 'POST /run, POST /quit, GET /describe\n');
    // POST /run?name=poster names the files this request writes poster-NNN.<ext>.
    const name = plainName(url.searchParams.get('name') ?? 'out', 'name');
    const invocation = loadFiles(await readJson(req));
    consoleErrors = [];
    const outcome = saveFiles(await page.evaluate((inv) => window.lopsy.run(inv), invocation), name);
    if (!outcome.ok && consoleErrors.length > 0) outcome.consoleErrors = consoleErrors;
    send(200, outcome);
  } catch (err) {
    if (err instanceof DriverError) return send(400, { ok: false, error: { code: 'driver', message: err.message } });
    send(500, { ok: false, error: { code: 'driver', message: String(err?.stack ?? err) }, consoleErrors });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`lopsy driver on http://127.0.0.1:${PORT} → ${LOPSY_URL}`));
```

Send a stage as a JSON file:

```bash
cat > steps/01-sky.json <<'EOF'
[
  { "op": "doc.new", "width": 1200, "height": 800 },
  { "op": "layer.set", "name": "Sky" },
  { "op": "tool.set", "tool": "gradient", "options": { "type": "linear",
    "stops": [{ "position": 0, "color": "#1b2a4a" }, { "position": 1, "color": "#f2a541" }] } },
  { "op": "paint.gradient", "from": { "x": 600, "y": 0 }, "to": { "x": 600, "y": 800 } },
  { "op": "view.render", "maxSize": 800 }
]
EOF
curl -s --data-binary @steps/01-sky.json 127.0.0.1:47391/run
```

Always send files with `--data-binary @file`: `--data` strips newlines, and
shell quoting mangles JSON. The answer's last result holds
`"file": "lopsy-out/out-001.png"`: open that image and look at it.

## The loop

A finished piece takes dozens to hundreds of commands. Don't send one giant
list and rerun it from the top whenever something is off. Work in stages on
the one document the driver keeps open:

1. **Plan before you touch the editor.** Decide the concept, the document
   size, a palette of 4–8 hex colours, and the layer stack from back to front,
   with a name for each layer. Compute geometry in code (polygons, curves,
   grids, text positions) so shapes line up exactly.
2. **Build in stages**, one request per stage (background, main shapes,
   detail, type, effects, finishing), each a batch of related commands. Put
   every element on its own layer, so it can be moved, recoloured or given
   effects later.
3. **Look after every stage.** End each batch with
   `{ "op": "view.render", "maxSize": 800 }` and open the PNG it wrote. Check
   that the stage did what you intended before you send the next one. Most
   mistakes are cheap to undo straight away (`history.undo`) and expensive to
   find later. `view.render-layer` shows one layer alone, and `view.sample`
   reads one pixel's colour; `doc.info` lists the layers, the selection, the
   colours, the active tool and the history.
4. **Checkpoint** after each stage that took real work:
   `POST /run?name=checkpoint` with `{ "op": "doc.save" }` writes a `.lopsy`
   project. If the page is reloaded or something goes wrong, reopen it:

   ```json
   { "op": "doc.open", "base64": { "$file": "lopsy-out/checkpoint-007.lopsy" }, "name": "checkpoint.lopsy" }
   ```

   A reopened project keeps its layers, masks, effects, text, adjustments,
   paths and guides, and starts a fresh undo history.
5. **Export** with `{ "op": "doc.export", "format": "png" }` (or `jpeg`,
   `webp`, `bmp`) and look at the exported file itself.
6. **Quit the driver** when you're done: `curl -s -X POST 127.0.0.1:47391/quit`.

## The contract

### Invocations and batches

An invocation is a JSON object: `op` names the command and every parameter
sits beside it.

```json
{ "op": "select.rect", "x": 40, "y": 40, "width": 200, "height": 120 }
```

`lopsy.run` (and `POST /run`) takes one invocation or an array. An array runs
**in order** and **stops at the first failure**: the commands after it do not
run, and the ones before it stay done.

### Results

Every call resolves to an envelope; `lopsy.run` does not reject:

```json
{ "ok": true, "result": { "id": "…" } }
{ "ok": true, "results": [ { … }, { … } ] }
{ "ok": false, "error": { "name": "CommandError", "code": "invalid", "message": "…" } }
```

A refusal is a `CommandError`. A bug in the editor comes back the same way,
as `{ "name": "InternalError", "code": "internal" }` (see below).

`result` answers a single invocation, `results` an array (one entry per
invocation, in order). Each command's summary says what it returns: the new
layer's id, the selection bounds, the layer's properties after a change, and
so on. For a failed array, `error.index` is the position of the invocation
that failed, `error.completed` holds the results of the ones before it, and
the message starts with `[index] op:`.

### Errors

| `code` | Meaning | What to do |
| --- | --- | --- |
| `invalid` | The params are wrong. The message names the bad one and what it accepts (`select.rect: width must be a finite number from 1 to 49152, got -5`; `unknown param "w"; allowed: x, y, width, height, mode`). | Fix the params. |
| `refused` | The editor will not do that in its current state. The message says why and usually what to do (`A selection is active … deselect first (select.none)`). | Change the state, then retry. |
| `not-found` | An unknown command, layer, node or path. Unknown commands come with suggestions (`Did you mean: filter.gaussian-blur, …`). | Correct the name; `GET /describe` or `doc.info` lists what exists. |
| `unavailable` | Nothing to act on yet: no document open (`No document is open`), the engine not started, or the graphics context lost and being restored. | Create or open a document; otherwise wait a moment and retry. |
| `unsettled` | The command's change **was applied**, but the engine did not finish drawing it within 10 s. Its result is on `error.result`. | **Do not run it again.** Wait, then check with `view.render` or `doc.info`. |
| `internal` | The editor hit a bug. The step that failed **may or may not have been applied**; in a batch, the steps before it (`error.completed`) were. The message names the error. | Call `doc.info` (and `view.render`) before deciding what to redo, and report it with the message and the batch that caused it. |

`unavailable` also answers every call at once, before anything runs, when the
browser has no WebGL2 (the message says so): use a real GPU, or the SwiftShader
flags the driver passes by default.

### Coordinates

All positions are **document pixels**: (0, 0) is the top-left of the image, x
grows to the right and y downwards. Points are `{ "x": …, "y": … }`;
rectangles and ellipses are `x, y, width, height` of their box. There is no
view or zoom to account for. Points may lie outside the document (from −16384
to 32768), so a stroke or gradient can start off the canvas; selections are
clipped to it. Stroke and gesture points may be fractional. A document is at
most 16384 px a side, or the GPU's largest texture if that is smaller.

### Layers

A layer param takes a layer's **id or its exact name**; leaving it out means
the **active layer**. A command that works on the active layer (`layer.duplicate`,
`layer.rasterize-style`, `layer.move`, `mask.add`, `image.flip-layer`,
`text.style`…) makes a named layer active first, as clicking its row would,
and then acts, so that layer is active afterwards; its summary says so. Others
(`layer.set`, `layer.effects`, `layer.remove`, `mask.remove`,
`select.from-layer`, `view.render-layer`) leave the active layer alone. When two layers share a name, the call is refused as
`invalid` and lists their ids, so give layers unique names (`layer.add`
takes `name`) or keep the ids that `layer.add` and `doc.info` return.
`doc.info` lists the layers bottom to top, each with its id, type, parent
group, position, opacity, blend mode and whether it is active.

A new white document has a white **Background** layer and an empty
**Layer 1** above it, which is active, both inside the root group
**Project** (the document's own group, which carries its global
adjustments). `background: "transparent"` gives one empty Background layer.

### Ambient state

This is the one idea agents get wrong. Painting, filling, gradient, shape,
selection and text commands **take no colour or style params**: they read
the editor's current settings, exactly as the tools read the Color panel and
the options bar. Set them first:

- `color.set` sets the **foreground** (and `background`) colour as
  `"#rrggbb"`. `paint.fill`, `paint.stroke`, `paint.bucket`, `path.stroke`
  and `text.add` use the foreground; `filter.clouds` blends the foreground
  into the background.
- `tool.set` sets a tool's options: brush size and hardness, gradient type
  and stops, shape kind and colours, the marquees' feather, text size and
  alignment, wand tolerance… `GET /describe?op=tool.describe` then
  `{ "op": "tool.describe", "tool": "brush" }` lists every option with its
  range and current value.
- `text.set-font` sets the font family, weight and style.

Nothing resets between commands or between documents: `doc.new` keeps the
colours, the tool options and the active tool you had before. Set everything a stage relies on at
the start of the stage. There are no per-call overrides.

Commands that drive a tool make it the **active tool** first, as clicking it
in the toolbox would: `paint.stroke`, `paint.gradient`, `paint.shape`,
`paint.bucket`, `text.add`, `text.edit`, `layer.move`, `layer.nudge`,
`layer.transform`, `select.wand`, `select.quick`, `select.nudge`,
`tool.gesture` and `tool.select` itself; `layer.add-image` and
`clipboard.paste` choose the Move tool. The selection commands
(`select.rect`, `select.ellipse`, `select.polygon`…) and the filters do not
change the tool. Switching tools commits text being edited and a pending Move
float, as it does in the UI.

### Commands wait for the engine

A command resolves only once the engine has drawn its change: a `view.render`
straight after a fill shows the fill. You never need sleeps or retries
between commands. A large document on a software renderer can take a few
seconds per heavy command (see [Behaviours](#behaviours-worth-knowing)); a
command that is still drawing after 10 s comes back `unsettled`.

### The page must be the visible tab

Browsers pause animation frames in background tabs, and the engine draws on
animation frames. Headless pages are always visible, so the driver's page is
fine. In a headed browser, keep the agent page the front tab: in a background
tab, commands wait and then fail with `unavailable` or `unsettled`, and the
message says *The page is a background tab … make it the visible tab*.

## Command families

About 130 commands, in 19 families. This table is a map; the parameters are
in `GET /describe?family=<family>` (or `?op=<id>`), which is always current.
Every command's summary names the UI control it matches and its history label.

| Family | For | Most useful |
| --- | --- | --- |
| `doc` | Documents and files | `doc.new`, `doc.info`, `doc.export`, `doc.save`, `doc.open` |
| `view` | Looking at the result | `view.render`, `view.render-layer`, `view.sample` |
| `layer` | The layer stack | `layer.add`, `layer.set` (name, opacity, blend mode, visibility), `layer.effects`, `layer.move`, `layer.duplicate`, `layer.group`, `layer.reorder` |
| `color` | Foreground and background | `color.set`, `color.swap`, `color.reset` |
| `tool` | Tool options | `tool.set`, `tool.describe`, `tool.options`, `tool.gesture` (raw canvas gestures) |
| `select` | Selections | `select.rect`, `select.ellipse`, `select.polygon`, `select.none`, `select.modify`, `select.invert`, `select.from-layer` |
| `paint` | Putting pixels down | `paint.fill`, `paint.stroke`, `paint.gradient`, `paint.shape`, `paint.clear`, `paint.bucket` |
| `text` | Live text layers | `text.set-font`, `text.add`, `text.style`, `text.edit` |
| `filter` | Destructive filters | `filter.gaussian-blur`, `filter.add-noise`, `filter.texture`, `filter.clouds`, `filter.halftone`… (33) |
| `adjust` | Non-destructive adjustments on a group | `adjust.add`, `adjust.set`, `adjust.list` |
| `mask` | Layer masks | `mask.add`, `mask.edit`, `mask.clear`, `mask.remove` |
| `image` | The whole canvas | `image.canvas-size`, `image.size`, `image.crop`, `image.rotate`, `image.flip-layer`, `image.border` |
| `history` | Undo | `history.undo`, `history.redo` |
| `path` | Vector paths | `path.add`, `path.stroke`, `path.unite`, `path.list` |
| `clipboard` | The editor's own clipboard | `clipboard.copy`, `clipboard.paste`, `clipboard.copy-merged` |
| `guide` | Ruler guides | `guide.add`, `guide.list` |
| `quickmask` | Quick Mask mode | `quickmask.set` |
| `pattern`, `brush` | Defining patterns and brush tips | `pattern.define`, `filter.pattern-fill`, `brush.define` |

## Recipes

Each recipe is a complete invocation list that runs as written on a fresh
page (they are tested against the agent page). Send one as it is, then adapt
it. Apart from the photo recipe, they need nothing but the page.

<!-- recipe: flat-shapes -->
```json
[
  { "op": "doc.new", "width": 600, "height": 400 },
  { "op": "layer.set", "name": "Ground" },
  { "op": "color.set", "foreground": "#f4e9d8" },
  { "op": "paint.fill" },

  { "op": "layer.add", "name": "House" },
  { "op": "color.set", "foreground": "#264653" },
  { "op": "select.rect", "x": 120, "y": 200, "width": 360, "height": 160 },
  { "op": "paint.fill" },
  { "op": "select.none" },

  { "op": "layer.add", "name": "Roof" },
  { "op": "color.set", "foreground": "#2a9d8f" },
  { "op": "select.polygon", "points": [{ "x": 90, "y": 210 }, { "x": 300, "y": 70 }, { "x": 510, "y": 210 }] },
  { "op": "paint.fill" },
  { "op": "select.none" },

  { "op": "layer.add", "name": "Windows" },
  { "op": "color.set", "foreground": "#e9c46a" },
  { "op": "select.rect", "x": 160, "y": 240, "width": 70, "height": 60 },
  { "op": "select.rect", "x": 370, "y": 240, "width": 70, "height": 60, "mode": "add" },
  { "op": "select.ellipse", "x": 270, "y": 110, "width": 60, "height": 60, "mode": "add" },
  { "op": "paint.fill" },
  { "op": "select.none" },

  { "op": "layer.add", "name": "Door" },
  { "op": "tool.set", "tool": "shape", "options": { "mode": "rectangle", "cornerRadius": 18,
    "fillColor": "#e76f51", "strokeColor": "#1d3557", "strokeWidth": 4 } },
  { "op": "paint.shape", "from": { "x": 300, "y": 310 }, "to": { "x": 335, "y": 360 } },

  { "op": "view.render", "maxSize": 600 }
]
```

**Flat shapes: select, then fill.** A selection plus `paint.fill` is the most
dependable primitive: crisp edges, exact geometry, any polygon you can
compute (a 48–72 point polygon reads as a smooth curve). `mode: "add"` (or
`subtract`, `intersect`) combines selections, so one fill covers several
shapes. With no selection, `paint.fill` fills the whole layer. Always
`select.none` afterwards: a live selection keeps constraining everything that
follows. The Shape tool is the other route, with its own fill and stroke
colours (`fillColor`, `strokeColor`, set with `tool.set`, not the foreground)
and rounded corners; it draws from the centre (`from`) to a corner (`to`).

<!-- recipe: soft-shapes-and-light -->
```json
[
  { "op": "doc.new", "width": 600, "height": 400 },
  { "op": "layer.set", "name": "Night" },
  { "op": "color.set", "foreground": "#14213d" },
  { "op": "paint.fill" },

  { "op": "layer.add", "name": "Glow" },
  { "op": "tool.set", "tool": "marquee-ellipse", "options": { "feather": 40 } },
  { "op": "select.ellipse", "x": 200, "y": 70, "width": 200, "height": 200 },
  { "op": "color.set", "foreground": "#fca311" },
  { "op": "paint.fill" },
  { "op": "select.none" },
  { "op": "tool.set", "tool": "marquee-ellipse", "options": { "feather": 0 } },
  { "op": "layer.set", "blendMode": "screen" },

  { "op": "layer.add", "name": "Orb" },
  { "op": "select.ellipse", "x": 250, "y": 120, "width": 100, "height": 100 },
  { "op": "color.set", "foreground": "#fff3c4" },
  { "op": "paint.fill" },
  { "op": "select.none" },

  { "op": "layer.add", "name": "Shadow" },
  { "op": "color.set", "foreground": "#000000" },
  { "op": "select.ellipse", "x": 210, "y": 320, "width": 180, "height": 30 },
  { "op": "paint.fill" },
  { "op": "select.none" },
  { "op": "filter.gaussian-blur", "radius": 12 },
  { "op": "layer.set", "blendMode": "multiply", "opacity": 70 },

  { "op": "layer.add", "name": "Haze" },
  { "op": "select.rect", "x": 0, "y": 250, "width": 600, "height": 60 },
  { "op": "select.modify", "kind": "feather", "amount": 30 },
  { "op": "color.set", "foreground": "#e5e5e5" },
  { "op": "paint.fill" },
  { "op": "select.none" },
  { "op": "layer.set", "blendMode": "soft-light" },

  { "op": "view.render", "maxSize": 600 }
]
```

**Soft shapes and light.** There are three ways to soften an edge: the
marquees' `feather` option (shared by both marquees and `select.polygon`, so
set it back to 0 afterwards), `select.modify` with `kind: "feather"` on a
selection you already have, or a hard fill followed by `filter.gaussian-blur`
on that layer. Put glows and haze on their own layers with a blend mode:
`screen` or `color-dodge` for light, `multiply` for shade, `overlay` or
`soft-light` for tint. Blend modes and opacity are layer properties, set with
`layer.set`.

<!-- recipe: gradients -->
```json
[
  { "op": "doc.new", "width": 600, "height": 400 },
  { "op": "layer.set", "name": "Sky" },
  { "op": "tool.set", "tool": "gradient", "options": { "type": "linear", "stops": [
    { "position": 0, "color": "#0b132b" }, { "position": 0.6, "color": "#5c4d7d" }, { "position": 1, "color": "#f4a261" } ] } },
  { "op": "paint.gradient", "from": { "x": 300, "y": 0 }, "to": { "x": 300, "y": 400 } },

  { "op": "layer.add", "name": "Moon glow" },
  { "op": "tool.set", "tool": "gradient", "options": { "type": "radial", "stops": [
    { "position": 0, "color": "#fff1c1" }, { "position": 1, "color": "#fff1c100" } ] } },
  { "op": "paint.gradient", "from": { "x": 430, "y": 120 }, "to": { "x": 430, "y": 20 } },
  { "op": "layer.set", "blendMode": "screen" },

  { "op": "layer.add", "name": "Panel" },
  { "op": "select.rect", "x": 60, "y": 220, "width": 240, "height": 140 },
  { "op": "tool.set", "tool": "gradient", "options": { "type": "linear", "stops": [
    { "position": 0, "color": "#e63946" }, { "position": 1, "color": "#457b9d" } ] } },
  { "op": "paint.gradient", "from": { "x": 60, "y": 220 }, "to": { "x": 300, "y": 360 } },
  { "op": "select.none" },

  { "op": "view.render", "maxSize": 600 }
]
```

**Gradients.** A gradient's stops are a tool option, not the
foreground/background colours: set them with `tool.set` on the `gradient`
tool (2–16 stops, positions 0–1, colours `"#rrggbb"` or `"#rrggbbaa"` for
transparency). `paint.gradient` is a drag: linear runs along it, radial is
centred on `from` with the drag's length as its radius. It covers the whole
layer, or only the selection when there is one, which is how a gradient goes
into a shape. A stop with alpha `00` lets the layer show through, so a radial
gradient to transparent on a `screen` layer is a soft light source.

<!-- recipe: brush-work -->
```json
[
  { "op": "doc.new", "width": 600, "height": 400 },
  { "op": "layer.set", "name": "Paper" },
  { "op": "color.set", "foreground": "#fdf6e3" },
  { "op": "paint.fill" },

  { "op": "layer.add", "name": "Ink" },
  { "op": "color.set", "foreground": "#073642" },
  { "op": "tool.set", "tool": "brush", "options": { "size": 14, "hardness": 90, "opacity": 100 } },
  { "op": "paint.stroke", "points": [
    { "x": 60, "y": 120 }, { "x": 100, "y": 90 }, { "x": 140, "y": 80 }, { "x": 180, "y": 95 }, { "x": 220, "y": 125 },
    { "x": 260, "y": 150 }, { "x": 300, "y": 155 }, { "x": 340, "y": 140 }, { "x": 380, "y": 110 }, { "x": 420, "y": 88 },
    { "x": 460, "y": 85 }, { "x": 500, "y": 100 }, { "x": 540, "y": 125 } ] },

  { "op": "tool.set", "tool": "brush", "options": { "size": 6, "hardness": 100 } },
  { "op": "paint.stroke", "points": [{ "x": 60, "y": 220 }] },
  { "op": "paint.stroke", "points": [{ "x": 540, "y": 220 }], "line": true },
  { "op": "paint.stroke", "points": [{ "x": 540, "y": 340 }], "line": true },

  { "op": "tool.set", "tool": "pencil", "options": { "size": 2 } },
  { "op": "paint.stroke", "tool": "pencil", "points": [{ "x": 60, "y": 260 }, { "x": 300, "y": 300 }] },

  { "op": "path.add", "anchors": [
    { "point": { "x": 60, "y": 360 }, "handleOut": { "x": 180, "y": 260 } },
    { "point": { "x": 400, "y": 360 }, "handleIn": { "x": 280, "y": 260 } } ] },
  { "op": "color.set", "foreground": "#cb4b16" },
  { "op": "path.stroke", "width": 5 },

  { "op": "tool.set", "tool": "eraser", "options": { "size": 40 } },
  { "op": "paint.stroke", "tool": "eraser", "points": [{ "x": 300, "y": 60 }, { "x": 300, "y": 180 }] },

  { "op": "view.render", "maxSize": 600 }
]
```

**Brush work.** `paint.stroke` is one drag of a painting tool through
`points`, with the tool's options from `tool.set` and the foreground colour.
One point is a single dab. Denser points give smoother curves: generate them
in code. `line: true` is a Shift-click: a straight line from where the
previous stroke **on this layer** ended to the stroke's first point, so a dab
followed by `line` strokes draws a polyline. The pencil gives aliased,
pixel-art lines; the eraser, smudge, dodge, sponge, stamp and healing tools
work the same way (`tool` picks one). For an exact smooth curve, add a bezier
path with `path.add` (each anchor's `handleIn` / `handleOut` are absolute
document points) and stroke it with `path.stroke`, which uses the foreground
colour and a width of 1–50 px. Strokes are instantaneous, so the brush's
time-based behaviours (speed-based size, hold-to-smooth) never happen.

<!-- recipe: type -->
```json
[
  { "op": "doc.new", "width": 800, "height": 500 },
  { "op": "layer.set", "name": "Backdrop" },
  { "op": "color.set", "foreground": "#1d1d2c" },
  { "op": "paint.fill" },

  { "op": "text.set-font", "family": "IM Fell English" },
  { "op": "tool.set", "tool": "text", "options": { "fontSize": 110, "align": "center" } },
  { "op": "color.set", "foreground": "#f4d58d" },
  { "op": "text.add", "x": 400, "y": 90, "text": "Night Market" },

  { "op": "layer.select", "layer": "Backdrop" },
  { "op": "text.set-font", "family": "Montserrat", "weight": 700 },
  { "op": "tool.set", "tool": "text", "options": { "fontSize": 26, "align": "center" } },
  { "op": "color.set", "foreground": "#f2f2f2" },
  { "op": "text.add", "x": 400, "y": 290, "text": "OPEN FRIDAYS FROM SIX\nBY THE RIVER" },

  { "op": "text.style", "layer": "Night Market", "options": { "fontSize": 120 } },
  { "op": "text.edit", "layer": "Night Market", "text": "Night Bazaar" },
  { "op": "layer.effects", "layer": "Night Bazaar", "colorOverlay": { "enabled": true, "color": "#ffb703" } },

  { "op": "layer.select", "layer": "Backdrop" },
  { "op": "text.set-font", "family": "Barlow Condensed" },
  { "op": "tool.set", "tool": "text", "options": { "fontSize": 18, "align": "left" } },
  { "op": "color.set", "foreground": "#a8a8bf" },
  { "op": "text.add", "x": 60, "y": 400, "text": "Stalls, music and lanterns. Bring a friend and something to share.",
    "box": { "width": 260, "height": 60 } },

  { "op": "view.render", "maxSize": 800 }
]
```

**Type.** `text.add` makes a live text layer in the current font, size,
alignment and foreground colour, **directly above the active layer**. Point
text is a click at (x, y): `align: "center"` centres each line on x, and the
glyphs' ink starts noticeably below y (roughly a third of the font size for
capitals). `\n` breaks a line; `box` makes paragraph text that wraps at its
width. The layer is named after its first 16 characters.

**Choose the font before you add the text**, with `text.set-font` and an
exact family name as Google Fonts lists it (`Montserrat`, `Barlow
Condensed`, `IM Fell English`…) and a weight the family offers. The command
waits for the font to download, and so do `text.add` and `text.edit`: their
result says `fontLoaded: true` when the text is drawn in it.
`fontLoaded: false` means the font did not arrive within 20 s: the text is
there in a fallback face and will switch when the font loads, so don't add it
again.

**Watch the active layer.** Right after `text.add` the new text layer is
active, and as in the UI, the text settings then apply to it: `text.set-font`
**restyles that layer**, and `tool.set` on the text tool is refused. So
before setting up the next piece of text, select a non-text layer
(`layer.select`) or add one. To change a text layer later, `text.style`
changes its size, style or alignment and `text.edit` replaces its words
(renaming a layer still named after its old text). `text.edit` also loads
the layer's colour into the foreground and its font, size, alignment and
spacing into the text options, as clicking into the text does: set the colour
again before you paint. There is no command to recolour a text
layer: a `colorOverlay` effect does it and keeps the text live.

<!-- recipe: layer-effects -->
```json
[
  { "op": "doc.new", "width": 600, "height": 400 },
  { "op": "layer.set", "name": "Table" },
  { "op": "color.set", "foreground": "#e9ecef" },
  { "op": "paint.fill" },

  { "op": "layer.add", "name": "Badge" },
  { "op": "color.set", "foreground": "#3a86ff" },
  { "op": "select.ellipse", "x": 80, "y": 100, "width": 200, "height": 200 },
  { "op": "paint.fill" },
  { "op": "select.none" },
  { "op": "layer.effects",
    "dropShadow": { "enabled": true, "color": "#000000", "offsetX": 0, "offsetY": 12, "blur": 24, "opacity": 40 },
    "stroke": { "enabled": true, "color": "#ffffff", "width": 8, "position": "inside" },
    "innerGlow": { "enabled": true, "color": "#bde0fe", "size": 30, "opacity": 60 } },

  { "op": "layer.add", "name": "Neon" },
  { "op": "color.set", "foreground": "#ffffff" },
  { "op": "select.rect", "x": 360, "y": 130, "width": 160, "height": 16 },
  { "op": "select.rect", "x": 432, "y": 130, "width": 16, "height": 140, "mode": "add" },
  { "op": "paint.fill" },
  { "op": "select.none" },
  { "op": "layer.effects", "outerGlow": { "enabled": true, "color": "#ff006e", "size": 30, "spread": 4, "opacity": 90 },
    "colorOverlay": { "enabled": true, "color": "#ffd6ec" } },

  { "op": "layer.rasterize-style", "layer": "Badge" },
  { "op": "view.render", "maxSize": 600 }
]
```

**Layer effects.** `layer.effects` sets any of `dropShadow`, `stroke`,
`outerGlow`, `innerGlow` and `colorOverlay` on a raster or text layer; fields
you leave out keep their values, so `{ "enabled": true }` alone turns an
effect on with its defaults. `GET /describe?op=layer.effects` has each
field's range. Effects stay live and follow the layer's pixels. A group has
no effects: give each layer its own. Many live effects slow every later
command down on a software renderer; once a layer's look is final,
`layer.rasterize-style` bakes its effects into its pixels. Like every command
that acts on the active layer, it takes `layer` to name another one, which it
makes active first (here Badge, while Neon was active).

<!-- recipe: filters-and-textures -->
```json
[
  { "op": "doc.new", "width": 600, "height": 400 },
  { "op": "layer.set", "name": "Paper" },
  { "op": "color.set", "foreground": "#efe4cf" },
  { "op": "paint.fill" },
  { "op": "filter.texture", "kind": "Canvas", "amount": 35 },

  { "op": "layer.add", "name": "Clouds" },
  { "op": "color.set", "foreground": "#ffffff", "background": "#3d405b" },
  { "op": "filter.clouds", "scale": 6 },
  { "op": "layer.set", "blendMode": "soft-light", "opacity": 60 },

  { "op": "layer.add", "name": "Dots" },
  { "op": "tool.set", "tool": "gradient", "options": { "type": "linear", "stops": [
    { "position": 0, "color": "#000000" }, { "position": 1, "color": "#ffffff" } ] } },
  { "op": "select.rect", "x": 40, "y": 220, "width": 520, "height": 140 },
  { "op": "paint.gradient", "from": { "x": 40, "y": 0 }, "to": { "x": 560, "y": 0 } },
  { "op": "filter.halftone", "dotSize": 10 },
  { "op": "select.none" },
  { "op": "layer.set", "blendMode": "multiply", "opacity": 80 },

  { "op": "layer.add", "name": "Grain" },
  { "op": "color.set", "foreground": "#808080" },
  { "op": "paint.fill" },
  { "op": "filter.add-noise", "amount": 40, "monochromatic": "Mono", "distribution": "Gaussian" },
  { "op": "layer.set", "blendMode": "overlay", "opacity": 30 },

  { "op": "view.render", "maxSize": 600 }
]
```

**Filters and textures.** A filter rewrites the active layer's pixels, inside
the selection when there is one (the Dots gradient and its halftone stay in
their rectangle). Params you leave out take the filter dialog's defaults.
Some enum values are the dialog's labels, capitalised as shown there
(`"Mono"`, `"Gaussian"`, `"Canvas"`), so read them from
`GET /describe?family=filter`. Useful for illustration: `add-noise` (grain:
fill a layer mid-grey, add mono noise, set it to `overlay`), `texture`
(Grain, Rough, Canvas, Streaks, Cells), `halftone`, `pixelate`, `posterize`,
`threshold`, `oil-paint`, `cel-shading`; `clouds`, `fibers`, `smoke`,
`sunburst` and `voronoi` render texture onto the layer (clouds in the
foreground and background colours); `motion-blur`, `radial-blur`,
`lens-distortion`, `chromatic-aberration`, `kaleidoscope`, `bloom`,
`color-lut`. Filters refuse text and group layers. `clouds`, `fibers`,
`smoke` and `add-noise` draw a new random seed on every run.

<!-- recipe: masks -->
```json
[
  { "op": "doc.new", "width": 600, "height": 400 },
  { "op": "layer.set", "name": "Sea" },
  { "op": "color.set", "foreground": "#0b3954" },
  { "op": "paint.fill" },

  { "op": "layer.add", "name": "Sunset" },
  { "op": "color.set", "foreground": "#ff6663" },
  { "op": "paint.fill" },
  { "op": "mask.add" },
  { "op": "tool.set", "tool": "gradient", "options": { "type": "linear", "stops": [
    { "position": 0, "color": "#ffffff" }, { "position": 1, "color": "#000000" } ] } },
  { "op": "paint.gradient", "from": { "x": 0, "y": 100 }, "to": { "x": 0, "y": 300 } },
  { "op": "mask.edit", "enabled": false },

  { "op": "layer.add", "name": "Porthole" },
  { "op": "color.set", "foreground": "#fefae0" },
  { "op": "paint.fill" },
  { "op": "select.ellipse", "x": 180, "y": 80, "width": 240, "height": 240 },
  { "op": "select.invert" },
  { "op": "mask.add" },
  { "op": "tool.set", "tool": "brush", "options": { "size": 30, "hardness": 100 } },
  { "op": "paint.stroke", "points": [{ "x": 40, "y": 360 }, { "x": 560, "y": 360 }] },
  { "op": "mask.edit", "enabled": false },

  { "op": "view.render", "maxSize": 600 }
]
```

**Masks.** `mask.add` gives the active layer a mask and **enters mask edit
mode**: from then on paint, fill, gradient and filter commands write the
mask, not the pixels, until `mask.edit` with `enabled: false`. With a
selection, the new mask reveals only the selection and the selection is
dropped (the Porthole frame keeps everything outside its circle). In the
mask, white reveals and black hides: `paint.fill` and `paint.gradient` use
the grey value of their colours, but the **brush and pencil always hide and
the eraser always reveals**, whatever the foreground. `mask.edit` with
`enabled: true` goes back into a mask later, `mask.clear` resets it and
`mask.remove` deletes it.

<!-- recipe: group-adjustments -->
```json
[
  { "op": "doc.new", "width": 600, "height": 400 },
  { "op": "layer.set", "name": "Field" },
  { "op": "color.set", "foreground": "#90be6d" },
  { "op": "paint.fill" },
  { "op": "layer.add", "name": "Barn" },
  { "op": "color.set", "foreground": "#c1121f" },
  { "op": "select.rect", "x": 200, "y": 150, "width": 200, "height": 160 },
  { "op": "paint.fill" },
  { "op": "select.none" },

  { "op": "layer.group", "layers": ["Field", "Barn"] },
  { "op": "layer.set", "name": "Farm" },
  { "op": "adjust.add", "group": "Farm", "type": "hue-saturation" },
  { "op": "adjust.set", "group": "Farm", "node": "hue-saturation", "params": { "saturation": -60 } },
  { "op": "adjust.add", "group": "Farm", "type": "curves" },
  { "op": "adjust.set", "group": "Farm", "node": "curves", "params": {
    "curves": { "rgb": [{ "x": 0, "y": 0.1 }, { "x": 0.5, "y": 0.45 }, { "x": 1, "y": 0.95 }] } } },

  { "op": "adjust.set", "group": "Project", "node": "exposure", "params": { "exposure": 0.3 } },
  { "op": "adjust.list", "group": "Farm" },
  { "op": "view.render", "maxSize": 600 }
]
```

**Adjustments on a group.** Adjustments are non-destructive nodes on a
group: they apply to everything inside it and can be changed or removed at
any time. `layer.group` wraps layers in a new group named `Group` (rename it
with `layer.set`); `adjust.add` appends a node (`exposure`, `contrast`,
`highlights-shadows`, `saturation`, `vignette`, `curves`, `levels`,
`hue-saturation`, `color-balance`, `color-grading`, `invert`,
`black-white`, `photo-filter`, `channel-mixer`, `gradient-map`) and
`adjust.set` changes its params, which `adjust.list` shows with their
current values. The root group `Project` starts with levels, curves,
exposure, hue/saturation and colour-grading nodes at neutral settings:
adjust those to grade the whole image. `filter.hue-saturation` and
`filter.brightness-contrast` are the destructive equivalents on one layer.

<!-- recipe: move-flip-turn -->
```json
[
  { "op": "doc.new", "width": 600, "height": 400 },
  { "op": "layer.add", "name": "Arrow" },
  { "op": "color.set", "foreground": "#3d5a80" },
  { "op": "select.polygon", "points": [
    { "x": 60, "y": 80 }, { "x": 160, "y": 80 }, { "x": 160, "y": 50 }, { "x": 220, "y": 110 },
    { "x": 160, "y": 170 }, { "x": 160, "y": 140 }, { "x": 60, "y": 140 } ] },
  { "op": "paint.fill" },
  { "op": "select.none" },

  { "op": "layer.duplicate" },
  { "op": "layer.set", "name": "Back" },
  { "op": "layer.move", "dx": 300, "dy": 0 },
  { "op": "image.flip-layer", "axis": "horizontal" },

  { "op": "layer.duplicate", "layer": "Arrow" },
  { "op": "layer.set", "name": "Down", "opacity": 60 },
  { "op": "layer.transform", "rotate": 90 },
  { "op": "layer.move", "dx": 0, "dy": 160 },
  { "op": "layer.nudge", "dx": 3, "dy": 0 },

  { "op": "view.render", "maxSize": 600 }
]
```

**Moving, flipping and quarter-turning.** `layer.move` moves a layer by
(dx, dy) as a Move-tool drag would, and returns where its content is
afterwards. It is **refused while a selection is active** (a drag would lift
the selected pixels instead), so `select.none` first. `image.flip-layer`
mirrors one layer about its own content (`image.rotate` turns the whole
image); `layer.transform` turns layers a quarter turn (`rotate: 90` or `-90`)
or flips several layers together about the centre of their content. Text
stays live through all of them. `layer.duplicate` puts the copy, named
`<name> copy`, directly on top of the original and makes it active. There is
no arbitrary-angle rotation or scaling command: see
[What the API does not offer](#what-the-api-does-not-offer).

<!-- recipe: duplicate-and-group -->
```json
[
  { "op": "doc.new", "width": 600, "height": 300 },
  { "op": "layer.set", "name": "Snow" },
  { "op": "color.set", "foreground": "#edf6f9" },
  { "op": "paint.fill" },

  { "op": "layer.add", "name": "Tree" },
  { "op": "color.set", "foreground": "#2d6a4f" },
  { "op": "select.polygon", "points": [{ "x": 80, "y": 60 }, { "x": 130, "y": 230 }, { "x": 30, "y": 230 }] },
  { "op": "paint.fill" },
  { "op": "select.none" },

  { "op": "layer.duplicate", "layer": "Tree" },
  { "op": "layer.set", "name": "Tree 2" },
  { "op": "layer.move", "dx": 160, "dy": 0 },
  { "op": "layer.duplicate", "layer": "Tree 2" },
  { "op": "layer.set", "name": "Tree 3" },
  { "op": "layer.move", "dx": 160, "dy": 0 },

  { "op": "layer.group", "layers": ["Tree", "Tree 2", "Tree 3"] },
  { "op": "layer.set", "name": "Forest", "opacity": 85 },
  { "op": "layer.add", "name": "Inside the group" },
  { "op": "doc.info" },
  { "op": "view.render", "maxSize": 600 }
]
```

**Duplicating and grouping.** Repeated elements are a duplicate and a move
each (or a fill each from computed geometry). `layer.group` puts the named
layers in a new group where the topmost of them was and makes the group
active. **`layer.add` inserts directly above the active layer, in the active
layer's group; when the active layer is a group, the new layer goes inside
it, at the top**, which is how "Inside the group" lands in Forest. To put a
layer somewhere else, `layer.reorder` moves it above or below another layer,
or `inside` a group. A group's opacity, blend mode and adjustments apply to
everything in it.

<!-- recipe: place-an-image -->
```json
[
  { "op": "doc.new", "width": 800, "height": 600 },
  { "op": "layer.add-image", "base64": { "$file": "photo.jpg" }, "name": "photo.jpg" },
  { "op": "select.none" },
  { "op": "layer.set", "name": "Photo" },
  { "op": "filter.desaturate" },
  { "op": "layer.add", "name": "Duotone" },
  { "op": "tool.set", "tool": "gradient", "options": { "type": "linear", "stops": [
    { "position": 0, "color": "#2b2d42" }, { "position": 1, "color": "#ef8354" } ] } },
  { "op": "paint.gradient", "from": { "x": 0, "y": 0 }, "to": { "x": 800, "y": 600 } },
  { "op": "layer.set", "blendMode": "color", "opacity": 85 },
  { "op": "view.render", "maxSize": 800 }
]
```

**Placing an image.** `layer.add-image` takes an image file's bytes (PNG,
JPEG, GIF, BMP or WebP) as base64; with the driver, `{ "$file": "photo.jpg" }`
reads a file of yours. The image becomes a new layer named `Pasted Layer`
above the active layer, centred and **shrunk to fit** when it is larger than
the canvas. As with a paste in the UI, its pixels become the selection and
the Move tool is chosen, so `select.none` before anything else (the selection
would constrain filters and paint, and `layer.move` refuses while it is
active). `doc.open` opens an image as a new document at its own size instead.

<!-- recipe: undo -->
```json
[
  { "op": "doc.new", "width": 300, "height": 200 },
  { "op": "color.set", "foreground": "#9d4edd" },
  { "op": "select.rect", "x": 20, "y": 20, "width": 120, "height": 120 },
  { "op": "paint.fill" },
  { "op": "select.none" },
  { "op": "layer.add", "name": "Mistake" },
  { "op": "color.set", "foreground": "#ff0000" },
  { "op": "paint.fill" },
  { "op": "history.undo", "steps": 3 },
  { "op": "doc.info" }
]
```

**Undo.** `history.undo` and `history.redo` take `steps`. Every command's
summary gives its history label, and `doc.info` lists the labels to undo and
redo, so you can count steps. `layer.add` with a name is two steps (Add Layer,
Rename Layer); colour, tool-option, selection-replace and `select.none`
changes are none. Here the three steps undo the red fill and the named layer,
and `doc.info` shows `["New Document", "Fill"]`.

### A complete composition

A sunset poster in eight layers: a gradient sky, a glowing sun, two ridges
with mist between them, film grain, and type with a shadow. It runs in a few
seconds.

<!-- recipe: evening-poster -->
```json
[
  { "op": "doc.new", "width": 1200, "height": 800 },
  { "op": "layer.set", "name": "Sky" },
  { "op": "tool.set", "tool": "gradient", "options": { "type": "linear", "stops": [
    { "position": 0, "color": "#1b2a4a" }, { "position": 0.55, "color": "#c8553d" }, { "position": 1, "color": "#f2a541" } ] } },
  { "op": "paint.gradient", "from": { "x": 600, "y": 0 }, "to": { "x": 600, "y": 640 } },

  { "op": "layer.add", "name": "Sun" },
  { "op": "color.set", "foreground": "#ffe8a3" },
  { "op": "select.ellipse", "x": 470, "y": 330, "width": 260, "height": 260 },
  { "op": "paint.fill" },
  { "op": "select.none" },
  { "op": "layer.effects", "outerGlow": { "enabled": true, "color": "#ffb347", "size": 80, "opacity": 80 } },

  { "op": "layer.add", "name": "Far ridge" },
  { "op": "color.set", "foreground": "#5b3f63" },
  { "op": "select.polygon", "points": [
    { "x": 0, "y": 800 }, { "x": 0, "y": 520 }, { "x": 180, "y": 450 }, { "x": 340, "y": 540 }, { "x": 560, "y": 470 },
    { "x": 820, "y": 560 }, { "x": 1000, "y": 470 }, { "x": 1200, "y": 530 }, { "x": 1200, "y": 800 } ] },
  { "op": "paint.fill" },
  { "op": "select.none" },

  { "op": "layer.add", "name": "Mist" },
  { "op": "tool.set", "tool": "gradient", "options": { "type": "linear", "stops": [
    { "position": 0, "color": "#ffd9a000" }, { "position": 1, "color": "#ffd9a0" } ] } },
  { "op": "paint.gradient", "from": { "x": 600, "y": 470 }, "to": { "x": 600, "y": 640 } },
  { "op": "layer.set", "blendMode": "screen", "opacity": 70 },

  { "op": "layer.add", "name": "Near ridge" },
  { "op": "color.set", "foreground": "#0e1628" },
  { "op": "select.polygon", "points": [
    { "x": 0, "y": 800 }, { "x": 0, "y": 600 }, { "x": 240, "y": 560 }, { "x": 420, "y": 640 },
    { "x": 700, "y": 590 }, { "x": 960, "y": 660 }, { "x": 1200, "y": 600 }, { "x": 1200, "y": 800 } ] },
  { "op": "paint.fill" },
  { "op": "select.none" },

  { "op": "layer.add", "name": "Grain" },
  { "op": "color.set", "foreground": "#808080" },
  { "op": "paint.fill" },
  { "op": "filter.add-noise", "amount": 40, "monochromatic": "Mono", "distribution": "Gaussian" },
  { "op": "layer.set", "blendMode": "overlay", "opacity": 35 },

  { "op": "text.set-font", "family": "Barlow Condensed", "weight": 700 },
  { "op": "tool.set", "tool": "text", "options": { "fontSize": 170, "align": "center" } },
  { "op": "color.set", "foreground": "#f7f1e3" },
  { "op": "text.add", "x": 600, "y": 40, "text": "EVENING" },
  { "op": "layer.effects", "dropShadow": { "enabled": true, "color": "#1b2a4a", "offsetX": 0, "offsetY": 6, "blur": 18, "opacity": 50 } },

  { "op": "layer.select", "layer": "Grain" },
  { "op": "text.set-font", "family": "Montserrat", "weight": 700 },
  { "op": "tool.set", "tool": "text", "options": { "fontSize": 26, "align": "center" } },
  { "op": "text.add", "x": 600, "y": 730, "text": "A WALK IN THE HILLS  ·  SEPTEMBER" },

  { "op": "view.render", "maxSize": 800 },
  { "op": "doc.export", "format": "png" }
]
```

Through the driver, the last two results carry the paths of an 800 × 533
preview and the 1200 × 800 PNG. In real work you would send this as four or
five stages and look at each one; it is one list here so it can be tested
whole.

## What the API does not offer

These have no command. Don't hunt for them:

- **Arbitrary-angle rotation and scaling, distort and perspective.** Only
  quarter turns and flips (`layer.transform`, `image.flip-layer`,
  `image.rotate`) and whole-image resizing (`image.size`). `tool.gesture`
  can drag the Move tool's transform handles, but you would have to compute
  where the handles are yourself. Draw at the angle and size you need
  instead: a polygon selection can have any orientation.
- **The Spray tool** (it paints on a timer while the button is held),
  **Liquify**, **Tilt-Shift** and **Mesh Warp**.
- **Changing the colour of an existing text layer.** `text.add` uses the
  foreground; afterwards a `colorOverlay` effect recolours the text and keeps
  it live.
- **Text letter spacing, line height and paragraph spacing.** `text.style`
  and `tool.set` take size, style, alignment, underline, strikethrough and
  vertical only.
- **Turning a path into a selection or a filled shape.** `path.stroke`
  strokes a path; to fill a curve, select a polygon through points sampled
  along it.
- **The Export dialog's options** beyond what `doc.export` takes (format,
  JPEG/WebP quality, 16-bit PNG), and anything that needs the **system
  clipboard** or a **file picker**: files go in and out as base64
  (`doc.open`, `layer.add-image`, `doc.save`, `doc.export`,
  `doc.export-psd`), and `clipboard.*` is the editor's own clipboard.
- **A list of available fonts.** `text.set-font` takes any family the
  editor's font picker lists (the Google Fonts catalogue), by its exact name.

The UI guide, <https://lopsy.art/SKILL-UI.md>, covers all of these by driving
the full editor at <https://lopsy.art/>.

## Behaviours worth knowing

Each of these was checked on the agent page.

- **A new document** is a white `Background`, an empty `Layer 1` (active) and
  the root group `Project`. It changes nothing else: the colours, the tool
  options and the active tool carry over from before `doc.new` (Move on a
  fresh page; the Brush after a `paint.stroke`).
- **A selection constrains painting, fills, gradients and filters until
  `select.none`.** It is the most common cause of "my stroke only half
  appeared". `select.none` takes `commit`: `true` also commits a pending Move
  float or layer transform, as Cmd+D does. `commit: true` is the safe default
  when you want a clean state.
- **`layer.add` inserts above the active layer**, inside the active layer's
  group, or inside the active group at its top. Text from `text.add` lands
  the same way. Plan which layer is active before you add.
- **`text.add` puts point text's line box at (x, y)**, for left alignment
  its top-left; the ink starts lower, by about a third of the font size for
  capitals in most faces. Read the real bounds from `doc.info` (`x`, `y` of
  the text layer) or `view.render-layer`.
- **After `text.add`, the text settings belong to the new text layer.**
  `text.set-font` restyles it and `tool.set` on the text tool is refused until
  another layer is active.
- **`text.edit` loads the edited layer's colour into the foreground**, and its
  style into the text options.
- **The Shape tool's fill starts as the foreground colour** the first time it
  is chosen on a page, unless `tool.set` has given it a `fillColor` already.
- **In mask edit mode the brush and pencil always hide and the eraser always
  reveals**; `paint.fill` and `paint.gradient` write the grey value of their
  colours.
- **`layer.move` is refused while a selection is active**, and
  `layer.add-image` leaves one: `select.none` after placing an image.
- **`color.set` takes opaque colours only** (`"#rrggbb"` or `"#rgb"`;
  `"#rrggbbaa"` is `invalid`). For a translucent fill, lower the layer's
  opacity, or use a gradient stop with alpha.
- **`view.sample` reads the canvas as the Eyedropper does**: in mask edit
  mode that includes the mask overlay's tint. `view.render` and `doc.export`
  give the image itself.
- **The undo history holds 50 steps.** Older steps fall off the bottom.
  Save projects as checkpoints instead of relying on deep undo.
- **Fonts download on first use.** `fontLoaded: false` (after 20 s without
  the font) means the change was made in a fallback face; it switches when the
  font arrives. Don't repeat the command.
- **Headless rendering is software WebGL (SwiftShader), and slower than a
  GPU.** Simple commands take milliseconds, but a large layer effect or a
  `view.render` of a 3000 × 2000 document takes seconds. Keep documents
  around 1000–2000 px on the long side, render previews with `maxSize`, and
  use `REAL_GPU=1` when the machine has a GPU. The driver prints the WebGL
  renderer at startup: if it names SwiftShader under `REAL_GPU=1`, the GPU
  was not picked up. Edit `GPU_ARGS` in the driver for your platform (on
  Linux, `--use-angle=vulkan --enable-features=Vulkan --ignore-gpu-blocklist`
  is the other combination known to work).
- **Exports are wide-gamut.** PNGs from `doc.export` and `view.render` carry a
  Display P3 colour profile: your hex values are written unchanged and tagged
  P3, so a colour-managed viewer shows them a little more saturated than the
  same hex in sRGB. That's expected, not a bug.
- **Something that looks like a bug may be one.** Search
  <https://github.com/theseamusjames/lopsy.art/issues> for workarounds.
