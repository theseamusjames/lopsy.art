/**
 * Grade in Photonamous keeps a layer's transparency (spec 6.12, L5). A
 * Lopsy layer arrives as the engine's 16-bit layer blob; this drives the
 * develop engine the Edit view uses on such a blob with partial alpha and
 * checks that every develop stage leaves alpha alone, and that with no
 * edit the colours come back within one 8-bit step.
 *
 * The blob is built here in its uncompressed form (flags 0): a 32-byte
 * geometry header, then RGBA as unsigned 16-bit samples, straight alpha,
 * as Lopsy's layer readback writes it.
 */
import { inflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';

const W = 16;
const H = 8;

/** A sample in [0, 1] as the blob stores it: unsigned 16-bit, 0..65535. */
function u16(v: number): number {
  return Math.round(v * 65535);
}

/** The test layer: a colour ramp across, alpha in steps down the columns, one fully clear column. */
function pixel(x: number, y: number): [number, number, number, number] {
  const alphaSteps = [1, 0.75, 0.5, 0.25, 0.125, 0];
  const a = alphaSteps[x % alphaSteps.length]!;
  return [0.2 + (x / W) * 0.6, 0.3 + (y / H) * 0.4, 0.5, a];
}

function layerBlob(): number[] {
  const header = new DataView(new ArrayBuffer(32));
  [0, 0, W, H, W, H].forEach((v, i) => header.setInt32(i * 4, v, true));
  header.setInt32(24, 0, true);
  header.setUint32(28, W * H * 8, true);
  const body = new DataView(new ArrayBuffer(W * H * 8));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      pixel(x, y).forEach((c, i) => body.setUint16(((y * W + x) * 4 + i) * 2, u16(c), true));
    }
  }
  return [...new Uint8Array(header.buffer), ...new Uint8Array(body.buffer)];
}

/** Samples of a 16-bit RGBA PNG, normalised to 0..1. */
function decodePng16(png: Buffer): { width: number; height: number; samples: number[] } {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  expect([png[24], png[25]]).toEqual([16, 6]);
  const idat: Buffer[] = [];
  for (let at = 8; at < png.length; ) {
    const len = png.readUInt32BE(at);
    if (png.toString('ascii', at + 4, at + 8) === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const data = inflateSync(Buffer.concat(idat));
  const bpp = 8;
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = data[y * (stride + 1)]!;
    for (let i = 0; i < stride; i++) {
      const raw = data[y * (stride + 1) + 1 + i]!;
      const left = i >= bpp ? out[y * stride + i - bpp]! : 0;
      const up = y > 0 ? out[(y - 1) * stride + i]! : 0;
      const upLeft = y > 0 && i >= bpp ? out[(y - 1) * stride + i - bpp]! : 0;
      let value = raw;
      if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + ((left + up) >> 1);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      }
      out[y * stride + i] = value & 0xff;
    }
  }
  const samples: number[] = [];
  for (let i = 0; i < out.length; i += 2) samples.push(out.readUInt16BE(i) / 65535);
  return { width, height, samples };
}

/** Loads the layer blob in the develop engine, applies `changes` and returns its full-size 16-bit PNG. */
async function gradeInPage(page: Page, changes: Record<string, unknown>): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ blob, changes }) => {
      const engineModule = await import('/src/engine/develop-engine.ts');
      const controls = await import('/src/edit/edit-controls.ts');
      const harness = await import('/src/edit/EditHarness/harness-asset.ts');
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 32;
      document.body.append(canvas);
      const engine = await engineModule.createDevelopEngine(canvas);
      try {
        await engine.load(new Blob([new Uint8Array(blob)], { type: engineModule.LOPSY_LAYER_MIME }), 'png');
        const asset = harness.harnessAsset('a', 'layer.png', 1, 'png', 'image/png');
        engine.setRecipe(controls.applyChanges(harness.harnessVersion(asset).recipe, changes));
        const png = new Uint8Array(await (await engine.exportImage({ format: 'png' })).arrayBuffer());
        let s = '';
        for (const b of png) s += String.fromCharCode(b);
        return btoa(s);
      } finally {
        engine.dispose();
        canvas.remove();
      }
    },
    { blob: layerBlob(), changes },
  );
  return Buffer.from(base64, 'base64');
}

const STEP = 1 / 255;

test.describe('grading a layer keeps its transparency', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/edit-harness.html');
  });

  test('with no edit, colours and alpha come back within one 8-bit step', async ({ page }) => {
    const { width, height, samples } = decodePng16(await gradeInPage(page, {}));
    expect([width, height]).toEqual([W, H]);
    let worst = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const want = pixel(x, y);
        const i = (y * W + x) * 4;
        expect(Math.abs(samples[i + 3]! - want[3]), `alpha at ${x},${y}`).toBeLessThanOrEqual(STEP);
        // Colour only matters where there is something to see.
        if (want[3] < 0.1) continue;
        for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(samples[i + c]! - want[c]!));
      }
    }
    expect(worst).toBeLessThanOrEqual(STEP);
  });

  const STAGES: Record<string, Record<string, unknown>> = {
    'white balance': { 'whiteBalance.temperature': 40, 'whiteBalance.tint': -20 },
    tone: { 'tone.exposure': 1, 'tone.contrast': 40, 'tone.highlights': -50, 'tone.shadows': 50, 'tone.whites': 20, 'tone.blacks': -20 },
    color: { 'color.vibrance': 50, 'color.saturation': -30 },
    curves: { 'curves.luminance': [{ x: 0, y: 0.2 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }] },
    'color by hue': { 'colorByHue.blue.saturation': 60, 'colorByHue.green.hue': 30 },
    'color grading': { 'colorGrading.shadows.saturation': 60, 'colorGrading.shadows.hue': 200, 'colorGrading.highlights.saturation': 40 },
    detail: { 'sharpness.amount': 120, 'noise.luminance': 60, 'noise.color': 60 },
    'local contrast': { 'localContrast.large': 60, 'localContrast.small': 60, 'localContrast.haze': 40 },
    vignette: { 'finish.vignette': -80 },
    monochrome: { 'profile.id': 'monochrome' },
  };

  /** Stages whose effect on this smooth ramp is large enough to see, so the test knows they ran. */
  const VISIBLE = new Set(['white balance', 'tone', 'curves', 'color grading', 'vignette', 'monochrome']);

  for (const [stage, changes] of Object.entries(STAGES)) {
    test(`${stage} leaves alpha alone`, async ({ page }) => {
      const { samples } = decodePng16(await gradeInPage(page, changes));
      if (VISIBLE.has(stage)) {
        let moved = 0;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            if (pixel(x, y)[3] !== 1) continue;
            for (let c = 0; c < 3; c++) moved = Math.max(moved, Math.abs(samples[(y * W + x) * 4 + c]! - pixel(x, y)[c]!));
          }
        }
        expect(moved, `${stage} changed the colours`).toBeGreaterThan(0.01);
      }
      const off: string[] = [];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const got = samples[(y * W + x) * 4 + 3]!;
          if (Math.abs(got - pixel(x, y)[3]) > STEP) off.push(`${x},${y}: ${got.toFixed(3)} not ${pixel(x, y)[3]}`);
        }
      }
      expect(off).toEqual([]);
    });
  }
});
