#!/usr/bin/env node
// Ban on raw WebGL in the Rust engine outside `gpu/`, per
// docs/engine-migration-plan.md (Phase 1).
//
// Feature code draws through the pass layer (`gpu/pass.rs`) and allocates
// through the texture and framebuffer pools. The WebGL context itself is
// private to `gpu/`, so most violations do not compile; this check also
// catches GL types and constants named from outside it.
//
// A "reference" is a `WebGl*` type or constant path, or a `gl.method(`
// call.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const ENGINE_SRC = join(ROOT, 'engine-rs', 'crates', 'lopsy-wasm', 'src');

// The pass layer and its backend live here and are allowed raw GL.
const BACKEND_DIR = 'gpu/';

const PATTERN = /\bWebGl\w+|\bgl\.[a-z_0-9]+\(/g;

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
  errors.push(
    `${file}: ${count} raw GL reference(s). ` +
      'Use the pass layer and the pools in gpu/ instead of WebGL directly.',
  );
}

if (errors.length > 0) {
  console.error('Raw GL outside gpu/:\n');
  for (const error of errors) console.error(`  ${error}`);
  console.error('\nSee docs/engine-migration-plan.md (Phase 1).');
  process.exit(1);
}

console.log('No raw GL outside gpu/.');
