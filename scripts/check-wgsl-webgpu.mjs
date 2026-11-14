#!/usr/bin/env node
// Compiles every engine shader's WGSL with a browser's WebGPU compiler.
//
//   npm run wgsl:check            headless Chromium on SwiftShader
//   WGSL_ANGLE=metal npm run wgsl:check    on the real GPU instead
//
// The engine's shaders are written in WGSL and translated to GLSL at build
// time by naga (engine-rs/crates/lopsy-shaderc). naga accepting a file does
// not prove a WebGPU implementation will: Chromium's compiler rejects, for
// one, a `textureSample` after an early return that depends on a varying.
// The WebGL backend would never notice, so this check does.
//
// It runs the same translation the build does (through the lopsy-shaderc
// binary) to get the WGSL exactly as naga parsed it, with includes spliced
// in, then asks `device.createShaderModule` for its compilation messages.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SHADERS = join(ROOT, 'engine-rs/crates/lopsy-engine/src/gpu/shaders');

function wgslFiles(dir) {
  return readdirSync(dir).sort().flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return wgslFiles(path);
    return name.endsWith('.wgsl') ? [path] : [];
  });
}

/** Runs inside the page. */
async function compileAll(sources) {
  if (!navigator.gpu) return { reason: 'navigator.gpu is undefined', shaders: [] };
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return { reason: 'requestAdapter() returned null', shaders: [] };
  const device = await adapter.requestDevice();
  const shaders = [];
  for (const { name, code } of sources) {
    const { messages } = await device.createShaderModule({ code }).getCompilationInfo();
    shaders.push({
      name,
      errors: messages.filter((m) => m.type === 'error').map((m) => `line ${m.lineNum}: ${m.message}`),
    });
  }
  return { reason: null, shaders };
}

const outDir = mkdtempSync(join(tmpdir(), 'lopsy-wgsl-'));
let exitCode = 0;
try {
  const translated = spawnSync(
    'cargo',
    ['run', '--quiet', '--manifest-path', join(ROOT, 'engine-rs/Cargo.toml'), '-p', 'lopsy-shaderc', '--', SHADERS, outDir],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  if (translated.status !== 0) throw new Error('lopsy-shaderc failed');
  const sources = wgslFiles(outDir).map((path) => ({
    name: relative(outDir, path),
    code: readFileSync(path, 'utf8'),
  }));

  // WebGPU needs a secure context; http://127.0.0.1 is one.
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>wgsl check</title>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const angle = process.env.WGSL_ANGLE ?? 'swiftshader';
  const browser = await chromium.launch({
    args: ['--use-gl=angle', `--use-angle=${angle}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-unsafe-swiftshader'],
  });
  let result;
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    result = await page.evaluate(compileAll, sources);
  } finally {
    await browser.close();
    server.close();
  }

  if (result.reason) throw new Error(`WebGPU is not available in this browser: ${result.reason}`);
  const failed = result.shaders.filter((s) => s.errors.length > 0);
  for (const shader of failed) {
    console.error(`${shader.name}`);
    for (const error of shader.errors) console.error(`  ${error}`);
  }
  console.log(`WGSL check: ${result.shaders.length - failed.length} of ${result.shaders.length} shaders compile on WebGPU (${angle}).`);
  if (failed.length > 0) exitCode = 1;
} catch (e) {
  console.error(`WGSL check failed: ${e.message}`);
  exitCode = 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
process.exit(exitCode);
