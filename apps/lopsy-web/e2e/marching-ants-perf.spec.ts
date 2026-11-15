import { test, expect } from './fixtures';
import { waitForStore, createDocument } from './helpers';

/**
 * Regression test for #923: marching ants froze the editor (2-4s per frame)
 * for selections with thousands of disconnected islands (e.g. a
 * non-contiguous Magic Wand pick on a noise/grunge texture). The root cause
 * was `renderSelectionAnts` (src/app/rendering/render-selection.ts) issuing
 * a `beginPath()`/`stroke()` pair per traced contour, every animated overlay
 * frame — with ~18,000 islands that's ~36,000 `stroke()` calls per frame,
 * every frame, for as long as the selection stays active.
 *
 * The mask is built directly here (a grid of thousands of isolated single-
 * color squares, each becoming its own traced contour) and committed via
 * the same `setSelection` store primitive every selection tool (wand,
 * lasso, marquee) calls on commit. This isolates the thing #923 is actually
 * about — the render module's per-frame stroke cost — from the separate
 * question of how fast the wand tool's own color-matching scan is, and
 * avoids needing a non-deterministic filter-generated noise texture to
 * reliably reproduce "thousands of islands".
 *
 * Primary assertion: instrument `CanvasRenderingContext2D.prototype.stroke`
 * and assert the animated overlay issues a small, *constant* number of
 * stroke() calls per frame — not one that scales with the island count.
 * This is deterministic and immune to absolute-timing noise (CDP/rAF
 * wall-clock timing in this sandbox's SwiftShader + substituted Chromium
 * build turned out to be dominated by an unrelated async warm-up path
 * (`loadBuiltinBitmapBrushes`'s `OffscreenCanvas`/`getImageData` decode,
 * triggered unconditionally on engine init) that can stall the main thread
 * for many seconds independent of this fix — see the investigation notes
 * in the PR description). A secondary, best-effort wall-clock frame-time
 * check is still recorded and logged (not hard-asserted) for visibility.
 */

// Grid used to lay out isolated islands: a `dot`-sized square centered in
// every `step`-sized cell. The gap between dots (step - dot) guarantees no
// two dots are ever 4-connected, so each becomes its own traced contour —
// deterministically reproducing the "thousands of islands" shape of the
// issue's non-contiguous wand-on-noise-texture repro.
const DOC_WIDTH = 1200;
const DOC_HEIGHT = 1500;
const STEP = 10;
const DOT = 4;
const EXPECTED_ISLANDS = Math.floor(DOC_WIDTH / STEP) * Math.floor(DOC_HEIGHT / STEP);

test.describe('Marching ants perf — thousands of selection islands', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('stroke() calls per overlay frame stay constant, not proportional to island count', async ({ page }) => {
    test.setTimeout(120_000);

    await createDocument(page, DOC_WIDTH, DOC_HEIGHT, false);

    // Rulers are on by default and draw their own tick marks with a
    // stroke() per tick — unrelated to #923 but sharing the same
    // CanvasRenderingContext2D. Turn them (and grid/guides) off so the
    // instrumented count below isolates the ants' own contribution.
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { showRulers: boolean; showGrid: boolean; showGuides: boolean };
        setState: (partial: Record<string, unknown>) => void;
      };
      store.setState({ showRulers: false, showGrid: false, showGuides: false });
    });

    // --- instrument CanvasRenderingContext2D.stroke() before the mask lands ---
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      w.__strokeCallCount = 0;
      const proto = CanvasRenderingContext2D.prototype;
      const original = proto.stroke;
      w.__originalStroke = original;
      proto.stroke = function (...args: Parameters<typeof original>) {
        (w.__strokeCallCount as number)++;
        return original.apply(this, args);
      };
    });

    // --- commit a selection whose mask has ~18,000 isolated islands ---
    // (same `setSelection(bounds, mask, w, h)` primitive the wand/lasso/
    // marquee tools call on commit — see src/app/store/selection-slice.ts)
    const selectionInfo = await page.evaluate(
      ({ w, h, step, dot }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            setSelection: (
              bounds: { x: number; y: number; width: number; height: number },
              mask: Uint8ClampedArray,
              maskWidth: number,
              maskHeight: number,
            ) => void;
          };
        };
        const mask = new Uint8ClampedArray(w * h);
        const cols = Math.floor(w / step);
        const rows = Math.floor(h / step);
        const pad = Math.floor((step - dot) / 2);
        let islands = 0;
        for (let cy = 0; cy < rows; cy++) {
          for (let cx = 0; cx < cols; cx++) {
            islands++;
            const ox = cx * step + pad;
            const oy = cy * step + pad;
            for (let y = oy; y < oy + dot; y++) {
              for (let x = ox; x < ox + dot; x++) {
                mask[y * w + x] = 255;
              }
            }
          }
        }
        store.getState().setSelection({ x: 0, y: 0, width: w, height: h }, mask, w, h);
        return { islands, maskW: w, maskH: h };
      },
      { w: DOC_WIDTH, h: DOC_HEIGHT, step: STEP, dot: DOT },
    );
    expect(selectionInfo.islands).toBe(EXPECTED_ISLANDS);

    await page.waitForFunction(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { selection: { active: boolean } };
      };
      return store.getState().selection.active;
    });

    // Let the app's own rAF loop (useCanvasRendering.ts) animate the ants
    // for a fixed number of real frames, then read back the stroke() tally
    // and (best-effort, unasserted) per-frame wall-clock timing together.
    const FRAMES_TO_SAMPLE = 8;
    const result = await page.evaluate((frameCount) => {
      return new Promise<{ strokeCalls: number; frameTimes: number[] }>((resolve) => {
        const w = window as unknown as Record<string, unknown>;
        w.__strokeCallCount = 0;
        const frameTimes: number[] = [];
        let lastTime = performance.now();
        let n = 0;
        function tick() {
          const now = performance.now();
          frameTimes.push(now - lastTime);
          lastTime = now;
          n++;
          if (n < frameCount) {
            requestAnimationFrame(tick);
          } else {
            resolve({ strokeCalls: w.__strokeCallCount as number, frameTimes });
          }
        }
        requestAnimationFrame(tick);
      });
    }, FRAMES_TO_SAMPLE);

    // Restore the patched method.
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      CanvasRenderingContext2D.prototype.stroke = w.__originalStroke as typeof CanvasRenderingContext2D.prototype.stroke;
    });

    const strokesPerFrame = result.strokeCalls / FRAMES_TO_SAMPLE;
    const ft = [...result.frameTimes].sort((a, b) => a - b);
    const pctl = (arr: number[], p: number) => arr[Math.floor(arr.length * p)] ?? 0;

    console.log(
      `Marching ants perf — selection ${selectionInfo.maskW}x${selectionInfo.maskH}, ${selectionInfo.islands} islands\n` +
      `stroke() calls: ${result.strokeCalls} over ${FRAMES_TO_SAMPLE} frames (${strokesPerFrame.toFixed(1)}/frame)\n` +
      `Frame time (best-effort, not asserted — see comment above): ` +
      `p50 ${pctl(ft, 0.5).toFixed(1)}ms  p95 ${pctl(ft, 0.95).toFixed(1)}ms  max ${(ft[ft.length - 1] ?? 0).toFixed(1)}ms`,
    );

    // --- primary, deterministic assertion ---
    // Unfixed, renderSelectionAnts calls stroke() once per traced contour,
    // twice (solid + dashed) — ~2 * EXPECTED_ISLANDS per frame (tens of
    // thousands of calls). Fixed, it strokes one cached Path2D twice per
    // frame regardless of island count. With rulers/grid/guides disabled
    // above, the only stroke() calls left on this context are the ants
    // (solid + dashed) plus a small, fixed number from other overlay bits
    // (brush cursor, transform handles) that don't apply here — so this
    // stays tight to the actual fix while being ~1500x below the unfixed
    // call count for this island count.
    expect(strokesPerFrame).toBeLessThan(8);
    expect(strokesPerFrame).toBeLessThan(EXPECTED_ISLANDS / 100);
  });
});
