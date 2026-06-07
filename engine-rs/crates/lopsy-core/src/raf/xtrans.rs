/// X-Trans 6×6 CFA demosaicing — Markesteijn-style multi-pass algorithm.
///
/// Fujifilm X-Trans sensors use a 6×6 repeating CFA pattern instead of the
/// standard 2×2 Bayer pattern. The pattern has ~56% green, ~22% red, ~22% blue.
/// The exact pattern varies by camera model and is read from the RAF file.
///
/// This module implements a Markesteijn-style demosaicer:
///
/// 1. **Multi-direction green interpolation** — for each non-green pixel, four
///    candidate green values are computed (horizontal, vertical, NE-diagonal,
///    NW-diagonal). Each candidate uses two nearest greens along that
///    direction, plus a Laplacian correction term from the known channel
///    (which captures edge structure independent of color).
///
/// 2. **Per-direction homogeneity scoring** — each direction's candidate is
///    scored by how well it lines up with local image structure: we measure
///    second derivatives of luma/chroma in the candidate's direction. Lower
///    derivative = more homogeneous = better fit.
///
/// 3. **Homogeneity-weighted blending** — the four green candidates are
///    averaged with weights inversely proportional to their direction's
///    derivative. This blends smoothly where directions agree and snaps
///    to the dominant direction at edges.
///
/// 4. **Color-difference R/B interpolation** — with a complete green plane,
///    the R-G and B-G chroma planes are interpolated. Chroma varies much
///    more smoothly than R/B alone, so a small Gaussian-like kernel on the
///    chroma plane produces sharp edges with clean colors. Final R/B = chroma + G.
///
/// 5. **Three-pass refinement (optional)** — passes 2 and 3 recompute green
///    using the just-interpolated R and B as a guide, then re-interpolate
///    R/B from the refined green. Each pass tightens chroma at edges.
///
/// The algorithm operates on a single-channel raw buffer (post white-balance)
/// indexed by `cfa[(row%6)*6 + (col%6)]` with channel codes 0=R, 1=G, 2=B.

const R: u8 = 0;
const G: u8 = 1;
const B: u8 = 2;

/// Public entrypoint. Edge-directed Markesteijn-style demosaic: green is
/// reconstructed by blending four directional candidates weighted by local
/// homogeneity, then R/B are filled via the smooth color-difference planes.
///
/// This replaces the previous 5×5 same-color box average. That average could
/// not tile the 6×6 X-Trans period cleanly, so flat areas (sky, walls) picked
/// up a 6-pixel-period bias which the color matrix then amplified into a
/// visible grid. The previous code papered over it with a box blur, which
/// also smeared real detail. The edge-directed path reconstructs flat fields
/// exactly at every crop offset (see `flat_gray_has_no_grid_at_any_crop_offset`),
/// so no compensating blur is needed.
pub fn demosaic_xtrans(raw: &[f32], width: u32, height: u32, pattern: &[u8; 36]) -> Vec<f32> {
    demosaic_xtrans_passes(raw, width, height, pattern, 3)
}

/// Markesteijn 3-pass demosaicer — the full-quality path used by
/// `demosaic_xtrans`. Kept as a named alias for callers that want to be
/// explicit about the algorithm.
pub fn demosaic_xtrans_markesteijn(raw: &[f32], width: u32, height: u32, pattern: &[u8; 36]) -> Vec<f32> {
    demosaic_xtrans_passes(raw, width, height, pattern, 3)
}

/// Markesteijn demosaic with a tunable pass count. `passes=1` is the fast
/// single-pass version; `passes=3` is the full quality version that refines
/// the green plane twice.
pub fn demosaic_xtrans_passes(
    raw: &[f32],
    width: u32,
    height: u32,
    pattern: &[u8; 36],
    passes: u8,
) -> Vec<f32> {
    let w = width as usize;
    let h = height as usize;

    // For very small images, fall back to the simple averaging — Markesteijn
    // needs at least a small border around every output pixel.
    if w < 12 || h < 12 {
        return simple_demosaic(raw, w, h, pattern);
    }

    // Precompute direction-specific neighbor offsets for every cell of the
    // 6×6 CFA pattern. For each of the 36 cell positions, we record the
    // offsets (in pixels) to the two nearest green pixels along each of the
    // four cardinal/diagonal directions, plus the two next-nearest greens
    // for Laplacian-style edge correction.
    let neighbors = build_neighbor_table(pattern);

    // Pass 1: interpolate green using only the raw mosaic.
    let mut green = interpolate_green(raw, w, h, pattern, &neighbors);

    // Passes 2 and 3: refine green using the previously computed R-G / B-G
    // chroma planes as guides. Each refinement pass uses chroma gradients
    // (which are smoother than raw color gradients) to better predict
    // green at non-green pixels.
    for _ in 1..passes.max(1) {
        let (chroma_r, chroma_b) = interpolate_chroma(raw, &green, w, h, pattern);
        green = refine_green(raw, &green, &chroma_r, &chroma_b, w, h, pattern, &neighbors);
    }

    // Final R/B interpolation via color-difference plane.
    let (mut chroma_r, mut chroma_b) = interpolate_chroma(raw, &green, w, h, pattern);

    // Median-filter the color-difference (R-G, B-G) planes to remove the
    // CFA-locked false colour that edge-directed X-Trans demosaicing leaves
    // on fine texture — the regular magenta/green speckle visible at pixel
    // zoom on detailed areas (marble, foliage). These errors are impulse-like
    // and tied to individual CFA positions, so a small median removes them
    // cleanly. Real chroma is low-frequency, and luma detail is carried by the
    // green plane, so this does not soften edges the way a luma blur would.
    // This is the standard final step of the Markesteijn pipeline (dcraw runs
    // three such passes); we had omitted it.
    for _ in 0..CHROMA_MEDIAN_PASSES {
        chroma_r = median_filter_3x3(&chroma_r, w, h);
        chroma_b = median_filter_3x3(&chroma_b, w, h);
    }

    // Compose RGB from the green plane (which holds the raw value at green
    // sites) plus the cleaned chroma. R/B are reconstructed everywhere from
    // green + chroma rather than forcing the raw single-pixel value at known
    // sites: doing the latter re-injected exactly the per-CFA-position spikes
    // the median just removed.
    let mut rgb = vec![0.0f32; w * h * 3];
    for i in 0..w * h {
        let out = i * 3;
        let g = green[i];
        rgb[out] = (g + chroma_r[i]).max(0.0);
        rgb[out + 1] = g.max(0.0);
        rgb[out + 2] = (g + chroma_b[i]).max(0.0);
    }

    rgb
}

/// Number of 3×3 median passes applied to each color-difference plane to
/// suppress CFA-locked false colour. Three matches dcraw's Markesteijn.
const CHROMA_MEDIAN_PASSES: usize = 3;

/// 3×3 median filter on a single-channel plane, edge-clamped. Returns a new
/// buffer. Used on the chroma (color-difference) planes for false-colour
/// suppression; it preserves edges far better than a linear blur.
fn median_filter_3x3(plane: &[f32], w: usize, h: usize) -> Vec<f32> {
    let mut out = vec![0.0f32; w * h];
    for row in 0..h {
        for col in 0..w {
            let mut win = [0.0f32; 9];
            let mut k = 0;
            for dy in -1i32..=1 {
                let r = (row as i32 + dy).clamp(0, h as i32 - 1) as usize;
                for dx in -1i32..=1 {
                    let c = (col as i32 + dx).clamp(0, w as i32 - 1) as usize;
                    win[k] = plane[r * w + c];
                    k += 1;
                }
            }
            out[row * w + col] = median9(win);
        }
    }
    out
}

/// Median of 9 values via partial selection (find the 5th-smallest). ~35
/// comparisons, allocation-free.
#[inline]
fn median9(mut v: [f32; 9]) -> f32 {
    for i in 0..5 {
        let mut m = i;
        for j in (i + 1)..9 {
            if v[j] < v[m] {
                m = j;
            }
        }
        v.swap(i, m);
    }
    v[4]
}

/// Separable box blur on planar RGB-interleaved data. `radius` is the
/// kernel half-width (so a radius of 3 gives a 7×7 effective kernel).
/// Two passes (H then V) with O(1)-per-pixel running-sum updates.
///
/// Retained behind `#[allow(dead_code)]`: the demosaic no longer blurs, but
/// this is kept as a quick regression lever if a model needs mild smoothing.
#[allow(dead_code)]
fn box_blur_separable_rgb(src: &[f32], w: usize, h: usize, radius: usize) -> Vec<f32> {
    let mut tmp = vec![0.0f32; src.len()];
    let mut dst = vec![0.0f32; src.len()];

    // Horizontal pass: src → tmp
    for row in 0..h {
        let row_off = row * w * 3;
        for col in 0..w {
            let c_start = col.saturating_sub(radius);
            let c_end = (col + radius + 1).min(w);
            let mut sums = [0.0f32; 3];
            let mut count = 0u32;
            for c in c_start..c_end {
                let idx = row_off + c * 3;
                sums[0] += src[idx];
                sums[1] += src[idx + 1];
                sums[2] += src[idx + 2];
                count += 1;
            }
            let n = count as f32;
            let o = row_off + col * 3;
            tmp[o] = sums[0] / n;
            tmp[o + 1] = sums[1] / n;
            tmp[o + 2] = sums[2] / n;
        }
    }

    // Vertical pass: tmp → dst
    for col in 0..w {
        for row in 0..h {
            let r_start = row.saturating_sub(radius);
            let r_end = (row + radius + 1).min(h);
            let mut sums = [0.0f32; 3];
            let mut count = 0u32;
            for r in r_start..r_end {
                let idx = (r * w + col) * 3;
                sums[0] += tmp[idx];
                sums[1] += tmp[idx + 1];
                sums[2] += tmp[idx + 2];
                count += 1;
            }
            let n = count as f32;
            let o = (row * w + col) * 3;
            dst[o] = sums[0] / n;
            dst[o + 1] = sums[1] / n;
            dst[o + 2] = sums[2] / n;
        }
    }

    dst
}

// ─────────────────────────────────────────────────────────────────────
// Pattern helpers
// ─────────────────────────────────────────────────────────────────────

#[inline]
fn cfa_color(pattern: &[u8; 36], row: usize, col: usize) -> u8 {
    pattern[(row % 6) * 6 + (col % 6)]
}

/// Neighbor offsets for a single cell, in each of 4 directions.
///
/// For each direction we store: `[g1, g2, gminus1, gminus2, far_same]` where
/// g1/g2 are the two nearest greens along the direction, gminus1/gminus2 are
/// the nearest greens in the opposite direction, and `far_same` is the
/// nearest same-color pixel at distance 2 along the direction (used for
/// Laplacian color correction).
#[derive(Clone, Copy)]
struct CellNeighbors {
    /// One per direction (H, V, NE, NW). Each entry is a triple of (dx, dy)
    /// offsets for: nearest green +, nearest green -, far same color +, far same color -.
    dirs: [DirOffsets; 4],
}

#[derive(Clone, Copy, Default)]
struct DirOffsets {
    gp: (i32, i32),     // nearest green in + direction
    gn: (i32, i32),     // nearest green in - direction
    /// Distance (in unit cells) of `gp` from the center pixel along the
    /// direction axis. Used for distance-weighted averaging because X-Trans
    /// greens are not always equidistant on either side.
    dist_p: i32,
    /// Distance of `gn` from center.
    dist_n: i32,
    same_p: (i32, i32), // far same-color in + direction (for Laplacian)
    same_n: (i32, i32), // far same-color in - direction
    has_far: bool,      // whether far_p/far_n landed on a same-color pixel
    /// True only when gp and gn are at equal distance from the center —
    /// the only case where Laplacian color-channel correction is valid.
    symmetric: bool,
}

const DIR_OFFSETS_BASE: [(i32, i32); 4] = [
    (1, 0),  // H: step right
    (0, 1),  // V: step down
    (1, 1),  // NE diagonal (down-right)
    (1, -1), // NW diagonal (up-right)
];

fn build_neighbor_table(pattern: &[u8; 36]) -> [[CellNeighbors; 6]; 6] {
    let mut table = [[CellNeighbors { dirs: [DirOffsets::default(); 4] }; 6]; 6];
    for r in 0..6 {
        for c in 0..6 {
            let center_color = pattern[r * 6 + c];
            for (d, &(dx, dy)) in DIR_OFFSETS_BASE.iter().enumerate() {
                table[r][c].dirs[d] = find_dir_offsets(pattern, r as i32, c as i32, dx, dy, center_color);
            }
        }
    }
    table
}

/// Walk outward from (r, c) along direction (dx, dy) to find the nearest
/// green pixel in both + and - directions. Then continue past that to
/// find a same-color pixel at distance >= 2 (the "far same color") for
/// Laplacian correction.
fn find_dir_offsets(
    pattern: &[u8; 36],
    r: i32,
    c: i32,
    dx: i32,
    dy: i32,
    center_color: u8,
) -> DirOffsets {
    let mut out = DirOffsets::default();

    // Search for nearest green in + direction (up to 3 steps).
    for step in 1..=3 {
        let nr = (r + dy * step).rem_euclid(6);
        let nc = (c + dx * step).rem_euclid(6);
        if pattern[(nr as usize) * 6 + (nc as usize)] == G {
            out.gp = (dx * step, dy * step);
            out.dist_p = step;
            break;
        }
    }
    // Same in - direction.
    for step in 1..=3 {
        let nr = (r - dy * step).rem_euclid(6);
        let nc = (c - dx * step).rem_euclid(6);
        if pattern[(nr as usize) * 6 + (nc as usize)] == G {
            out.gn = (-dx * step, -dy * step);
            out.dist_n = step;
            break;
        }
    }
    out.symmetric = out.dist_p == out.dist_n && out.dist_p > 0;
    // Far same-color in + direction (search at distance 2, 3, 4).
    for step in 2..=4 {
        let nr = (r + dy * step).rem_euclid(6);
        let nc = (c + dx * step).rem_euclid(6);
        if pattern[(nr as usize) * 6 + (nc as usize)] == center_color {
            out.same_p = (dx * step, dy * step);
            out.has_far = true;
            break;
        }
    }
    // Far same-color in - direction.
    for step in 2..=4 {
        let nr = (r - dy * step).rem_euclid(6);
        let nc = (c - dx * step).rem_euclid(6);
        if pattern[(nr as usize) * 6 + (nc as usize)] == center_color {
            out.same_n = (-dx * step, -dy * step);
        }
    }
    out
}

// ─────────────────────────────────────────────────────────────────────
// Reflective edge clamping
// ─────────────────────────────────────────────────────────────────────

#[inline]
fn reflect(coord: i32, max: i32) -> usize {
    let mut x = coord;
    if x < 0 {
        x = -x;
    }
    if x >= max {
        x = 2 * (max - 1) - x;
    }
    if x < 0 {
        x = 0;
    }
    if x >= max {
        x = max - 1;
    }
    x as usize
}

#[inline]
fn at(raw: &[f32], w: usize, h: usize, r: i32, c: i32) -> f32 {
    let rr = reflect(r, h as i32);
    let cc = reflect(c, w as i32);
    raw[rr * w + cc]
}

// ─────────────────────────────────────────────────────────────────────
// Green interpolation (4 directions, blended by homogeneity)
// ─────────────────────────────────────────────────────────────────────

/// Interpolate green at every pixel. Green is known at G positions and
/// estimated at R/B positions by blending four directional candidates.
fn interpolate_green(
    raw: &[f32],
    w: usize,
    h: usize,
    pattern: &[u8; 36],
    neighbors: &[[CellNeighbors; 6]; 6],
) -> Vec<f32> {
    let mut green = vec![0.0f32; w * h];

    // First pass: copy known greens.
    for row in 0..h {
        for col in 0..w {
            if cfa_color(pattern, row, col) == G {
                green[row * w + col] = raw[row * w + col];
            }
        }
    }

    // Second pass: interpolate green at non-green pixels.
    //
    // For each direction we compute a candidate green using a
    // distance-weighted average of the two nearest greens along that
    // direction, optionally corrected by the local Laplacian of the known
    // channel (only when the two greens are equidistant, otherwise the
    // correction is biased). We then blend the four candidates by
    // inverse-gradient weight: directions with low local gradient (i.e.
    // smooth along that axis) dominate.
    for row in 0..h {
        for col in 0..w {
            let c = cfa_color(pattern, row, col);
            if c == G {
                continue;
            }

            let cell = &neighbors[row % 6][col % 6];
            let center = raw[row * w + col];

            let mut candidates = [0.0f32; 4];
            let mut gradients = [0.0f32; 4];
            let mut g_min_all = f32::MAX;
            let mut g_max_all = f32::MIN;

            // Pre-fetch all per-direction neighbors so we can clamp at the end.
            let mut gp_arr = [0.0f32; 4];
            let mut gn_arr = [0.0f32; 4];
            for d in 0..4 {
                let dirs = cell.dirs[d];
                gp_arr[d] = at(raw, w, h, row as i32 + dirs.gp.1, col as i32 + dirs.gp.0);
                gn_arr[d] = at(raw, w, h, row as i32 + dirs.gn.1, col as i32 + dirs.gn.0);
                g_min_all = g_min_all.min(gp_arr[d]).min(gn_arr[d]);
                g_max_all = g_max_all.max(gp_arr[d]).max(gn_arr[d]);
            }

            for d in 0..4 {
                let dirs = cell.dirs[d];
                let gp = gp_arr[d];
                let gn = gn_arr[d];

                // Distance-weighted average. If gp is at distance dp and gn at
                // dn, the linearly interpolated value at the center is:
                //   g = gn + (gp - gn) * dn / (dp + dn)
                // which weights gp by dn/(dp+dn) and gn by dp/(dp+dn).
                let dp = dirs.dist_p.max(1) as f32;
                let dn = dirs.dist_n.max(1) as f32;
                let total = dp + dn;
                let mut g_pred = (gp * dn + gn * dp) / total;

                // Laplacian correction only when symmetric (greens equidistant).
                // The correction term is the second derivative of the known
                // color channel along this axis; under the constant-hue
                // assumption, green should follow the same second derivative.
                // Use a small weight (1/8) because the known channel and green
                // are at different WB scales — too large a correction biases
                // the predicted green toward the known channel's scale.
                if dirs.symmetric && dirs.has_far {
                    let sp = at(raw, w, h, row as i32 + dirs.same_p.1, col as i32 + dirs.same_p.0);
                    let sn = at(raw, w, h, row as i32 + dirs.same_n.1, col as i32 + dirs.same_n.0);
                    let lap = (2.0 * center - sp - sn) * 0.125;
                    g_pred += lap;
                }

                candidates[d] = g_pred;

                // Direction gradient: large = strong edge crossing this axis.
                let grad_green = (gp - gn).abs();
                let grad_color = if dirs.has_far {
                    let sp = at(raw, w, h, row as i32 + dirs.same_p.1, col as i32 + dirs.same_p.0);
                    let sn = at(raw, w, h, row as i32 + dirs.same_n.1, col as i32 + dirs.same_n.0);
                    (sp - sn).abs()
                } else {
                    0.0
                };
                gradients[d] = grad_green + grad_color;
            }

            // Inverse-gradient blending. Squaring sharpens the direction
            // preference: a 2× lower gradient → 4× higher weight.
            // Noise-floor epsilon: large enough that noise-level gradients do
            // not dominate the directional weighting (which produced diagonal
            // "worm" artifacts in flat/shadow areas on real sensor data), while
            // real edges still have gradients well above it and snap correctly.
            let eps = 1e-3f32;
            let mut g_final = 0.0f32;
            let mut weight_sum = 0.0f32;
            for d in 0..4 {
                let gg = gradients[d];
                let w_d = 1.0 / (eps + gg * gg);
                g_final += candidates[d] * w_d;
                weight_sum += w_d;
            }
            g_final /= weight_sum;

            green[row * w + col] = g_final.clamp(g_min_all, g_max_all);
        }
    }

    green
}

/// Re-interpolate green using already-known chroma planes. Same structure as
/// `interpolate_green` but the Laplacian correction now uses the chroma
/// (R-G or B-G) gradient at distance 2, which is smoother than raw color.
fn refine_green(
    raw: &[f32],
    prev_green: &[f32],
    chroma_r: &[f32],
    chroma_b: &[f32],
    w: usize,
    h: usize,
    pattern: &[u8; 36],
    neighbors: &[[CellNeighbors; 6]; 6],
) -> Vec<f32> {
    let mut green = prev_green.to_vec();

    for row in 0..h {
        for col in 0..w {
            let c = cfa_color(pattern, row, col);
            if c == G {
                continue;
            }
            let chroma = if c == R { chroma_r } else { chroma_b };
            let cell = &neighbors[row % 6][col % 6];

            let mut candidates = [0.0f32; 4];
            let mut gradients = [0.0f32; 4];
            let mut g_min_all = f32::MAX;
            let mut g_max_all = f32::MIN;

            let mut gp_arr = [0.0f32; 4];
            let mut gn_arr = [0.0f32; 4];
            for d in 0..4 {
                let dirs = cell.dirs[d];
                gp_arr[d] = at(prev_green, w, h, row as i32 + dirs.gp.1, col as i32 + dirs.gp.0);
                gn_arr[d] = at(prev_green, w, h, row as i32 + dirs.gn.1, col as i32 + dirs.gn.0);
                g_min_all = g_min_all.min(gp_arr[d]).min(gn_arr[d]);
                g_max_all = g_max_all.max(gp_arr[d]).max(gn_arr[d]);
            }

            for d in 0..4 {
                let dirs = cell.dirs[d];
                let gp = gp_arr[d];
                let gn = gn_arr[d];

                // Distance-weighted average baseline.
                let dp = dirs.dist_p.max(1) as f32;
                let dn = dirs.dist_n.max(1) as f32;
                let mut g_pred = (gp * dn + gn * dp) / (dp + dn);

                // Chroma-guided refinement: predicted chroma at center =
                // average of chroma at same-color neighbors. If green is
                // wrong, the implied center chroma will disagree with the
                // averaged-neighbor chroma. Nudge green to close the gap.
                // Only valid when neighbors are symmetric.
                if dirs.symmetric && dirs.has_far {
                    let chroma_center = raw[row * w + col] - prev_green[row * w + col];
                    let chroma_p = at(chroma, w, h, row as i32 + dirs.same_p.1, col as i32 + dirs.same_p.0);
                    let chroma_n = at(chroma, w, h, row as i32 + dirs.same_n.1, col as i32 + dirs.same_n.0);
                    let target_chroma = 0.5 * (chroma_p + chroma_n);
                    let chroma_err = chroma_center - target_chroma;
                    g_pred -= chroma_err * 0.5;
                }

                candidates[d] = g_pred;

                let grad_green = (gp - gn).abs();
                let grad_chroma = if dirs.has_far {
                    let chroma_p = at(chroma, w, h, row as i32 + dirs.same_p.1, col as i32 + dirs.same_p.0);
                    let chroma_n = at(chroma, w, h, row as i32 + dirs.same_n.1, col as i32 + dirs.same_n.0);
                    (chroma_p - chroma_n).abs()
                } else {
                    0.0
                };
                gradients[d] = grad_green + grad_chroma;
            }

            // Noise-floor epsilon: large enough that noise-level gradients do
            // not dominate the directional weighting (which produced diagonal
            // "worm" artifacts in flat/shadow areas on real sensor data), while
            // real edges still have gradients well above it and snap correctly.
            let eps = 1e-3f32;
            let mut g_final = 0.0f32;
            let mut weight_sum = 0.0f32;
            for d in 0..4 {
                let gg = gradients[d];
                let w_d = 1.0 / (eps + gg * gg);
                g_final += candidates[d] * w_d;
                weight_sum += w_d;
            }
            g_final /= weight_sum;

            green[row * w + col] = g_final.clamp(g_min_all, g_max_all);
        }
    }

    green
}

// ─────────────────────────────────────────────────────────────────────
// Chroma (R-G and B-G) plane interpolation
// ─────────────────────────────────────────────────────────────────────

/// Fill the chroma planes (R-G at known R positions, B-G at known B
/// positions) and bilinearly interpolate the missing values.
///
/// X-Trans has R and B distributed sparsely (~22% each), so we use a
/// weighted-average of nearby known chroma samples within a small window.
/// Chroma varies smoothly across edges (since edges are mainly luma) so
/// even a 5×5 window doesn't over-soften.
fn interpolate_chroma(
    raw: &[f32],
    green: &[f32],
    w: usize,
    h: usize,
    pattern: &[u8; 36],
) -> (Vec<f32>, Vec<f32>) {
    let mut chroma_r = vec![0.0f32; w * h];
    let mut chroma_b = vec![0.0f32; w * h];

    // Step 1: seed known chroma values at R and B CFA positions.
    for row in 0..h {
        for col in 0..w {
            let i = row * w + col;
            let c = cfa_color(pattern, row, col);
            if c == R {
                chroma_r[i] = raw[i] - green[i];
            } else if c == B {
                chroma_b[i] = raw[i] - green[i];
            }
        }
    }

    // Step 2: fill missing chroma via Gaussian-weighted average of known
    // samples in a 5×5 window. We process R and B chroma in one pass.
    //
    // 5×5 Gaussian-ish weights, normalized at each pixel by the count of
    // valid neighbors of the required color.
    const KERNEL: [[f32; 5]; 5] = [
        [1.0, 2.0, 3.0, 2.0, 1.0],
        [2.0, 4.0, 6.0, 4.0, 2.0],
        [3.0, 6.0, 9.0, 6.0, 3.0],
        [2.0, 4.0, 6.0, 4.0, 2.0],
        [1.0, 2.0, 3.0, 2.0, 1.0],
    ];

    let mut out_r = chroma_r.clone();
    let mut out_b = chroma_b.clone();

    for row in 0..h {
        for col in 0..w {
            let i = row * w + col;
            let c = cfa_color(pattern, row, col);

            // For R-chroma: if this pixel is R, keep the known value.
            // Otherwise compute a weighted average of nearby known R-chroma.
            if c != R {
                let mut sum = 0.0f32;
                let mut wsum = 0.0f32;
                for dy in -2i32..=2 {
                    for dx in -2i32..=2 {
                        let nr = row as i32 + dy;
                        let nc = col as i32 + dx;
                        if nr < 0 || nr >= h as i32 || nc < 0 || nc >= w as i32 {
                            continue;
                        }
                        let ni = nr as usize * w + nc as usize;
                        if cfa_color(pattern, nr as usize, nc as usize) == R {
                            let kw = KERNEL[(dy + 2) as usize][(dx + 2) as usize];
                            sum += chroma_r[ni] * kw;
                            wsum += kw;
                        }
                    }
                }
                out_r[i] = if wsum > 0.0 { sum / wsum } else { 0.0 };
            }

            if c != B {
                let mut sum = 0.0f32;
                let mut wsum = 0.0f32;
                for dy in -2i32..=2 {
                    for dx in -2i32..=2 {
                        let nr = row as i32 + dy;
                        let nc = col as i32 + dx;
                        if nr < 0 || nr >= h as i32 || nc < 0 || nc >= w as i32 {
                            continue;
                        }
                        let ni = nr as usize * w + nc as usize;
                        if cfa_color(pattern, nr as usize, nc as usize) == B {
                            let kw = KERNEL[(dy + 2) as usize][(dx + 2) as usize];
                            sum += chroma_b[ni] * kw;
                            wsum += kw;
                        }
                    }
                }
                out_b[i] = if wsum > 0.0 { sum / wsum } else { 0.0 };
            }
        }
    }

    (out_r, out_b)
}

// ─────────────────────────────────────────────────────────────────────
// Small-image fallback
// ─────────────────────────────────────────────────────────────────────

/// Simple per-color averaging in a 5×5 window. Used only as a fallback for
/// images smaller than the minimum tile size, where Markesteijn can't get
/// enough border.
fn simple_demosaic(raw: &[f32], w: usize, h: usize, pattern: &[u8; 36]) -> Vec<f32> {
    let mut rgb = vec![0.0f32; w * h * 3];
    for row in 0..h {
        for col in 0..w {
            let out = (row * w + col) * 3;
            let mut sums = [0.0f32; 3];
            let mut counts = [0u32; 3];
            let r_start = row.saturating_sub(2);
            let r_end = (row + 3).min(h);
            let c_start = col.saturating_sub(2);
            let c_end = (col + 3).min(w);
            for r in r_start..r_end {
                for c in c_start..c_end {
                    let ch = cfa_color(pattern, r, c) as usize;
                    sums[ch] += raw[r * w + c];
                    counts[ch] += 1;
                }
            }
            for ch in 0..3 {
                if counts[ch] > 0 {
                    rgb[out + ch] = sums[ch] / counts[ch] as f32;
                }
            }
        }
    }
    rgb
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// A representative X-Trans 6×6 pattern (cell 0/0 = G).
    const TEST_PATTERN: [u8; 36] = [
        G, R, B, G, B, R,
        B, G, G, R, G, G,
        R, G, G, B, G, G,
        G, B, R, G, R, B,
        R, G, G, B, G, G,
        B, G, G, R, G, G,
    ];

    #[test]
    fn cfa_color_indexes_into_pattern() {
        assert_eq!(cfa_color(&TEST_PATTERN, 0, 0), G);
        assert_eq!(cfa_color(&TEST_PATTERN, 0, 1), R);
        assert_eq!(cfa_color(&TEST_PATTERN, 6, 6), G); // wraps
        assert_eq!(cfa_color(&TEST_PATTERN, 1, 0), B);
    }

    #[test]
    fn solid_gray_reconstructs_to_gray() {
        // A uniform gray sensor produces uniform gray RGB everywhere.
        // (Each CFA cell captures the same value, so all candidates agree.)
        let w = 32;
        let h = 32;
        let raw = vec![0.5f32; w * h];
        let rgb = demosaic_xtrans_passes(&raw, w as u32, h as u32, &TEST_PATTERN, 1);
        // Allow a tiny epsilon for floating-point sum-then-divide.
        for row in 6..h - 6 {
            for col in 6..w - 6 {
                let o = (row * w + col) * 3;
                assert!((rgb[o] - 0.5).abs() < 1e-3, "R at {},{} = {}", row, col, rgb[o]);
                assert!((rgb[o + 1] - 0.5).abs() < 1e-3, "G at {},{} = {}", row, col, rgb[o + 1]);
                assert!((rgb[o + 2] - 0.5).abs() < 1e-3, "B at {},{} = {}", row, col, rgb[o + 2]);
            }
        }
    }

    #[test]
    fn median9_finds_the_middle_value() {
        assert_eq!(median9([9.0, 1.0, 5.0, 3.0, 7.0, 2.0, 8.0, 4.0, 6.0]), 5.0);
        assert_eq!(median9([0.5; 9]), 0.5);
    }

    #[test]
    fn median_filter_removes_isolated_impulse() {
        // A flat plane with a single spike: the 3×3 median erases the spike
        // (only 1 of 9 samples differ) while leaving the flat field alone.
        let (w, h) = (9, 9);
        let mut plane = vec![0.2f32; w * h];
        plane[4 * w + 4] = 0.9;
        let out = median_filter_3x3(&plane, w, h);
        assert!((out[4 * w + 4] - 0.2).abs() < 1e-6, "spike not removed: {}", out[4 * w + 4]);
        for v in &out {
            assert!((v - 0.2).abs() < 1e-6);
        }
    }

    #[test]
    fn chroma_median_suppresses_false_color_on_texture() {
        // A GRAY but textured scene (R=G=B at every pixel) must reconstruct to
        // near-neutral. Any chroma is demosaic false colour. The chroma median
        // keeps it small: without it this scene reaches mean≈0.036 / max≈0.15;
        // with it, mean≈0.012 / max≈0.043. The thresholds below sit between
        // those, so the test fails if the median is ever removed.
        let (w, h) = (120usize, 120usize);
        let mut raw = vec![0.0f32; w * h];
        for row in 0..h {
            for col in 0..w {
                let t = 0.2 * ((col as f32 * 0.9).sin() * (row as f32 * 0.7).cos());
                raw[row * w + col] = (0.5 + t).clamp(0.02, 0.98);
            }
        }
        let rgb = demosaic_xtrans(&raw, w as u32, h as u32, &TEST_PATTERN);
        let mut mean = 0.0f64;
        let mut max = 0.0f32;
        let mut n = 0u64;
        for row in 6..h - 6 {
            for col in 6..w - 6 {
                let o = (row * w + col) * 3;
                let chroma = (rgb[o] - rgb[o + 1])
                    .abs()
                    .max((rgb[o + 1] - rgb[o + 2]).abs())
                    .max((rgb[o] - rgb[o + 2]).abs());
                mean += chroma as f64;
                max = max.max(chroma);
                n += 1;
            }
        }
        let mean = mean / n as f64;
        assert!(mean < 0.02, "mean false-colour too high: {mean}");
        assert!(max < 0.08, "false-colour spike too high: {max}");
    }

    #[test]
    fn passes_3_runs_without_panic() {
        let w = 24;
        let h = 24;
        let mut raw = vec![0.0f32; w * h];
        // Fill with a smooth ramp.
        for row in 0..h {
            for col in 0..w {
                raw[row * w + col] = (row as f32 + col as f32) / ((w + h) as f32);
            }
        }
        let rgb = demosaic_xtrans_passes(&raw, w as u32, h as u32, &TEST_PATTERN, 3);
        assert_eq!(rgb.len(), w * h * 3);
        // All values finite and non-negative.
        for v in &rgb {
            assert!(v.is_finite() && *v >= 0.0);
        }
    }

    #[test]
    fn small_image_falls_back_safely() {
        // 8×8 is below the 12 threshold — should hit simple_demosaic.
        let w = 8;
        let h = 8;
        let raw = vec![0.3f32; w * h];
        let rgb = demosaic_xtrans_passes(&raw, w as u32, h as u32, &TEST_PATTERN, 3);
        assert_eq!(rgb.len(), w * h * 3);
        for v in &rgb {
            assert!((*v - 0.3).abs() < 1e-3);
        }
    }

    /// Shift a base 6×6 pattern by a crop offset, mirroring how `read_raf`
    /// aligns the CFA to cropped output pixels via `shift_cfa`.
    fn shifted_pattern(base: &[u8; 36], row_off: usize, col_off: usize) -> [u8; 36] {
        let mut out = [0u8; 36];
        for r in 0..6 {
            for c in 0..6 {
                out[r * 6 + c] = base[((r + row_off) % 6) * 6 + ((c + col_off) % 6)];
            }
        }
        out
    }

    /// A flat-gray X-Trans mosaic must reconstruct to a uniform RGB field with
    /// NO 6px-periodic variance — at every crop offset. This is the stronger
    /// version of `solid_gray_reconstructs_to_gray`: it runs the real
    /// entrypoint (no separate blur to hide a grid) across all 36 crop phases
    /// and asserts there is no per-CFA-position variation in the interior.
    #[test]
    fn flat_gray_has_no_grid_at_any_crop_offset() {
        let w = 60;
        let h = 60;
        let gray = 0.5f32;
        let raw = vec![gray; w * h];

        for ro in 0..6 {
            for co in 0..6 {
                let pat = shifted_pattern(&TEST_PATTERN, ro, co);
                let rgb = demosaic_xtrans(&raw, w as u32, h as u32, &pat);

                // (a) every interior pixel reconstructs to the input gray.
                let mut max_dev = 0.0f32;
                for row in 4..h - 4 {
                    for col in 4..w - 4 {
                        let o = (row * w + col) * 3;
                        for ch in 0..3 {
                            max_dev = max_dev.max((rgb[o + ch] - gray).abs());
                        }
                    }
                }
                assert!(
                    max_dev < 1e-4,
                    "flat-gray deviation {:.6} at crop offset ({},{})",
                    max_dev, ro, co
                );

                // (b) no 6px-periodic structure: the mean value of each of the
                // 36 CFA cell positions must be identical (the signature of a
                // grid is per-cell means that differ).
                let mut cell_sum = [0.0f64; 36];
                let mut cell_cnt = [0u32; 36];
                for row in 4..h - 4 {
                    for col in 4..w - 4 {
                        let o = (row * w + col) * 3;
                        let cell = (row % 6) * 6 + (col % 6);
                        cell_sum[cell] += ((rgb[o] + rgb[o + 1] + rgb[o + 2]) / 3.0) as f64;
                        cell_cnt[cell] += 1;
                    }
                }
                let means: Vec<f64> = (0..36)
                    .map(|i| cell_sum[i] / cell_cnt[i].max(1) as f64)
                    .collect();
                let lo = means.iter().cloned().fold(f64::MAX, f64::min);
                let hi = means.iter().cloned().fold(f64::MIN, f64::max);
                assert!(
                    hi - lo < 1e-4,
                    "6px grid detected: per-cell mean spread {:.6} at offset ({},{})",
                    hi - lo, ro, co
                );
            }
        }
    }

    /// A flat-gray field must also stay color-neutral: R, G and B reconstruct
    /// to the same value (no false chroma grid) at every crop offset.
    #[test]
    fn flat_gray_stays_neutral_at_any_crop_offset() {
        let w = 60;
        let h = 60;
        let raw = vec![0.5f32; w * h];
        for ro in 0..6 {
            for co in 0..6 {
                let pat = shifted_pattern(&TEST_PATTERN, ro, co);
                let rgb = demosaic_xtrans(&raw, w as u32, h as u32, &pat);
                for row in 4..h - 4 {
                    for col in 4..w - 4 {
                        let o = (row * w + col) * 3;
                        let chroma =
                            (rgb[o] - rgb[o + 1]).abs().max((rgb[o + 1] - rgb[o + 2]).abs());
                        assert!(
                            chroma < 1e-4,
                            "false chroma {:.6} at {},{} offset ({},{})",
                            chroma, row, col, ro, co
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn neighbor_table_has_greens_for_all_dirs() {
        let nb = build_neighbor_table(&TEST_PATTERN);
        // For any cell, every direction should find a green neighbor within 3
        // steps (the X-Trans pattern guarantees this).
        for r in 0..6 {
            for c in 0..6 {
                for d in 0..4 {
                    let dirs = nb[r][c].dirs[d];
                    assert!(
                        dirs.gp != (0, 0) || dirs.gn != (0, 0),
                        "no green found for cell {},{} dir {}",
                        r, c, d
                    );
                }
            }
        }
    }
}
