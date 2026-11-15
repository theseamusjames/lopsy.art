const LUT_SIZE = 32;

export interface LutPreset {
  id: string;
  name: string;
  data: Uint8Array;
  size: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

type ColorTransform = (r: number, g: number, b: number) => [number, number, number];

function generateLutStrip(size: number, transform: ColorTransform): Uint8Array {
  const stripW = size * size;
  const stripH = size;
  const data = new Uint8Array(stripW * stripH * 4);
  const maxIdx = size - 1;

  for (let y = 0; y < stripH; y++) {
    for (let x = 0; x < stripW; x++) {
      const blue = Math.floor(x / size);
      const red = x % size;
      const green = y;

      const rIn = red / maxIdx;
      const gIn = green / maxIdx;
      const bIn = blue / maxIdx;

      const [rOut, gOut, bOut] = transform(rIn, gIn, bIn);

      const idx = (y * stripW + x) * 4;
      data[idx] = Math.round(clamp01(rOut) * 255);
      data[idx + 1] = Math.round(clamp01(gOut) * 255);
      data[idx + 2] = Math.round(clamp01(bOut) * 255);
      data[idx + 3] = 255;
    }
  }

  return data;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

function liftShadows(v: number, amount: number): number {
  return v + amount * (1 - v) * (1 - v);
}

function applyCurve(v: number, shadows: number, highlights: number): number {
  const lifted = liftShadows(v, shadows);
  return Math.pow(lifted, 1 - highlights * 0.5);
}

const warmVintage: ColorTransform = (r, g, b) => {
  const [h, s, l] = rgbToHsl(r, g, b);
  const newS = s * 0.75;
  const [rr, gg, bb] = hslToRgb(h, newS, l);
  return [
    applyCurve(rr, 0.08, 0.1) * 1.05,
    applyCurve(gg, 0.05, 0.05),
    applyCurve(bb, 0.02, -0.05) * 0.92,
  ];
};

const tealOrange: ColorTransform = (r, g, b) => {
  const [, , l] = rgbToHsl(r, g, b);
  const shadowBlend = 1 - clamp01(l * 2);
  const highlightBlend = clamp01(l * 2 - 1);
  const midBlend = 1 - shadowBlend - highlightBlend;

  let nr = r;
  let ng = g;
  let nb = b;

  nr += highlightBlend * 0.12 - shadowBlend * 0.08;
  ng += highlightBlend * 0.06 - shadowBlend * 0.02;
  nb += -highlightBlend * 0.06 + shadowBlend * 0.15;

  const [, ns] = rgbToHsl(nr, ng, nb);
  const boostS = ns * (1 + midBlend * 0.3);
  const [h2] = rgbToHsl(clamp01(nr), clamp01(ng), clamp01(nb));
  const [rOut, gOut, bOut] = hslToRgb(h2, clamp01(boostS), l);
  return [clamp01(rOut), clamp01(gOut), clamp01(bOut)];
};

const noir: ColorTransform = (r, g, b) => {
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const contrast = clamp01((lum - 0.5) * 1.6 + 0.5);
  const lifted = liftShadows(contrast, 0.06);
  return [lifted * 1.02, lifted * 0.99, lifted * 0.95];
};

const crossProcess: ColorTransform = (r, g, b) => {
  const rCurve = clamp01(r * r * 0.6 + r * 0.5 - 0.05);
  const gCurve = clamp01(Math.pow(g, 0.8) * 1.1);
  const bCurve = clamp01(b * 0.7 + 0.1);
  const [h, s, l] = rgbToHsl(rCurve, gCurve, bCurve);
  const [rr, gg, bb] = hslToRgb(h, clamp01(s * 1.3), l);
  return [clamp01(rr), clamp01(gg), clamp01(bb)];
};

const fadedFilm: ColorTransform = (r, g, b) => {
  const liftedR = r * 0.85 + 0.08;
  const liftedG = g * 0.85 + 0.06;
  const liftedB = b * 0.85 + 0.07;
  const [h, s, l] = rgbToHsl(liftedR, liftedG, liftedB);
  const [rr, gg, bb] = hslToRgb(h, s * 0.7, l);
  return [clamp01(rr + 0.02), clamp01(gg), clamp01(bb - 0.02)];
};

const sunset: ColorTransform = (r, g, b) => {
  const [, , l] = rgbToHsl(r, g, b);
  const warmPush = (1 - l) * 0.15;
  return [
    clamp01(r + warmPush * 1.2),
    clamp01(g + warmPush * 0.4),
    clamp01(b - warmPush * 0.3),
  ];
};

const coolBlue: ColorTransform = (r, g, b) => {
  const [, , l] = rgbToHsl(r, g, b);
  const shadowBlend = 1 - clamp01(l * 2.5);
  return [
    clamp01(r - shadowBlend * 0.08),
    clamp01(g + shadowBlend * 0.02),
    clamp01(b + shadowBlend * 0.15),
  ];
};

const cyberpunk: ColorTransform = (r, g, b) => {
  const [h, s, l] = rgbToHsl(r, g, b);
  const newS = clamp01(s * 1.5);
  const shadowBlend = 1 - clamp01(l * 2);
  const highlightBlend = clamp01(l * 2 - 1);
  const [rr, gg, bb] = hslToRgb(h, newS, l);
  return [
    clamp01(rr + highlightBlend * 0.08 + shadowBlend * 0.12),
    clamp01(gg - shadowBlend * 0.05 + highlightBlend * 0.02),
    clamp01(bb + shadowBlend * 0.2 - highlightBlend * 0.05),
  ];
};

let cachedPresets: LutPreset[] | null = null;

export function getBuiltinPresets(): LutPreset[] {
  if (cachedPresets) return cachedPresets;

  const transforms: Array<{ id: string; name: string; fn: ColorTransform }> = [
    { id: 'warm-vintage', name: 'Warm Vintage', fn: warmVintage },
    { id: 'teal-orange', name: 'Teal & Orange', fn: tealOrange },
    { id: 'noir', name: 'Noir', fn: noir },
    { id: 'cross-process', name: 'Cross Process', fn: crossProcess },
    { id: 'faded-film', name: 'Faded Film', fn: fadedFilm },
    { id: 'sunset', name: 'Sunset', fn: sunset },
    { id: 'cool-blue', name: 'Cool Blue', fn: coolBlue },
    { id: 'cyberpunk', name: 'Cyberpunk', fn: cyberpunk },
  ];

  cachedPresets = transforms.map(({ id, name, fn }) => ({
    id,
    name,
    data: generateLutStrip(LUT_SIZE, fn),
    size: LUT_SIZE,
  }));

  return cachedPresets;
}

export function parseCubeFile(text: string): LutPreset | null {
  const lines = text.split('\n');
  let size = 0;
  let title = 'Imported LUT';
  const rgbValues: number[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('TITLE')) {
      const match = trimmed.match(/TITLE\s+"?([^"]*)"?/);
      if (match?.[1]) title = match[1];
      continue;
    }

    if (trimmed.startsWith('LUT_3D_SIZE')) {
      const sizeStr = trimmed.split(/\s+/)[1];
      if (sizeStr) size = parseInt(sizeStr, 10);
      continue;
    }

    if (trimmed.startsWith('DOMAIN_MIN') || trimmed.startsWith('DOMAIN_MAX')) {
      continue;
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length >= 3 && parts[0] !== undefined && parts[1] !== undefined && parts[2] !== undefined) {
      const r = parseFloat(parts[0]);
      const g = parseFloat(parts[1]);
      const b = parseFloat(parts[2]);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        rgbValues.push(r, g, b);
      }
    }
  }

  if (size < 2 || rgbValues.length < size * size * size * 3) return null;

  const stripW = size * size;
  const stripH = size;
  const data = new Uint8Array(stripW * stripH * 4);

  for (let blue = 0; blue < size; blue++) {
    for (let green = 0; green < size; green++) {
      for (let red = 0; red < size; red++) {
        const lineIdx = blue * size * size + green * size + red;
        const base = lineIdx * 3;
        const r = clamp01(rgbValues[base] ?? 0);
        const g = clamp01(rgbValues[base + 1] ?? 0);
        const b = clamp01(rgbValues[base + 2] ?? 0);

        const x = blue * size + red;
        const y = green;
        const pixIdx = (y * stripW + x) * 4;
        data[pixIdx] = Math.round(r * 255);
        data[pixIdx + 1] = Math.round(g * 255);
        data[pixIdx + 2] = Math.round(b * 255);
        data[pixIdx + 3] = 255;
      }
    }
  }

  return { id: `imported-${Date.now()}`, name: title, data, size };
}
