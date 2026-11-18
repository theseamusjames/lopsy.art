//! Finish (spec 5.4, stage 15 of 6.10): a shaped vignette and film grain,
//! the CPU reference of `engine/src/gpu/shaders/develop/finish.wgsl`;
//! change them together. The pass runs last in the develop chain, after
//! sharpening, on display-referred (sRGB-encoded) pixels, in the live frame
//! and in every export.
//!
//! `setImageFinish` takes 9 floats:
//! `[vignetteAmount −100..100, size 0..100, roundness −100..100,
//!   feather 0..100, grainAmount 0..100, grainSize 0..100,
//!   grainRoughness 0..100, seed, pixelScale]`.
//! The vignette here replaces the image adjustments' amount-only one: an app
//! that uses this sets that one to 0.
//!
//! **Vignette.** Around the document centre, with `u`, `v` the offsets over
//! the half width and half height (−1..1 at the edges): positive roundness
//! moves toward a circle (the offsets measured in the shorter half side),
//! negative toward a rectangle (a superellipse up to exponent 8). The
//! midpoint of the falloff is at `0.25 + 0.95 · size/100` of the way from
//! the centre to the corners (the superellipse norm is 1 there), its width is `0.05 + 0.95 · feather/100`, and the mask
//! `k` rises with `smoothstep` across it. Negative amounts darken
//! (`v · (1 + a·k)`), positive ones lighten toward white
//! (`v + a·k·(1 − v)`).
//!
//! **Grain.** Value noise on a grid of cells `1 + 3 · size/100`
//! full-resolution pixels wide. At full resolution (`pixelScale` 1, every
//! export) the grid is in document pixels. On a working image
//! (`pixelScale` < 1) it is drawn as the full-size grain looks once
//! downscaled: a cell spans `cell · pixelScale` working pixels, floored at
//! one, and its contrast is scaled by the averaging a downscale does
//! (`working_octave`). The pattern then differs from the export's; its
//! apparent size and contrast match. Each cell's value is an integer hash (PCG) of its index and the
//! seed, so grain is deterministic per photo; values are interpolated
//! bilinearly with a smoothstep, and roughness mixes in a second octave at
//! half the cell size. The grain is added to all channels, weighted toward
//! the midtones, at up to ±0.12 at amount 100.

/// Floats `setImageFinish` takes.
pub const VALUES_LEN: usize = 9;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FinishSettings {
    pub vignette: f32,
    pub size: f32,
    pub roundness: f32,
    pub feather: f32,
    pub grain: f32,
    pub grain_size: f32,
    pub roughness: f32,
    pub seed: u32,
    pub pixel_scale: f32,
}

impl FinishSettings {
    pub fn from_values(v: &[f32]) -> Result<Self, String> {
        if v.len() != VALUES_LEN || !v.iter().all(|x| x.is_finite()) {
            return Err(format!("Finish values must be {VALUES_LEN} finite floats"));
        }
        Ok(Self {
            vignette: v[0].clamp(-100.0, 100.0),
            size: v[1].clamp(0.0, 100.0),
            roundness: v[2].clamp(-100.0, 100.0),
            feather: v[3].clamp(0.0, 100.0),
            grain: v[4].clamp(0.0, 100.0),
            grain_size: v[5].clamp(0.0, 100.0),
            roughness: v[6].clamp(0.0, 100.0),
            seed: v[7].abs().min(16_777_216.0) as u32,
            pixel_scale: v[8].clamp(1e-3, 1.0),
        })
    }
    pub fn is_active(&self) -> bool {
        self.vignette != 0.0 || self.grain != 0.0
    }
}

fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// The vignette mask at document point (`x`, `y`) of a `w`×`h` document.
pub fn vignette_mask(s: &FinishSettings, x: f32, y: f32, w: f32, h: f32) -> f32 {
    let (hw, hh) = (0.5 * w, 0.5 * h);
    let (mut u, mut v) = ((x - hw) / hw, (y - hh) / hh);
    let round = (s.roundness / 100.0).max(0.0);
    let half_min = hw.min(hh);
    u = u + round * ((x - hw) / half_min - u);
    v = v + round * ((y - hh) / half_min - v);
    let n = 2.0 + 6.0 * (-s.roundness / 100.0).max(0.0);
    // The superellipse norm, 1 at the frame's corners.
    let d = (u.abs().powf(n) + v.abs().powf(n)).powf(1.0 / n) / 2f32.powf(1.0 / n);
    let mid = 0.25 + 0.95 * s.size / 100.0;
    let width = 0.05 + 0.95 * s.feather / 100.0;
    smoothstep(mid - 0.5 * width, mid + 0.5 * width, d)
}

/// A PCG-style integer hash of a cell index and seed, to 0..1. Exact
/// integer arithmetic, so every backend gives the same grain.
pub fn hash(ix: u32, iy: u32, seed: u32) -> f32 {
    let mut a = ix.wrapping_add(seed.wrapping_mul(747_796_405)).wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
    let mut b = iy.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
    a = a.wrapping_add(b.wrapping_mul(1_664_525));
    b = b.wrapping_add(a.wrapping_mul(1_664_525));
    a ^= a >> 16;
    b ^= b >> 16;
    a = a.wrapping_add(b.wrapping_mul(1_664_525));
    a ^= a >> 16;
    (a >> 8) as f32 / 16_777_216.0
}

fn value_noise(px: f32, py: f32, cell: f32, seed: u32) -> f32 {
    let (gx, gy) = (px / cell, py / cell);
    let (ix, iy) = (gx.floor(), gy.floor());
    let (fx, fy) = (smoothstep(0.0, 1.0, gx - ix), smoothstep(0.0, 1.0, gy - iy));
    let (ix, iy) = (ix.max(0.0) as u32, iy.max(0.0) as u32);
    let n00 = hash(ix, iy, seed);
    let n10 = hash(ix + 1, iy, seed);
    let n01 = hash(ix, iy + 1, seed);
    let n11 = hash(ix + 1, iy + 1, seed);
    let top = n00 + fx * (n10 - n00);
    let bottom = n01 + fx * (n11 - n01);
    top + fy * (bottom - top)
}

/// Grain at document point (`x`, `y`), −0.5..0.5 before scaling.
pub fn grain_noise(s: &FinishSettings, x: f32, y: f32) -> f32 {
    let cell = 1.0 + 3.0 * s.grain_size / 100.0;
    let r = s.roughness / 100.0;
    if s.pixel_scale >= 1.0 {
        let (px, py) = (x / s.pixel_scale, y / s.pixel_scale);
        let coarse = value_noise(px, py, cell, s.seed);
        let fine = value_noise(px, py, 0.5 * cell, s.seed ^ 0x9E37_79B9);
        return coarse + r * (fine - coarse) - 0.5;
    }
    let (coarse, coarse_amp) = working_octave(x, y, cell, s.pixel_scale, s.seed);
    let (fine, fine_amp) = working_octave(x, y, 0.5 * cell, s.pixel_scale, s.seed ^ 0x9E37_79B9);
    (1.0 - r) * coarse_amp * coarse + r * fine_amp * fine
}

/// One octave of grain on a working image at `scale` (< 1): what a
/// full-resolution octave of `cell` full pixels looks like once the export
/// is downscaled by `scale`. A cell spans `cell · scale` working pixels;
/// when that is under one, the grain shows at one working pixel, and its
/// contrast falls with the number of independent samples a working pixel
/// averages, about `1 / (max(cell, 1) · scale)²` (no finer than one full
/// pixel, since that is what the export samples). The amplitude is that
/// standard-deviation ratio times `GRAIN_PREVIEW_GAIN`, capped at 1.
/// Returns the centred value (−0.5..0.5) and the amplitude.
fn working_octave(x: f32, y: f32, cell: f32, scale: f32, seed: u32) -> (f32, f32) {
    let cell_w = cell * scale;
    let amp = (GRAIN_PREVIEW_GAIN * cell.max(1.0) * scale).min(1.0);
    (value_noise(x, y, cell_w.max(1.0), seed) - 0.5, amp)
}

/// Neighbouring grain samples share interpolation corners, so a downscale
/// averages fewer independent values than it averages pixels: measured
/// against box-downscaled exports (`working_scale_grain_matches_a_downscaled_export`),
/// the plain `cell · scale` ratio comes out about this much too faint.
pub const GRAIN_PREVIEW_GAIN: f32 = 1.6;

/// One encoded pixel through the finish at document point (`x`, `y`).
pub fn finish_pixel(rgb: [f32; 3], s: &FinishSettings, x: f32, y: f32, w: f32, h: f32) -> [f32; 3] {
    let mut c = rgb;
    if s.vignette != 0.0 {
        let k = vignette_mask(s, x, y, w, h);
        let a = s.vignette / 100.0;
        for v in c.iter_mut() {
            *v = if a < 0.0 { *v * (1.0 + a * k) } else { *v + a * k * (1.0 - *v) };
        }
    }
    if s.grain != 0.0 {
        let y_l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        let mid = 0.3 + 0.7 * (4.0 * y_l * (1.0 - y_l)).clamp(0.0, 1.0);
        let g = 0.24 * s.grain / 100.0 * mid * grain_noise(s, x, y);
        for v in c.iter_mut() {
            *v += g;
        }
    }
    c.map(|v| v.max(0.0))
}

/// The finish over RGBA f32 (`w`×`h`, encoded), alpha untouched.
pub fn finish_reference(rgba: &[f32], w: usize, h: usize, s: &FinishSettings) -> Vec<f32> {
    let mut out = rgba.to_vec();
    for y in 0..h {
        for x in 0..w {
            let i = (y * w + x) * 4;
            let c = finish_pixel([out[i], out[i + 1], out[i + 2]], s, x as f32 + 0.5, y as f32 + 0.5, w as f32, h as f32);
            out[i..i + 3].copy_from_slice(&c);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(v: [f32; VALUES_LEN]) -> FinishSettings {
        FinishSettings::from_values(&v).unwrap()
    }

    #[test]
    fn the_vignette_darkens_corners_not_the_centre() {
        let s = settings([-80.0, 50.0, 0.0, 50.0, 0.0, 0.0, 0.0, 1.0, 1.0]);
        let (w, h) = (300.0, 200.0);
        assert_eq!(vignette_mask(&s, 150.0, 100.0, w, h), 0.0);
        assert!(vignette_mask(&s, 1.0, 1.0, w, h) > 0.9);
        let corner = finish_pixel([0.5; 3], &s, 1.0, 1.0, w, h);
        assert!(corner[0] < 0.2);
        let light = settings([80.0, 50.0, 0.0, 50.0, 0.0, 0.0, 0.0, 1.0, 1.0]);
        assert!(finish_pixel([0.5; 3], &light, 1.0, 1.0, w, h)[0] > 0.8);
        // Bigger size moves the falloff outward.
        let big = settings([-80.0, 100.0, 0.0, 10.0, 0.0, 0.0, 0.0, 1.0, 1.0]);
        assert!(vignette_mask(&big, 20.0, 20.0, w, h) < vignette_mask(&s, 20.0, 20.0, w, h));
        // Roundness +100: the same mask at the same distance across and down.
        let round = settings([-80.0, 40.0, 100.0, 40.0, 0.0, 0.0, 0.0, 1.0, 1.0]);
        let across = vignette_mask(&round, 150.0 + 70.0, 100.0, w, h);
        let down = vignette_mask(&round, 150.0, 100.0 + 70.0, w, h);
        assert!((across - down).abs() < 1e-5, "{across} vs {down}");
    }

    #[test]
    fn grain_is_deterministic_per_seed_and_follows_full_resolution() {
        let s = settings([0.0, 0.0, 0.0, 0.0, 60.0, 50.0, 30.0, 42.0, 1.0]);
        let other = settings([0.0, 0.0, 0.0, 0.0, 60.0, 50.0, 30.0, 43.0, 1.0]);
        let a: Vec<f32> = (0..64).map(|i| grain_noise(&s, i as f32 + 0.5, 3.5)).collect();
        let b: Vec<f32> = (0..64).map(|i| grain_noise(&s, i as f32 + 0.5, 3.5)).collect();
        let c: Vec<f32> = (0..64).map(|i| grain_noise(&other, i as f32 + 0.5, 3.5)).collect();
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert!(a.iter().all(|v| (-0.5..=0.5).contains(v)));
        let mean = a.iter().sum::<f32>() / a.len() as f32;
        assert!(mean.abs() < 0.15);
    }

    /// Standard deviation of grain over a `w`×`h` area at `scale`, after a
    /// box downscale by `factor` (1 for none).
    fn grain_std(s: &FinishSettings, w: usize, h: usize, factor: usize) -> f32 {
        let mut vals = Vec::new();
        for by in 0..h / factor {
            for bx in 0..w / factor {
                let mut sum = 0.0;
                for dy in 0..factor {
                    for dx in 0..factor {
                        sum += grain_noise(s, (bx * factor + dx) as f32 + 0.5, (by * factor + dy) as f32 + 0.5);
                    }
                }
                vals.push(sum / (factor * factor) as f32);
            }
        }
        let mean = vals.iter().sum::<f32>() / vals.len() as f32;
        (vals.iter().map(|v| (v - mean) * (v - mean)).sum::<f32>() / vals.len() as f32).sqrt()
    }

    #[test]
    fn working_scale_grain_matches_a_downscaled_export() {
        for (size, roughness) in [(0.0, 0.0), (0.0, 100.0), (50.0, 30.0), (100.0, 0.0), (100.0, 100.0)] {
            let full = settings([0.0, 0.0, 0.0, 0.0, 60.0, size, roughness, 77.0, 1.0]);
            let working = FinishSettings { pixel_scale: 1.0 / 3.0, ..full };
            // The export at full size, box-downscaled by 3, against the
            // working render of the same area.
            let exported = grain_std(&full, 360, 240, 3);
            let previewed = grain_std(&working, 120, 80, 1);
            let ratio = previewed / exported;
            assert!((0.75..1.33).contains(&ratio), "size {size}, roughness {roughness}: {previewed} vs {exported}");
            // The old mapping (full-resolution cells sampled once per
            // working pixel) was several times too strong.
            assert!(previewed < grain_std(&full, 120, 80, 1));
        }
    }

    #[test]
    fn grain_at_full_resolution_is_unchanged() {
        // Values from the mapping before working-scale grain, at scale 1.
        let s = settings([0.0, 0.0, 0.0, 0.0, 60.0, 50.0, 30.0, 42.0, 1.0]);
        let (px, py) = (17.5f32, 9.5f32);
        let cell = 1.0 + 3.0 * 50.0 / 100.0;
        let coarse = value_noise(px, py, cell, 42);
        let fine = value_noise(px, py, 0.5 * cell, 42 ^ 0x9E37_79B9);
        assert_eq!(grain_noise(&s, px, py), coarse + 0.3 * (fine - coarse) - 0.5);
    }

    #[test]
    fn settings_parse_and_off_is_identity() {
        assert!(FinishSettings::from_values(&[0.0; 8]).is_err());
        assert!(FinishSettings::from_values(&[f32::NAN; 9]).is_err());
        let off = settings([0.0, 50.0, 0.0, 50.0, 0.0, 50.0, 50.0, 1.0, 1.0]);
        assert!(!off.is_active());
        assert_eq!(finish_pixel([0.3, 0.4, 0.5], &off, 1.0, 1.0, 10.0, 10.0), [0.3, 0.4, 0.5]);
    }
}
