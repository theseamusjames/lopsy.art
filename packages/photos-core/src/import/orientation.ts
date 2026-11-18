/**
 * EXIF orientations as 2x2 matrices mapping stored to displayed axes
 * (x right, y down), so orientations can be composed and inverted.
 */

type Matrix = readonly [number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1];

const MATRICES: Readonly<Record<number, Matrix>> = {
  1: [1, 0, 0, 1],
  2: [-1, 0, 0, 1],
  3: [-1, 0, 0, -1],
  4: [1, 0, 0, -1],
  5: [0, 1, 1, 0],
  6: [0, -1, 1, 0],
  7: [0, -1, -1, 0],
  8: [0, 1, -1, 0],
};

export function normalizeOrientation(value: number | null | undefined): number {
  return value !== null && value !== undefined && Number.isInteger(value) && value >= 1 && value <= 8 ? value : 1;
}

function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3]];
}

function toOrientation(m: Matrix): number {
  for (const [key, value] of Object.entries(MATRICES)) {
    if (value.every((v, i) => v === m[i])) return Number(key);
  }
  return 1;
}

/**
 * The orientation still to apply to an image a decoder has already turned
 * by `applied`, so that the result shows as `wanted`.
 */
export function remainingOrientation(wanted: number, applied: number): number {
  const w = MATRICES[normalizeOrientation(wanted)] ?? IDENTITY;
  const a = MATRICES[normalizeOrientation(applied)] ?? IDENTITY;
  // Orientation matrices are orthogonal: the inverse is the transpose.
  const inverse: Matrix = [a[0], a[2], a[1], a[3]];
  return toOrientation(multiply(w, inverse));
}
