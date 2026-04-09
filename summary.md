# E2E Test Review Summary

Comprehensive review of all 48 e2e test files for validity of assertions and test scenarios.

**Legend:** **VALID** = test is sound, **WEAK** = test runs but assertions are insufficient, **INVALID** = test does not meaningfully verify its claim.

---

## Statistics

| Verdict | Count | % |
|---------|-------|---|
| VALID | ~38 | ~25% |
| WEAK | ~75 | ~50% |
| INVALID | ~37 | ~25% |

~150 individual tests reviewed across 48 files.

---

## Critical Findings (INVALID tests)

These tests provide zero meaningful coverage and should be rewritten or removed.

### Tests That Always Pass (No Assertions)

| File | Test | Problem |
|------|------|---------|
| `brush-system.spec.ts` | 08 preview update | Zero `expect()` calls. Takes screenshots but never compares them. |
| `brush-symmetry-render.spec.ts` | effects apply after layer switch | Zero `expect()` calls. Takes screenshot only. |

### Tests That Verify Their Own Code, Not the App

| File | Test | Problem |
|------|------|---------|
| `centered-grid.spec.ts` | grid symmetric / edge snapping | Both tests compute snap math with inline JS arithmetic. No app code exercised. Would pass if grid feature didn't exist. |
| `bug-fixes.spec.ts` | cloned content matches source region | Manually copies pixels in JS, then reads them back. Clone stamp tool never invoked. |
| `bug-fixes.spec.ts` | painting with selection | Tests that `paintRect` helper respects bounds, not that GPU selection mask works. |
| `rendering.spec.ts` | tests 21, 29, 36-38, 49 | Implement filters inline in `page.evaluate()` rather than calling actual app filter actions. |
| `selection-coordinates.spec.ts` | tests 2-3 | `magicWandSelect`/`fillSelection` helpers bypass real tool code entirely. |

### Tests With Structurally Wrong Assertions

| File | Test | Problem |
|------|------|---------|
| `pixelate-filter.spec.ts` | applies pixelate | Asserts layer count/dimensions, not pixel content. Undo test references non-existent globals (`__wasmEngine`), silently skips filter. |
| `grid-slider.spec.ts` | slider check | `sliderExists || !selectExists` is a tautology — always true. |
| `grid-slider.spec.ts` | slider changes size | Calls `setGridSize()` directly — never touches the slider UI. |
| `brush-system.spec.ts` | 06 ABR import | Calls `addPreset()` directly — no ABR file parsing exercised. |
| `brush-system.spec.ts` | 10 brush from selection | Calls `addPreset()` directly — "create from selection" feature never invoked. |
| `brush-abr-spacing.spec.ts` | ABR file picker | Calls `addPreset()` directly. Canvas count assertion matches any `<canvas>` on page. |
| `brush-soft-overlap.spec.ts` | overlap test | Transparent doc + composited readback = wrong color model. Could silently return all zeros and pass. |
| `brush-symmetry-render.spec.ts` | symmetry strokes committed | Symmetry never verified (no mirrored pixel checks). |
| `brush-fade.spec.ts` | fade enabled | Transparent document + composited readback = wrong color model for the assertions. |
| `rounded-corners.spec.ts` | all 3 tests | `getPixelAt` reads JS pixel store, but shapes write to GPU and call `clearJsPixelData()`. All reads return zeros — transparency assertions pass for wrong reason, fill assertions are false negatives. |
| `new-document-cleanup.spec.ts` | clears old layers | Never checks old layer IDs for stale textures. Engine assertion tests new doc's layers, not old ones. Bridge unavailability silently passes. |
| `export-adjustments.spec.ts` | saturation/vibrance | `setImageAdjustments` doesn't exist on the store. The test writes to a non-existent field, exports, then re-reads what it wrote — never testing the export pipeline. |
| `bug-fixes.spec.ts` | disabling adjustments | Uses `__uiStore` for cleanup but `__editorStore` for setup — different state systems, asymmetric teardown. |
| `layer-groups.spec.ts` | canvas shows content after move | `expect(screenshot.length).toBeGreaterThan(100)` — any PNG is >100 bytes. Non-test. |
| `layer-groups.spec.ts` | group adjustments affect rendering | Only checks store values, never reads pixels. |
| `layer-groups.spec.ts` | sub-group adjustments affect rendering | Re-implements aggregation inline in test, never calls app code. |
| `layer-memory.spec.ts` | single dot / sparse corners | JS heap measurement doesn't capture GPU texture memory. `getOrCreateLayerPixelData` allocates full-canvas buffers, contradicting the sparse storage claim. |
| `layer-memory-realistic.spec.ts` | user scenario | Same JS heap vs GPU memory mismatch. |
| `merge-down.spec.ts` | undo preserves pixel integrity | `beforeMergeSnap` captured but never used. Both assertions are vacuous `> 0` checks. |
| `polygon-rotation.spec.ts` | odd-sided triangle points up | Only checks `width > 10` and `height > 10`. Never verifies orientation. |
| `mobile-canvas.spec.ts` | pinch-to-zoom | CDP-only, no browser guard. |
| `mobile-canvas.spec.ts` | single-finger draws | No positive assertion drawing occurred. Vacuously passes if touch events are dropped. |
| `mobile-canvas.spec.ts` | two-finger pan | No assertion zoom didn't change. No minimum pan delta. |
| `transform-stray-pixels.spec.ts` | GPU composite check | Lower bound `0.85x` is geometrically wrong for 45° rotation (~79% coverage). |
| `transform-user-repro.spec.ts` | perspective mode | Tests only store wiring, not behavior. Perspective effect never verified. |

### Screenshot-Only Tests in rendering.spec.ts (No Assertions)

Tests 01-09, 13-14, 18-19, 23, 33-35, 44, 47, 53 in `rendering.spec.ts` take screenshots but have zero `expect()` calls. They can never catch regressions automatically.

---

## Systemic Issues

### 1. `pixelDiff > 0` as the only assertion

Many brush tests (brush-system 01-05, 09, brush-abr-spacing property tests) assert only that "some pixels changed." This catches complete tool failure but not behavioral correctness. A brush that draws a single pixel in the wrong location passes.

**Affected:** ~15 tests across `brush-system.spec.ts`, `brush-abr-spacing.spec.ts`

### 2. JS pixel reads on GPU-rendered content

The architecture is GPU-first: shapes, brush strokes, and filters write to WebGL textures. But many tests read via `getPixelAt` → `__readLayerPixels` → JS `layerPixelData`, which is often empty or stale after GPU operations. This causes false positives (transparency assertions pass because no data, not because content is transparent) and false negatives.

**Affected:** `rounded-corners.spec.ts` (all 3), `shape-tool.spec.ts`, `text-tool.spec.ts` (test 11), `move-layer.spec.ts` (GPU tests), `rendering.spec.ts` (most pixel checks)

### 3. Duplicate helpers instead of shared imports

~20 test files redefine `createDocument`, `waitForStore`, `getEditorState` locally instead of importing from `e2e/helpers.ts`. The local versions typically use `waitForTimeout(200-300)` instead of the robust `waitForFunction` polling in helpers.ts, causing flakiness.

**Affected:** `brush-fade`, `brush-soft-overlap`, `brush-shift-click`, `brush-symmetry-render`, `brush-opacity-range`, `brush-abr-spacing`, `centered-grid`, `grid-slider`, `fill-selection`, `guide-swatch`, `external-paste-drop`, `hold-smooth-line`, `layer-groups`, `layer-panel`, `merge-down`, `move-layer`, `paths`, `shape-path-output`, `root-group-controls`

### 4. Silent false-positives via early return or missing globals

Several tests access undocumented globals (`__wasmEngine`, `__readCompositedPixels`, `__brushPresetStore`, `__imageAdjustmentsModule`). When these don't exist, functions return `null`/`undefined` and assertions pass vacuously (e.g., `{r:0,g:0,b:0,a:0}` matches "is transparent").

**Affected:** `pixelate-filter`, `brush-soft-overlap`, `brush-shift-click`, `hold-smooth-line`, `external-paste-drop` (GPU pixel tests), `export-adjustments`

### 5. `waitForTimeout` instead of condition-based waits

~30 tests use bare `waitForTimeout(100-500)` sleeps instead of `waitForFunction` polling. These are both flaky (too short on slow CI) and wasteful (too long on fast machines).

### 6. `console.log` in committed tests

`layer-groups.spec.ts` (lines 689-690, 1079), `transform-user-repro.spec.ts` contain debug `console.log` statements.

---

## Per-File Verdicts

### Brush Tests

| File | Tests | Verdicts |
|------|-------|----------|
| `brush-system.spec.ts` | 12 tests | 6 INVALID, 4 WEAK, 2 WEAK |
| `brush-fade.spec.ts` | 2 tests | 1 INVALID, 1 WEAK |
| `brush-opacity-range.spec.ts` | 1 test | WEAK |
| `brush-abr-spacing.spec.ts` | ~12 tests | 3 INVALID, ~9 WEAK |
| `brush-perf.spec.ts` | 1 test (skipped) | WEAK |
| `brush-soft-overlap.spec.ts` | 1 test | INVALID |
| `brush-shift-click.spec.ts` | 1 test | WEAK |
| `brush-symmetry-render.spec.ts` | 2 tests | 2 INVALID |

### Canvas/Grid/UI Tests

| File | Tests | Verdicts |
|------|-------|----------|
| `canvas-visible.spec.ts` | 2 tests | WEAK (minor — mostly valid, needs g/b channel checks) |
| `centered-grid.spec.ts` | 2 tests | 2 INVALID |
| `grid-slider.spec.ts` | 2 tests | 2 INVALID |
| `webgl2-warning.spec.ts` | 4 tests | 1 VALID, 3 WEAK |
| `zoom-scroll.spec.ts` | 2 tests | 2 WEAK |
| `mobile-canvas.spec.ts` | 4 tests | 1 WEAK, 3 INVALID |
| `root-group-controls.spec.ts` | 2 tests | 2 WEAK |

### Clipboard Tests

| File | Tests | Verdicts |
|------|-------|----------|
| `clipboard.spec.ts` | 14 tests | 5 VALID, 9 WEAK |

### Export Tests

| File | Tests | Verdicts |
|------|-------|----------|
| `export-formats.spec.ts` | 5 tests | 1 VALID, 4 WEAK |
| `export-adjustments.spec.ts` | 1 test | INVALID |
| `external-paste-drop.spec.ts` | 10 tests | 2 VALID, 8 WEAK |

### Filter Tests

| File | Tests | Verdicts |
|------|-------|----------|
| `pixelate-filter.spec.ts` | 2 tests | 2 INVALID |

### Selection/Fill Tests

| File | Tests | Verdicts |
|------|-------|----------|
| `fill-selection.spec.ts` | 3 tests | 2 INVALID, 1 WEAK |
| `selection-coordinates.spec.ts` | 3 tests | 1 WEAK, 2 INVALID |

### History Tests

| File | Tests | Verdicts |
|------|-------|----------|
| `history.spec.ts` | 19 tests | 9 VALID, 10 WEAK |

### Layer Tests

| File | Tests | Verdicts |
|------|-------|----------|
| `layer-panel.spec.ts` | 18 tests | 12 VALID, 5 WEAK, 1 INVALID |
| `layer-groups.spec.ts` | ~20 tests | 8 VALID, 9 WEAK, 3 INVALID |
| `layer-memory.spec.ts` | 3 tests | 1 WEAK, 2 INVALID |
| `layer-memory-realistic.spec.ts` | 1 test | INVALID |
| `merge-down.spec.ts` | 7 tests | 1 INVALID, 6 WEAK |
| `move-layer.spec.ts` | 5 tests | 1 VALID, 4 WEAK |
| `align.spec.ts` | ~8 tests | WEAK |
| `group-move.spec.ts` | 1 test | INVALID |

### Shape/Path Tests

| File | Tests | Verdicts |
|------|-------|----------|
| `shape-tool.spec.ts` | ~6 tests | Mix of WEAK and VALID |
| `shape-path-output.spec.ts` | 3 tests | 3 WEAK |
| `paths.spec.ts` | 11 tests | 2 VALID, 9 WEAK |
| `polygon-rotation.spec.ts` | 3 tests | 1 VALID, 1 WEAK, 1 INVALID |
| `rounded-corners.spec.ts` | 3 tests | 3 INVALID |

### Text Tests

| File | Tests | Verdicts |
|------|-------|----------|
| `text-tool.spec.ts` | 11 tests | 5 VALID, 4 WEAK, 2 INVALID |

### Transform Tests

| File | Tests | Verdicts |
|------|-------|----------|
| `transform.spec.ts` | ~10 tests | Mix of VALID and WEAK |
| `transform-stray-pixels.spec.ts` | 13 tests | 1 INVALID, 12 WEAK |
| `transform-user-repro.spec.ts` | 4 tests | 1 INVALID, 3 WEAK |

### Rendering Tests

| File | Tests | Verdicts |
|------|-------|----------|
| `rendering.spec.ts` | ~55 tests | ~15 INVALID (no assertions), ~6 INVALID (self-testing), ~20 WEAK, ~14 VALID |
| `rasterization-fix.spec.ts` | ~5 tests | Mix of WEAK |

### Bug Fix Tests

| File | Tests | Verdicts |
|------|-------|----------|
| `bug-fixes.spec.ts` | 16 tests | 4 VALID, 9 WEAK, 3 INVALID |

### Other Tests

| File | Tests | Verdicts |
|------|-------|----------|
| `guide-swatch.spec.ts` | 2 tests | 1 INVALID, 1 WEAK |
| `hold-smooth-line.spec.ts` | 2 tests | 1 INVALID, 1 WEAK |
| `memory-profile.spec.ts` | 1 test | WEAK |
| `new-document-cleanup.spec.ts` | 1 test | INVALID |
| `tools.spec.ts` | ~15 tests | Mix of VALID and WEAK |

---

## Top Priority Fixes

### Tier 1: Tests providing false confidence (INVALID, high-traffic features)

1. **`pixelate-filter.spec.ts`** — Rewrite to paint non-uniform content (e.g., circles), apply filter, verify blocks appeared
2. **`rounded-corners.spec.ts`** — Switch to GPU readback (`__readCompositedPixels`) or screenshot comparison
3. **`rendering.spec.ts` screenshot-only tests** — Add pixel assertions to the ~18 assertion-free tests
4. **`rendering.spec.ts` self-testing filters** — Call actual app filter actions instead of reimplementing inline
5. **`centered-grid.spec.ts` + `grid-slider.spec.ts`** — Rewrite to test actual app code
6. **`brush-system.spec.ts` tests 06, 08, 10** — Test actual ABR import, preview rendering, and brush-from-selection features

### Tier 2: Systemic improvements

7. **Consolidate helpers** — All 20+ files with duplicate helpers should import from `e2e/helpers.ts`
8. **Replace `waitForTimeout` with `waitForFunction`** — Across ~30 tests
9. **Add GPU readback helper** — Create a shared `getCompositedPixelAt` in helpers.ts for tests that need composited output
10. **Guard against missing globals** — Add `expect(result).not.toBeNull()` before using `__readCompositedPixels` etc.

### Tier 3: Strengthen weak tests

11. **Upgrade `pixelDiff > 0` to targeted pixel checks** — Brush system tests
12. **Add before/after comparisons** — History tests should verify undo stack depth
13. **Add boundary pixel checks** — Fill/selection tests
14. **Fix Meta key for Linux CI** — Paths spec Cmd+drag tests
