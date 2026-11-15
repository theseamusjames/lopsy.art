const INF = 1e20;

/**
 * Exact squared Euclidean distance transform (Felzenszwalb & Huttenlocher).
 * `grid` holds 0 for "target" cells and INF elsewhere on input; on return
 * each cell holds the squared distance from its centre to the nearest
 * target cell's centre.
 */
export function squaredDistanceTransform(grid: Float32Array, width: number, height: number): void {
  const size = Math.max(width, height);
  const f = new Float64Array(size);
  const d = new Float64Array(size);
  const v = new Int32Array(size);
  const z = new Float64Array(size + 1);

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x]!;
    transform1d(f, d, v, z, height);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y]!;
  }
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) f[x] = grid[row + x]!;
    transform1d(f, d, v, z, width);
    for (let x = 0; x < width; x++) grid[row + x] = d[x]!;
  }
}

function transform1d(
  f: Float64Array,
  d: Float64Array,
  v: Int32Array,
  z: Float64Array,
  n: number,
): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    const fq = f[q]!;
    let s = ((fq + q * q) - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = ((fq + q * q) - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const dq = q - v[k]!;
    d[q] = dq * dq + f[v[k]!]!;
  }
}

export const DISTANCE_INFINITY = INF;
