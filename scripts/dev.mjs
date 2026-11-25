#!/usr/bin/env node
/**
 * `npm run dev`: every app's dev server at once, set up to hand off to each
 * other (docs/photonamous-setup.md, section 2): Lopsy on
 * http://localhost:5173/ and Photonamous on http://localhost:5174/. Each runs
 * its own `dev` script; `npm run dev:lopsy` or `npm run dev:photonamous`
 * starts one alone. Arguments go to both: `npm run dev -- --host`.
 *
 * Each app trusts only the other's origin, so the ports are fixed: if one is
 * taken, both stop instead of moving. Ctrl+C stops both, and so does either
 * one stopping. A handoff URL already set, in the shell or in the app's
 * `.env` files, wins over the one here.
 */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOPSY = 5173;
const PHOTONAMOUS = 5174;
const url = (port) => `http://localhost:${port}/`;

/** `name` as the app's own setup has it (the shell, then its `.env` files), else `fallback`. */
const setting = (dir, name, fallback) => ({
  [name]: loadEnv('development', resolve(root, dir), name)[name] ?? fallback,
});

const apps = [
  {
    name: 'lopsy',
    workspace: 'lopsy-web',
    port: LOPSY,
    env: setting('apps/lopsy-web', 'VITE_PHOTONAMOUS_URL', url(PHOTONAMOUS)),
  },
  {
    name: 'photonamous',
    workspace: 'photonamous',
    port: PHOTONAMOUS,
    env: setting('apps/photonamous', 'VITE_LOPSY_URL', url(LOPSY)),
  },
];

const windows = process.platform === 'win32';
const npm = process.env.npm_execpath; // npm's own script, when npm runs this one
const color = process.stdout.isTTY && !('NO_COLOR' in process.env) ? { FORCE_COLOR: '1' } : {};
const width = Math.max(...apps.map((app) => app.name.length));
const open = new Set();
let stopping = false;

/**
 * Stops every app still running. On POSIX each app is its own process group,
 * and the whole group is signalled: npm's `sh -c` does not hand over to Vite,
 * so killing npm alone would leave Vite running (MEMORY.md).
 */
function stop(signal) {
  stopping = true;
  for (const child of open) {
    if (windows) spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    else {
      try {
        process.kill(-child.pid, signal);
      } catch {
        // The group is gone already.
      }
    }
  }
}

console.log(`Lopsy on ${url(LOPSY)} and Photonamous on ${url(PHOTONAMOUS)}. Ctrl+C stops both.`);
for (const app of apps) {
  const args = ['run', 'dev', '-w', app.workspace, '--', '--port', String(app.port), '--strictPort'];
  const options = {
    cwd: root,
    env: { ...process.env, ...app.env, ...color },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group on POSIX (see stop); on Windows, Ctrl+C reaches every process in the console.
    detached: !windows,
  };
  const extra = process.argv.slice(2);
  const child = npm
    ? spawn(process.execPath, [npm, ...args, ...extra], options)
    : spawn('npm', [...args, ...extra], { ...options, shell: windows });
  const prefix = `${app.name.padEnd(width)} |`;
  for (const [from, to] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    createInterface({ input: from }).on('line', (line) => to.write(`${prefix} ${line}\n`));
  }
  open.add(child);
  child.on('error', (error) => {
    console.error(`${prefix} ${error.message}`);
    process.exitCode = 1;
    stop('SIGTERM');
  });
  // After 'close' all of its output has been written. The first app to stop by itself sets the exit code.
  child.on('close', (code) => {
    open.delete(child);
    if (!stopping && code) process.exitCode = code;
    stop('SIGTERM');
  });
}
// The terminal's Ctrl+C reaches only this process's group, so pass it on.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => stop(signal));
