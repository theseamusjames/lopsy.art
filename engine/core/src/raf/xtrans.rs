//! X-Trans 6×6 CFA demosaicing.
//!
//! Fujifilm X-Trans sensors use a 6×6 repeating CFA pattern instead of the
//! standard 2×2 Bayer pattern. The pattern has ~56% green, ~22% red, ~22% blue.
//! The exact pattern varies by camera model and is read from the RAF file.
//!
//! The algorithm lives in `super::markesteijn`. Everything here operates on
//! a single-channel raw buffer (post white-balance) indexed by
//! `cfa[(row%6)*6 + (col%6)]` with channel codes 0=R, 1=G, 2=B.

use super::markesteijn;

#[cfg(test)]
const R: u8 = 0;
#[cfg(test)]
const G: u8 = 1;
#[cfg(test)]
const B: u8 = 2;

/// Public entrypoint: Markesteijn's edge-directed demosaic. Flat fields
/// reconstruct exactly at every crop offset (see
/// `flat_gray_has_no_grid_at_any_crop_offset`). A pattern without the
/// X-Trans structure, or a frame too small to mirror at its edges, gets a
/// plain same-colour average instead.
pub fn demosaic_xtrans(raw: &[f32], width: u32, height: u32, pattern: &[u8; 36]) -> Vec<f32> {
    let (w, h) = (width as usize, height as usize);
    match markesteijn::Layout::new(pattern) {
        Some(layout) if w >= markesteijn::MIN_SIDE && h >= markesteijn::MIN_SIDE => {
            markesteijn::demosaic(raw, w, h, &layout)
        }
        _ => simple_demosaic(raw, w, h, pattern),
    }
}

/// Deliberately dumb, phase-faithful demosaic for diagnostics: each output
/// channel is the value of the NEAREST same-colour sample (the pixel itself if
/// it already carries that colour). No directional or homogeneity logic, no
/// cross-channel mixing — so any CFA-period structure it produces comes purely
/// from the CFA phase map and the channel levels, not from clever interpolation.
pub fn demosaic_nearest(raw: &[f32], width: u32, height: u32, pattern: &[u8; 36]) -> Vec<f32> {
    let w = width as usize;
    let h = height as usize;
    let mut rgb = vec![0.0f32; w * h * 3];

    for row in 0..h {
        for col in 0..w {
            let out = (row * w + col) * 3;
            let own_color = cfa_color(pattern, row, col);

            for target in 0u8..3 {
                if own_color == target {
                    rgb[out + target as usize] = raw[row * w + col];
                } else {
                    // Search growing Chebyshev rings until at least one sample
                    // of the target colour is found, then average all such
                    // samples in that ring. Cap at radius 6 to bound cost.
                    let mut found_sum = 0.0f32;
                    let mut found_count = 0u32;
                    'rings: for radius in 1i32..=6 {
                        for dy in -radius..=radius {
                            for dx in -radius..=radius {
                                // Only the outermost shell of the Chebyshev ring.
                                if dy.abs() != radius && dx.abs() != radius {
                                    continue;
                                }
                                let nr = (row as i32 + dy).clamp(0, h as i32 - 1) as usize;
                                let nc = (col as i32 + dx).clamp(0, w as i32 - 1) as usize;
                                if cfa_color(pattern, nr, nc) == target {
                                    found_sum += raw[nr * w + nc];
                                    found_count += 1;
                                }
                            }
                        }
                        if found_count > 0 {
                            break 'rings;
                        }
                    }
                    rgb[out + target as usize] = if found_count > 0 {
                        found_sum / found_count as f32
                    } else {
                        raw[row * w + col]
                    };
                }
            }
        }
    }

    rgb
}

// ─────────────────────────────────────────────────────────────────────
// Pattern helpers
// ─────────────────────────────────────────────────────────────────────

#[inline]
fn cfa_color(pattern: &[u8; 36], row: usize, col: usize) -> u8 {
    pattern[(row % 6) * 6 + (col % 6)]
}

// ─────────────────────────────────────────────────────────────────────
// Small-image fallback
// ─────────────────────────────────────────────────────────────────────

/// Simple per-color averaging in a 5×5 window. The fallback for frames
/// `demosaic_xtrans` cannot hand to Markesteijn.
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
        let rgb = demosaic_xtrans(&raw, w as u32, h as u32, &TEST_PATTERN);
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
    fn gray_texture_reconstructs_near_neutral() {
        // A GRAY but textured scene (R=G=B at every pixel) must reconstruct to
        // near-neutral: any chroma is demosaic false colour. It measures
        // mean≈0.008 / max≈0.073; the thresholds leave a little room.
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
    fn small_frames_reconstruct_flat_gray() {
        // 4×4 is below the mirror minimum and takes the plain average; 8×8
        // is all border and still goes through Markesteijn.
        for side in [4usize, 8, 13] {
            let raw = vec![0.3f32; side * side];
            let rgb = demosaic_xtrans(&raw, side as u32, side as u32, &TEST_PATTERN);
            assert_eq!(rgb.len(), side * side * 3);
            for v in &rgb {
                assert!((*v - 0.3).abs() < 1e-3, "{side}: {v}");
            }
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
    fn demosaic_nearest_uniform_gray_is_exact() {
        // A uniform mosaic (all samples = 0.5) must reconstruct to 0.5 in
        // every channel at every pixel: no tiling or phase error, because the
        // nearest same-colour sample always has the same value.
        let w = 36usize;
        let h = 36usize;
        let raw = vec![0.5f32; w * h];
        let rgb = demosaic_nearest(&raw, w as u32, h as u32, &TEST_PATTERN);
        assert_eq!(rgb.len(), w * h * 3, "output length mismatch");
        for i in 0..w * h {
            let o = i * 3;
            assert!(
                (rgb[o]     - 0.5).abs() < 1e-6,
                "R wrong at pixel {i}: {}",  rgb[o]
            );
            assert!(
                (rgb[o + 1] - 0.5).abs() < 1e-6,
                "G wrong at pixel {i}: {}", rgb[o + 1]
            );
            assert!(
                (rgb[o + 2] - 0.5).abs() < 1e-6,
                "B wrong at pixel {i}: {}", rgb[o + 2]
            );
        }
    }

}
