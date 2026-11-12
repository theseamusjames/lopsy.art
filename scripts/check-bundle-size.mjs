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
const BUDGET = {
  'lopsy_wasm_bg.wasm': { raw: 4_228_519, gzip: 1_824_653 },
  'lopsy_wasm.js': { raw: 236_107, gzip: 26_666 },
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
