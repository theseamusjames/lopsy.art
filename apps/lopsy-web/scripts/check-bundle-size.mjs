#!/usr/bin/env node
// Size budget for the engine bundle, per docs/engine-migration-plan.md
// ("Budgets"). Run after `npm run wasm:build`.
//
// The migration reshapes most of the engine, so its download size is
// checked on every PR rather than discovered at the end. This script
// measures the wasm binary and its JS glue and fails if either has grown
// more than MARGIN past its recorded budget.
//
// To accept a size increase, raise the budget below in the same PR and
// say why. When a PR makes the bundle meaningfully smaller, lower the
// budget so the saving is kept.
//
// The margin absorbs toolchain drift: the same source builds to slightly
// different sizes as rustc, wasm-pack and wasm-opt versions move.

import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PKG = join(ROOT, 'src', 'engine-wasm', 'pkg');

const MARGIN = 0.03;

// Bytes, as built by CI, which is where this check is enforced. A local
// build can differ by a percent or two (a macOS build of the same source
// came out 1.8% larger). `gzip` is what a typical visitor downloads.
//
// Raised in Phase 6.6 by what that step measurably added to a local build
// (39.5 KB of wasm, 0.9%; 1.5 KB of glue): a readback became a future the
// backend completes, and each of the 26 read exports a task that can wait
// for one. The wgpu build needs both, and the two builds share the engine.
//
// The glue was raised for Lopsy Photos' RAW develop exports (setRawDevelop,
// clearRawDevelop, rafRenderLinearBand, rafRenderBinnedLinear,
// rafDevelopDefaults, rafDevelopProfiles, readDevelopHistogram, autoTone,
// rafAutoWhiteBalance) by what they measurably added to the wasm-bindgen
// glue of a local release build: 7,596 B raw, 1,351 B gzip (+3.8 % and
// +6.4 %, past the margin on their own).
//
// The wasm was raised to what CI measured with those exports in (run
// 44283534311, commit 4c81d17: 4,366,533 B raw, 1,857,436 B gzip; +2.31 %
// and +0.89 % over the old budget): still inside the margin, but the
// colour controls that follow would otherwise eat the rest of it.
//
// The glue was raised again for Lopsy Photos' colour, detail, areas and
// finish exports (setImageColorGrading, setImageColorMixer, setImageDetail,
// setImageLocalContrast, setImageAreas, setImageAreaOverlay,
// setImageFinish, setImageDetailMaskView, setClippingWarning, their
// clears, exportTiff16, sampleNeutralWhiteBalance, rafWhiteBalancePresets
// and rafWhiteBalanceKelvin), to what a local build measured with them in:
// 216,567 B raw, 24,208 B gzip. The glue is wasm-bindgen output, so CI
// measures the same bytes (it did for the previous raise).
const BUDGET = {
  'lopsy_wasm_bg.wasm': { raw: 4_366_533, gzip: 1_857_436 },
  'lopsy_wasm.js': { raw: 216_567, gzip: 24_208 },
};

function format(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function percent(actual, budget) {
  const delta = ((actual - budget) / budget) * 100;
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%`;
}

if (!existsSync(PKG)) {
  console.error(`No engine build at ${PKG}. Run: npm run wasm:build`);
  process.exit(2);
}

const errors = [];

for (const [file, budget] of Object.entries(BUDGET)) {
  const bytes = readFileSync(join(PKG, file));
  const actual = { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
  for (const kind of ['raw', 'gzip']) {
    const line = `${file} ${kind}: ${actual[kind]} bytes (${format(actual[kind])}), budget ${budget[kind]} (${percent(actual[kind], budget[kind])})`;
    console.log(line);
    if (actual[kind] > budget[kind] * (1 + MARGIN)) {
      errors.push(line);
    }
  }
}

if (errors.length > 0) {
  console.error(`\nBundle size check failed: more than ${MARGIN * 100}% over budget.\n`);
  for (const error of errors) console.error(`  ${error}`);
  console.error('\nIf the growth is intended, raise the budget in scripts/check-bundle-size.mjs and explain why.');
  process.exit(1);
}

console.log('\nBundle size check: OK.');
