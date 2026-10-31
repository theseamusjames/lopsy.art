//! The Stroke layer effect's wide-stroke band: every pixel whose centre lies
//! within `half_width` (Euclidean) of a seed pixel's centre, found with two
//! separable passes so the cost per pixel grows with the radius, not its
//! square. A row pass records each pixel's distance to the nearest seed in
//! its own row; a column pass then takes the minimum of `dy² + row(dy)²`
//! over the column, which is the exact squared distance to the nearest seed.
//!
//! This is the CPU statement of `separable_edt.glsl` in `lopsy-wasm`, which
//! runs the same two passes on the GPU (with the row distance stored in two
//! 8-bit channels, see [`encode_distance`]). The result matches the
//! single-pass per-pixel search the narrow-stroke path uses, so the band is
//! the same width on axis-aligned, diagonal and curved edges.

/// What the row pass stores when no seed lies within the search radius.
pub const NO_SEED: u32 = 0xFFFF;

/// Pixels the passes look at on each side: the band's reach, rounded up.
pub fn search_radius(half_width: f32) -> u32 {
    half_width.max(0.0).ceil() as u32
}

/// Split a row distance into the two channel bytes the GPU pass stores
/// (high, low), so it survives an RGBA8 texture exactly.
pub fn encode_distance(d: u32) -> [u8; 2] {
    let d = d.min(NO_SEED);
    [(d >> 8) as u8, (d & 0xFF) as u8]
}

pub fn decode_distance(bytes: [u8; 2]) -> u32 {
    (u32::from(bytes[0]) << 8) | u32::from(bytes[1])
}

/// Row pass: for each pixel, the distance to the nearest seed in its row
/// within `radius`, or [`NO_SEED`]. With `oob_seed`, pixels beyond the
/// buffer's left and right edges count as seeds.
pub fn row_distances(
    seeds: &[bool],
    width: usize,
    height: usize,
    radius: u32,
    oob_seed: bool,
) -> Vec<u32> {
    let mut out = vec![NO_SEED; width * height];
    let r = radius as i64;
    for y in 0..height {
        let row = &seeds[y * width..(y + 1) * width];
        let is_seed = |x: i64| -> bool {
            if x < 0 || x >= width as i64 {
                oob_seed
            } else {
                row[x as usize]
            }
        };
        for x in 0..width as i64 {
            if let Some(d) = (0..=r).find(|&i| is_seed(x - i) || is_seed(x + i)) {
                out[y * width + x as usize] = d as u32;
            }
        }
    }
    out
}

/// Column pass: a pixel is in the band when some row distance `h` at
/// vertical offset `dy` has `dy² + h² ≤ half_width²`. With `oob_seed`, rows
/// beyond the top and bottom edges are all seed.
pub fn band_from_row_distances(
    rows: &[u32],
    width: usize,
    height: usize,
    half_width: f32,
    oob_seed: bool,
) -> Vec<bool> {
    let radius = search_radius(half_width) as i64;
    let reach_sq = f64::from(half_width) * f64::from(half_width);
    let mut out = vec![false; width * height];
    for y in 0..height as i64 {
        for x in 0..width {
            let mut best = f64::INFINITY;
            for dy in 0..=radius {
                let dy_sq = (dy * dy) as f64;
                if dy_sq >= best {
                    break;
                }
                for sy in [y - dy, y + dy] {
                    let h = if sy < 0 || sy >= height as i64 {
                        if oob_seed {
                            0
                        } else {
                            NO_SEED
                        }
                    } else {
                        rows[sy as usize * width + x]
                    };
                    if i64::from(h) <= radius {
                        best = best.min(dy_sq + f64::from(h * h));
                    }
                }
            }
            out[y as usize * width + x] = best <= reach_sq;
        }
    }
    out
}

/// Both passes: the pixels within `half_width` of a seed.
pub fn stroke_band(
    seeds: &[bool],
    width: usize,
    height: usize,
    half_width: f32,
    oob_seed: bool,
) -> Vec<bool> {
    let rows = row_distances(seeds, width, height, search_radius(half_width), oob_seed);
    band_from_row_distances(&rows, width, height, half_width, oob_seed)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The narrow-stroke path's per-pixel search, as `stroke_edt.glsl` runs it.
    fn brute_force(
        seeds: &[bool],
        w: usize,
        h: usize,
        half_width: f32,
        oob_seed: bool,
    ) -> Vec<bool> {
        let r = search_radius(half_width) as i64 + 1;
        let reach_sq = half_width * half_width;
        let mut out = vec![false; w * h];
        for y in 0..h as i64 {
            for x in 0..w as i64 {
                'search: for dy in -r..=r {
                    for dx in -r..=r {
                        if ((dx * dx + dy * dy) as f32) > reach_sq {
                            continue;
                        }
                        let (sx, sy) = (x + dx, y + dy);
                        let seed = if sx < 0 || sy < 0 || sx >= w as i64 || sy >= h as i64 {
                            oob_seed
                        } else {
                            seeds[sy as usize * w + sx as usize]
                        };
                        if seed {
                            out[y as usize * w + x as usize] = true;
                            break 'search;
                        }
                    }
                }
            }
        }
        out
    }

    /// Deterministic pseudo-random blobs (xorshift) so the comparison covers
    /// arbitrary shapes, holes and edges touching the buffer border.
    fn blobs(w: usize, h: usize, seed: u32) -> Vec<bool> {
        let mut s = seed;
        let mut next = || {
            s ^= s << 13;
            s ^= s >> 17;
            s ^= s << 5;
            s
        };
        let centres: Vec<(f32, f32, f32)> = (0..5)
            .map(|_| {
                (
                    (next() % w as u32) as f32,
                    (next() % h as u32) as f32,
                    2.0 + (next() % 9) as f32,
                )
            })
            .collect();
        (0..w * h)
            .map(|i| {
                let (x, y) = ((i % w) as f32, (i / w) as f32);
                centres
                    .iter()
                    .any(|&(cx, cy, r)| (x - cx).powi(2) + (y - cy).powi(2) <= r * r)
            })
            .collect()
    }

    #[test]
    fn matches_the_per_pixel_search_on_arbitrary_shapes() {
        let (w, h) = (48, 40);
        for seed in [1u32, 7, 42, 1279, 90210] {
            let seeds = blobs(w, h, seed);
            for half_width in [1.0, 2.5, 6.0, 10.0, 11.0, 13.7, 16.0] {
                for oob_seed in [false, true] {
                    assert_eq!(
                        stroke_band(&seeds, w, h, half_width, oob_seed),
                        brute_force(&seeds, w, h, half_width, oob_seed),
                        "seed {seed}, half-width {half_width}, oob {oob_seed}",
                    );
                }
            }
        }
    }

    /// Band thickness along a row, inward from a 45° edge `x + y = c`.
    #[test]
    fn band_is_the_width_perpendicular_to_a_diagonal_edge() {
        let (w, h) = (120, 120);
        let c = 120;
        // Seeds = transparent side of the edge (as for an Inside stroke).
        let seeds: Vec<bool> = (0..w * h).map(|i| (i % w) + (i / w) < c).collect();
        for half_width in [11.0f32, 16.0, 24.0] {
            let band = stroke_band(&seeds, w, h, half_width, false);
            let y = 60;
            let run = (0..w)
                .filter(|&x| band[y * w + x] && !seeds[y * w + x])
                .count();
            let perpendicular = run as f32 / std::f32::consts::SQRT_2;
            assert!(
                (perpendicular - half_width).abs() <= 1.0,
                "half-width {half_width}: {perpendicular} px perpendicular",
            );
        }
    }

    #[test]
    fn band_is_the_width_on_an_axis_aligned_edge() {
        let (w, h) = (80, 10);
        let seeds: Vec<bool> = (0..w * h).map(|i| i % w < 20).collect();
        let band = stroke_band(&seeds, w, h, 16.0, false);
        let run = (0..w)
            .filter(|&x| band[5 * w + x] && !seeds[5 * w + x])
            .count();
        assert_eq!(run, 16);
    }

    #[test]
    fn corners_come_out_round() {
        let (w, h) = (60, 60);
        // A single seed pixel: its band is a disc, not a square.
        let mut seeds = vec![false; w * h];
        seeds[30 * w + 30] = true;
        let band = stroke_band(&seeds, w, h, 12.0, false);
        assert!(band[30 * w + 42]);
        assert!(band[42 * w + 30]);
        assert!(
            !band[(30 + 9) * w + 30 + 9],
            "diagonal at 12.7 px is outside a 12 px disc"
        );
        assert!(band[(30 + 8) * w + 30 + 8], "diagonal at 11.3 px is inside");
    }

    #[test]
    fn out_of_bounds_seeds_reach_into_the_buffer() {
        let (w, h) = (30, 30);
        let seeds = vec![false; w * h];
        let band = stroke_band(&seeds, w, h, 12.0, true);
        assert!(band[15 * w + 11], "12 px from the left edge's outside");
        assert!(!band[15 * w + 12], "13 px from every edge's outside");
        assert!(!stroke_band(&seeds, w, h, 12.0, false).iter().any(|&b| b));
    }

    #[test]
    fn distance_encoding_round_trips_through_two_bytes() {
        for d in [0, 1, 10, 255, 256, 300, 4095, NO_SEED] {
            assert_eq!(decode_distance(encode_distance(d)), d);
        }
        assert_eq!(decode_distance(encode_distance(NO_SEED + 10)), NO_SEED);
    }

    #[test]
    fn search_radius_rounds_the_reach_up() {
        assert_eq!(search_radius(16.0), 16);
        assert_eq!(search_radius(10.5), 11);
        assert_eq!(search_radius(-1.0), 0);
    }
}
