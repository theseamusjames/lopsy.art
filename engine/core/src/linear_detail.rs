//! Local contrast and haze in linear light, for the develop chain with the
//! working space on (`crate::working_space`): the CPU reference of
//! `engine/src/gpu/shaders/develop/luminance_stats.wgsl`,
//! `local_contrast_log.wgsl` and `haze.wgsl`. Change each function and its
//! shader together; `engine/src/develop/detail.rs` drives the passes and
//! makes the blurs (`crate::detail::blur_axis`, through a box downscale above
//! `crate::detail::PYRAMID_SIGMA`). Without the working space the old stage
//! on sRGB-encoded values (`crate::detail::local_contrast_reference`) runs
//! instead, unchanged.
//!
//! # Large and small details
//!
//! On rendered linear Rec. 2020, after the tone pass. Per pixel:
//!
//! 1. **Log luminance.** `L = log2(max(Y, 0) + LC_FLOOR)` with `Y` the
//!    Rec. 2020 luminance. The floor keeps black finite, and it shrinks
//!    differences far below it, so noise in the deepest shadows is not
//!    measured as several stops of detail.
//! 2. **The neighbourhood.** A pass writes `x = L − LC_CENTRE` and `x²`;
//!    both are blurred with a Gaussian of `LC_SMALL_SIGMA` and of
//!    `LC_LARGE_SIGMA` full-resolution pixels (times the pixel scale), giving
//!    each radius's mean `μ` and variance `σ² = max(E[x²] − μ², 0)` of log
//!    luminance. Centring on middle grey keeps `x²` small enough that a
//!    half-float texture holds the variance of fine texture.
//! 3. **The detail at each radius** is the pixel's difference from its
//!    neighbourhood's mean, shrunk by the neighbourhood's own variance (a
//!    Wiener, or Lee, filter in log space): `D = (x − μ) · ε / (σ² + ε)`.
//!    Where the neighbourhood is texture (`σ²` well under `ε`), `D` is the
//!    plain difference from the mean. Where it straddles a strong edge,
//!    `σ²` is about a quarter of the edge's height squared, and `D` falls as
//!    `ε / height`: a step of `S` stops gives at most about `2ε / S` stops of
//!    detail at the edge itself and less beside it, so the halo a boost can
//!    make is limited by construction and is smaller the stronger the edge.
//! 4. **The slider** scales each radius's detail: `Δ = a_large · D_large +
//!    a_small · D_small` stops, with `a = LC_BOOST · v / 100` for a positive
//!    value `v` and `a = v / 100` for a negative one.
//! 5. **The three channels are multiplied by `2^Δ`**, so hue and
//!    saturation do not move, a channel's sign is kept and nothing becomes
//!    negative that was not.
//!
//! The sliders' ends: +100 multiplies the detail at that radius by
//! `1 + LC_BOOST` (2.5×, in stops); −100 removes it, leaving the edge-aware
//! base `μ + (x − μ) · σ² / (σ² + ε)`, which is flat inside texture and keeps
//! strong edges. Zero on both is the identity, and the pass is skipped.
//!
//! # Haze
//!
//! On scene linear Rec. 2020, before the tone pass (and after noise
//! reduction). A pass writes the pixel's darkest channel `max(min(r, g, b),
//! 0)` and its luminance `max(Y, 0)`; both are blurred by `HAZE_SIGMA`
//! full-resolution pixels (times the pixel scale): the veil `V` (the
//! dark-channel estimate of the haze's light) and the neighbourhood's
//! luminance `B`. With `h` the slider over 100:
//!
//! - **Removing haze** (`h > 0`): `v = HAZE_REMOVE · h · V` is taken from
//!   each channel through `f(c) = c − v · (1 − e^(−c / v))` (`c` itself at
//!   or below 0, or where `v` is 0), which is `c − v` well above the veil,
//!   falls smoothly to 0 instead of going below it (to `0.37 v` at `c = v`),
//!   and is continuous and increasing. All three channels are then
//!   multiplied by `P / f(P)` with `P = V + MIDDLE_GREY`, the exposure
//!   compensation: a pixel at the veil plus middle grey keeps its value, so
//!   mid-tones above the veil keep their brightness, those darker get
//!   darker and those brighter get brighter. Taking the same amount from
//!   every channel raises saturation, as the haze's grey goes.
//! - **Adding haze** (`h < 0`): `v = HAZE_ADD · |h| · B` is added to each
//!   channel and the sum multiplied by `1 / (1 + v / (B + MIDDLE_GREY))`,
//!   with the same pivot: shadows lift, highlights come down, saturation
//!   falls. A non-negative channel stays non-negative.
//!
//! Zero is the identity, and the pass is skipped.

use crate::detail::LocalContrastSettings;
use crate::scene_tone::MIDDLE_GREY;

/// Added to luminance before its log, so black is finite: about 11 stops
/// under scene white and 8.5 under middle grey. Detail at this luminance
/// counts half, and at 8 times it 0.9.
pub const LC_FLOOR: f32 = 1.0 / 2048.0;
/// The log luminance the moments are taken about: middle grey.
pub const LC_CENTRE: f32 = -2.473_931_2;
/// The large radius's variance scale, stops²: a neighbourhood whose log
/// luminance varies by half a stop (σ² = 0.25) keeps half its detail.
pub const LC_LARGE_EPSILON: f32 = 0.25;
/// The small radius's, stops²: a fifth of a stop.
pub const LC_SMALL_EPSILON: f32 = 0.04;
/// What +100 adds to the detail, as a multiple of it.
pub const LC_BOOST: f32 = 1.5;

/// The haze blur radius, full-resolution pixels (as the old large blur).
pub const HAZE_SIGMA: f32 = crate::detail::LC_LARGE_SIGMA;
/// The share of the veil taken away at +100.
pub const HAZE_REMOVE: f32 = 1.0;
/// The share of the neighbourhood's luminance added as a veil at −100.
pub const HAZE_ADD: f32 = 0.5;

/// What `luminance_stats.wgsl` writes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Statistic {
    /// `x = log2(max(Y, 0) + LC_FLOOR) − LC_CENTRE` and `x²`, for local contrast.
    LogMoments,
    /// The darkest channel and the luminance, both at least 0, for haze.
    Veil,
}

impl Statistic {
    /// The shader's `u_mode`.
    pub fn mode(self) -> i32 {
        match self {
            Statistic::LogMoments => 0,
            Statistic::Veil => 1,
        }
    }
}

fn dot(w: [f32; 3], c: [f32; 3]) -> f32 {
    w[0] * c[0] + w[1] * c[1] + w[2] * c[2]
}

/// `log2(max(y, 0) + LC_FLOOR) − LC_CENTRE`.
pub fn log_luminance(y: f32) -> f32 {
    (y.max(0.0) + LC_FLOOR).log2() - LC_CENTRE
}

/// The statistics image (`luminance_stats.wgsl`) of RGBA f32 `img`, with
/// `luma` the luminance weights of its primaries: two values in R and G,
/// 0 in B, 1 in alpha so a premultiplied downscale reads it unchanged.
pub fn statistics(img: &[f32], luma: [f32; 3], what: Statistic) -> Vec<f32> {
    img.chunks_exact(4)
        .flat_map(|p| {
            let c = [p[0], p[1], p[2]];
            let y = dot(luma, c);
            match what {
                Statistic::LogMoments => {
                    let x = log_luminance(y);
                    [x, x * x, 0.0, 1.0]
                }
                Statistic::Veil => [c[0].min(c[1]).min(c[2]).max(0.0), y.max(0.0), 0.0, 1.0],
            }
        })
        .collect()
}

/// The slider's factor on the detail: `LC_BOOST · v / 100` above 0, `v / 100` below.
pub fn detail_gain(v: f32) -> f32 {
    if v > 0.0 { LC_BOOST * v / 100.0 } else { v / 100.0 }
}

/// Whether the linear local contrast pass has something to do (haze is a
/// pass of its own).
pub fn local_contrast_draws(s: &LocalContrastSettings) -> bool {
    s.large != 0.0 || s.small != 0.0
}

/// The detail at one radius, from the pixel's `x` and its neighbourhood's
/// blurred moments `m` (`E[x]`, `E[x²]`).
pub fn wiener_detail(x: f32, m: [f32; 2], epsilon: f32) -> f32 {
    let variance = (m[1] - m[0] * m[0]).max(0.0);
    (x - m[0]) * epsilon / (variance + epsilon)
}

/// Large and small details on rendered linear `img` (`local_contrast_log.wgsl`).
/// `small` and `large` are `statistics(img, luma, LogMoments)` blurred by
/// `LC_SMALL_SIGMA` and `LC_LARGE_SIGMA` (times the pixel scale).
pub fn local_contrast_log_reference(img: &[f32], small: &[f32], large: &[f32], luma: [f32; 3], s: &LocalContrastSettings) -> Vec<f32> {
    let (gl, gs) = (detail_gain(s.large), detail_gain(s.small));
    let mut out = img.to_vec();
    for (i, p) in out.chunks_exact_mut(4).enumerate() {
        let x = log_luminance(dot(luma, [p[0], p[1], p[2]]));
        let dl = wiener_detail(x, [large[i * 4], large[i * 4 + 1]], LC_LARGE_EPSILON);
        let ds = wiener_detail(x, [small[i * 4], small[i * 4 + 1]], LC_SMALL_EPSILON);
        let gain = (gl * dl + gs * ds).exp2();
        for c in &mut p[..3] {
            *c *= gain;
        }
    }
    out
}

/// Whether the haze pass has something to do.
pub fn haze_draws(s: &LocalContrastSettings) -> bool {
    s.haze != 0.0
}

/// `c − v · (1 − e^(−c / v))`: `v` taken from `c` without going below 0;
/// `c` where it or `v` is not above 0.
pub fn remove_veil(c: f32, v: f32) -> f32 {
    if c > 0.0 && v > 0.0 { c - v * (1.0 - (-c / v).exp()) } else { c }
}

/// Haze on scene linear `img` (`haze.wgsl`). `veil` is
/// `statistics(img, luma, Veil)` blurred by `HAZE_SIGMA` (times the pixel
/// scale).
pub fn haze_reference(img: &[f32], veil: &[f32], haze: f32) -> Vec<f32> {
    let h = haze / 100.0;
    let mut out = img.to_vec();
    if h == 0.0 {
        return out;
    }
    for (i, p) in out.chunks_exact_mut(4).enumerate() {
        if h > 0.0 {
            let v_dark = veil[i * 4];
            let v = HAZE_REMOVE * h * v_dark;
            let pivot = v_dark + MIDDLE_GREY;
            let gain = pivot / remove_veil(pivot, v);
            for c in &mut p[..3] {
                *c = remove_veil(*c, v) * gain;
            }
        } else {
            let b = veil[i * 4 + 1];
            let v = HAZE_ADD * -h * b;
            let gain = 1.0 / (1.0 + v / (b + MIDDLE_GREY));
            for c in &mut p[..3] {
                *c = (*c + v) * gain;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::detail::{gaussian, LC_LARGE_SIGMA, LC_SMALL_SIGMA};
    use crate::working_space::{luma, Gamut};

    fn settings(large: f32, small: f32, haze: f32) -> LocalContrastSettings {
        LocalContrastSettings { large, small, haze, pixel_scale: 1.0 }
    }

    fn run_lc(img: &[f32], w: usize, h: usize, s: &LocalContrastSettings, scale: f32) -> Vec<f32> {
        let l = luma(Gamut::Rec2020);
        let stats = statistics(img, l, Statistic::LogMoments);
        let small = gaussian(&stats, w, h, LC_SMALL_SIGMA * scale);
        let large = gaussian(&stats, w, h, LC_LARGE_SIGMA * scale);
        local_contrast_log_reference(img, &small, &large, l, s)
    }

    fn y_of(p: &[f32]) -> f32 {
        dot(luma(Gamut::Rec2020), [p[0], p[1], p[2]])
    }

    #[test]
    fn zero_is_the_identity_and_is_not_drawn() {
        let img: Vec<f32> = (0..64).flat_map(|i| [0.01 * i as f32, 0.2, 0.5, 1.0]).collect();
        let s = settings(0.0, 0.0, 0.0);
        assert!(!local_contrast_draws(&s) && !haze_draws(&s));
        assert_eq!(run_lc(&img, 8, 8, &s, 1.0), img);
        let veil = statistics(&img, luma(Gamut::Rec2020), Statistic::Veil);
        assert_eq!(haze_reference(&img, &veil, 0.0), img);
    }

    #[test]
    fn a_coloured_ramp_keeps_its_chromaticity() {
        // A warm colour whose brightness ramps across and is textured.
        let (w, h) = (48, 8);
        let img: Vec<f32> = (0..w * h)
            .flat_map(|i| {
                let x = (i % w) as f32;
                let k = 0.05 * (x / 4.0).exp2().min(40.0) * (1.0 + 0.2 * (x * 1.3).sin());
                [0.9 * k, 0.5 * k, 0.2 * k, 1.0]
            })
            .collect();
        let out = run_lc(&img, w, h, &settings(80.0, -60.0, 0.0), 0.25);
        let mut moved = 0.0f32;
        for (a, b) in img.chunks_exact(4).zip(out.chunks_exact(4)) {
            moved = moved.max((b[0] / a[0] - 1.0).abs());
            for c in 0..3 {
                assert!((b[c] / b[1] - a[c] / a[1]).abs() < 1e-5, "{a:?} -> {b:?}");
            }
        }
        assert!(moved > 0.05, "the pass did something: {moved}");
    }

    #[test]
    fn large_details_raise_texture_and_minus_100_flattens_it() {
        let (w, h) = (64, 8);
        let img: Vec<f32> = (0..w * h)
            .flat_map(|i| {
                let v = 0.18 * (0.3 * ((i % w) as f32 * 0.8).sin()).exp2();
                [v, v, v, 1.0]
            })
            .collect();
        let spread = |o: &[f32]| {
            let ls: Vec<f32> = o.chunks_exact(4).map(|p| y_of(p).log2()).collect();
            ls.iter().cloned().fold(f32::MIN, f32::max) - ls.iter().cloned().fold(f32::MAX, f32::min)
        };
        let before = spread(&img);
        let up = spread(&run_lc(&img, w, h, &settings(100.0, 0.0, 0.0), 0.2));
        let down = spread(&run_lc(&img, w, h, &settings(-100.0, 0.0, 0.0), 0.2));
        assert!(up > before * 2.0, "{before} -> {up}");
        assert!(down < before * 0.2, "{before} -> {down}");
        assert!(spread(&run_lc(&img, w, h, &settings(0.0, 100.0, 0.0), 1.0)) > before * 1.3);
    }

    #[test]
    fn nothing_goes_negative_and_signs_are_kept() {
        let img: Vec<f32> = (0..64).flat_map(|i| [-0.02, 0.001 * i as f32, 3.0 * (i % 2) as f32, 1.0]).collect();
        let out = run_lc(&img, 8, 8, &settings(100.0, 100.0, 0.0), 1.0);
        for (a, b) in img.iter().zip(&out) {
            assert!(a.signum() == b.signum() || *a == 0.0 && *b == 0.0, "{a} -> {b}");
            assert!(b.is_finite());
        }
    }

    /// A test image with a uniform veil `veil` added to every channel.
    fn veiled(w: usize, h: usize, veil: f32) -> Vec<f32> {
        (0..w * h)
            .flat_map(|i| {
                let (x, y) = ((i % w) as f32, (i / w) as f32);
                let t = 0.5 + 0.5 * (x * 0.37).sin() * (y * 0.23).cos();
                [0.30 * t + veil, 0.12 * t * t + veil, 0.04 + 0.2 * (1.0 - t) + veil, 1.0]
            })
            .collect()
    }

    fn haze(img: &[f32], w: usize, h: usize, amount: f32) -> Vec<f32> {
        let veil = gaussian(&statistics(img, luma(Gamut::Rec2020), Statistic::Veil), w, h, 6.0);
        haze_reference(img, &veil, amount)
    }

    #[test]
    fn removing_haze_lowers_an_added_veil_and_never_goes_negative() {
        let (w, h) = (48, 32);
        let clear = veiled(w, h, 0.0);
        let hazy = veiled(w, h, 0.15);
        let darkest = |o: &[f32]| o.chunks_exact(4).map(|p| p[0].min(p[1]).min(p[2])).sum::<f32>() / (w * h) as f32;
        let cleaned = haze(&hazy, w, h, 100.0);
        assert!(cleaned.iter().all(|&v| v >= 0.0));
        // The darkest channel, the veil's measure, loses at least a third of
        // what the veil added, after the exposure compensation.
        let (before, after, target) = (darkest(&hazy), darkest(&cleaned), darkest(&clear));
        eprintln!("darkest channel: clear {target}, veiled {before}, dehazed {after}");
        assert!(after < before - (before - target) / 3.0, "{before} -> {after} (clear {target})");
        // The picture darkens by less than half a stop on average, though a
        // sixth of its light was veil; a pixel at the veil plus middle grey
        // keeps its value.
        let mean_y = |o: &[f32]| o.chunks_exact(4).map(y_of).sum::<f32>() / (w * h) as f32;
        let shift = (mean_y(&cleaned) / mean_y(&hazy)).log2();
        eprintln!("mean luminance moves {shift:.3} stops");
        assert!(shift.abs() < 0.5, "{} -> {}", mean_y(&hazy), mean_y(&cleaned));
        let flat_veil = [0.2f32, 0.0, 0.0, 1.0];
        let pivot = 0.2 + MIDDLE_GREY;
        let kept = haze_reference(&[pivot, pivot, pivot, 1.0], &flat_veil, 100.0);
        assert!((kept[0] - pivot).abs() < 1e-6, "{kept:?}");
        // Adding haze lifts the darkest channel and stays non-negative.
        let added = haze(&clear, w, h, -100.0);
        assert!(added.iter().all(|&v| v >= 0.0));
        assert!(darkest(&added) > darkest(&clear) + 0.02);
        // Continuous in the slider: a small value moves little.
        let small = haze(&hazy, w, h, 1.0);
        assert!(small.iter().zip(&hazy).all(|(a, b)| (a - b).abs() < 0.01));
    }

    #[test]
    fn the_veil_statistics_and_log_moments() {
        let img = [0.4, -0.1, 0.2, 1.0, 0.0, 0.0, 0.0, 0.5];
        let v = statistics(&img, [0.25, 0.5, 0.25], Statistic::Veil);
        assert_eq!(v, vec![0.0, 0.1, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]);
        let m = statistics(&img[4..], [0.25, 0.5, 0.25], Statistic::LogMoments);
        assert!((m[0] - (-11.0 - LC_CENTRE)).abs() < 1e-5 && (m[1] - m[0] * m[0]).abs() < 1e-4);
        assert!((LC_CENTRE - MIDDLE_GREY.log2()).abs() < 1e-6);
    }
}
