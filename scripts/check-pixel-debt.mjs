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
//
// When adding an entry, update docs/pixel-data-debt.md in the same PR if
// the file represents production code (not a test fixture or already-tracked
// engine plumbing). Comments below cross-reference the tracking issue when
// the debt has a GPU-port plan.
const ALLOWLIST = {
  // ──────────────────────────────────────────────────────────────────────
  // Test files — fixtures allocate pixel buffers to exercise real code
  // paths. These don't ship to users; they only need to round-trip.
  // ──────────────────────────────────────────────────────────────────────
  'src/app/editor-store.test.ts': 3,
  'src/app/interactions/quick-mask-move.test.ts': 2,
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
  'src/engine-wasm/engine-sync.test.ts': 3,
  'src/engine-wasm/sync-layers.test.ts': 5,
  'src/engine/pixel-data-manager.test.ts': 2,
  'src/engine/pixel-data.test.ts': 1,
  'src/filters/auto-enhance.test.ts': 1,
  'src/filters/curves.test.ts': 3,
  'src/filters/surface-blur.test.ts': 5,
  'src/io/project-save.test.ts': 1,
  'src/panels/AdjustmentsPanel/histogram-compute.test.ts': 2,
  'src/panels/ChannelsPanel/channel-extract.test.ts': 2,    // see #440 (delete with prod file)
  'src/selection/selection-to-path.test.ts': 2,
  'src/selection/selection.test.ts': 17,
  'src/test-setup.ts': 1,
  'src/test/canvas-mock.ts': 3,
  'src/tools/brush/brush-from-selection.test.ts': 3,
  'src/tools/crop/perspective-crop.test.ts': 3,             // see #441 (delete with prod file)
  'src/tools/gradient/gradient-interaction.test.ts': 2,
  'src/tools/magnetic-lasso/magnetic-lasso.test.ts': 2,
  'src/tools/move/move.test.ts': 1,
  'src/tools/path/boolean-ops.test.ts': 11,
  'src/tools/quick-select/quick-select.test.ts': 3,
  'src/tools/transform/transform.test.ts': 2,
  'src/utils/bmp-encoder.test.ts': 2,

  // ──────────────────────────────────────────────────────────────────────
  // Tracked pixel-data debt — documented in docs/pixel-data-debt.md §1.
  // The pixelDataManager ImageData orchestration layer; collapses to a
  // thin upload-and-forget wrapper once every filter has a GPU shader.
  // ──────────────────────────────────────────────────────────────────────
  'src/engine/pixel-data.ts': 1,

  // ──────────────────────────────────────────────────────────────────────
  // Tracked mask debt — documented in docs/pixel-data-debt.md §3.
  // Layer-mask CPU paint path; migration to mask_paint_dab.glsl pending.
  // ──────────────────────────────────────────────────────────────────────
  'src/app/interactions/move-handlers.ts': 5,
  'src/app/interactions/quick-mask-move.ts': 1,
  'src/app/store/actions/add-layer-mask.ts': 1,
  'src/app/useCanvasInteraction.ts': 3,                      // mask-buffer copies + 1×1 placeholder singleton
  'src/tools/fill/fill-interaction.ts': 1,                   // bucket fill writes mask data

  // ──────────────────────────────────────────────────────────────────────
  // Selection mask — explicitly OK per the policy table.
  // ──────────────────────────────────────────────────────────────────────
  'src/app/interactions/selection-handlers.ts': 6,
  'src/panels/LayerPanel/layer-selection.ts': 2,
  'src/panels/PathsPanel/path-to-selection.ts': 1,
  'src/selection/selection.ts': 13,                          // see #442 — feather pass should move to existing GPU helper
  'src/tools/lasso/lasso.ts': 1,
  'src/tools/transform/transform-mask.ts': 1,

  // ──────────────────────────────────────────────────────────────────────
  // GPU readback — explicitly OK per the policy table.
  // ──────────────────────────────────────────────────────────────────────
  'src/engine-wasm/gpu-pixel-access.ts': 4,
  'src/app/store/history-worker.ts': 2,

  // Quick mask GPU readback — selection mask from GPU texture.
  'src/app/interactions/quick-mask-ops.ts': 1,

  // ──────────────────────────────────────────────────────────────────────
  // File I/O — produce raw buffers for encoders / parsers / loaders.
  // ──────────────────────────────────────────────────────────────────────
  'src/app/MenuBar/menus/file-menu.ts': 2,                   // PNG export + JPEG export
  'src/io/project-load.ts': 1,                               // .lopsy project unpack
  'src/io/psd.ts': 1,

  // ──────────────────────────────────────────────────────────────────────
  // Clipboard — paste-from-clipboard wraps decoded bytes into ImageData
  // for the existing upload pipeline. Aliased views, not new heap. See §1.
  // ──────────────────────────────────────────────────────────────────────
  'src/app/store/clipboard-slice.ts': 2,

  // ──────────────────────────────────────────────────────────────────────
  // Wide-gamut ImageData plumbing — engine infrastructure.
  // ──────────────────────────────────────────────────────────────────────
  'src/engine/canvas-ops.ts': 1,
  'src/engine/color-space.ts': 5,

  // ──────────────────────────────────────────────────────────────────────
  // Tracked GPU-port debt — each file has a dedicated tracking issue
  // for the shader port that will eliminate the CPU implementation.
  // ──────────────────────────────────────────────────────────────────────
  'src/panels/ChannelsPanel/channel-extract.ts': 2,          // #440 — port to GPU shader
  'src/tools/crop/perspective-crop.ts': 1,                   // #441 — port homography warp to GPU
  'src/tools/liquify/liquify.ts': 2,                         // #443 — port displacement map to GPU
  'src/tools/quick-select/quick-select-interaction.ts': 5,   // quick-select pixel readback, port pending
  'src/tools/quick-select/quick-select.ts': 2,               // quick-select mask build, port pending
  'src/tools/path/boolean-ops.ts': 3,                        // canvas-based boolean ops; see #465 (DOM-in-tools cleanup)

  // ──────────────────────────────────────────────────────────────────────
  // Pattern + thumbnail generation — UI previews / navigator tile copy.
  // ──────────────────────────────────────────────────────────────────────
  'src/app/pattern-store.ts': 2,
  'src/panels/NavigatorPanel/NavigatorPanel.tsx': 2,         // pixel readback + ImageData wrap for thumbnail render

  // ──────────────────────────────────────────────────────────────────────
  // Brush engine scaffolding — stamps, shape data, ABR / preset I/O.
  // ──────────────────────────────────────────────────────────────────────
  'src/app/tool-settings-store.ts': 10,                      // built-in brush tip generation
  'src/app/MenuBar/brush-actions.ts': 2,                     // brush-from-selection / brush-from-layer
  'src/components/BrushModal/BrushDabPreview.tsx': 2,        // brush preview blur kernel + output
  'src/components/BrushModal/BrushModal.tsx': 1,             // texture-image grayscale import
  'src/tools/brush/abr-parser.ts': 4,
  'src/tools/brush/brush-from-selection.ts': 8,
  'src/tools/brush/brush.ts': 1,
  'src/tools/brush/builtin-brushes.ts': 1,                   // PNG → grayscale tip decode
  'src/tools/brush/preset-io.ts': 1,                         // Base64 → bytes for preset import

  // ──────────────────────────────────────────────────────────────────────
  // Transform matrices — Float32Array is the WebGL matrix shape.
  // ──────────────────────────────────────────────────────────────────────
  'src/app/OptionsBar/tool-options/TransformControls.tsx': 4,
  'src/app/interactions/transform-handlers.ts': 2,
  'src/tools/transform/transform.ts': 2,
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
