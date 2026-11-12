#!/usr/bin/env node
// Compares two directories of engine-output checkpoints written by
// e2e/parity.ts (see docs/engine-migration-plan.md, "Verification").
//
//   node scripts/parity-compare.mjs <baseline-dir> <current-dir> [--tolerance N]
//
// For every checkpoint in the baseline it compares the export composite
// byte for byte and reports the largest per-channel difference, and it
// compares each layer's pixel hash. With the default tolerance of 0 any
// difference fails. With a tolerance above 0 the composite may differ by
// up to N per channel; layer hash differences are then reported but do
// not fail, since a hash cannot say how large a difference is.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dirs = [];
let tolerance = 0;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--tolerance') {
    tolerance = Number(args[++i]);
  } else {
    dirs.push(args[i]);
  }
}
const [baselineDir, currentDir] = dirs;

if (!baselineDir || !currentDir || Number.isNaN(tolerance)) {
  console.error('usage: parity-compare.mjs <baseline-dir> <current-dir> [--tolerance N]');
  process.exit(2);
}
if (!existsSync(baselineDir)) {
  console.error(`No baseline at ${baselineDir}. Record one on main first: npm run parity:record`);
  process.exit(2);
}

function compareComposite(a, b) {
  if (a.length !== b.length) return { sizeMismatch: true, maxDelta: 255, differingPixels: -1 };
  let maxDelta = 0;
  let differingPixels = 0;
  for (let i = 0; i < a.length; i += 4) {
    let pixelDiffers = false;
    for (let c = 0; c < 4; c++) {
      const delta = Math.abs(a[i + c] - b[i + c]);
      if (delta > 0) pixelDiffers = true;
      if (delta > maxDelta) maxDelta = delta;
    }
    if (pixelDiffers) differingPixels++;
  }
  return { sizeMismatch: false, maxDelta, differingPixels };
}

function compareLayers(a, b) {
  const problems = [];
  if (a.length !== b.length) {
    problems.push(`layer count ${a.length} → ${b.length}`);
    return problems;
  }
  for (let i = 0; i < a.length; i++) {
    const la = a[i];
    const lb = b[i];
    const label = `layer ${i} "${la.name}"`;
    for (const key of ['name', 'type', 'x', 'y', 'width', 'height']) {
      if (la[key] !== lb[key]) problems.push(`${label}: ${key} ${la[key]} → ${lb[key]}`);
    }
    if (la.sha256 !== lb.sha256) problems.push(`${label}: pixels differ`);
  }
  return problems;
}

const failures = [];
const notes = [];
let checkpoints = 0;
let worstDelta = 0;

const compositions = readdirSync(baselineDir).filter((entry) => statSync(join(baselineDir, entry)).isDirectory());
if (compositions.length === 0) {
  console.error(`Baseline at ${baselineDir} has no compositions.`);
  process.exit(2);
}

for (const composition of compositions) {
  const names = readdirSync(join(baselineDir, composition))
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length))
    .sort();

  for (const name of names) {
    checkpoints++;
    const id = `${composition}/${name}`;
    const currentJson = join(currentDir, composition, `${name}.json`);
    if (!existsSync(currentJson)) {
      failures.push(`${id}: missing from the current run`);
      continue;
    }

    const baseMeta = JSON.parse(readFileSync(join(baselineDir, composition, `${name}.json`), 'utf8'));
    const currMeta = JSON.parse(readFileSync(currentJson, 'utf8'));
    if (baseMeta.width !== currMeta.width || baseMeta.height !== currMeta.height) {
      failures.push(`${id}: composite size ${baseMeta.width}x${baseMeta.height} → ${currMeta.width}x${currMeta.height}`);
      continue;
    }

    const result = compareComposite(
      readFileSync(join(baselineDir, composition, `${name}.rgba`)),
      readFileSync(join(currentDir, composition, `${name}.rgba`)),
    );
    if (result.maxDelta > worstDelta) worstDelta = result.maxDelta;
    if (result.sizeMismatch) {
      failures.push(`${id}: composite byte length differs`);
    } else if (result.maxDelta > tolerance) {
      failures.push(`${id}: composite differs in ${result.differingPixels} pixels, max channel delta ${result.maxDelta}`);
    } else if (result.maxDelta > 0) {
      notes.push(`${id}: composite differs in ${result.differingPixels} pixels, max channel delta ${result.maxDelta} (within tolerance)`);
    }

    for (const problem of compareLayers(baseMeta.layers, currMeta.layers)) {
      (tolerance === 0 ? failures : notes).push(`${id}: ${problem}`);
    }
  }
}

for (const note of notes) console.log(`note: ${note}`);

if (failures.length > 0) {
  console.error(`Parity check failed (${failures.length} problem(s), tolerance ${tolerance}):\n`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(
  `Parity OK: ${checkpoints} checkpoints in ${compositions.length} composition(s), ` +
    `max channel delta ${worstDelta} (tolerance ${tolerance}).`,
);
