import type { Pt } from './composition-uncharted-fjords.steps.ts';

// Pure geometry for the Uncharted Fjords emblem: a seeded rocky coastline,
// tapering fjord channels, skerries and the compass-rose kites. Everything is
// deterministic so every run draws the same map.

export const C: Pt = { x: 600, y: 600 };
export const R_SEA = 380;
export const R_TICKS = 388;
export const R_PLATE = 470;
/** Compass-rose centre. Whole percentages of the 1200 px doc (35%, 52%) so the Sunburst centre lands exactly. */
export const K: Pt = { x: 420, y: 624 };

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Midpoint displacement between successive control points: a rocky coast. */
export function rocky(ctrl: Pt[], depth: number, rough: number, seed: number): Pt[] {
  const r = rng(seed);
  let pts = ctrl.slice();
  for (let d = 0; d < depth; d++) {
    const out: Pt[] = [pts[0]!];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!;
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      const off = (r() * 2 - 1) * len * rough;
      out.push({ x: (a.x + b.x) / 2 - (dy / len) * off, y: (a.y + b.y) / 2 + (dx / len) * off }, b);
    }
    pts = out;
  }
  return pts;
}

/** Catmull-Rom through the control points. */
export function spline(ctrl: Pt[], per = 8): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)]!, p1 = ctrl[i]!, p2 = ctrl[i + 1]!, p3 = ctrl[Math.min(ctrl.length - 1, i + 2)]!;
    for (let s = 0; s < per; s++) {
      const t = s / per, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(ctrl[ctrl.length - 1]!);
  return out;
}

/** A tapering channel around a centreline, with slightly ragged banks. */
export function channel(center: Pt[], w0: number, w1: number, seed: number): Pt[] {
  const r = rng(seed);
  const left: Pt[] = [], right: Pt[] = [];
  const n = center.length;
  for (let i = 0; i < n; i++) {
    const a = center[Math.max(0, i - 1)]!, b = center[Math.min(n - 1, i + 1)]!;
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l;
    const w = (w0 + (w1 - w0) * (i / (n - 1))) / 2;
    const jl = w * (0.75 + r() * 0.5), jr = w * (0.75 + r() * 0.5);
    left.push({ x: center[i]!.x + nx * jl, y: center[i]!.y + ny * jl });
    right.push({ x: center[i]!.x - nx * jr, y: center[i]!.y - ny * jr });
  }
  // Round the head of the fjord with the last centre point.
  return [...left, center[n - 1]!, ...right.reverse()];
}

/** A small jagged island blob. */
export function skerry(cx: number, cy: number, rx: number, ry: number, seed: number, rot = 0): Pt[] {
  const r = rng(seed);
  const n = 28;
  const radii: number[] = [];
  for (let i = 0; i < n; i++) radii.push(0.7 + r() * 0.45);
  const out: Pt[] = [];
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const k = (radii[i]! + radii[(i + 1) % n]! + radii[(i + n - 1) % n]!) / 3;
    const ex = Math.cos(t) * rx * k, ey = Math.sin(t) * ry * k;
    out.push({ x: cx + ex * c - ey * s, y: cy + ex * s + ey * c });
  }
  return out;
}

export function polar(center: Pt, r: number, deg: number): Pt {
  const a = (deg * Math.PI) / 180;
  return { x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r };
}

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

const COAST_CTRL: Pt[] = [
  { x: -60, y: 250 }, { x: 120, y: 280 }, { x: 250, y: 318 }, { x: 330, y: 382 }, { x: 425, y: 408 },
  { x: 500, y: 478 }, { x: 552, y: 560 }, { x: 640, y: 612 }, { x: 700, y: 702 }, { x: 790, y: 752 },
  { x: 885, y: 800 }, { x: 1000, y: 872 }, { x: 1120, y: 900 }, { x: 1270, y: 905 },
];

/** Land polygon: rocky coast, closed round the top-right outside the canvas. */
export function landPoly(): Pt[] {
  const coast = rocky(COAST_CTRL, 5, 0.18, 7);
  return [...coast, { x: 1270, y: -70 }, { x: -60, y: -70 }];
}

export const FJORDS: Array<{ ctrl: Pt[]; w0: number; w1: number; seed: number }> = [
  { ctrl: [{ x: 272, y: 368 }, { x: 318, y: 318 }, { x: 372, y: 300 }, { x: 410, y: 262 }, { x: 452, y: 250 }], w0: 30, w1: 7, seed: 11 },
  { ctrl: [{ x: 508, y: 540 }, { x: 560, y: 480 }, { x: 604, y: 440 }, { x: 628, y: 392 }, { x: 690, y: 372 }, { x: 736, y: 330 }, { x: 792, y: 318 }], w0: 40, w1: 8, seed: 23 },
  { ctrl: [{ x: 722, y: 752 }, { x: 772, y: 700 }, { x: 842, y: 676 }, { x: 884, y: 628 }, { x: 928, y: 596 }], w0: 34, w1: 8, seed: 37 },
];

export function fjordCenter(i: number): Pt[] {
  return spline(FJORDS[i]!.ctrl, 6);
}

export function fjordPoly(i: number): Pt[] {
  const f = FJORDS[i]!;
  return channel(fjordCenter(i), f.w0, f.w1, f.seed);
}

/** One half of a compass point: centre, tip, and the shoulder on one side. */
export function kite(center: Pt, len: number, shoulder: number, deg: number, side: 1 | -1): Pt[] {
  return [center, polar(center, len, deg), polar(center, shoulder, deg + side * 45)];
}
