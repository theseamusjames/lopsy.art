/**
 * Perspective crop math — pure logic, no DOM, no React.
 *
 * Computes the projective (homography) transform from a source quadrilateral
 * to a destination rectangle and applies it via inverse mapping with bilinear
 * interpolation.
 */

export interface Quad {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
}

/** 3×3 row-major homogeneous transform matrix (9 elements). */
export type Matrix3x3 = [
  number, number, number,
  number, number, number,
  number, number, number,
];

/**
 * Solve for the 8 coefficients of the direct linear transform (DLT) that maps
 * `srcQuad` corners → a rectangle `[0,0] → [dstW, dstH]`.
 *
 * The returned matrix maps destination (u, v) pixels → source (x, y) pixels
 * (i.e. the *inverse* warp used in a pull-based resampler).
 *
 * The identity quad (corners matching the rect corners) produces the identity
 * matrix within floating-point tolerance.
 */
export function computePerspectiveTransform(srcQuad: Quad, dstWidth: number, dstHeight: number): Matrix3x3 {
  // Map dst rectangle corners to src quad corners.
  // We solve: dst → src (the inverse warp).
  const dst = [
    [0, 0],
    [dstWidth, 0],
    [dstWidth, dstHeight],
    [0, dstHeight],
  ] as const;

  const src = [
    [srcQuad.topLeft.x,     srcQuad.topLeft.y],
    [srcQuad.topRight.x,    srcQuad.topRight.y],
    [srcQuad.bottomRight.x, srcQuad.bottomRight.y],
    [srcQuad.bottomLeft.x,  srcQuad.bottomLeft.y],
  ] as const;

  // Build the 8×8 linear system for the homography coefficients h0..h7
  // (h8 = 1 fixed). Each correspondence gives 2 equations:
  //   x' = (h0*u + h1*v + h2) / (h6*u + h7*v + 1)
  //   y' = (h3*u + h4*v + h5) / (h6*u + h7*v + 1)
  // Rearranged:
  //   h0*u + h1*v + h2 - h6*u*x' - h7*v*x' = x'
  //   h3*u + h4*v + h5 - h6*u*y' - h7*v*y' = y'
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const [u, v] = dst[i]!;
    const [xp, yp] = src[i]!;
    A.push([u, v, 1, 0, 0, 0, -u * xp, -v * xp]);
    b.push(xp);
    A.push([0, 0, 0, u, v, 1, -u * yp, -v * yp]);
    b.push(yp);
  }

  const h = gaussSolve8x8(A, b);

  return [
    h[0]!, h[1]!, h[2]!,
    h[3]!, h[4]!, h[5]!,
    h[6]!, h[7]!, 1,
  ];
}

/**
 * Solve the 8×8 linear system Ax = b using Gaussian elimination with partial
 * pivoting. Returns the solution vector.
 */
function gaussSolve8x8(A: number[][], b: number[]): number[] {
  const n = 8;
  // Augmented matrix
  const M: number[][] = A.map((row, i) => [...row, b[i]!]);

  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxRow = col;
    let maxVal = Math.abs(M[col]![col]!);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(M[row]![col]!);
      if (v > maxVal) { maxVal = v; maxRow = row; }
    }
    // Swap rows
    [M[col], M[maxRow]] = [M[maxRow]!, M[col]!];

    const pivot = M[col]![col]!;
    if (Math.abs(pivot) < 1e-12) continue;

    // Eliminate below
    for (let row = col + 1; row < n; row++) {
      const factor = M[row]![col]! / pivot;
      for (let k = col; k <= n; k++) {
        M[row]![k]! -= factor * M[col]![k]!;
      }
    }
  }

  // Back substitution
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = M[row]![n]!;
    for (let col = row + 1; col < n; col++) {
      sum -= M[row]![col]! * x[col]!;
    }
    x[row] = sum / M[row]![row]!;
  }

  return x;
}

/**
 * Apply the perspective warp to `src` ImageData (full layer texture) and
 * produce a new `outWidth × outHeight` ImageData. Each output pixel is
 * inverse-mapped through `matrix` to a source coordinate, sampled with
 * bilinear interpolation.
 *
 * `matrix` is the inverse warp (dst → src) as returned by
 * `computePerspectiveTransform`.
 */
export function applyPerspectiveWarp(
  src: ImageData,
  matrix: Matrix3x3,
  outWidth: number,
  outHeight: number,
): ImageData {
  const [h0, h1, h2, h3, h4, h5, h6, h7] = matrix;
  const srcW = src.width;
  const srcH = src.height;
  const srcData = src.data;
  const out = new ImageData(outWidth, outHeight);
  const outData = out.data;

  for (let dv = 0; dv < outHeight; dv++) {
    for (let du = 0; du < outWidth; du++) {
      // Map output pixel (du, dv) → source (sx, sy) via homography
      const denom = h6! * du + h7! * dv + 1;
      if (Math.abs(denom) < 1e-10) continue;
      const sx = (h0! * du + h1! * dv + h2!) / denom;
      const sy = (h3! * du + h4! * dv + h5!) / denom;

      // Bilinear interpolation
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = x0 + 1;
      const y1 = y0 + 1;

      if (x0 < 0 || y0 < 0 || x1 > srcW || y1 > srcH) continue;

      const fx = sx - x0;
      const fy = sy - y0;

      const i00 = clampCoord(x0, y0, srcW, srcH) * 4;
      const i10 = clampCoord(x1, y0, srcW, srcH) * 4;
      const i01 = clampCoord(x0, y1, srcW, srcH) * 4;
      const i11 = clampCoord(x1, y1, srcW, srcH) * 4;

      const oi = (dv * outWidth + du) * 4;

      for (let c = 0; c < 4; c++) {
        const v00 = srcData[i00 + c]!;
        const v10 = srcData[i10 + c]!;
        const v01 = srcData[i01 + c]!;
        const v11 = srcData[i11 + c]!;
        outData[oi + c] = Math.round(
          v00 * (1 - fx) * (1 - fy) +
          v10 * fx       * (1 - fy) +
          v01 * (1 - fx) * fy       +
          v11 * fx       * fy,
        );
      }
    }
  }

  return out;
}

function clampCoord(x: number, y: number, w: number, h: number): number {
  const cx = Math.max(0, Math.min(w - 1, x));
  const cy = Math.max(0, Math.min(h - 1, y));
  return cy * w + cx;
}

/**
 * Compute a reasonable output rectangle size for a perspective crop quad.
 *
 * Uses the average of opposite-edge lengths as output width / height —
 * the same heuristic Photoshop uses.
 */
export function inferOutputSize(quad: Quad): { width: number; height: number } {
  const topLen = dist(quad.topLeft, quad.topRight);
  const botLen = dist(quad.bottomLeft, quad.bottomRight);
  const leftLen = dist(quad.topLeft, quad.bottomLeft);
  const rightLen = dist(quad.topRight, quad.bottomRight);

  const width  = Math.round((topLen + botLen) / 2);
  const height = Math.round((leftLen + rightLen) / 2);

  return { width: Math.max(1, width), height: Math.max(1, height) };
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}
