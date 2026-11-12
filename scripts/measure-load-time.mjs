#!/usr/bin/env node
// Measures initial load time of the production build, per
// docs/engine-migration-plan.md ("Budgets").
//
//   npm run build && node scripts/measure-load-time.mjs [--runs N] [--headed] [--software]
//
// Serves dist/ with `vite preview`, then does N cold loads, each in a
// freshly launched browser so nothing is cached. Per load it reports:
//
//   wasmInit      navigation start → wasm module fetched, compiled and ready
//   engineCreate  time inside createEngine (GL context + shader compilation)
//   wasmTransfer  bytes the browser downloaded for the .wasm file
//
// and prints the median and the slowest of each. The slowest engineCreate
// is usually the first run after the shaders change: the OS keeps a
// compiled-shader cache across browser launches, so only that run pays
// the full compile. That is what a first-time visitor pays, so it is
// reported separately instead of being averaged away.
//
// The GPU renderer string is printed too, because shader compile time on
// SwiftShader (software GL) says little about a real GPU; pass --software
// to measure SwiftShader on purpose.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = 41987;
const URL_BASE = `http://localhost:${PORT}/`;

const args = process.argv.slice(2);
const runsFlag = args.indexOf('--runs');
const runs = runsFlag === -1 ? 7 : Number(args[runsFlag + 1]);
const headed = args.includes('--headed');
const software = args.includes('--software');

if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
  console.error('No production build in dist/. Run: npm run build');
  process.exit(2);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function startPreview() {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => reject(new Error('vite preview did not start within 30s')), 30000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes(String(PORT))) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`vite preview exited early (code ${code})`));
    });
  });
}

async function measureOnce() {
  const browser = await chromium.launch({
    headless: !headed,
    // The default headless shell has no GPU; the full Chromium binary does.
    channel: 'chromium',
    args: software
      ? ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist']
      : ['--ignore-gpu-blocklist', '--enable-gpu'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(URL_BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => performance.getEntriesByName('lopsy:wasm-init').length > 0);
    await page
      .getByRole('dialog', { name: 'New Document' })
      .getByRole('button', { name: 'Create', exact: true })
      .click();
    await page.waitForFunction(() => performance.getEntriesByName('lopsy:engine-create').length > 0);

    return await page.evaluate(() => {
      const wasmInit = performance.getEntriesByName('lopsy:wasm-init')[0];
      const engineCreate = performance.getEntriesByName('lopsy:engine-create')[0];
      const wasmResource = performance
        .getEntriesByType('resource')
        .find((entry) => entry.name.endsWith('.wasm'));
      const gl = document.createElement('canvas').getContext('webgl2');
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      return {
        wasmInit: wasmInit.duration,
        engineCreate: engineCreate.duration,
        wasmTransfer: wasmResource ? wasmResource.transferSize : 0,
        renderer: gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown',
      };
    });
  } finally {
    await browser.close();
  }
}

const preview = await startPreview();
const samples = [];
try {
  for (let i = 0; i < runs; i++) {
    const sample = await measureOnce();
    samples.push(sample);
    console.log(
      `run ${i + 1}: wasmInit ${sample.wasmInit.toFixed(0)} ms, ` +
        `engineCreate ${sample.engineCreate.toFixed(0)} ms, wasmTransfer ${sample.wasmTransfer} bytes`,
    );
  }
} finally {
  preview.kill();
}

console.log(`\nrenderer: ${samples[0].renderer}`);
console.log(`${runs} cold loads (median / slowest):`);
for (const key of ['wasmInit', 'engineCreate']) {
  const values = samples.map((s) => s[key]);
  console.log(`  ${key.padEnd(13)} ${median(values).toFixed(0)} ms / ${Math.max(...values).toFixed(0)} ms`);
}
console.log(`  wasmTransfer  ${median(samples.map((s) => s.wasmTransfer))} bytes`);
