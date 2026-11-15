import type { Page } from '@playwright/test';
import {
  DOC_W, DOC_H, shot, pause, menu, tool, setFg, fill, deselect, selectLayer, renameActive, newLayer,
  setGradient, gradientDrag, type Stop, filter, blendMode, closeEffects, effect, layerOpacity,
  brushSettings, closeBrushSettings, dragDoc, clickDoc, type Pt,
  rectSelect, ellipseSelect, lassoSelect, fillRect, fillEllipse, fillPoly, selectModify, pressKey,
  starPts, sparklePts, heartPts, bezierPts, vGuide, hGuide, docToScreen, setFont, layerBounds, contentBounds, toolOption, moveBy, centerContentOn, selectAlpha, tx, rasterizeStyle, polyline, rotateSelection, scaleSelection,
} from './composition-cosmic-xray.steps.ts';

export const INK = '#0B0720';

export async function layers(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string; layerOrder: string[]; layers: Array<Record<string, unknown>> }; undoStack: unknown[]; redoStack: unknown[] };
    };
    const s = store.getState();
    return {
      active: s.document.activeLayerId, undo: s.undoStack.length, redo: s.redoStack.length,
      layers: s.document.layerOrder.map((id) => {
        const l = s.document.layers.find((x) => x.id === id)!;
        return `${l.name} [${l.type}] ${l.x},${l.y} ${l.width}x${l.height} op=${l.opacity} ${l.blendMode} parent=${l.parentId ?? ''} id=${id}`;
      }),
    };
  });
}

export async function s01(page: Page): Promise<void> {
  await page.goto(process.env.COSMIC_URL ?? '/');
  const modal = page.getByText('New Document');
  await modal.waitFor();
  await page.locator('label:has-text("Width")').locator('..').locator('input').fill(String(DOC_W));
  await page.locator('label:has-text("Height")').locator('..').locator('input').fill(String(DOC_H));
  await page.getByRole('button', { name: 'Create' }).click();
  await page.locator('[data-testid="canvas-container"]').waitFor();
  await pause(page, 800);
  await shot(page, '01-new-doc');
}

export const HOLO: Stop[] = [
  { pos: 0, hex: '#22E8FF' },
  { pos: 0.3, hex: '#FF3FD8' },
  { pos: 0.58, hex: '#7B4DFF' },
  { pos: 0.8, hex: '#3DFFC8' },
  { pos: 1, hex: '#FFE45C' },
];

export async function s02(page: Page): Promise<void> {
  await selectLayer(page, 'Background');
  await setFg(page, INK);
  await fill(page);
  await selectLayer(page, 'Layer 1');
  await renameActive(page, 'Holo Wash');
  await setGradient(page, 'linear', HOLO);
  await gradientDrag(page, { x: 0, y: 0 }, { x: DOC_W, y: DOC_H });
  await shot(page, '02-holo-wash');
}

export async function s03(page: Page): Promise<void> {
  await newLayer(page, 'Nebula');
  await filter(page, 'Clouds...', { Scale: 4 });
  await filter(page, 'Brightness/Contrast...', { Brightness: -45, Contrast: 90 });
  await blendMode(page, 'multiply');
  await closeEffects(page);
  await shot(page, '03-nebula-clouds');
}

export async function s04(page: Page): Promise<void> {
  await selectLayer(page, 'Holo Wash');
  await layerOpacity(page, 40);
  await selectLayer(page, 'Nebula');
  await newLayer(page, 'Stars');
  await setFg(page, '#000000');
  await fill(page);
  await filter(page, 'Add Noise...', { Amount: 100 }, ['Mono']);
  await filter(page, 'Threshold...', { Level: 48 });
  await blendMode(page, 'screen');
  await closeEffects(page);
  await layerOpacity(page, 60);
  await shot(page, '04-star-field');
}

export async function s05(page: Page): Promise<void> {
  await selectLayer(page, 'Stars');
  await newLayer(page, 'Frame');
  await rectSelect(page, 26, 26, DOC_W - 52, DOC_H - 52);
  await setGradient(page, 'linear', HOLO);
  await gradientDrag(page, { x: 26, y: 26 }, { x: DOC_W - 26, y: DOC_H - 26 });
  await rectSelect(page, 40, 40, DOC_W - 80, DOC_H - 80);
  await shot(page, '05a-frame-inner-marquee');
  await pressKey(page, 'Delete');
  // A hairline second rule inside the band, the classic double border.
  await rectSelect(page, 54, 54, DOC_W - 108, DOC_H - 108);
  await setFg(page, '#F4F0FF');
  await fill(page);
  await selectModify(page, 'Shrink', 3);
  await shot(page, '05b-frame-shrink');
  await pressKey(page, 'Delete');
  await deselect(page);
  await effect(page, 'Outer Glow', { Size: 18, Opacity: 55 }, { label: 'Glow color', hex: '#22e8ff' });
  await closeEffects(page);
  await shot(page, '05-frame');
  // Bake the glow into pixels: live effects re-render every frame.
  await rasterizeStyle(page);
}
export const COL_L = 330;
export const COL_R = 870;
export const ROW_1 = 600;
export const ROW_2 = 1130;

export async function s06(page: Page): Promise<void> {
  for (const x of [COL_L, DOC_W / 2, COL_R]) await vGuide(page, x);
  for (const y of [170, ROW_1, ROW_2]) await hGuide(page, y);
  await menu(page, 'View', 'Show Grid');
  await pause(page, 200);
  await shot(page, '06-guides-grid');
}

export const INK_LINE = '#120a2e';

export async function gridSize(page: Page, index: number): Promise<void> {
  const slider = page.locator('input[type="range"][aria-label="Grid size"]');
  await slider.fill(String(index));
  await pause(page, 100);
}

export async function s07(page: Page): Promise<void> {
  await gridSize(page, 1); // 8 px
  await menu(page, 'View', 'Show Grid'); // hide grid while drawing freehand parts
  await selectLayer(page, 'Frame');
  // Swallowtail ends sit behind the band and drop a little lower.
  await newLayer(page, 'Banner Tails');
  await setGradient(page, 'linear', [
    { pos: 0, hex: '#7B4DFF' }, { pos: 0.5, hex: '#FF3FD8' }, { pos: 1, hex: '#22E8FF' },
  ]);
  await lassoSelect(page, [
    { x: 210, y: 128 }, { x: 62, y: 128 }, { x: 118, y: 188 }, { x: 62, y: 248 }, { x: 210, y: 248 },
  ]);
  await gradientDrag(page, { x: 62, y: 128 }, { x: 210, y: 248 });
  await lassoSelect(page, [
    { x: DOC_W - 210, y: 128 }, { x: DOC_W - 62, y: 128 }, { x: DOC_W - 118, y: 188 }, { x: DOC_W - 62, y: 248 }, { x: DOC_W - 210, y: 248 },
  ]);
  await gradientDrag(page, { x: DOC_W - 62, y: 248 }, { x: DOC_W - 210, y: 128 });
  // Fold triangles: the shadowed underside where the band turns back.
  await fillPoly(page, [{ x: 170, y: 218 }, { x: 210, y: 218 }, { x: 210, y: 248 }], '#2A124F');
  await fillPoly(page, [{ x: DOC_W - 170, y: 218 }, { x: DOC_W - 210, y: 218 }, { x: DOC_W - 210, y: 248 }], '#2A124F');
  await deselect(page);
  await effect(page, 'Stroke', { Width: 6 }, { label: 'Stroke color', hex: INK_LINE });
  await closeEffects(page);
  await shot(page, '07a-banner-tails');

  await newLayer(page, 'Banner');
  await rectSelect(page, 170, 92, DOC_W - 340, 126);
  await setGradient(page, 'linear', HOLO);
  await gradientDrag(page, { x: 170, y: 92 }, { x: DOC_W - 170, y: 218 });
  await shot(page, '07b-banner-gradient');
  await deselect(page);
  await effect(page, 'Stroke', { Width: 7 }, { label: 'Stroke color', hex: INK_LINE });
  await effect(page, 'Inner Glow', { Size: 14, Opacity: 70 }, { label: 'Glow color', hex: '#ffffff' });
  await effect(page, 'Outer Glow', { Size: 30, Opacity: 60 }, { label: 'Glow color', hex: '#ff3fd8' });
  await closeEffects(page);
  await shot(page, '07-banner');
  await bake(page, ['Banner Tails', 'Banner']);
}
export async function exportPng(page: Page, path: string): Promise<void> {
  const dl = page.waitForEvent('download', { timeout: 120000 });
  await menu(page, 'File', 'Quick Export PNG');
  const d = await dl;
  await d.saveAs(path);
}
export async function s08(page: Page): Promise<unknown> {
  await selectLayer(page, 'Banner');
  await tool(page, 'text');
  await toolOption(page, 'Size', 84);
  await setFont(page, 'Rye');
  await setFg(page, '#FFFFFF');
  await clickDoc(page, 230, 112);
  await page.keyboard.type('COSMIC  X-RAY', { delay: 60 });
  await pause(page, 800);
  await shot(page, '08a-title-typing');
  await page.keyboard.press('Tab');
  await pause(page, 800);
  await shot(page, '08b-title-committed');
  return { layer: await layerBounds(page, 'COSMIC X-RAY'), content: await contentBounds(page, 'COSMIC X-RAY') };
}

export async function s09(page: Page): Promise<unknown> {
  // Bigger type, then re-colour it: click into the committed text with the
  // Text tool, select all, and pick the ink colour.
  await selectLayer(page, 'COSMIC X-RAY');
  await tool(page, 'text');
  await toolOption(page, 'Size', 92);
  await pause(page, 800);
  const cb = await contentBounds(page, 'COSMIC X-RAY');
  await clickDoc(page, (cb!.x0 + cb!.x1) / 2, (cb!.y0 + cb!.y1) / 2);
  await page.keyboard.press('Control+a');
  await pause(page, 300);
  await shot(page, '09a-title-select-all');
  await setFg(page, INK_LINE);
  await pause(page, 500);
  await shot(page, '09b-title-ink');
  await page.keyboard.press('Tab');
  await pause(page, 800);
  return { content: await contentBounds(page, 'COSMIC X-RAY'), l: await layerBounds(page, 'COSMIC X-RAY') };
}

export async function s10(page: Page): Promise<unknown> {
  // Seat the title: centre its glyph box inside the 170..1030 x 92..218 band.
  await selectLayer(page, 'COSMIC X-RAY');
  const b = await centerContentOn(page, 'COSMIC X-RAY', 600, 155);
  await effect(page, 'Stroke', { Width: 3 }, { label: 'Stroke color', hex: '#ffffff' });
  await effect(page, 'Drop Shadow', { 'Offset X': 4, 'Offset Y': 4, Blur: 0, Opacity: 55 }, { label: 'Shadow color', hex: '#2a124f' });
  await closeEffects(page);
  await shot(page, '10-title-seated');
  return b;
}

export const HOLO_PASTEL: Stop[] = [
  { pos: 0, hex: '#B8F7FF' },
  { pos: 0.28, hex: '#FFB3F0' },
  { pos: 0.55, hex: '#C9B6FF' },
  { pos: 0.8, hex: '#B3FFE6' },
  { pos: 1, hex: '#FFF3B0' },
];

export const SKULL: Pt = { x: COL_L, y: ROW_1 + 20 };

function skullOutline(): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= 28; i++) {
    const t = Math.PI - 0.3 + (i / 28) * (Math.PI + 0.6);
    pts.push({ x: 130 * Math.cos(t), y: -40 + 125 * Math.sin(t) });
  }
  pts.push({ x: 118, y: 40 }, { x: 102, y: 70 }, { x: 88, y: 84 }, { x: 80, y: 112 }, { x: 62, y: 140 },
    { x: 30, y: 152 }, { x: -30, y: 152 }, { x: -62, y: 140 }, { x: -80, y: 112 }, { x: -88, y: 84 },
    { x: -102, y: 70 }, { x: -118, y: 40 });
  return pts;
}

function wedge(head: Pt, tail: Pt, w: number): Pt[] {
  const dx = tail.x - head.x, dy = tail.y - head.y;
  const len = Math.hypot(dx, dy);
  const px = -dy / len, py = dx / len;
  const back = { x: head.x - (dx / len) * w * 0.9, y: head.y - (dy / len) * w * 0.9 };
  return [
    { x: head.x + px * w, y: head.y + py * w },
    { x: back.x + px * w * 0.7, y: back.y + py * w * 0.7 },
    back,
    { x: back.x - px * w * 0.7, y: back.y - py * w * 0.7 },
    { x: head.x - px * w, y: head.y - py * w },
    tail,
  ];
}

export async function s11(page: Page): Promise<void> {
  // Comet behind the skull: three tapered wedges streaking up-left.
  await selectLayer(page, 'Frame');
  await newLayer(page, 'Comet Tail');
  const head = { x: SKULL.x + 170, y: SKULL.y - 120 };
  const tail = { x: SKULL.x - 215, y: SKULL.y - 240 };
  await setGradient(page, 'linear', [
    { pos: 0, hex: '#FFFFFF' }, { pos: 0.25, hex: '#22E8FF' }, { pos: 0.7, hex: '#FF3FD8', a: 0.6 }, { pos: 1, hex: '#7B4DFF', a: 0 },
  ]);
  await lassoSelect(page, wedge(head, tail, 44));
  await gradientDrag(page, head, tail);
  await shot(page, '11a-comet-wedge');
  await deselect(page);
  await filter(page, 'Motion Blur...', { Angle: 17, Distance: 24 });
  await newLayer(page, 'Comet Head');
  await setGradient(page, 'radial', [
    { pos: 0, hex: '#FFFFFF' }, { pos: 0.55, hex: '#FFF3B0' }, { pos: 1, hex: '#22E8FF' },
  ]);
  await ellipseSelect(page, head.x, head.y, 30, 30);
  await gradientDrag(page, { x: head.x - 8, y: head.y - 8 }, { x: head.x + 30, y: head.y + 30 });
  await deselect(page);
  await effect(page, 'Stroke', { Width: 5 }, { label: 'Stroke color', hex: INK_LINE });
  await effect(page, 'Outer Glow', { Size: 40, Opacity: 90 }, { label: 'Glow color', hex: '#22e8ff' });
  await closeEffects(page);
  await shot(page, '11-comet');
}

export async function s12(page: Page): Promise<void> {
  await newLayer(page, 'Skull');
  await lassoSelect(page, tx(SKULL, skullOutline()));
  await setGradient(page, 'linear', HOLO_PASTEL);
  await gradientDrag(page, { x: SKULL.x - 130, y: SKULL.y - 165 }, { x: SKULL.x + 130, y: SKULL.y + 152 });
  await shot(page, '12a-skull-lasso-gradient');
  await deselect(page);
  await effect(page, 'Stroke', { Width: 7 }, { label: 'Stroke color', hex: INK_LINE });
  await effect(page, 'Inner Glow', { Size: 34, Opacity: 80 }, { label: 'Glow color', hex: '#7b4dff' });
  await closeEffects(page);
  await shot(page, '12-skull');
}

export async function s13(page: Page): Promise<void> {
  await newLayer(page, 'Skull Ink');
  for (const sx of [-1, 1]) {
    await fillEllipse(page, SKULL.x + sx * 50, SKULL.y + 28, 37, 33, INK_LINE);
  }
  await fillPoly(page, tx(SKULL, [
    { x: 0, y: 62 }, { x: 15, y: 88 }, { x: 8, y: 98 }, { x: 0, y: 92 }, { x: -8, y: 98 }, { x: -15, y: 88 },
  ]), INK_LINE);
  await fillRect(page, SKULL.x - 54, SKULL.y + 108, 108, 34, INK_LINE);
  await setFg(page, '#F4F0FF');
  for (let i = 0; i < 6; i++) {
    await rectSelect(page, SKULL.x - 50 + i * 17, SKULL.y + 111, 13, 13);
    await fill(page);
    await rectSelect(page, SKULL.x - 50 + i * 17, SKULL.y + 127, 13, 11);
    await fill(page);
  }
  await deselect(page);
  await shot(page, '13-skull-features');
}

export async function bake(page: Page, names: string[]): Promise<void> {
  for (const n of names) {
    await selectLayer(page, n);
    await rasterizeStyle(page);
  }
}

export async function s13b(page: Page): Promise<void> {
  await bake(page, ['Comet Head', 'Skull']);
  await shot(page, '13b-baked');
}

function zigzag(x0: number, x1: number, yAt: (x: number) => number, amp: number, step: number): Pt[] {
  const pts: Pt[] = [];
  let k = 0;
  for (let x = x0; x <= x1 + 0.1; x += step, k++) pts.push({ x, y: yAt(x) + (k % 2 ? amp : -amp) });
  return pts;
}

export async function inkBrush(page: Page, size: number, hex: string): Promise<void> {
  await tool(page, 'brush');
  await brushSettings(page, { Size: size, Hardness: 100, Spacing: 8, Opacity: 100, Scatter: 0, 'Size Jitter': 0, 'Opacity Jitter': 0 });
  await closeBrushSettings(page);
  await setFg(page, hex);
}

export async function s14(page: Page): Promise<void> {
  await deselect(page);
  await selectLayer(page, 'Skull Ink');
  await newLayer(page, 'Skull X-Ray Lines');
  await inkBrush(page, 5, '#FFFFFF');
  const S = SKULL;
  // Coronal suture across the crown, sagittal suture up the middle.
  await polyline(page, tx(S, zigzag(-92, 92, (x) => -92 - 22 * Math.cos((x / 92) * (Math.PI / 2)), 6, 12)));
  await polyline(page, tx(S, [{ x: 0, y: -160 }, { x: 5, y: -150 }, { x: -5, y: -140 }, { x: 5, y: -130 }, { x: -5, y: -122 }, { x: 0, y: -114 }]));
  // Temple contours.
  for (const sx of [-1, 1]) {
    await polyline(page, tx(S, bezierPts({ x: sx * 112, y: 18 }, { x: sx * 118, y: -40 }, { x: sx * 96, y: -86 }, { x: sx * 60, y: -112 }, 12)));
    // Brow ridge and cheekbone.
    await polyline(page, tx(S, bezierPts({ x: sx * 92, y: 2 }, { x: sx * 70, y: -18 }, { x: sx * 32, y: -18 }, { x: sx * 12, y: -2 }, 10)));
    await polyline(page, tx(S, bezierPts({ x: sx * 104, y: 58 }, { x: sx * 84, y: 76 }, { x: sx * 46, y: 76 }, { x: sx * 26, y: 64 }, 10)));
  }
  await shot(page, '14a-skull-sutures');
  await effect(page, 'Outer Glow', { Size: 16, Opacity: 90 }, { label: 'Glow color', hex: '#22e8ff' });
  await closeEffects(page);
  // Glowing x-ray eyes.
  await newLayer(page, 'Skull Eyes');
  for (const sx of [-1, 1]) {
    await fillEllipse(page, S.x + sx * 50, S.y + 30, 13, 13, '#22E8FF');
    await fillEllipse(page, S.x + sx * 50 - 3, S.y + 27, 5, 5, '#FFFFFF');
  }
  await effect(page, 'Outer Glow', { Size: 26, Opacity: 100 }, { label: 'Glow color', hex: '#22e8ff' });
  await closeEffects(page);
  await shot(page, '14-skull-xray');
}

export function capsulePts(a: Pt, b: Pt, r: number, n = 10): Pt[] {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = ang - Math.PI / 2 + (i / n) * Math.PI;
    out.push({ x: b.x + Math.cos(t) * r, y: b.y + Math.sin(t) * r });
  }
  for (let i = 0; i <= n; i++) {
    const t = ang + Math.PI / 2 + (i / n) * Math.PI;
    out.push({ x: a.x + Math.cos(t) * r, y: a.y + Math.sin(t) * r });
  }
  return out;
}

function lerp(a: Pt, b: Pt, t: number): Pt { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }

export const HAND: Pt = { x: COL_R, y: ROW_1 + 70 };

const FINGERS: Array<{ base: Pt; tip: Pt; r: number }> = [
  { base: { x: -40, y: 10 }, tip: { x: -46, y: -78 }, r: 15 },
  { base: { x: -10, y: 5 }, tip: { x: -10, y: -100 }, r: 15.5 },
  { base: { x: 22, y: 5 }, tip: { x: 27, y: -88 }, r: 15 },
  { base: { x: 52, y: 15 }, tip: { x: 62, y: -45 }, r: 13 },
];
const THUMB = { base: { x: -50, y: 95 }, tip: { x: -122, y: 2 }, r: 16 };

export async function s15(page: Page): Promise<void> {
  await selectLayer(page, 'Banner Tails');
  // New layers land above the active one, so start the hand just under the banner.
  await newLayer(page, 'Hand Flesh');
  await setFg(page, '#4A22B8');
  await lassoSelect(page, tx(HAND, [
    { x: -56, y: -2 }, { x: 66, y: -4 }, { x: 72, y: 60 }, { x: 64, y: 130 }, { x: 50, y: 175 }, { x: 48, y: 228 },
    { x: -46, y: 228 }, { x: -48, y: 175 }, { x: -62, y: 120 }, { x: -64, y: 50 },
  ]));
  await fill(page);
  for (const f of [...FINGERS, THUMB]) {
    await lassoSelect(page, tx(HAND, capsulePts(f.base, f.tip, f.r)));
    await fill(page);
  }
  await deselect(page);
  await shot(page, '15a-hand-silhouette');
  // Deepen the flesh toward the wrist so the bones read as lit from inside.
  await selectAlpha(page, 'Hand Flesh');
  await setGradient(page, 'linear', [
    { pos: 0, hex: '#7B4DFF' }, { pos: 0.6, hex: '#3A1C8C' }, { pos: 1, hex: '#1C0E4A' },
  ]);
  // Same upper-left light as every other design on the sheet.
  await gradientDrag(page, { x: HAND.x - 120, y: HAND.y - 110 }, { x: HAND.x + 80, y: HAND.y + 230 });
  await deselect(page);
  await effect(page, 'Stroke', { Width: 7 }, { label: 'Stroke color', hex: INK_LINE });
  await effect(page, 'Outer Glow', { Size: 30, Opacity: 85 }, { label: 'Glow color', hex: '#ff3fd8' });
  await closeEffects(page);
  await shot(page, '15-hand-flesh');
}

export async function s16(page: Page): Promise<void> {
  await selectLayer(page, 'Hand Flesh');
  await newLayer(page, 'Hand Bones');
  await setFg(page, '#FFFFFF');
  const bone = async (a: Pt, b: Pt, r: number) => {
    await lassoSelect(page, tx(HAND, capsulePts(a, b, r, 6)));
    await fill(page);
  };
  const splits = [0, 0.46, 0.76, 1];
  for (const f of FINGERS) {
    const tip = lerp(f.base, f.tip, 0.97);
    const len = Math.hypot(tip.x - f.base.x, tip.y - f.base.y);
    const r = f.r * 0.4;
    // Capsule caps overhang their end points by r, so inset each end by r
    // plus half the joint gap to leave a visible dark joint between bones.
    const inset = (r + 3) / len;
    for (let i = 0; i < 3; i++) {
      const a = lerp(f.base, tip, splits[i]! + inset);
      const b = lerp(f.base, tip, splits[i + 1]! - inset);
      await bone(a, b, r);
    }
  }
  // Metacarpals fan out from the wrist to each knuckle.
  const wrist = [{ x: -30, y: 172 }, { x: -8, y: 168 }, { x: 16, y: 168 }, { x: 38, y: 174 }];
  for (let i = 0; i < 4; i++) await bone(wrist[i]!, lerp(FINGERS[i]!.base, wrist[i]!, 0.12), 5.5);
  await bone({ x: -34, y: 155 }, { x: -56, y: 98 }, 6.5);
  await bone({ x: -66, y: 82 }, { x: -86, y: 54 }, 6);
  await bone({ x: -97, y: 40 }, { x: -112, y: 18 }, 5.5);
  for (const c of [{ x: -28, y: 194 }, { x: -6, y: 190 }, { x: 16, y: 192 }, { x: 36, y: 198 }, { x: -16, y: 212 }, { x: 8, y: 213 }, { x: 28, y: 214 }]) {
    await ellipseSelect(page, HAND.x + c.x, HAND.y + c.y, 8, 7);
    await fill(page);
  }
  await deselect(page);
  await shot(page, '16a-hand-bones-white');
  await selectAlpha(page, 'Hand Bones');
  await setGradient(page, 'linear', HOLO_PASTEL);
  await gradientDrag(page, { x: HAND.x - 110, y: HAND.y - 100 }, { x: HAND.x + 70, y: HAND.y + 220 });
  await deselect(page);
  await effect(page, 'Stroke', { Width: 3 }, { label: 'Stroke color', hex: INK_LINE });
  await effect(page, 'Outer Glow', { Size: 12, Opacity: 80 }, { label: 'Glow color', hex: '#22e8ff' });
  await closeEffects(page);
  await shot(page, '16-hand-bones');
}

export async function s17(page: Page): Promise<unknown> {
  await selectLayer(page, 'Banner Tails');
  await newLayer(page, 'Moon');
  const m = { x: HAND.x - 6, y: HAND.y - 190 };
  await ellipseSelect(page, m.x, m.y, 84, 84);
  await setGradient(page, 'linear', [
    { pos: 0, hex: '#FFF3B0' }, { pos: 0.45, hex: '#FFB3F0' }, { pos: 1, hex: '#22E8FF' },
  ]);
  await gradientDrag(page, { x: m.x - 84, y: m.y + 60 }, { x: m.x + 70, y: m.y - 84 });
  // Bite the crescent out with a second, offset ellipse.
  await ellipseSelect(page, m.x + 34, m.y - 30, 76, 76);
  await shot(page, '17a-moon-bite-marquee');
  await pressKey(page, 'Delete');
  await deselect(page);
  const before = await contentBounds(page, 'Moon');
  // Tilt the crescent so its horns cradle toward the fingertips.
  await selectAlpha(page, 'Moon');
  await rotateSelection(page, before!, -25, '17b-moon-rotate-handles');
  await deselect(page);
  await effect(page, 'Stroke', { Width: 6 }, { label: 'Stroke color', hex: INK_LINE });
  await effect(page, 'Inner Glow', { Size: 18, Opacity: 75 }, { label: 'Glow color', hex: '#ffffff' });
  await effect(page, 'Outer Glow', { Size: 44, Opacity: 80 }, { label: 'Glow color', hex: '#fff3b0' });
  await closeEffects(page);
  await shot(page, '17-moon');
  return { before, after: await contentBounds(page, 'Moon') };
}

export async function groupLayers(page: Page, first: string, last: string, name: string): Promise<void> {
  await selectLayer(page, first);
  await selectLayer(page, last, ['Shift']);
  await menu(page, 'Layer', 'Group Layers');
  await pause(page, 300);
  await renameActive(page, name);
}

export async function s18(page: Page): Promise<unknown> {
  await bake(page, ['Skull X-Ray Lines', 'Skull Eyes', 'Moon', 'Hand Flesh', 'Hand Bones']);
  await groupLayers(page, 'Comet Tail', 'Skull Eyes', '01 Skull & Comet');
  await groupLayers(page, 'Moon', 'Hand Bones', '02 Hand & Moon');
  await shot(page, '18-design-groups');
  return layers(page);
}

export const HEART: Pt = { x: COL_L, y: ROW_2 };

function bandPts(center: Pt[], w: number): Pt[] {
  const left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i < center.length; i++) {
    const a = center[Math.max(0, i - 1)]!, b = center[Math.min(center.length - 1, i + 1)]!;
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l;
    const taper = 0.55 + 0.45 * Math.sin((i / (center.length - 1)) * Math.PI);
    left.push({ x: center[i]!.x + nx * w * taper, y: center[i]!.y + ny * w * taper });
    right.push({ x: center[i]!.x - nx * w * taper, y: center[i]!.y - ny * w * taper });
  }
  return [...left, ...right.reverse()];
}

export async function s19(page: Page): Promise<void> {
  await selectLayer(page, 'Banner Tails');
  await newLayer(page, 'Heart');
  await lassoSelect(page, heartPts(HEART.x, HEART.y - 27, 10, 80));
  await setGradient(page, 'radial', [
    { pos: 0, hex: '#FFF3B0' }, { pos: 0.3, hex: '#FF3FD8' }, { pos: 0.68, hex: '#7B4DFF' }, { pos: 1, hex: '#22E8FF' },
  ]);
  await gradientDrag(page, { x: HEART.x - 60, y: HEART.y - 90 }, { x: HEART.x + 150, y: HEART.y + 150 });
  await shot(page, '19a-heart-radial');
  await deselect(page);
  await effect(page, 'Stroke', { Width: 7 }, { label: 'Stroke color', hex: INK_LINE });
  await effect(page, 'Inner Glow', { Size: 22, Opacity: 60 }, { label: 'Glow color', hex: '#ffffff' });
  await effect(page, 'Outer Glow', { Size: 40, Opacity: 80 }, { label: 'Glow color', hex: '#ff3fd8' });
  await closeEffects(page);
  // A kidney-shaped foil glint on the left lobe.
  await newLayer(page, 'Heart Shine');
  await fillPoly(page, tx(HEART, bandPts(bezierPts({ x: -120, y: -40 }, { x: -118, y: -100 }, { x: -70, y: -118 }, { x: -40, y: -96 }, 12), 9)), '#FFFFFF');
  await blendMode(page, 'screen');
  await closeEffects(page);
  await shot(page, '19-heart');
}

export async function s20(page: Page): Promise<void> {
  await newLayer(page, 'Ribcage');
  await setFg(page, '#FFFFFF');
  await lassoSelect(page, tx(HEART, capsulePts({ x: 0, y: -80 }, { x: 0, y: 70 }, 8, 6)));
  await fill(page);
  const ribs = [
    { y0: -74, end: { x: 150, y: -34 } },
    { y0: -36, end: { x: 144, y: 10 } },
    { y0: 2, end: { x: 126, y: 52 } },
    { y0: 40, end: { x: 98, y: 90 } },
  ];
  for (const r of ribs) {
    for (const s of [-1, 1]) {
      const c = bezierPts({ x: s * 12, y: r.y0 }, { x: s * 70, y: r.y0 - 24 }, { x: s * r.end.x * 0.96, y: r.y0 - 6 }, { x: s * r.end.x, y: r.end.y }, 16);
      await lassoSelect(page, tx(HEART, bandPts(c, 8)));
      await fill(page);
    }
  }
  await deselect(page);
  await shot(page, '20a-ribs-white');
  await selectAlpha(page, 'Ribcage');
  await setGradient(page, 'linear', HOLO_PASTEL);
  await gradientDrag(page, { x: HEART.x - 150, y: HEART.y - 90 }, { x: HEART.x + 150, y: HEART.y + 90 });
  await deselect(page);
  await effect(page, 'Stroke', { Width: 3 }, { label: 'Stroke color', hex: INK_LINE });
  await effect(page, 'Outer Glow', { Size: 14, Opacity: 85 }, { label: 'Glow color', hex: '#22e8ff' });
  await closeEffects(page);
  await layerOpacity(page, 92);
  await shot(page, '20-ribcage');
}

export async function s21(page: Page): Promise<void> {
  const star = { x: HEART.x + 150, y: HEART.y - 168 };
  const tailEnd = { x: HEART.x - 90, y: HEART.y - 250 };
  await newLayer(page, 'Shooting Star Trail');
  await setGradient(page, 'linear', [
    { pos: 0, hex: '#FFF3B0' }, { pos: 0.4, hex: '#FF3FD8', a: 0.8 }, { pos: 1, hex: '#7B4DFF', a: 0 },
  ]);
  for (const [off, w] of [[-16, 10], [0, 16], [16, 10]] as const) {
    const end = { x: tailEnd.x + off * 0.4, y: tailEnd.y + off * 2.2 };
    await lassoSelect(page, wedge({ x: star.x - 10, y: star.y + off * 0.6 }, end, w));
    await gradientDrag(page, star, end);
  }
  await deselect(page);
  await filter(page, 'Motion Blur...', { Angle: 19, Distance: 14 });
  await newLayer(page, 'Shooting Star');
  await lassoSelect(page, starPts(star.x, star.y, 44, 18, 5, -Math.PI / 2 + 0.2));
  await setGradient(page, 'radial', [
    { pos: 0, hex: '#FFFFFF' }, { pos: 0.5, hex: '#FFF3B0' }, { pos: 1, hex: '#FFB3F0' },
  ]);
  await gradientDrag(page, star, { x: star.x + 44, y: star.y + 30 });
  await deselect(page);
  await effect(page, 'Stroke', { Width: 5 }, { label: 'Stroke color', hex: INK_LINE });
  await effect(page, 'Outer Glow', { Size: 30, Opacity: 90 }, { label: 'Glow color', hex: '#fff3b0' });
  await closeEffects(page);
  await shot(page, '21-shooting-star');
}

export const PLANET: Pt = { x: COL_R, y: ROW_2 + 10 };

export async function s22(page: Page): Promise<void> {
  await bake(page, ['Heart', 'Ribcage', 'Shooting Star']);
  await groupLayers(page, 'Heart', 'Shooting Star', '03 Heart & Star');
  // A root-level layer is active, so the planet layers stay out of group 03.
  await selectLayer(page, 'Banner Tails');
  await newLayer(page, 'Planet');
  await ellipseSelect(page, PLANET.x, PLANET.y, 118, 118);
  await setGradient(page, 'radial', [
    { pos: 0, hex: '#FFFFFF' }, { pos: 0.18, hex: '#B8F7FF' }, { pos: 0.48, hex: '#C9B6FF' }, { pos: 0.78, hex: '#FF3FD8' }, { pos: 1, hex: '#3A1C8C' },
  ]);
  await gradientDrag(page, { x: PLANET.x - 45, y: PLANET.y - 50 }, { x: PLANET.x + 110, y: PLANET.y + 125 });
  await deselect(page);
  // Burn the terminator so the sphere turns away from the light.
  await tool(page, 'dodge');
  await page.locator('[aria-labelledby="dodge-mode-label"]').selectOption('burn');
  await toolOption(page, 'Exposure', 16);
  await toolOption(page, 'Size', 110);
  await dragDoc(page, tx(PLANET, bezierPts({ x: 118, y: -40 }, { x: 125, y: 60 }, { x: 70, y: 125 }, { x: -40, y: 124 }, 14)), { steps: 3 });
  await shot(page, '22a-planet-burn');
  // Latitude bands, clipped to the sphere with an inverted alpha selection.
  await newLayer(page, 'Planet Bands');
  for (const [y, w] of [[-52, 10], [-12, 16], [34, 9], [66, 6]] as const) {
    await fillPoly(page, tx(PLANET, [
      { x: -140, y: y - w + 22 }, { x: 140, y: y - w - 22 }, { x: 140, y: y + w - 22 }, { x: -140, y: y + w + 22 },
    ]), '#7B4DFF');
  }
  await selectLayer(page, 'Planet');
  await selectAlpha(page, 'Planet');
  await selectLayer(page, 'Planet Bands');
  await menu(page, 'Select', 'Inverse');
  await pressKey(page, 'Delete');
  await deselect(page);
  await blendMode(page, 'multiply');
  await closeEffects(page);
  await layerOpacity(page, 45);
  await selectLayer(page, 'Planet');
  await effect(page, 'Stroke', { Width: 6 }, { label: 'Stroke color', hex: INK_LINE });
  await effect(page, 'Outer Glow', { Size: 36, Opacity: 70 }, { label: 'Glow color', hex: '#7b4dff' });
  await closeEffects(page);
  await shot(page, '22-planet');
}

export async function s23(page: Page): Promise<unknown> {
  await selectLayer(page, 'Planet Bands');
  await newLayer(page, 'Ring');
  await ellipseSelect(page, PLANET.x, PLANET.y, 215, 58);
  await setFg(page, '#FFFFFF');
  await fill(page);
  await ellipseSelect(page, PLANET.x, PLANET.y, 184, 40);
  await pressKey(page, 'Delete');
  await deselect(page);
  await selectAlpha(page, 'Ring');
  await setGradient(page, 'linear', HOLO);
  await gradientDrag(page, { x: PLANET.x - 215, y: PLANET.y }, { x: PLANET.x + 215, y: PLANET.y });
  const before = await contentBounds(page, 'Ring');
  await rotateSelection(page, before!, -18, '23a-ring-rotate');
  await deselect(page);
  // Erase the back half of the ring where it passes behind the planet: the
  // planet's alpha selection keeps the eraser off the ring outside the disc.
  // Load the alpha with Planet itself active, then click back to Ring, so the
  // selection is not swapped for Ring's own alpha on the first dab (see #801).
  await selectLayer(page, 'Planet');
  await selectAlpha(page, 'Planet');
  await selectLayer(page, 'Ring');
  await tool(page, 'eraser');
  await toolOption(page, 'Size', 30);
  await toolOption(page, 'Opacity', 100);
  const rot = (-18 * Math.PI) / 180;
  const arc: Pt[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = Math.PI + (i / 16) * Math.PI;
    const ex = Math.cos(t) * 200, ey = Math.sin(t) * 49;
    arc.push({ x: PLANET.x + ex * Math.cos(rot) - ey * Math.sin(rot), y: PLANET.y + ex * Math.sin(rot) + ey * Math.cos(rot) });
  }
  await polyline(page, arc);
  await shot(page, '23b-ring-erase-back');
  await deselect(page);
  await effect(page, 'Stroke', { Width: 4 }, { label: 'Stroke color', hex: INK_LINE });
  await effect(page, 'Outer Glow', { Size: 20, Opacity: 70 }, { label: 'Glow color', hex: '#22e8ff' });
  await closeEffects(page);
  // A little moon on its own orbit.
  await newLayer(page, 'Moonlet');
  await ellipseSelect(page, PLANET.x + 178, PLANET.y - 128, 22, 22);
  await setGradient(page, 'radial', [{ pos: 0, hex: '#FFFFFF' }, { pos: 1, hex: '#B3FFE6' }]);
  await gradientDrag(page, { x: PLANET.x + 170, y: PLANET.y - 136 }, { x: PLANET.x + 200, y: PLANET.y - 106 });
  await deselect(page);
  await effect(page, 'Stroke', { Width: 4 }, { label: 'Stroke color', hex: INK_LINE });
  await closeEffects(page);
  await bake(page, ['Planet', 'Ring', 'Moonlet']);
  await groupLayers(page, 'Planet', 'Moonlet', '04 Ringed Planet');
  await shot(page, '23-ringed-planet');
  return contentBounds(page, 'Ring');
}

// Each badge sits just above and left of its own design's bounding box.
export const BADGES: Pt[] = [
  { x: 112, y: 302 }, { x: 700, y: 380 }, { x: 112, y: 862 }, { x: 652, y: 952 },
];

async function copyPasteMove(page: Page, box: { x: number; y: number; w: number; h: number }, dx: number, dy: number, name: string, cut = false): Promise<void> {
  await rectSelect(page, box.x, box.y, box.w, box.h);
  await pressKey(page, cut ? 'Control+x' : 'Control+c');
  await pressKey(page, 'Control+v');
  await pause(page, 600);
  await deselect(page);
  await renameActive(page, name);
  await moveBy(page, { x: box.x + box.w / 2, y: box.y + box.h / 2 }, dx, dy);
}

export async function s24(page: Page): Promise<unknown> {
  // Flash numbers: one holographic badge, then copy / paste it to each design.
  await selectLayer(page, 'Banner Tails');
  await newLayer(page, 'Badge 1');
  const b = BADGES[0]!;
  await ellipseSelect(page, b.x, b.y, 27, 27);
  await setGradient(page, 'linear', HOLO_PASTEL);
  await gradientDrag(page, { x: b.x - 27, y: b.y - 27 }, { x: b.x + 27, y: b.y + 27 });
  await deselect(page);
  await effect(page, 'Stroke', { Width: 4 }, { label: 'Stroke color', hex: INK_LINE });
  await effect(page, 'Outer Glow', { Size: 16, Opacity: 80 }, { label: 'Glow color', hex: '#22e8ff' });
  await closeEffects(page);
  await rasterizeStyle(page);
  const box = { x: b.x - 34, y: b.y - 34, w: 68, h: 68 };
  for (let i = 1; i < 4; i++) {
    await selectLayer(page, 'Badge 1');
    await copyPasteMove(page, box, BADGES[i]!.x - b.x, BADGES[i]!.y - b.y, `Badge ${i + 1}`);
    if (i === 1) await shot(page, '24a-badge-pasted');
  }
  await shot(page, '24b-badges');
  // Numbers set in Rye, each centred on its badge.
  await tool(page, 'text');
  await toolOption(page, 'Size', 34);
  await setFont(page, 'Rye');
  await setFg(page, INK_LINE);
  const out: unknown[] = [];
  for (let i = 0; i < 4; i++) {
    await selectLayer(page, `Badge ${i + 1}`);
    await tool(page, 'text');
    await clickDoc(page, BADGES[i]!.x + 70, BADGES[i]!.y - 20);
    await page.keyboard.type(String(i + 1), { delay: 50 });
    await page.keyboard.press('Tab');
    await pause(page, 600);
    await renameActive(page, `No. ${i + 1}`);
    out.push(await centerContentOn(page, `No. ${i + 1}`, BADGES[i]!.x, BADGES[i]!.y + 1));
  }
  await shot(page, '24-flash-numbers');
  return out;
}

export const SPARK: Pt = { x: 560, y: 790 };

export async function s25(page: Page): Promise<unknown> {
  await selectLayer(page, 'Badge 1');
  await newLayer(page, 'Sparkle');
  await fillPoly(page, sparklePts(SPARK.x, SPARK.y, 34), '#FFFFFF');
  await shot(page, '25a-sparkle');
  // Copy, paste, rotate 45 degrees and shrink: the classic eight-point glint.
  const box = { x: SPARK.x - 40, y: SPARK.y - 40, w: 80, h: 80 };
  await rectSelect(page, box.x, box.y, box.w, box.h);
  await pressKey(page, 'Control+c');
  await pressKey(page, 'Control+v');
  await pause(page, 600);
  await renameActive(page, 'Sparkle Rot');
  await selectAlpha(page, 'Sparkle Rot');
  const b0 = (await contentBounds(page, 'Sparkle Rot'))!;
  await rotateSelection(page, b0, 45, '25b-sparkle-copy-rotate');
  const cx = (b0.x0 + b0.x1) / 2;
  const cy = (b0.y0 + b0.y1) / 2;
  const half = (b0.x1 - b0.x0) / 2;
  await deselect(page);
  await selectAlpha(page, 'Sparkle Rot');
  const b1 = (await contentBounds(page, 'Sparkle Rot'))!;
  await scaleSelection(page, { x: b1.x1, y: b1.y1 }, -(b1.x1 - b1.x0) * 0.2, -(b1.y1 - b1.y0) * 0.2, true, '25c-sparkle-copy-scale');
  await deselect(page);
  await centerContentOn(page, 'Sparkle Rot', cx, cy);
  await menu(page, 'Layer', 'Merge Down');
  await pause(page, 500);
  await effect(page, 'Outer Glow', { Size: 22, Opacity: 95 }, { label: 'Glow color', hex: '#ffffff' });
  await closeEffects(page);
  await rasterizeStyle(page);
  await shot(page, '25d-eight-point-glint');
  // Scatter copies across the sheet; cut the first one away from the gutter.
  const gb = { x: SPARK.x - half - 26, y: SPARK.y - half - 26, w: 2 * half + 52, h: 2 * half + 52 };
  const spots: Array<[number, number, string]> = [[1070, 360, 'Sparkle 2'], [140, 1320, 'Sparkle 3'], [1070, 1320, 'Sparkle 4'], [600, 880, 'Sparkle 5']];
  for (const [x, y, name] of spots) {
    await selectLayer(page, 'Sparkle');
    await copyPasteMove(page, gb, x - SPARK.x, y - SPARK.y, name);
  }
  await selectLayer(page, 'Sparkle');
  await copyPasteMove(page, gb, 560 - SPARK.x, 470 - SPARK.y, 'Sparkle 6', true);
  // Shrink two of the copies so the glints read at different distances.
  for (const name of ['Sparkle 5', 'Sparkle 3']) {
    await selectLayer(page, name);
    await selectAlpha(page, name);
    const bb = (await contentBounds(page, name))!;
    await scaleSelection(page, { x: bb.x1, y: bb.y1 }, -(bb.x1 - bb.x0) * 0.35, -(bb.y1 - bb.y0) * 0.35, true);
    await deselect(page);
  }
  await shot(page, '25-sparkles');
  return contentBounds(page, 'Sparkle 6');
}

export async function s26(page: Page): Promise<unknown> {
  // The sheet's signature line gets its own small ribbon plate, so it reads
  // as clearly as the title instead of floating on the star field.
  await selectLayer(page, 'Badge 1');
  await newLayer(page, 'Footer Plate');
  await fillPoly(page, [{ x: 350, y: 1430 }, { x: 292, y: 1430 }, { x: 310, y: 1452 }, { x: 292, y: 1474 }, { x: 350, y: 1474 }], '#7B4DFF');
  await fillPoly(page, [{ x: 850, y: 1430 }, { x: 908, y: 1430 }, { x: 890, y: 1452 }, { x: 908, y: 1474 }, { x: 850, y: 1474 }], '#7B4DFF');
  await rectSelect(page, 330, 1420, 540, 62);
  await setGradient(page, 'linear', HOLO_PASTEL);
  await gradientDrag(page, { x: 330, y: 1420 }, { x: 870, y: 1482 });
  await deselect(page);
  await effect(page, 'Stroke', { Width: 4 }, { label: 'Stroke color', hex: INK_LINE });
  await effect(page, 'Outer Glow', { Size: 18, Opacity: 70 }, { label: 'Glow color', hex: '#ff3fd8' });
  await closeEffects(page);
  await rasterizeStyle(page);
  await shot(page, '26a-footer-plate');
  await tool(page, 'text');
  await toolOption(page, 'Size', 30);
  await setFont(page, 'Rye');
  await setFg(page, INK_LINE);
  await clickDoc(page, 360, 1500);
  await page.keyboard.type('FLASH  No. 13   ~   X-RAY  SERIES', { delay: 40 });
  await page.keyboard.press('Tab');
  await pause(page, 800);
  await renameActive(page, 'Footer');
  const b = await centerContentOn(page, 'Footer', DOC_W / 2, 1451);
  await shot(page, '26-footer');
  return b;
}

/** Position + pixel fingerprint of the given layers (reads GPU textures). */
export async function layerHash(page: Page, names: string[]): Promise<string> {
  return page.evaluate(async (names) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { pushHistory: (l?: string) => void; document: { layers: Array<{ id: string; name: string; x: number; y: number }> } };
    };
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as (id: string) => Promise<{ width: number; height: number; pixels: ArrayLike<number> }>;
    const parts: string[] = [];
    for (const n of names) {
      const l = store.getState().document.layers.find((x) => x.name === n);
      if (!l) { parts.push(`${n}:missing`); continue; }
      const r = await read(l.id);
      let h = 2166136261;
      for (let i = 0; i < r.pixels.length; i += 3) { h ^= r.pixels[i]!; h = Math.imul(h, 16777619) >>> 0; }
      parts.push(`${n}@${l.x},${l.y}:${r.width}x${r.height}:${h.toString(16)}`);
    }
    return parts.join('|');
  }, names);
}

const MOVED = ['Heart', 'Ribcage', 'Planet', 'Ring', 'Badge 3', 'Badge 4'];

export async function s27(page: Page): Promise<unknown> {
  // Drop the bottom row 40 px: select both groups plus their badges and
  // numbers, and drag them together with Snap to Grid on.
  const before = await layerHash(page, MOVED);
  await menu(page, 'View', 'Show Grid');
  await selectLayer(page, '03 Heart & Star');
  for (const n of ['04 Ringed Planet', 'Badge 3', 'No. 3', 'Badge 4', 'No. 4']) await selectLayer(page, n, ['Control']);
  await tool(page, 'move');
  const from = await docToScreen(page, HEART.x, HEART.y);
  const to = await docToScreen(page, HEART.x, HEART.y + 40);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await pause(page, 400);
  await shot(page, '27a-group-drag-snap');
  await page.mouse.up();
  await pause(page, 500);
  await menu(page, 'View', 'Show Grid');
  const afterMove = await layerHash(page, MOVED);
  await shot(page, '27b-row-two-moved');
  // Undo three steps, check the canvas changed, then redo and check it is
  // byte-identical to where we were.
  const hashes: string[] = [afterMove];
  for (let i = 0; i < 3; i++) {
    await pressKey(page, 'Control+z');
    await pause(page, 600);
    hashes.push(await layerHash(page, MOVED));
  }
  await shot(page, '27c-undo-x3');
  for (let i = 0; i < 3; i++) {
    await pressKey(page, 'Control+Shift+z');
    await pause(page, 600);
  }
  const afterRedo = await layerHash(page, MOVED);
  await shot(page, '27d-redo-x3');
  return { before, hashes, afterRedo, match: afterRedo === afterMove, bottom: await contentBounds(page, 'Heart') };
}

export async function s28(page: Page): Promise<void> {
  // Finishing: bloom on the star field, a chromatic split on the comet tail,
  // and a fine print grain over everything.
  await selectLayer(page, 'Stars');
  await filter(page, 'Bloom...', { Threshold: 40, 'Soft Knee': 50, Radius: 6, Intensity: 140 });
  await shot(page, '28a-stars-bloom');
  await selectLayer(page, 'Comet Tail');
  await filter(page, 'Chromatic Aberration...', { Amount: 7, Direction: 17 });
  await selectLayer(page, 'Footer');
  await newLayer(page, 'Grain');
  await setFg(page, '#808080');
  await fill(page);
  await filter(page, 'Add Noise...', { Amount: 22 }, ['Mono', 'Gaussian']);
  await blendMode(page, 'overlay');
  await closeEffects(page);
  await layerOpacity(page, 18);
  await shot(page, '28-finishing');
}

export async function s29(page: Page, path = 'e2e/screenshots/cosmic-xray-tattoo-flash.png'): Promise<void> {
  await deselect(page);
  await shot(page, '29-finished-in-editor');
  await exportPng(page, path);
}
