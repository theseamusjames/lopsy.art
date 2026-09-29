import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, selectTool, setToolOption, docToScreen, setForegroundColor } from './helpers';

/**
 * #1020 — layer-mask and Quick Mask brush dabs are scissored to each
 * dab's bounding box instead of rendering and copying back the whole
 * mask texture twice per dab.
 *
 * A scissor rect that is too tight clips the dab (an unpainted ring or
 * flat edge); a copy-back that strays outside the rect leaks stale
 * scratch contents into the mask. Either shows up as a mask that no
 * longer matches what the dab shader computes, so the test records every
 * dab the engine actually draws (centre, size, hardness, opacity, mode —
 * read off the `quick_mask_dab` program's uniforms as they are set) and
 * replays them on the CPU with the shader's formula over the whole
 * texture. The GPU mask must match that reference at every texel, to
 * within the rounding of the texture's storage format.
 *
 * Strokes cover hard and soft brushes, a brush larger than the document,
 * hide and reveal (brush and eraser), and dabs that hang off the texture
 * edges and corners. The per-dab cost itself is GPU time that WebGL does
 * not expose; the scissor bounds are unit-tested in
 * `lopsy-core/src/brush.rs` (`circle_dab_scissor_rect`).
 */

const DOC_W = 360;
const DOC_H = 260;
const TOLERANCE = 2;

interface Stroke {
  tool: 'brush' | 'eraser';
  size: number;
  hardness?: number;
  opacity: number;
  from: [number, number];
  to?: [number, number];
}

async function installDabRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface Tag { program: WebGLProgram; name: string }
    const w = window as unknown as { __maskDabs: number[][] };
    w.__maskDabs = [];
    const names = new Map<WebGLProgram, Set<string>>();
    const tags = new WeakMap<WebGLUniformLocation, Tag>();
    const values = new Map<WebGLProgram, Map<string, number[]>>();
    let current: WebGLProgram | null = null;
    const proto = WebGL2RenderingContext.prototype;

    const origGetLoc = proto.getUniformLocation;
    proto.getUniformLocation = function patched(this: WebGL2RenderingContext, program: WebGLProgram, name: string) {
      const loc = origGetLoc.call(this, program, name);
      if (!names.has(program)) names.set(program, new Set());
      names.get(program)!.add(name);
      if (loc) tags.set(loc, { program, name });
      return loc;
    };
    const origUse = proto.useProgram;
    proto.useProgram = function patched(this: WebGL2RenderingContext, program: WebGLProgram | null) {
      current = program;
      return origUse.call(this, program);
    };
    const record = (loc: WebGLUniformLocation | null, v: number[]) => {
      if (!loc) return;
      const tag = tags.get(loc);
      if (!tag) return;
      if (!values.has(tag.program)) values.set(tag.program, new Map());
      values.get(tag.program)!.set(tag.name, v);
    };
    const orig1f = proto.uniform1f;
    proto.uniform1f = function patched(this: WebGL2RenderingContext, loc: WebGLUniformLocation | null, x: number) {
      record(loc, [x]);
      return orig1f.call(this, loc, x);
    };
    const orig1i = proto.uniform1i;
    proto.uniform1i = function patched(this: WebGL2RenderingContext, loc: WebGLUniformLocation | null, x: number) {
      record(loc, [x]);
      return orig1i.call(this, loc, x);
    };
    const orig2f = proto.uniform2f;
    proto.uniform2f = function patched(this: WebGL2RenderingContext, loc: WebGLUniformLocation | null, x: number, y: number) {
      record(loc, [x, y]);
      return orig2f.call(this, loc, x, y);
    };
    const isDabProgram = (p: WebGLProgram): boolean => {
      const n = names.get(p);
      return !!n && n.has('u_maskTex') && n.has('u_hardness') && n.has('u_mode') && n.has('u_center');
    };
    const origDraw = proto.drawArrays;
    proto.drawArrays = function patched(this: WebGL2RenderingContext, mode: number, first: number, count: number) {
      if (current && isDabProgram(current)) {
        const v = values.get(current)!;
        const c = v.get('u_center')!;
        const ts = v.get('u_texSize')!;
        w.__maskDabs.push([
          c[0]!, c[1]!, v.get('u_size')![0]!, v.get('u_hardness')![0]!,
          v.get('u_opacity')![0]!, v.get('u_mode')![0]!, ts[0]!, ts[1]!,
        ]);
      }
      return origDraw.call(this, mode, first, count);
    };
  });
}

async function paintStrokes(page: Page, strokes: Stroke[]): Promise<void> {
  for (const s of strokes) {
    await selectTool(page, s.tool);
    await setToolOption(page, 'Size', s.size);
    if (s.hardness !== undefined) await setToolOption(page, 'Hardness', s.hardness);
    await setToolOption(page, 'Opacity', s.opacity);
    const a = await docToScreen(page, s.from[0], s.from[1]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    if (s.to) {
      const b = await docToScreen(page, s.to[0], s.to[1]);
      await page.mouse.move(b.x, b.y, { steps: 12 });
    }
    await page.mouse.up();
    await page.waitForTimeout(50);
  }
}

/**
 * Compare `actual` (one byte per texel, the GPU mask) against a CPU replay
 * of every recorded dab starting from `initial`. Runs in the page so the
 * full mask never crosses the protocol.
 */
const COMPARE_IN_PAGE = `
(function compare(actual, width, height, initial, dabs) {
  const probe = document.createElement('canvas').getContext('webgl2');
  const isFloat = !!(probe && probe.getExtension('EXT_color_buffer_float'));
  const f16 = (v) => {
    if (v === 0) return 0;
    const e = Math.max(Math.floor(Math.log2(Math.abs(v))), -14);
    const scale = Math.pow(2, 10 - e);
    return Math.round(v * scale) / scale;
  };
  const u8 = (v) => Math.round(Math.min(Math.max(v, 0), 1) * 255) / 255;
  const store = isFloat ? f16 : u8;
  const smoothstep = (e0, e1, x) => {
    const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
    return t * t * (3 - 2 * t);
  };
  const ref = new Float64Array(width * height).fill(initial / 255);
  for (const [cx, cy, size, hardness, opacity, mode, tw, th] of dabs) {
    if (tw !== width || th !== height) return { error: 'dab texSize ' + tw + 'x' + th + ' != mask ' + width + 'x' + height };
    const radius = size * 0.5;
    const x0 = Math.max(0, Math.floor(cx - radius - 1));
    const x1 = Math.min(width - 1, Math.ceil(cx + radius + 1));
    const y0 = Math.max(0, Math.floor(cy - radius - 1));
    const y1 = Math.min(height - 1, Math.ceil(cy + radius + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (dist > radius) continue;
        const t = Math.min(Math.max(dist / radius, 0), 1);
        const soft = 1 - t * t;
        const stamp = (hardness + (1 - hardness) * soft) * (1 - smoothstep(radius - 1, radius, dist));
        const s = stamp * opacity;
        const i = y * width + x;
        ref[i] = store(mode === 0 ? Math.max(ref[i], s) : ref[i] * (1 - s));
      }
    }
  }
  let mismatches = 0;
  let maxDiff = 0;
  let firstBad = null;
  let changed = 0;
  for (let i = 0; i < width * height; i++) {
    const expected = Math.round(ref[i] * 255);
    const diff = Math.abs(actual[i] - expected);
    if (Math.abs(actual[i] - initial) > 32) changed++;
    if (diff > maxDiff) maxDiff = diff;
    if (diff > ${TOLERANCE}) {
      mismatches++;
      if (!firstBad) firstBad = { x: i % width, y: Math.floor(i / width), actual: actual[i], expected };
    }
  }
  return { mismatches, maxDiff, firstBad, changed, dabCount: dabs.length };
})
`;

interface CompareResult {
  error?: string;
  mismatches: number;
  maxDiff: number;
  firstBad: { x: number; y: number; actual: number; expected: number } | null;
  changed: number;
  dabCount: number;
}

async function compareLayerMask(page: Page): Promise<CompareResult> {
  return page.evaluate((src) => {
    const w = window as unknown as {
      __maskDabs: number[][];
      __editorStore: {
        getState: () => {
          document: {
            activeLayerId: string | null;
            layers: Array<{ id: string; mask: { data: Uint8ClampedArray; width: number; height: number } | null }>;
          };
        };
      };
    };
    const doc = w.__editorStore.getState().document;
    const mask = doc.layers.find((l) => l.id === doc.activeLayerId)!.mask!;
    const compare = (0, eval)(src) as (...a: unknown[]) => CompareResult;
    return compare(mask.data, mask.width, mask.height, 255, w.__maskDabs);
  }, COMPARE_IN_PAGE);
}

async function compareSelection(page: Page): Promise<CompareResult> {
  return page.evaluate((src) => {
    const w = window as unknown as {
      __maskDabs: number[][];
      __editorStore: {
        getState: () => { selection: { mask: Uint8ClampedArray | null; maskWidth: number; maskHeight: number } };
      };
    };
    const sel = w.__editorStore.getState().selection;
    const compare = (0, eval)(src) as (...a: unknown[]) => CompareResult;
    return compare(sel.mask, sel.maskWidth, sel.maskHeight, 0, w.__maskDabs);
  }, COMPARE_IN_PAGE);
}

test.describe('Mask brush dabs are scissored without changing the result (#1020)', () => {
  test.beforeEach(async ({ page }) => {
    await installDabRecorder(page);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, DOC_W, DOC_H, false);
    await page.waitForTimeout(200);
  });

  test('layer mask: hard, soft, oversized and edge dabs, hide and reveal', async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    test.setTimeout(120_000);

    await page.locator('[aria-label="Add Mask"]').click();
    await page.getByRole('button', { name: /Edit mask for/ }).click();
    await page.waitForTimeout(200);

    await paintStrokes(page, [
      // Hide with a hard brush across the middle.
      { tool: 'brush', size: 24, hardness: 100, opacity: 100, from: [40, 130], to: [320, 140] },
      // Soft, semi-opaque, hanging off the top-left corner.
      { tool: 'brush', size: 90, hardness: 0, opacity: 60, from: [3, 4], to: [150, 20] },
      // Reveal back through the hard stroke (eraser = reveal on a mask).
      { tool: 'eraser', size: 40, opacity: 100, from: [180, 60], to: [190, 220] },
      // Soft single dab bigger than the whole document, off the bottom-right corner.
      { tool: 'brush', size: 500, hardness: 30, opacity: 40, from: [355, 255] },
      // Hard dab clipped by the right edge.
      { tool: 'brush', size: 30, hardness: 100, opacity: 100, from: [357, 60], to: [358, 200] },
    ]);
    await page.screenshot({ path: 'e2e/screenshots/mask-dab-scissor-layer-mask.png' });

    // `layer.mask.data` catches up with the GPU mask lazily (#760, #780).
    let result: CompareResult | null = null;
    await expect.poll(async () => {
      result = await compareLayerMask(page);
      return result.mismatches;
    }, { timeout: 30_000 }).toBe(0);
    const r = result as unknown as CompareResult;
    expect(r.error).toBeUndefined();
    expect(r.dabCount).toBeGreaterThan(20);
    // Thousands of texels changed — the replay is not trivially "all white".
    expect(r.changed).toBeGreaterThan(5000);
    expect(r.maxDiff).toBeLessThanOrEqual(TOLERANCE);
  });

  test('quick mask: add and remove with hard, soft and edge dabs', async ({ page }) => {
    test.setTimeout(120_000);

    await page.keyboard.press('q');
    await page.waitForTimeout(150);

    await setForegroundColor(page, 255, 255, 255);
    await paintStrokes(page, [
      // White brush adds to the selection.
      { tool: 'brush', size: 24, hardness: 100, opacity: 100, from: [40, 130], to: [320, 140] },
      { tool: 'brush', size: 90, hardness: 0, opacity: 60, from: [3, 4], to: [150, 20] },
      { tool: 'brush', size: 500, hardness: 30, opacity: 40, from: [355, 255] },
      // Eraser removes, through the hard stroke and off the bottom edge.
      { tool: 'eraser', size: 40, opacity: 100, from: [180, 60], to: [190, 258] },
    ]);
    // Black brush removes too — hard dabs clipped by the right edge.
    await setForegroundColor(page, 0, 0, 0);
    await paintStrokes(page, [
      { tool: 'brush', size: 30, hardness: 100, opacity: 100, from: [357, 60], to: [358, 200] },
    ]);
    await page.screenshot({ path: 'e2e/screenshots/mask-dab-scissor-quick-mask.png' });

    await page.keyboard.press('q');
    await page.waitForTimeout(300);

    const r = await compareSelection(page);
    expect(r.error).toBeUndefined();
    expect(r.dabCount).toBeGreaterThan(20);
    expect(r.changed).toBeGreaterThan(5000);
    expect(r.firstBad).toBeNull();
    expect(r.mismatches).toBe(0);
  });
});
