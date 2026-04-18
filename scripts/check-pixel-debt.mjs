#!/usr/bin/env node
// Enforces the GPU-only pixel data policy documented in docs/pixel-data-debt.md.
//
// Rejects `new ImageData`, `new Uint8ClampedArray`, and `new Float32Array`
// under src/ except in files that appear in the allowlist below, and fails
// if an allowlisted file exceeds its recorded baseline count.
//
// When you legitimately need to add a new entry, update this allowlist
// AND update docs/pixel-data-debt.md in the same PR.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(ROOT, 'src');

const PATTERN = /\bnew\s+(ImageData|Uint8ClampedArray|Float32Array)\b/g;

// Allowlist keyed by POSIX-style path relative to repo root.
// Each entry is the number of matches the file may contain. New code must
// keep counts steady or drive them down — never up.
const ALLOWLIST = {
  // Test files — fixtures allocate pixel buffers to exercise real code paths.
  'src/app/editor-store.test.ts': 3,
  'src/app/store/actions/align-layer.test.ts': 1,
  'src/app/store/actions/crop-canvas.test.ts': 1,
  'src/app/store/actions/duplicate-layer.test.ts': 1,
  'src/app/store/actions/flatten-image.test.ts': 1,
  'src/app/store/actions/layer-property-updates.test.ts': 2,
  'src/app/store/actions/merge-down.test.ts': 2,
  'src/app/store/actions/open-image.test.ts': 5,
  'src/app/store/actions/rasterize-style.test.ts': 1,
  'src/app/store/actions/remove-layer-mask.test.ts': 1,
  'src/app/store/actions/remove-layer.test.ts': 1,
  'src/app/store/actions/resize-canvas.test.ts': 1,
  'src/app/store/actions/resize-image.test.ts': 1,
  'src/engine/mask-utils.test.ts': 4,
  'src/engine/pixel-data-manager.test.ts': 2,
  'src/engine/pixel-data.test.ts': 1,
  'src/filters/curves.test.ts': 3,
  'src/selection/selection.test.ts': 14,
  'src/tools/brush/brush-from-selection.test.ts': 3,
  'src/tools/eraser/eraser.test.ts': 3,
  'src/tools/magnetic-lasso/magnetic-lasso.test.ts': 2,
  'src/tools/move/move.test.ts': 1,
  'src/tools/transform/transform.test.ts': 2,
  'src/utils/bmp-encoder.test.ts': 2,
  'src/test/canvas-mock.ts': 3,

  // Tracked pixel-data debt — documented in docs/pixel-data-debt.md §1.
  'src/engine/pixel-data.ts': 1,

  // Tracked mask debt — documented in docs/pixel-data-debt.md §3.
  'src/app/interactions/move-handlers.ts': 4,
  'src/app/store/actions/add-layer-mask.ts': 1,
  'src/engine/mask-utils.ts': 1,

  // Selection mask — explicitly OK per the policy table.
  'src/app/interactions/selection-handlers.ts': 4,
  'src/panels/LayerPanel/layer-selection.ts': 2,
  'src/panels/PathsPanel/path-to-selection.ts': 1,
  'src/selection/selection.ts': 4,
  'src/tools/lasso/lasso.ts': 1,
  'src/tools/transform/transform-mask.ts': 1,

  // GPU readback — explicitly OK per the policy table.
  'src/engine-wasm/gpu-pixel-access.ts': 4,
  'src/app/store/history-worker.ts': 2,

  // Export / file I/O — produce raw buffers for encoders.
  'src/app/MenuBar/menus/file-menu.ts': 1,
  'src/io/psd.ts': 1,

  // Wide-gamut ImageData plumbing — engine infrastructure.
  'src/engine/canvas-ops.ts': 1,
  'src/engine/color-space.ts': 5,

  // Brush engine scaffolding — stamps, shape data, ABR parsing.
  'src/app/brush-preset-store.ts': 7,
  'src/tools/brush/abr-parser.ts': 4,
  'src/tools/brush/brush-from-selection.ts': 4,
  'src/tools/brush/brush.ts': 1,

  // Transform matrices — Float32Array is the WebGL matrix shape.
  'src/app/OptionsBar/tool-options/TransformControls.tsx': 4,
  'src/app/interactions/transform-handlers.ts': 2,
  'src/tools/transform/transform.ts': 2,

  // Canvas interaction dummy upload — documented in-file.
  'src/app/useCanvasInteraction.ts': 1,
};

function walk(dir) {
  const results = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (name === 'node_modules' || name === 'pkg') continue;
      results.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(name)) {
      results.push(full);
    }
  }
  return results;
}

function countMatches(file) {
  const text = readFileSync(file, 'utf8');
  const m = text.match(PATTERN);
  return m ? m.length : 0;
}

function toPosix(p) {
  return p.split(sep).join('/');
}

const files = walk(SRC);
const violations = [];
const regressions = [];
const cleaned = [];

for (const file of files) {
  const rel = toPosix(relative(ROOT, file));
  const count = countMatches(file);
  if (count === 0) continue;

  const budget = ALLOWLIST[rel];
  if (budget === undefined) {
    violations.push({ file: rel, count });
    continue;
  }
  if (count > budget) {
    regressions.push({ file: rel, count, budget });
  } else if (count < budget) {
    cleaned.push({ file: rel, count, budget });
  }
}

let exitCode = 0;

if (violations.length > 0) {
  exitCode = 1;
  console.error('Pixel-debt check failed: new files contain banned allocations.');
  console.error('See docs/pixel-data-debt.md for the policy.');
  console.error('');
  for (const v of violations) {
    console.error(`  ${v.file}: ${v.count} allocation(s) — not in allowlist`);
  }
  console.error('');
}

if (regressions.length > 0) {
  exitCode = 1;
  console.error('Pixel-debt check failed: allowlisted files exceeded their budget.');
  console.error('');
  for (const r of regressions) {
    console.error(`  ${r.file}: ${r.count} found, budget ${r.budget}`);
  }
  console.error('');
}

if (cleaned.length > 0) {
  console.error('Pixel-debt check: allowlist is stale — these files have fewer allocations than recorded.');
  console.error('Reduce the budget in scripts/check-pixel-debt.mjs to lock in the improvement.');
  console.error('');
  for (const c of cleaned) {
    console.error(`  ${c.file}: ${c.count} found, budget ${c.budget}`);
  }
  console.error('');
  exitCode = 1;
}

if (exitCode === 0) {
  console.log('Pixel-debt check: OK.');
}

process.exit(exitCode);
