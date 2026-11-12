#!/usr/bin/env node
// Ratchet for raw WebGL usage in the Rust engine, per
// docs/engine-migration-plan.md (Phase 1).
//
// Feature code is moving off raw WebGL calls and onto the pass layer in
// `gpu/`. Until that is finished, this script pins how many raw GL
// references each file outside `gpu/` may contain. The numbers only go
// down:
//
//   - more references than the baseline  → fail (new GL debt)
//   - fewer references than the baseline → fail until the baseline is
//     lowered to match, so the ratchet never has slack in it
//
// A "reference" is a `WebGl*` type or constant path, or a `gl.method(`
// call. If you genuinely need a new raw GL call in a file that has not
// been converted yet, raise that file's number in the same PR and say why.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const ENGINE_SRC = join(ROOT, 'engine-rs', 'crates', 'lopsy-wasm', 'src');

// The pass layer and its backend live here and are allowed raw GL.
const BACKEND_DIR = 'gpu/';

const PATTERN = /\bWebGl\w+|\bgl\.[a-z_0-9]+\(/g;

// POSIX-style path relative to engine-rs/crates/lopsy-wasm/src → the
// number of raw GL references the file may contain. Sorted smallest
// first, which is also the rough conversion order.
const BASELINE = {
  'api/color_mode.rs': 1,
  'glyph_atlas.rs': 4,
  'api/filter/adjust.rs': 9,
  'clone_stamp_gpu.rs': 11,
  'smudge_gpu.rs': 12,
  'api/paint.rs': 13,
  'dab_pass_gpu.rs': 15,
  'api/filter/noise.rs': 17,
  'api/filter/preview.rs': 17,
  'api/fill.rs': 28,
  'selection_gpu.rs': 31,
  'stamp_preview_gpu.rs': 31,
  'thumbnail_gpu.rs': 35,
  'shape_gpu.rs': 36,
  'healing_brush_gpu.rs': 37,
  'effect_cache_gpu.rs': 40,
  'api/filter/render.rs': 42,
  'api/filter/blur.rs': 44,
  'layer_transform_gpu.rs': 45,
  'coverage_stroke_gpu.rs': 55,
  'api/filter/distort.rs': 57,
  'api/filter/stylize.rs': 70,
  'gradient_gpu.rs': 72,
  'mask_paint_gpu.rs': 94,
  'quick_mask_gpu.rs': 99,
  'filter_gpu.rs': 104,
  'engine.rs': 125,
  'brush_gpu.rs': 187,
  'layer_manager.rs': 446,
  'compositor.rs': 627,
};

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full));
    } else if (entry.endsWith('.rs')) {
      files.push(full);
    }
  }
  return files;
}

function countReferences(file) {
  const matches = readFileSync(file, 'utf8').match(PATTERN);
  return matches ? matches.length : 0;
}

const counts = new Map();
for (const file of walk(ENGINE_SRC)) {
  const rel = relative(ENGINE_SRC, file).split(sep).join('/');
  if (rel.startsWith(BACKEND_DIR)) continue;
  const count = countReferences(file);
  if (count > 0) counts.set(rel, count);
}

const errors = [];

for (const [file, count] of counts) {
  const allowed = BASELINE[file];
  if (allowed === undefined) {
    errors.push(
      `${file}: ${count} raw GL reference(s) in a file with no baseline. ` +
        'Use the pass layer in gpu/ instead of calling WebGL directly.',
    );
  } else if (count > allowed) {
    errors.push(
      `${file}: ${count} raw GL references, baseline is ${allowed}. ` +
        'Use the pass layer in gpu/ instead of adding WebGL calls.',
    );
  } else if (count < allowed) {
    errors.push(
      `${file}: ${count} raw GL references, baseline is ${allowed}. ` +
        `Lower its baseline to ${count} in scripts/check-gl-debt.mjs.`,
    );
  }
}

for (const file of Object.keys(BASELINE)) {
  if (!counts.has(file)) {
    errors.push(
      `${file}: no raw GL references left (or the file is gone). ` +
        'Remove its entry from scripts/check-gl-debt.mjs.',
    );
  }
}

const total = [...counts.values()].reduce((sum, n) => sum + n, 0);

if (errors.length > 0) {
  console.error('GL debt check failed:\n');
  for (const error of errors) console.error(`  ${error}`);
  console.error('\nSee docs/engine-migration-plan.md (Phase 1).');
  process.exit(1);
}

console.log(`GL debt: ${total} raw GL references in ${counts.size} files outside gpu/.`);
