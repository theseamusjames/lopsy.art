/**
 * Records the start screen's demo reel: a trailer of about 24 seconds, cut
 * from the app itself. See demo-reel.config.ts for how to run it.
 *
 * Everything on screen is the real app doing the real thing; the film is
 * made by directing it. Each shot is recorded on its own as the frames
 * Chromium draws (CDP screencast, at twice the reel's size), with the
 * camera moves done in the page (a transform on the app's root, so type
 * and controls stay sharp when the camera pushes in) and the titles laid
 * over it there too. ffmpeg then fits each shot to its length, joins them
 * with hard cuts and encodes the reel twice, as AV1 and as H.264, with a
 * poster from its first frame.
 *
 * The shots: the library under the first title; one photo picked and
 * rated; a timelapse of a real edit of a RAW file, every step of it
 * (demo-reel-edit.json), the camera coming to rest on the whole photograph;
 * before and after under the split divider, cut in on that same framing; "No servers."; "Your own cloud storage."; the library's
 * originals in Drive; "Completely free.", which dissolves into the end card.
 *
 * The Drive shot is four pictures of drive.google.com (demo-reel-drive-1
 * to -4.png, taken by hand from a real library), clicked through from the
 * library's folder down to a day's originals. Without those files it is a
 * drawing instead: the folders and files the app really wrote to the fake
 * Drive. The end card sits on a
 * photograph edited in the app (demo-reel-end.jpg, or REEL_END).
 *
 * REEL_PHOTOS fills the Drive library with its JPEG, PNG and WebP files.
 * RAW files cannot go there: the fake Drive answers through Playwright's
 * routing, which cannot hand an 85 MB original back to the page (Chromium
 * exits), and the app reads each RAW back after importing it. So the edit
 * shots open REEL_HERO, the RAW file the edit was made on, in a library in
 * this browser instead, where nothing is routed. The Edit view looks the
 * same in both.
 */
import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gisStubInitScript, routeFakeDrive } from '../../../packages/photos-core/src/storage/google-drive/playwright-fake-drive';
import type { FakeDrive } from '../../../packages/photos-core/src/storage/google-drive/fake-drive';
import { REEL_HEIGHT, REEL_WIDTH } from './demo-reel.config';
import { waitForReady } from './harness';
import { importStrip, tiles } from './library';

const here = dirname(fileURLToPath(import.meta.url));
const photosDir = process.env.REEL_PHOTOS;
/** Frames and the shots' intermediate files; deleted when the reel is written. */
const workDir = join(here, '../test-results/demo-reel');
const outDir = join(here, '../src/components/DemoReel');
const FPS = 30;
const RAW = /\.(raf|dng)$/i;
const DEVELOPED = /\.(jpe?g|png|webp)$/i;
const W = REEL_WIDTH;
const H = REEL_HEIGHT;

function filesMatching(pattern: RegExp): string[] {
  if (!photosDir || !existsSync(photosDir)) return [];
  return readdirSync(photosDir)
    .filter((name) => pattern.test(name))
    .sort()
    .map((name) => join(photosDir, name));
}

/** The Drive library's photos. */
function photoFiles(): string[] {
  return filesMatching(DEVELOPED).slice(0, Number(process.env.REEL_LIMIT ?? 500));
}

/** The photo the timelapse edits: REEL_HERO, the file demo-reel-edit.json's steps were made on. */
function heroFile(): string | null {
  const named = process.env.REEL_HERO;
  return named && existsSync(named) ? named : null;
}

/**
 * What the film adds to the page: a pointer (headless Chromium draws none)
 * and the title card, both outside the app's root so the camera does not
 * move them.
 */
function stageScript(fontUrl: string): string {
  return `(() => {
  const build = () => {
    if (document.getElementById('reel-pointer')) return;
    const style = document.createElement('style');
    style.textContent = \`
      @font-face { font-family: 'Reel'; src: url('${fontUrl}') format('woff2'); font-weight: 100 900; }
      html, body { overflow: hidden !important; background: #000 !important; }
      #reel-pointer { position: fixed; left: 0; top: 0; width: 22px; height: 22px; z-index: 2147483647; pointer-events: none; transform: translate(-100px, -100px); }
      #reel-title { position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; display: grid; place-items: center; background: rgba(0, 0, 0, 0); transition: background 140ms linear; }
      #reel-title span { display: block; max-width: 1300px; font: 900 136px/0.92 'Reel', system-ui, sans-serif; letter-spacing: -0.015em; text-transform: uppercase; text-align: center; color: #fff; text-shadow: 0 6px 40px rgba(0, 0, 0, 0.65); opacity: 0; transform: scale(1.22); transition: transform 520ms cubic-bezier(0.16, 1, 0.3, 1), opacity 120ms linear; }
      #reel-title.on { background: rgba(0, 0, 0, var(--dim, 0.5)); }
      #reel-title.on span { opacity: 1; transform: scale(1); }
      #reel-title.cut, #reel-title.cut span { transition: none; }
    \`;
    document.documentElement.appendChild(style);
    const pointer = document.createElement('div');
    pointer.id = 'reel-pointer';
    pointer.innerHTML = '<svg viewBox="0 0 22 22" width="22" height="22"><path d="M3 2l15 8.2-6.4 1.7L8.9 18z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(pointer);
    // pointermove, not mousemove: a control that cancels its pointerdown (the split divider) gets no mousemove.
    document.addEventListener('pointermove', (e) => {
      // While a drag is steered through the camera (shot 4), the pointer is drawn where the drag shows.
      const map = window.__reelPointerMap;
      const x = map ? map.origin + (e.clientX - map.origin) * map.scale : e.clientX;
      pointer.style.transform = 'translate(' + (x - 3) + 'px,' + (e.clientY - 2) + 'px)';
    }, true);
    const title = document.createElement('div');
    title.id = 'reel-title';
    title.appendChild(document.createElement('span'));
    document.documentElement.appendChild(title);
  };
  if (document.documentElement) build();
  document.addEventListener('DOMContentLoaded', build);
})();`;
}

/** Shows the title card over the page, or takes it away (`null`). `cut` puts it there without its entrance. */
async function title(page: Page, text: string | null, options: { dim?: number; cut?: boolean } = {}): Promise<void> {
  await page.evaluate(
    ({ text, dim, cut }) => {
      const el = document.getElementById('reel-title');
      const span = el?.querySelector('span');
      if (!el || !span) return;
      el.classList.toggle('cut', cut);
      el.style.setProperty('--dim', String(dim));
      if (text !== null) span.innerHTML = text;
      el.classList.toggle('on', text !== null);
    },
    { text, dim: options.dim ?? 0.5, cut: options.cut ?? false },
  );
}

interface Framing {
  /** How far in the camera is: 1 shows the whole window. */
  readonly scale: number;
  /** The point of the window, as laid out, at the middle of the frame. */
  readonly x: number;
  readonly y: number;
}

const WIDE: Framing = { scale: 1, x: W / 2, y: H / 2 };

/** Moves the camera to `to`, over `ms` (0 cuts). The app's root is what moves; the frame never shows past its edge. */
async function camera(page: Page, to: Framing, ms = 0, easing = 'cubic-bezier(0.3, 0.1, 0.2, 1)'): Promise<void> {
  await page.evaluate(
    ({ to, ms, easing, W, H }) => {
      const root = document.getElementById('root');
      if (!root) return;
      const tx = Math.min(0, Math.max(W - W * to.scale, W / 2 - to.x * to.scale));
      const ty = Math.min(0, Math.max(H - H * to.scale, H / 2 - to.y * to.scale));
      root.style.transformOrigin = '0 0';
      root.style.willChange = 'transform';
      root.style.transition = ms > 0 ? `transform ${ms}ms ${easing}` : 'none';
      root.style.transform = `translate(${tx}px, ${ty}px) scale(${to.scale})`;
    },
    { to, ms, easing, W, H },
  );
}

/** The middle of an element as the window lays it out. Ask with the camera wide. */
async function middle(target: Locator): Promise<{ x: number; y: number }> {
  const box = await target.boundingBox();
  if (!box) throw new Error('That element is not on screen');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

interface Frame {
  readonly file: string;
  readonly at: number;
}

/**
 * Captures what the page draws while `act` runs and for the rest of
 * `seconds`, and writes the shot as a lossless clip of exactly that length.
 * A shot whose actions ran long (the engine redraws at every step of a
 * drag) is played faster, never cut short.
 */
async function shot(page: Page, id: string, seconds: number, act: () => Promise<void>): Promise<string> {
  const dir = join(workDir, id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const client: CDPSession = await page.context().newCDPSession(page);
  const frames: Frame[] = [];
  client.on('Page.screencastFrame', (event) => {
    const file = `f${String(frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(join(dir, file), Buffer.from(event.data, 'base64'));
    frames.push({ file, at: event.metadata.timestamp ?? Date.now() / 1000 });
    void client.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
  });
  await client.send('Page.startScreencast', { format: 'jpeg', quality: 94, everyNthFrame: 1 });
  const started = Date.now();
  await act();
  const speed = Math.max(1, (Date.now() - started) / 1000 / seconds);
  const left = seconds * 1000 + 300 - (Date.now() - started);
  if (left > 0) await page.waitForTimeout(left);
  await client.send('Page.stopScreencast');
  await client.detach();
  if (frames.length === 0) throw new Error(`The ${id} shot drew no frames`);
  const took = (Date.now() - started) / 1000;
  console.log(`${id}: ${frames.length} frames in ${took.toFixed(1)} s, played at ${speed.toFixed(2)}x`);

  // Each frame is shown until the next one was drawn; the last one until the shot ends.
  const first = frames[0]!.at;
  const lines = ['ffconcat version 1.0'];
  frames.forEach((frame, index) => {
    const next = frames[index + 1]?.at ?? first + took + 1;
    lines.push(`file '${frame.file}'`, `duration ${Math.max((next - frame.at) / speed, 0.001).toFixed(4)}`);
  });
  lines.push(`file '${frames[frames.length - 1]!.file}'`);
  writeFileSync(join(dir, 'frames.ffconcat'), lines.join('\n') + '\n');
  const clip = join(workDir, `${id}.mkv`);
  ffmpeg([
    '-f', 'concat', '-safe', '0', '-i', join(dir, 'frames.ffconcat'),
    '-vf', `fps=${FPS},scale=${W}:${H}:flags=lanczos,format=yuv420p`,
    '-t', String(seconds),
    '-c:v', 'libx264', '-qp', '0', '-preset', 'veryfast',
    clip,
  ]);
  return clip;
}

function ffmpeg(args: readonly string[]): void {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}

/** Moves the pointer there the way a hand does: eased, over `ms`. */
async function glide(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, ms: number): Promise<void> {
  const steps = Math.max(2, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    await page.mouse.move(from.x + (to.x - from.x) * eased, from.y + (to.y - from.y) * eased);
    await page.waitForTimeout(16);
  }
}

/**
 * Takes the pointer out of the picture. Moving the mouse out of the window is not enough: the page is
 * told nothing about a mouse outside it, so the drawn pointer would stay where it last was.
 */
async function pointerAway(page: Page): Promise<void> {
  await page.mouse.move(-50, -50);
  await page.evaluate(() => {
    const pointer = document.getElementById('reel-pointer');
    if (pointer) pointer.style.transform = 'translate(-100px, -100px)';
  });
}

/** Presses a button the camera may have moved out of the window, where the mouse cannot reach it. */
async function press(target: Locator): Promise<void> {
  await target.first().evaluate((el: HTMLElement) => el.click());
}

interface DriveEntry {
  readonly depth: number;
  readonly name: string;
  readonly isFolder: boolean;
  readonly size: number;
}

/** The library's folders and files as they lie in the Drive, depth first, folders before files. */
async function driveTree(drive: FakeDrive): Promise<DriveEntry[]> {
  const out: DriveEntry[] = [];
  const walk = async (id: string, depth: number): Promise<void> => {
    const q = encodeURIComponent(`'${id}' in parents and trashed = false`);
    const res = await drive.fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,size)&pageSize=1000`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    const body = (await res.json()) as { files: { id: string; name: string; mimeType: string; size?: string }[] };
    const isFolder = (f: { mimeType: string }) => f.mimeType === 'application/vnd.google-apps.folder';
    const sorted = [...body.files].sort((a, b) => Number(isFolder(b)) - Number(isFolder(a)) || a.name.localeCompare(b.name));
    for (const f of sorted) {
      out.push({ depth, name: f.name, isFolder: isFolder(f), size: Number(f.size ?? 0) });
      if (isFolder(f)) await walk(f.id, depth + 1);
    }
  };
  await walk(drive.rootId, 0);
  return out;
}

function megabytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const FOLDER_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';
const PHOTO_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';
const TEXT_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>';

interface EditStep extends ReadonlyArray<unknown> {
  readonly 0: string;
  readonly 1: Record<string, unknown>;
}

/** The edit the timelapse replays: demo-reel-edit.json, a real edit's History, step by step. */
const EDIT = JSON.parse(readFileSync(join(here, 'demo-reel-edit.json'), 'utf8')) as { photo: string; steps: EditStep[] };

/**
 * The photograph behind the end card: REEL_END, by default
 * demo-reel-end.jpg beside this script (long shadows under trees, as
 * edited in the app), scaled to the size the reel is captured at so the
 * page that shows it stays small.
 */
function endPhoto(): Buffer {
  const source = process.env.REEL_END ?? join(here, 'demo-reel-end.jpg');
  if (!existsSync(source)) throw new Error(`No photograph for the end card: ${source} (set REEL_END)`);
  const scaled = join(workDir, 'end-photo.jpg');
  // sips keeps the photograph's orientation, which the browser then honours.
  execFileSync('sips', ['-Z', String(W * 2), '-s', 'formatOptions', '88', source, '--out', scaled], { stdio: 'ignore' });
  return readFileSync(scaled);
}

/** The end card's line, under the wordmark. */
const TAGLINE = 'Your photos on your own cloud storage.';

/**
 * Pictures of the library in Google Drive itself, one for each folder on the way down to a day's originals,
 * and the row that is opened in each (0 is the first). All are captures of drive.google.com in list view,
 * taken the same way (docs/photonamous-demo-reel.md), so a row is in the same place in every one.
 */
const DRIVE_LEVELS: readonly { readonly file: string; readonly opens: number | null }[] = [
  { file: 'demo-reel-drive-1.png', opens: 3 }, // My Drive > Photonamous: Originals is its fourth row
  { file: 'demo-reel-drive-2.png', opens: 0 }, // Originals: 2026
  { file: 'demo-reel-drive-3.png', opens: 0 }, // 2026: 2026-10-25
  { file: 'demo-reel-drive-4.png', opens: null }, // 2026-10-25: the RAW files
];
/** Where the list's rows are in those pictures, in their own pixels, and where on a row the pointer rests. */
const DRIVE_ROWS = { top: 316, height: 96, pointerX: 250 };

/** How long the last title takes to go. The wordmark waits for it: the two are never on screen together. */
const END_TITLE_OUT_MS = 650;

/** The last title, held over the end card's photograph, and the card it dissolves into (`endPage`). */
const END_CARD_CSS = `
    .dark { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.62); transition: opacity 800ms linear; }
    .title { position: fixed; inset: 0; display: grid; place-items: center; pointer-events: none; }
    .title span { display: block; max-width: 1300px; font: 900 136px/0.92 Inter, system-ui, sans-serif; letter-spacing: -0.015em; text-transform: uppercase; text-align: center; color: #fff; text-shadow: 0 6px 40px rgba(0, 0, 0, 0.65); opacity: 0; transform: scale(1.22); transition: transform 520ms cubic-bezier(0.16, 1, 0.3, 1), opacity 120ms linear; }
    .said .title span { opacity: 1; transform: scale(1); }
    .card { position: fixed; inset: 0; display: grid; place-content: center; justify-items: center; gap: 14px; pointer-events: none; }
    .card img { width: 880px; height: auto; opacity: 0; transform: scale(1.06); transition: transform 1500ms cubic-bezier(0.16, 1, 0.3, 1), opacity 750ms linear; }
    .card p { max-width: 900px; font-size: 46px; line-height: 1.18; font-weight: 700; letter-spacing: -0.02em; text-align: center; color: #fff; opacity: 0; transform: translateY(10px); transition: transform 900ms cubic-bezier(0.16, 1, 0.3, 1) 250ms, opacity 700ms linear 250ms; }
    .end .dark { opacity: 0; }
    .end .title span { opacity: 0; transition: opacity ${END_TITLE_OUT_MS}ms linear; }
    .end .card img, .end .card p { opacity: 1; transform: none; }
    .end .card img { transition-delay: ${END_TITLE_OUT_MS}ms; }
    .end .card p { transition-delay: ${END_TITLE_OUT_MS + 250}ms; }`;

/**
 * The Drive shot from real pictures (`DRIVE_LEVELS`): the pointer opens Photonamous' Originals, the year and
 * the day, one double-click each, with Drive's own grey under the pointer and blue on the click; then the
 * camera pulls back from the names to the whole rows of the day's RAW files. `window.play()` starts it.
 * The pointer is this page's own, dark and larger than the app's: the page is white.
 */
function realDrivePage(stills: readonly string[]): string {
  const opens = DRIVE_LEVELS.map((level) => level.opens).filter((row): row is number => row !== null);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; }
    html, body { overflow: hidden; background: #fff; height: 100vh; }
    .cam { position: absolute; left: 0; top: 0; width: 2238px; transform-origin: 0 0; transform: translate(56px, 190px); }
    .cam.wide { transform: translate(26px, 300px) scale(0.62); transition: transform 1000ms cubic-bezier(0.3, 0, 0.2, 1); }
    .level { position: absolute; left: 0; top: 0; width: 2238px; visibility: hidden; }
    .level.on { visibility: visible; }
    .band { position: absolute; left: 0; width: 2238px; height: ${DRIVE_ROWS.height - 2}px; background: #ededed; mix-blend-mode: multiply; display: none; }
    .band.picked { background: #c2e7ff; }
    .pointer { position: absolute; left: -5px; top: -3px; width: 34px; height: 34px; transform: translate(760px, 880px); transition: opacity 160ms linear; }
    .pointer svg { display: block; transform-origin: 5px 3px; transition: transform 60ms linear; }
    .pointer.down svg { transform: scale(0.84); }
  </style></head><body>
    <div class="cam">
      ${stills.map((still, index) => `<img class="level${index === 0 ? ' on' : ''}" src="data:image/png;base64,${still}" alt="">`).join('')}
      <div class="band"></div>
      <div class="pointer"><svg viewBox="0 0 22 22" width="34" height="34"><path d="M3 2l15 8.2-6.4 1.7L8.9 18z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg></div>
    </div>
    <script>
      const ROWS = ${JSON.stringify(DRIVE_ROWS)};
      const OPENS = ${JSON.stringify(opens)};
      const levels = [...document.querySelectorAll('.level')];
      const cam = document.querySelector('.cam');
      const band = document.querySelector('.band');
      const pointer = document.querySelector('.pointer');
      const wait = (ms) => new Promise((done) => setTimeout(done, ms));
      /** The grey Drive puts under the pointer, on that row; null takes it away. */
      const hover = (row) => {
        band.classList.remove('picked');
        band.style.display = row === null ? 'none' : 'block';
        if (row !== null) band.style.top = ROWS.top + ROWS.height * row + 'px';
      };
      const press = async () => {
        pointer.classList.add('down');
        await wait(80);
        pointer.classList.remove('down');
        await wait(70);
      };
      window.play = async () => {
        let on = null;
        await wait(250);
        for (let level = 0; level < OPENS.length; level++) {
          const row = OPENS[level];
          if (row !== on) {
            // The pointer travels to the row; the grey comes as it arrives.
            const ms = level === 0 ? 420 : 240;
            pointer.style.transition = 'transform ' + ms + 'ms cubic-bezier(0.3, 0, 0.2, 1), opacity 160ms linear';
            pointer.style.transform = 'translate(' + ROWS.pointerX + 'px,' + (ROWS.top + ROWS.height * (row + 0.5)) + 'px)';
            await wait(ms * 0.8);
            hover(row);
            await wait(ms * 0.2 + 140);
          } else {
            await wait(330);
          }
          // A double-click: the first selects the row (Drive's blue), the second opens it.
          await press();
          band.classList.add('picked');
          await press();
          await wait(60);
          levels.forEach((el, index) => el.classList.toggle('on', index === level + 1));
          // The pointer has not moved: it is over that row of the folder that opened, if it has one.
          on = row;
          hover(level + 1 < OPENS.length && OPENS[level + 1] !== row ? null : row);
        }
        await wait(200);
        hover(null);
        pointer.style.opacity = '0';
        cam.classList.add('wide');
      };
    </script>
  </body></html>`;
}

/**
 * The last shot: a photograph from the library filling the frame, drifting. The last title is said over it
 * in the dark (`said` on the body), then dissolves into the end card (`end`): the dark lifts as the title
 * goes, and only when it has gone do the wordmark and the line under it come up.
 */
function endPage(photoBase64: string, fontUrl: string, wordmarkUrl: string, lastTitle: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face { font-family: Inter; src: url('${fontUrl}') format('woff2'); font-weight: 100 900; }
    * { box-sizing: border-box; margin: 0; }
    html, body { overflow: hidden; background: #000; height: 100vh; font-family: Inter, system-ui, sans-serif; }
    .photo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; animation: drift 6.6s cubic-bezier(0.2, 0.6, 0.3, 1) forwards; }
    .shade { position: absolute; inset: 0; background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.62) 0%, rgba(0, 0, 0, 0.5) 45%, rgba(0, 0, 0, 0.72) 100%); }
    @keyframes drift { from { transform: scale(1.16); } to { transform: scale(1.02); } }
    ${END_CARD_CSS}
  </style></head><body>
    <img class="photo" src="data:image/jpeg;base64,${photoBase64}" alt="">
    <div class="shade"></div>
    <div class="dark"></div>
    <div class="title"><span>${lastTitle}</span></div>
    <div class="card"><img src="${wordmarkUrl}" alt=""><p>${TAGLINE}</p></div>
  </body></html>`;
}

/**
 * The Drive shot's page when there is no picture of the real thing: the
 * tree the app wrote to the fake Drive, its rows arriving one after another
 * while the camera drifts in.
 */
function drivePage(entries: readonly DriveEntry[], fontUrl: string): string {
  // The library's own bookkeeping is one line each; the photos are what a visitor cares to see.
  const rows: DriveEntry[] = [];
  let hiddenBelow: number | null = null;
  for (const entry of entries) {
    if (hiddenBelow !== null && entry.depth > hiddenBelow) continue;
    hiddenBelow = entry.isFolder && (entry.name === 'Library data' || entry.name === 'Exports' || entry.name === 'Lopsy documents') ? entry.depth : null;
    rows.push(entry);
  }
  const shown = rows.slice(0, 17);
  const iconFor = (entry: DriveEntry): string => (entry.isFolder ? FOLDER_ICON : DEVELOPED.test(entry.name) || RAW.test(entry.name) ? PHOTO_ICON : TEXT_ICON);
  const items = shown
    .map(
      (entry, index) =>
        `<li style="padding-left:${30 + entry.depth * 36}px;animation-delay:${(0.08 + index * 0.085).toFixed(3)}s" class="${entry.isFolder ? 'folder' : 'file'}">` +
        `<span class="icon">${iconFor(entry)}</span><span class="name">${entry.name}</span>` +
        `<span class="size">${entry.isFolder ? '' : megabytes(entry.size)}</span></li>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face { font-family: Inter; src: url('${fontUrl}') format('woff2'); font-weight: 100 900; }
    * { box-sizing: border-box; margin: 0; }
    html, body { overflow: hidden; background: #000; }
    body { color: #e0e0e0; font-family: Inter, system-ui, sans-serif; height: 100vh; }
    .drive { height: 100vh; padding: 64px 104px; background: #1e1e1e; transform-origin: 30% 30%; animation: drift 3.4s cubic-bezier(0.2, 0.6, 0.3, 1) forwards; }
    .where { font-size: 24px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #6cb6ff; }
    h1 { margin-top: 10px; font-size: 62px; font-weight: 800; letter-spacing: -0.03em; }
    h1 span { color: #8a8a8a; font-weight: 600; }
    ul { list-style: none; margin-top: 34px; padding: 12px 0; background: #252526; border: 1px solid #404040; border-radius: 16px; }
    li { display: flex; align-items: center; gap: 16px; height: 51px; padding-right: 30px; font-size: 25px; opacity: 0; animation: arrive 0.32s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .icon { display: flex; color: #adadad; }
    .folder .icon { color: #6cb6ff; }
    .folder .name { font-weight: 650; }
    .size { margin-left: auto; color: #adadad; font-size: 21px; font-variant-numeric: tabular-nums; }
    @keyframes arrive { from { opacity: 0; transform: translateX(-26px); } to { opacity: 1; transform: none; } }
    @keyframes drift { from { transform: scale(1.14); } to { transform: scale(1); } }
  </style></head><body>
    <div class="drive">
      <p class="where">In your Google Drive</p>
      <h1><span>My Drive /</span> Photonamous</h1>
      <ul>${items}</ul>
    </div>
  </body></html>`;
}

test('record the demo reel', async ({ page, baseURL }) => {
  const files = photoFiles();
  test.skip(files.length === 0, 'Set REEL_PHOTOS to a folder of photos to fill the library with');
  const hero = heroFile();
  if (!hero) throw new Error(`Set REEL_HERO to the photo the timelapse edits: ${EDIT.photo}`);
  mkdirSync(workDir, { recursive: true });
  const megs = files.reduce((sum, f) => sum + statSync(f).size, 0) / 1024 / 1024;
  console.log(`Importing ${files.length} photos (${megs.toFixed(0)} MB) from ${photosDir}; developing ${hero}`);

  // What went wrong, if the page stops: a recording has no assertion to say it.
  page.on('crash', () => console.log('The page crashed'));
  page.on('pageerror', (error) => console.log(`Page error: ${error.message}`));

  const fontUrl = `${baseURL}/fonts/inter-normal-latin.woff2`;
  const drive = await routeFakeDrive(page.context());
  await page.context().addInitScript(gisStubInitScript());
  await page.context().addInitScript(stageScript(fontUrl));

  // Off camera: sign in, fill the library, make the tiles small, give it some ratings.
  await page.goto('/');
  await page.getByRole('button', { name: 'Try it now' }).click();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible({ timeout: 60_000 });
  console.log('Signed in');
  await page.getByRole('button', { name: /Import photos/ }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: /Choose photos/ }).click();
  await (await chooser).setFiles(files);
  await page.getByRole('button', { name: /^Import \d+ photo/ }).click();
  console.log('Import started');
  await expect(importStrip(page))
    .toHaveCount(0, { timeout: Number(process.env.REEL_IMPORT_MS ?? 10 * 60_000) })
    .catch(async (error: unknown) => {
      await page.screenshot({ path: join(workDir, 'stuck-import.png') });
      console.log(`The import did not finish: ${await importStrip(page).innerText().catch(() => '?')}`);
      throw error;
    });
  console.log('Imported');
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page).first()).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Thumbnail size').fill(process.env.REEL_THUMB ?? '168');
  await page.waitForTimeout(600);
  // Only tiles wholly in view are touched: a click on one that is not would scroll the grid.
  const inView: { index: number; x: number; y: number }[] = [];
  for (let i = 0; i < (await tiles(page).count()); i++) {
    const box = await tiles(page).nth(i).boundingBox();
    if (box && box.y > 240 && box.y + box.height < H - 20) inView.push({ index: i, x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }
  if (inView.length === 0) throw new Error('No tile is in view');
  /** The tile the second shot picks: the one nearest the middle of the grid, clear of the toolbar and the sidebar. */
  const star = inView.reduce((best, tile) =>
    Math.hypot(tile.x - W * 0.47, tile.y - H * 0.58) < Math.hypot(best.x - W * 0.47, best.y - H * 0.58) ? tile : best,
  );
  const ratings = ['5', '4', '5', '3', '4', '5', '4', '5', '3'];
  for (let i = 0; i < ratings.length; i++) {
    const tile = inView[(i * 5 + 1) % inView.length]!;
    if (tile.index === star.index) continue; // the second shot rates this one on camera
    await page.mouse.click(tile.x, tile.y);
    await page.keyboard.press(ratings[i]!);
  }
  await page.keyboard.press('Escape');
  console.log('Rated');
  // The header should read Saved in the film; if the library is still saving after a while, say so and go on.
  await expect(page.getByRole('button', { name: /Saved/ }))
    .toBeVisible({ timeout: 90_000 })
    .catch(async () => console.log(`Not saved yet: ${await page.getByRole('banner').innerText().catch(() => '?')}`));
  await pointerAway(page);
  await page.waitForTimeout(800);

  const clips: string[] = [];
  const grid = { x: W * 0.47, y: H * 0.5 };

  // 1. The library, drifting in under the first title. The title is up from the first frame: that frame is the poster.
  await camera(page, { scale: 1.3, x: grid.x, y: grid.y + 40 });
  await title(page, 'Your<br>photos.', { dim: 0.42, cut: true });
  await page.waitForTimeout(400);
  clips.push(
    await shot(page, '1-library', 2.3, async () => {
      await camera(page, { scale: 1.12, x: grid.x, y: grid.y + 120 }, 2500, 'cubic-bezier(0.2, 0.5, 0.3, 1)');
      await page.waitForTimeout(1400);
      await title(page, null);
      await page.waitForTimeout(700);
    }),
  );

  // 2. Close on one tile: picked, then five stars.
  await title(page, null, { cut: true });
  await camera(page, { scale: 2.5, x: star.x + 30, y: star.y + 10 });
  await page.mouse.move(star.x + 150, star.y + 90);
  await page.waitForTimeout(300);
  clips.push(
    await shot(page, '2-pick', 1.3, async () => {
      await camera(page, { scale: 2.8, x: star.x + 10, y: star.y + 14 }, 1500, 'linear');
      await glide(page, { x: star.x + 150, y: star.y + 90 }, { x: star.x + 12, y: star.y + 8 }, 300);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(240);
      await page.keyboard.press('5');
      await page.waitForTimeout(460);
    }),
  );
  await camera(page, WIDE);

  // Off camera: a second page with a library in this browser, the hero photo in its Edit view, settled at full size.
  const editor = await page.context().newPage();
  editor.on('pageerror', (error) => console.log(`Page error: ${error.message}`));
  await editor.goto('/');
  await editor.getByRole('button', { name: /This browser/ }).click();
  await editor.getByRole('button', { name: /Import photos/ }).first().click();
  const heroChooser = editor.waitForEvent('filechooser');
  await editor.getByRole('menuitem', { name: /Choose photos/ }).click();
  await (await heroChooser).setFiles([hero]);
  await editor.getByRole('button', { name: /^Import 1 photo/ }).click();
  await expect(importStrip(editor)).toHaveCount(0, { timeout: 5 * 60_000 });
  await editor.getByRole('button', { name: /^All photos/ }).click();
  await tiles(editor).first().click();
  await editor.keyboard.press('Enter');
  await waitForReady(editor, 120_000);
  await editor.waitForTimeout(5000);
  const edit = editor.getByTestId('edit-view');
  const applyStep = ([label, changes]: EditStep): Promise<void> =>
    editor.evaluate(
      async ({ label, changes }) => {
        const { useUi } = await import('/src/app/store.ts');
        const { connection, editing } = useUi.getState();
        if (!connection || !editing) throw new Error('No photo is open in the Edit view');
        connection.session.editRecipe(editing.versionId, changes, label);
      },
      { label, changes },
    );
  // The crop goes on first, off camera. A crop changes the size of the photograph on screen, and that in the
  // middle of a camera move reads as a jump. The steps the film shows change only how the photograph looks.
  const changesShape = ([, changes]: EditStep): boolean => Object.keys(changes).some((key) => key.startsWith('framing.'));
  for (const step of EDIT.steps.filter(changesShape)) await applyStep(step);
  await editor.waitForTimeout(1500);

  // Where the photograph is: the split view lays its divider's track over exactly that. Shots 3 and 4 are
  // one framing, found here: the timelapse moves in to it and the split view cuts in with the camera still.
  const splitButton = edit.getByRole('button', { name: 'Split' });
  const divider = editor.getByTestId('split-divider');
  await press(splitButton);
  await editor.waitForTimeout(900);
  const picture = await divider.evaluate((el: HTMLElement) => {
    const stage = el.parentElement?.getBoundingClientRect() ?? new DOMRect();
    const px = (name: string) => parseFloat(el.style.getPropertyValue(name)) || 0;
    return { x: stage.left + px('--split-left'), y: stage.top + px('--split-top'), width: px('--split-width'), height: px('--split-height') };
  });
  if (picture.width <= 0 || picture.height <= 0) throw new Error('The split view did not say where the photograph is');
  /** The whole photograph, edge to edge the long way. */
  const whole: Framing = {
    scale: Math.min(W / picture.width, H / picture.height) * 0.97,
    x: picture.x + picture.width / 2,
    y: picture.y + picture.height / 2,
  };
  await camera(editor, whole);
  await editor.waitForTimeout(100);
  // The camera has scaled the page, and the divider works its place out from lengths as laid out. So the
  // mouse goes where the divider reads the fraction wanted, and the pointer is drawn where that shows: on
  // the divider. (A mouse aimed at the picture as laid out lands on the photograph and drags that instead.)
  const track = await divider.evaluate((el: HTMLElement) => {
    const stage = el.parentElement?.getBoundingClientRect() ?? new DOMRect();
    const handle = el.getBoundingClientRect();
    const px = (name: string) => parseFloat(el.style.getPropertyValue(name)) || 0;
    return {
      stageLeft: stage.left,
      left: px('--split-left'),
      width: px('--split-width'),
      // The divider's knob, half way down.
      handle: { x: handle.left + handle.width / 2, y: handle.top + handle.height / 2 },
    };
  });
  /** Where the mouse goes for the divider to read `fraction`. */
  const at = (fraction: number) => ({ x: track.stageLeft + track.left + track.width * fraction, y: track.handle.y });
  /** Where the divider shows when it is there. */
  const shows = (fraction: number) => ({ x: track.stageLeft + (track.left + track.width * fraction) * whole.scale, y: track.handle.y });
  const dividerAt = () => divider.evaluate((el) => Number(el.getAttribute('aria-valuenow')) / 100);
  // The divider waits at the photograph's left edge, where everything right of it is the edit: the cut to
  // the split view then changes nothing in the photograph, and the before comes in as the divider is dragged.
  await editor.mouse.move(track.handle.x, track.handle.y);
  await editor.mouse.down();
  await editor.mouse.move(at(0.25).x, at(0.25).y);
  await editor.mouse.move(at(0).x, at(0).y);
  await editor.mouse.up();
  if ((await dividerAt()) !== 0) throw new Error('The divider did not go to the left edge');
  await press(splitButton);
  await pointerAway(editor);

  // 3. The timelapse: a real edit of this photo, every step of it in order, as its History recorded them.
  // The steps go to the library the way the Edit view sends its own (LibrarySession.editRecipe), so the
  // sliders, the History list and the photograph all follow. The camera moves in and comes to rest on the
  // whole photograph before the shot ends.
  const PUSH_MS = 4800;
  await camera(editor, { ...whole, scale: Math.max(1, whole.scale / 1.1) });
  await editor.waitForTimeout(600);
  clips.push(
    await shot(editor, '3-timelapse', 5.6, async () => {
      const began = Date.now();
      await camera(editor, whole, PUSH_MS, 'cubic-bezier(0.25, 0.3, 0.35, 1)');
      // Two titles, a cut between them; the edit starts under the second.
      await title(editor, 'Professional<br>editing.', { dim: 0.34 });
      await editor.waitForTimeout(950);
      await title(editor, 'In your<br>web browser.', { dim: 0.34, cut: true });
      await editor.waitForTimeout(350);
      let step = 0;
      for (const editStep of EDIT.steps.filter((each) => !changesShape(each))) {
        if (++step === 8) await title(editor, null);
        await applyStep(editStep);
        await editor.waitForTimeout(Number(process.env.REEL_STEP_MS ?? 86));
      }
      const moving = PUSH_MS + 100 - (Date.now() - began);
      if (moving > 0) await editor.waitForTimeout(moving);
      // The pointer comes in to where the divider is about to be.
      await glide(editor, { x: shows(0).x - 260, y: H + 40 }, shows(0), 420);
    }),
  );

  // 4. Before and after, cut in on the same framing. The camera holds still on the whole photograph; only
  // the divider moves, across and back.
  await press(splitButton);
  await editor.waitForTimeout(900);
  if ((await dividerAt()) !== 0) throw new Error('The divider did not stay at the left edge');
  clips.push(
    await shot(editor, '4-before-after', 2.7, async () => {
      await editor.waitForTimeout(200);
      await editor.mouse.down();
      await editor.evaluate((map) => Object.assign(window, { __reelPointerMap: map }), {
        origin: track.stageLeft,
        scale: whole.scale,
      });
      await glide(editor, at(0), at(0.88), 700);
      await glide(editor, at(0.88), at(0.12), 780);
      await glide(editor, at(0.12), at(0.6), 560);
      await editor.mouse.up();
      await editor.waitForTimeout(150);
    }),
  );
  if (Math.abs((await dividerAt()) - 0.6) > 0.02) throw new Error('The divider did not follow the drag');
  await editor.evaluate(() => Object.assign(window, { __reelPointerMap: null }));
  await press(splitButton);
  await camera(editor, WIDE);
  await pointerAway(editor);
  await editor.waitForTimeout(600);

  // 5. The claims, over the darkened editor: one, then a cut to the other.
  clips.push(
    await shot(editor, '5-no-servers', 1.1, async () => {
      await title(editor, 'No<br>servers.', { dim: 0.86 });
      await editor.waitForTimeout(900);
    }),
  );
  await title(editor, null, { dim: 0.86, cut: true });
  await editor.evaluate(() => {
    // The dark stays between the two titles; only the words change.
    const el = document.getElementById('reel-title');
    if (el) el.style.background = 'rgba(0, 0, 0, 0.86)';
  });
  await editor.waitForTimeout(150);
  clips.push(
    await shot(editor, '6-own-cloud', 1.2, async () => {
      await title(editor, 'Your own<br>cloud storage.', { dim: 0.86 });
      await editor.waitForTimeout(1000);
    }),
  );
  await editor.close();

  // 7. The Drive: the library's originals there, in Drive's own pages when there is a picture of them.
  const stills = DRIVE_LEVELS.map((level) => join(here, level.file));
  const hasStills = stills.every((still) => existsSync(still));
  await page.setContent(
    hasStills
      ? realDrivePage(stills.map((still) => readFileSync(still).toString('base64')))
      : '<!doctype html><html><body style="background:#fff"></body></html>',
    { waitUntil: 'load' },
  );
  if (hasStills) await page.evaluate(() => Promise.all(Array.from(document.images, (image) => image.decode())));
  const tree = hasStills ? '' : drivePage(await driveTree(drive), fontUrl);
  await page.waitForTimeout(300);
  clips.push(
    hasStills
      ? await shot(page, '7-drive', 4.3, async () => {
          await page.evaluate(() => (window as unknown as { play: () => Promise<void> }).play());
          await page.waitForTimeout(1400);
        })
      : await shot(page, '7-drive', 2.3, async () => {
          await page.setContent(tree, { waitUntil: 'load' });
          await page.waitForTimeout(2100);
        }),
  );

  // 8. The last title, held longer than the others, and a dissolve into the end card: the wordmark and the
  // line, over a photograph from the library.
  const wordmarkUrl = `${baseURL}/src/components/Wordmark/photonamous-wordmark-1440.png`;
  const endHtml = endPage(endPhoto().toString('base64'), fontUrl, wordmarkUrl, 'Completely<br>free.');
  await page.setContent('<!doctype html><html><body style="background:#000"></body></html>');
  clips.push(
    await shot(page, '8-free-end', 5.6, async () => {
      await page.setContent(endHtml, { waitUntil: 'load' });
      await page.evaluate(() => document.body.classList.add('said'));
      await page.waitForTimeout(1800);
      await page.evaluate(() => document.body.classList.add('end'));
      await page.waitForTimeout(3600);
    }),
  );

  // The reel: the shots end to end, encoded twice, and its first frame as the poster.
  const list = join(workDir, 'reel.ffconcat');
  writeFileSync(list, ['ffconcat version 1.0', ...clips.map((clip) => `file '${clip}'`)].join('\n') + '\n');
  const joined = ['-f', 'concat', '-safe', '0', '-i', list, '-an', '-r', String(FPS), '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
  ffmpeg([...joined, '-c:v', 'libsvtav1', '-crf', process.env.REEL_AV1_CRF ?? '44', '-preset', '3', '-g', String(FPS * 8), join(outDir, 'demo-reel.av1.mp4')]);
  ffmpeg([...joined, '-c:v', 'libx264', '-crf', process.env.REEL_H264_CRF ?? '30', '-preset', 'veryslow', '-profile:v', 'high', '-g', String(FPS * 8), join(outDir, 'demo-reel.h264.mp4')]);
  ffmpeg(['-i', clips[0]!, '-frames:v', '1', '-q:v', '5', join(outDir, 'demo-reel-poster.jpg')]);
  // A master to cut or encode from again without recording again, when a place for it is named.
  const master = process.env.REEL_MASTER;
  if (master) {
    ffmpeg([...joined.filter((arg) => arg !== '+faststart' && arg !== '-movflags'), '-c:v', 'libx264', '-crf', '14', '-preset', 'slow', master]);
    console.log(`master: ${megabytes(statSync(master).size)} at ${master}`);
  }
  for (const name of ['demo-reel.av1.mp4', 'demo-reel.h264.mp4', 'demo-reel-poster.jpg']) {
    console.log(`${name}: ${megabytes(statSync(join(outDir, name)).size)}`);
  }
  if (!process.env.REEL_KEEP_FRAMES) rmSync(workDir, { recursive: true, force: true });
});
