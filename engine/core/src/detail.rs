//! Sharpness & noise (spec E8) and local contrast & haze (E15, first part)
//! for the Photonamous develop view: the CPU reference of the shaders in
//! `engine/src/gpu/shaders/develop/` (`blur_axis`, `noise_reduce`,
//! `detail_sharpen`, `local_contrast`). Change each function and its shader
//! together; `engine/src/develop/detail.rs` drives the passes.
//!
//! **Where they run.** The spec's order is noise reduction (stage 7, linear),
//! haze (8, linear), tone (9), local contrast (10, rendered), colour,
//! curves, sharpening (14, luminance). The engine renders the developed
//! layer, then the document's image adjustments (tone, colour, curves in
//! one pass), then the colour mixer. These stages fit around that as:
//! RAW develop → **noise reduction → haze + local contrast** → image
//! adjustments → colour mixer → areas → **sharpening** → finish (the
//! whole chain is in `engine/src/develop/mod.rs`). Deviations: all of them
//! work on display-referred (sRGB-encoded) values rather than linear
//! light, and local contrast runs before the tone controls instead of
//! after them. That is the chain without the working space. With it, noise
//! reduction runs here, wrapped in the display encoding, on scene data
//! before the tone pass ([`NoiseRun`]); sharpening runs here on rendered
//! data, wrapped; and haze and local contrast are
//! `crate::linear_detail`'s instead.
//!
//! **Resolution.** Radii are in full-resolution pixels; each stage takes
//! `pixel_scale` = working width / full width and scales its radii by it,
//! so the reduced preview and the full export blur over the same part of
//! the picture. Small radii are separable Gaussians at the working
//! resolution (at most ±12 taps); large ones (σ above `PYRAMID_SIGMA`) box-
//! downscale first and blur the small image, which the combining shader
//! reads back with bilinear filtering.
//!
//! **Luminance and chroma** are Rec. 709 luma of the encoded values and the
//! per-channel difference from it. Every stage changes luminance by adding
//! the same amount to all three channels or by scaling them together, so
//! none of them makes colour halos.

use crate::scene_tone::SLIDER_END;

/// Rec. 709 luma weights.
pub const LUMA: [f32; 3] = [0.2126, 0.7152, 0.0722];
/// Above this σ (working pixels) a blur goes through a downscaled image.
pub const PYRAMID_SIGMA: f32 = 4.0;
/// Most taps either side of a separable blur pass.
pub const MAX_BLUR_TAPS: i32 = 12;

/// Colour-noise blur radius, full-resolution pixels.
pub const NR_CHROMA_SIGMA: f32 = 6.0;
/// Small-details (texture) blur radius, full-resolution pixels.
pub const LC_SMALL_SIGMA: f32 = 3.0;
/// Large-details (clarity) and haze blur radius, full-resolution pixels.
pub const LC_LARGE_SIGMA: f32 = 50.0;

/// Sharpening and noise reduction, in the recipe's units.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DetailSettings {
    /// 0..150.
    pub amount: f32,
    /// 0.5..3.0 full-resolution pixels.
    pub radius: f32,
    /// 0..150: 0 sharpens everything, higher values only stronger edges
    /// (the mask's threshold is linear in it).
    pub edges: f32,
    /// Luminance noise reduction 0..150: up to 100 the filtered luminance is
    /// mixed in by `nr_luminance / 100` and the bilateral's range widens with
    /// it; past 100 the mix stays whole and the range keeps widening
    /// ([`nr_luminance_mix`], [`nr_range_sigma`]).
    pub nr_luminance: f32,
    /// Colour noise reduction 0..100. At 100 the chroma is wholly the
    /// blurred chroma (away from luminance edges); past it the mix would
    /// overshoot and push colour noise the other way, so 100 is its end.
    pub nr_color: f32,
    /// Keep detail 0..100: how much luminance noise reduction spares edges.
    /// At 100 the range σ is a quarter of what it is at 0; past about 133 it
    /// would be negative, so 100 is its end.
    pub nr_detail: f32,
    /// Working width / full width (1 at full resolution).
    pub pixel_scale: f32,
}

impl DetailSettings {
    /// From `setImageDetail`'s 7 floats, clamped to their ranges.
    pub fn from_values(v: &[f32]) -> Result<Self, String> {
        if v.len() != 7 || !v.iter().all(|x| x.is_finite()) {
            return Err("Detail values must be 7 finite floats".to_string());
        }
        Ok(Self {
            amount: v[0].clamp(0.0, 150.0),
            radius: v[1].clamp(0.5, 3.0),
            edges: v[2].clamp(0.0, SLIDER_END),
            nr_luminance: v[3].clamp(0.0, SLIDER_END),
            nr_color: v[4].clamp(0.0, 100.0),
            nr_detail: v[5].clamp(0.0, 100.0),
            pixel_scale: v[6].clamp(1e-3, 1.0),
        })
    }
    pub fn sharpens(&self) -> bool {
        self.amount > 0.0
    }
    pub fn reduces_noise(&self) -> bool {
        self.nr_luminance > 0.0 || self.nr_color > 0.0
    }
    /// σ of the unsharp mask in working pixels.
    pub fn sharpen_sigma(&self) -> f32 {
        (self.radius * self.pixel_scale).max(0.3)
    }
}

/// Large details and small details, −100..150, and haze, −150..100. At −100
/// a detail slider takes that detail away exactly (below it the detail
/// would come back inverted); at +100 haze removal takes away the whole
/// measured veil (past it, light that is not veil).
pub const DETAIL_FLOOR: f32 = -100.0;
/// Haze's top: the whole measured veil removed.
pub const HAZE_TOP: f32 = 100.0;

/// Large details, small details and haze (`DETAIL_FLOOR`, `HAZE_TOP`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LocalContrastSettings {
    pub large: f32,
    pub small: f32,
    pub haze: f32,
    pub pixel_scale: f32,
}

impl LocalContrastSettings {
    /// From `setImageLocalContrast`'s 4 floats, clamped to their ranges.
    pub fn from_values(v: &[f32]) -> Result<Self, String> {
        if v.len() != 4 || !v.iter().all(|x| x.is_finite()) {
            return Err("Local contrast values must be 4 finite floats".to_string());
        }
        Ok(Self {
            large: v[0].clamp(DETAIL_FLOOR, SLIDER_END),
            small: v[1].clamp(DETAIL_FLOOR, SLIDER_END),
            haze: v[2].clamp(-SLIDER_END, HAZE_TOP),
            pixel_scale: v[3].clamp(1e-3, 1.0),
        })
    }
    pub fn is_active(&self) -> bool {
        self.large != 0.0 || self.small != 0.0 || self.haze != 0.0
    }
}

fn luma(c: [f32; 3]) -> f32 {
    LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2]
}

fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Taps either side for σ.
pub fn blur_taps(sigma: f32) -> i32 {
    ((3.0 * sigma).ceil() as i32).clamp(1, MAX_BLUR_TAPS)
}

/// The box-downscale factor of a blur of σ working pixels above
/// `PYRAMID_SIGMA`: its smaller image is `factor` times smaller each way
/// (`pyramid_size`) and is blurred by `σ / factor`.
pub fn pyramid_factor(sigma: f32) -> u32 {
    (sigma / 2.0).ceil().max(2.0) as u32
}

/// The side of a blur's smaller image for a side of `side` pixels: whole
/// texels of up to `factor` pixels each, the last one shorter.
pub fn pyramid_size(side: u32, factor: u32) -> u32 {
    side.div_ceil(factor).max(1)
}

/// How far, in working pixels on each axis, the engine's blur of σ reaches:
/// a blurred pixel depends on no pixel further from it than this, and a
/// pixel that far changes it, give or take the margin below.
///
/// Up to `PYRAMID_SIGMA` it is the two separable passes' taps,
/// `blur_taps(max(σ, 0.3))`. Above it, the blur is read bilinearly from a
/// smaller image `f = pyramid_factor(σ)` times smaller (footprint `F ≤ f`
/// pixels a texel), blurred there by `σ / f` with `r` taps: a pixel at `x`
/// reads low texels `floor(t)` and `floor(t) + 1` at `t = (x + 0.5) / F − 0.5`,
/// each of which reads `r` texels either way, each the box of `F` pixels
/// read through 2×2 bilinear taps (at most half a pixel past its
/// footprint). That is at most `(r + 1.5) · F + 1` pixels; this gives
/// `(r + 2) · f + 2`, which also covers a bilinear coordinate rounded the
/// other way at a texel boundary.
pub fn blur_reach(sigma: f32) -> u32 {
    if sigma <= PYRAMID_SIGMA {
        return blur_taps(sigma.max(0.3)) as u32;
    }
    let factor = pyramid_factor(sigma);
    let taps = blur_taps((sigma / factor as f32).max(0.3)) as u32;
    (taps + 2) * factor + 2
}

/// How far noise reduction reaches: its colour blur, or the 5×5 bilateral's
/// two pixels when the blur reaches less.
pub fn noise_reduction_reach(s: &DetailSettings) -> u32 {
    blur_reach(NR_CHROMA_SIGMA * s.pixel_scale).max(2)
}

/// How far sharpening reaches: its blur (never a pyramid) and the edge
/// mask's gradient of the blurred image, one pixel either way.
pub fn sharpen_reach(s: &DetailSettings) -> u32 {
    blur_reach(s.sharpen_sigma().min(PYRAMID_SIGMA)) + 1
}

/// How far large and small details reach, on encoded values or on log
/// luminance (`linear_detail`), which blur the same two radii and read only
/// the pixel itself besides.
pub fn local_contrast_reach(s: &LocalContrastSettings) -> u32 {
    blur_reach(LC_SMALL_SIGMA * s.pixel_scale).max(blur_reach(LC_LARGE_SIGMA * s.pixel_scale))
}

/// One separable Gaussian pass over RGBA f32 (`w`×`h`), edge-clamped:
/// horizontal when `horizontal`, else vertical. `blur_axis.wgsl`.
pub fn blur_axis(img: &[f32], w: usize, h: usize, horizontal: bool, sigma: f32) -> Vec<f32> {
    let sigma = sigma.max(0.3);
    let r = blur_taps(sigma);
    let weights: Vec<f32> = (-r..=r).map(|i| (-((i * i) as f32) / (2.0 * sigma * sigma)).exp()).collect();
    let total: f32 = weights.iter().sum();
    let mut out = vec![0.0f32; img.len()];
    for y in 0..h {
        for x in 0..w {
            let mut acc = [0.0f32; 4];
            for (k, wt) in weights.iter().enumerate() {
                let d = k as i32 - r;
                let (sx, sy) = if horizontal {
                    ((x as i32 + d).clamp(0, w as i32 - 1) as usize, y)
                } else {
                    (x, (y as i32 + d).clamp(0, h as i32 - 1) as usize)
                };
                let o = (sy * w + sx) * 4;
                for c in 0..4 {
                    acc[c] += wt * img[o + c];
                }
            }
            let o = (y * w + x) * 4;
            for c in 0..4 {
                out[o + c] = acc[c] / total;
            }
        }
    }
    out
}

/// A full-resolution Gaussian of σ (both passes).
pub fn gaussian(img: &[f32], w: usize, h: usize, sigma: f32) -> Vec<f32> {
    let pass = blur_axis(img, w, h, true, sigma);
    blur_axis(&pass, w, h, false, sigma)
}

fn px(img: &[f32], i: usize) -> [f32; 3] {
    [img[i * 4], img[i * 4 + 1], img[i * 4 + 2]]
}

/// How much of the bilateral's luminance is mixed in: the slider over 100,
/// whole from 100 on. Past 100 the slider only widens the range σ, so more
/// noise is taken without the mix overshooting the filtered value.
pub fn nr_luminance_mix(s: &DetailSettings) -> f32 {
    (s.nr_luminance / 100.0).min(1.0)
}

/// Range σ of the luminance bilateral.
pub fn nr_range_sigma(s: &DetailSettings) -> f32 {
    (0.02 + 0.10 * s.nr_luminance / 100.0) * (1.0 - 0.75 * s.nr_detail / 100.0)
}

/// How noise reduction is run: on what data, and so with what thresholds.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NoiseRun {
    /// The luminance thresholds (the bilateral's range σ and the colour
    /// edge guard) are divided by this.
    pub threshold_scale: f32,
    /// Leave negative values as they come out, rather than clamping them to
    /// 0: with the working space, whose encoded values go below 0 for a
    /// colour outside sRGB.
    pub keep_negative: bool,
}

/// Noise reduction as it always ran: on sRGB-encoded values after the tone
/// curve, clamped at 0.
pub const DISPLAY_RUN: NoiseRun = NoiseRun { threshold_scale: 1.0, keep_negative: false };

/// With the working space, a RAW photo's noise reduction runs on scene data
/// (still wrapped in the display encoding), before the tone pass and so
/// before the camera's base curve, whose slope in encoded values over
/// scene 0.05..0.3 is 0.92 to 1.53 on the sample files (1.3 on average;
/// 0.76 to 1.3 below 0.02): noise there is that much smaller than after the
/// curve. Its thresholds are divided by this so a slider value removes
/// about as much as it did.
pub const NR_SCENE_THRESHOLD_SCALE: f32 = 1.25;

/// Noise reduction (`noise_reduce.wgsl`): a 5×5 bilateral on luminance,
/// mixed in by the luminance amount, and chroma replaced by the chroma of
/// `chroma_blur` (the image blurred by `NR_CHROMA_SIGMA`) by the colour
/// amount, except across luminance edges.
pub fn noise_reduce_reference(img: &[f32], chroma_blur: &[f32], w: usize, h: usize, s: &DetailSettings) -> Vec<f32> {
    noise_reduce_run_reference(img, chroma_blur, w, h, s, DISPLAY_RUN)
}

/// `noise_reduce_reference`, run as `run` says.
pub fn noise_reduce_run_reference(img: &[f32], chroma_blur: &[f32], w: usize, h: usize, s: &DetailSettings, run: NoiseRun) -> Vec<f32> {
    let sr = nr_range_sigma(s) / run.threshold_scale;
    let (lum, col) = (nr_luminance_mix(s), s.nr_color / 100.0);
    let mut out = img.to_vec();
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let c = px(img, i);
            let yc = luma(c);
            let (mut acc, mut total) = (0.0f32, 0.0f32);
            for dy in -2i32..=2 {
                for dx in -2i32..=2 {
                    let sx = (x as i32 + dx).clamp(0, w as i32 - 1) as usize;
                    let sy = (y as i32 + dy).clamp(0, h as i32 - 1) as usize;
                    let yn = luma(px(img, sy * w + sx));
                    let spatial = (-((dx * dx + dy * dy) as f32) / (2.0 * 1.2 * 1.2)).exp();
                    let range = (-((yn - yc) * (yn - yc)) / (2.0 * sr * sr)).exp();
                    acc += spatial * range * yn;
                    total += spatial * range;
                }
            }
            let y_new = yc + lum * (acc / total - yc);
            let b = px(chroma_blur, i);
            let yb = luma(b);
            let guard = (-((yb - yc) / 0.08 * run.threshold_scale).powi(2)).exp();
            let k = col * guard;
            for ch in 0..3 {
                let chroma = c[ch] - yc;
                let chroma_b = b[ch] - yb;
                let v = y_new + chroma + k * (chroma_b - chroma);
                out[i * 4 + ch] = if run.keep_negative { v } else { v.max(0.0) };
            }
        }
    }
    out
}

/// The sharpening edge mask at a blurred-luma gradient `mag`.
pub fn edge_mask(edges: f32, mag: f32) -> f32 {
    if edges <= 0.0 {
        return 1.0;
    }
    let t = 0.05 * edges / 100.0;
    smoothstep(0.5 * t, t, mag)
}

/// Unsharp mask on luminance with an edge mask (`detail_sharpen.wgsl`):
/// `blurred` is the image after `gaussian(sharpen_sigma)`. The mask comes
/// from the gradient of the blurred luminance (central differences).
pub fn sharpen_reference(img: &[f32], blurred: &[f32], w: usize, h: usize, s: &DetailSettings) -> Vec<f32> {
    let amount = s.amount / 100.0;
    let lb = |x: i32, y: i32| luma(px(blurred, (y.clamp(0, h as i32 - 1) as usize) * w + x.clamp(0, w as i32 - 1) as usize));
    let mut out = img.to_vec();
    for y in 0..h as i32 {
        for x in 0..w as i32 {
            let i = y as usize * w + x as usize;
            let c = px(img, i);
            let gx = 0.5 * (lb(x + 1, y) - lb(x - 1, y));
            let gy = 0.5 * (lb(x, y + 1) - lb(x, y - 1));
            let mask = edge_mask(s.edges, (gx * gx + gy * gy).sqrt());
            let d = amount * mask * (luma(c) - lb(x, y));
            for ch in 0..3 {
                out[i * 4 + ch] = (c[ch] + d).max(0.0);
            }
        }
    }
    out
}

/// The affine haze transform at a pixel whose large-scale neighbourhood is
/// `large`: returns (offset k, scale) with `J = (I − k) · scale` for
/// dehazing, or a mix toward light grey for adding haze.
fn haze_apply(c: [f32; 3], large: [f32; 3], haze: f32) -> [f32; 3] {
    let h = haze / 100.0;
    if h > 0.0 {
        let dark = large[0].min(large[1]).min(large[2]).clamp(0.0, 1.0);
        let k = 0.85 * h * dark;
        let inv = 1.0 / (1.0 - k);
        c.map(|v| (v - k) * inv)
    } else if h < 0.0 {
        let t = -h * 0.35;
        c.map(|v| v + t * (0.85 - v))
    } else {
        c
    }
}

/// Haze, then large and small details (`local_contrast.wgsl`). `small` and
/// `large` are the image blurred by `LC_SMALL_SIGMA` and `LC_LARGE_SIGMA`.
pub fn local_contrast_reference(img: &[f32], small: &[f32], large: &[f32], w: usize, h: usize, s: &LocalContrastSettings) -> Vec<f32> {
    let mut out = img.to_vec();
    for i in 0..w * h {
        let lg = px(large, i);
        let c = haze_apply(px(img, i), lg, s.haze);
        let cs = haze_apply(px(small, i), lg, s.haze);
        let cl = haze_apply(lg, lg, s.haze);
        let y = luma(c);
        let d = y - luma(cl);
        let mid = (4.0 * y * (1.0 - y)).clamp(0.0, 1.0);
        let y1 = y + s.large / 100.0 * 1.5 * mid * d / (1.0 + (d / 0.12) * (d / 0.12));
        let e = y - luma(cs);
        let y2 = y1 + s.small / 100.0 * 1.5 * e / (1.0 + (e / 0.08) * (e / 0.08));
        for ch in 0..3 {
            let v = if y > 1e-4 { c[ch] * (y2 / y) } else { c[ch] + (y2 - y) };
            out[i * 4 + ch] = v.max(0.0);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn noisy(w: usize, h: usize, amp: f32) -> Vec<f32> {
        let mut seed = 7u32;
        let mut rnd = move || {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (seed >> 8) as f32 / (1u32 << 24) as f32 - 0.5
        };
        (0..w * h)
            .flat_map(|i| {
                let x = (i % w) as f32 / w as f32;
                let edge = if i % w < w / 2 { 0.3 } else { 0.7 };
                [edge + amp * rnd(), edge - 0.1 + 0.1 * x + amp * rnd(), edge + 0.1 + amp * rnd(), 1.0]
            })
            .collect()
    }

    fn variance(img: &[f32], ch: usize, w: usize, x0: usize, x1: usize) -> f32 {
        let vals: Vec<f32> = img.chunks_exact(4).enumerate().filter(|(i, _)| (x0..x1).contains(&(i % w))).map(|(_, p)| p[ch]).collect();
        let mean = vals.iter().sum::<f32>() / vals.len() as f32;
        vals.iter().map(|v| (v - mean) * (v - mean)).sum::<f32>() / vals.len() as f32
    }

    fn detail(v: [f32; 7]) -> DetailSettings {
        DetailSettings::from_values(&v).unwrap()
    }

    #[test]
    fn blur_keeps_flat_images_flat_and_normalizes() {
        let img: Vec<f32> = (0..20 * 10).flat_map(|_| [0.25f32, 0.5, 0.75, 1.0]).collect();
        let out = gaussian(&img, 20, 10, 2.5);
        for (a, b) in img.iter().zip(&out) {
            assert!((a - b).abs() < 1e-5);
        }
        assert_eq!(blur_taps(0.3), 1);
        assert_eq!(blur_taps(10.0), MAX_BLUR_TAPS);
    }

    #[test]
    fn noise_reduction_lowers_noise_and_keeps_the_edge() {
        let (w, h) = (64, 32);
        let img = noisy(w, h, 0.08);
        let s = detail([0.0, 1.0, 0.0, 80.0, 100.0, 30.0, 1.0]);
        let blur = gaussian(&img, w, h, NR_CHROMA_SIGMA);
        let out = noise_reduce_reference(&img, &blur, w, h, &s);
        // Luminance noise in a flat strip, and colour noise (blue channel).
        assert!(variance(&out, 1, w, 4, 28) < 0.5 * variance(&img, 1, w, 4, 28));
        assert!(variance(&out, 2, w, 4, 28) < 0.3 * variance(&img, 2, w, 4, 28));
        // The 0.3 → 0.7 red edge survives.
        let row = 16 * w;
        assert!(out[(row + w / 2 + 3) * 4] - out[(row + w / 2 - 4) * 4] > 0.3);
        let off = noise_reduce_reference(&img, &blur, w, h, &detail([0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0]));
        for (a, b) in img.iter().zip(&off) {
            assert!((a - b).abs() < 1e-6 || *b == 0.0);
        }
    }

    #[test]
    fn sharpening_adds_contrast_at_edges_without_colour() {
        let (w, h) = (32, 8);
        let img: Vec<f32> = (0..w * h).flat_map(|i| if i % w < w / 2 { [0.2f32, 0.3, 0.4, 1.0] } else { [0.6, 0.7, 0.8, 1.0] }).collect();
        let s = detail([100.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0]);
        let blurred = gaussian(&img, w, h, s.sharpen_sigma());
        let out = sharpen_reference(&img, &blurred, w, h, &s);
        let at = |x: usize| (4 * w + x) * 4;
        assert!(out[at(w / 2 - 1)] < img[at(w / 2 - 1)], "dark side darker");
        assert!(out[at(w / 2)] > img[at(w / 2)], "light side lighter");
        // The same change in every channel: no colour halo.
        let d: Vec<f32> = (0..3).map(|c| out[at(w / 2) + c] - img[at(w / 2) + c]).collect();
        assert!((d[0] - d[1]).abs() < 1e-6 && (d[1] - d[2]).abs() < 1e-6);
        // Flat areas are untouched.
        assert!((out[at(2)] - img[at(2)]).abs() < 1e-6);
    }

    #[test]
    fn the_edge_mask_spares_low_contrast_texture() {
        assert_eq!(edge_mask(0.0, 0.0), 1.0);
        assert_eq!(edge_mask(100.0, 0.01), 0.0);
        assert_eq!(edge_mask(100.0, 0.2), 1.0);
        assert!(edge_mask(50.0, 0.02) > 0.0 && edge_mask(50.0, 0.02) < 1.0);
    }

    #[test]
    fn local_contrast_and_haze_move_the_right_way() {
        let (w, h) = (48, 8);
        let img: Vec<f32> = (0..w * h).flat_map(|i| {
            let v = 0.4 + 0.2 * ((i % w) as f32 / 6.0).sin();
            [v, v * 0.9, v * 0.8, 1.0]
        }).collect();
        let small = gaussian(&img, w, h, LC_SMALL_SIGMA);
        let large = gaussian(&gaussian(&img, w, h, 12.0), w, h, 12.0);
        let spread = |o: &[f32]| {
            let ys: Vec<f32> = o.chunks_exact(4).map(|p| luma([p[0], p[1], p[2]])).collect();
            ys.iter().cloned().fold(f32::MIN, f32::max) - ys.iter().cloned().fold(f32::MAX, f32::min)
        };
        let lc = |large_v: f32, small_v: f32, haze: f32| {
            local_contrast_reference(&img, &small, &large, w, h, &LocalContrastSettings { large: large_v, small: small_v, haze, pixel_scale: 1.0 })
        };
        assert_eq!(lc(0.0, 0.0, 0.0), img);
        assert!(spread(&lc(100.0, 0.0, 0.0)) > spread(&img) * 1.05);
        assert!(spread(&lc(-100.0, 0.0, 0.0)) < spread(&img) * 0.97);
        assert!(spread(&lc(0.0, 100.0, 0.0)) > spread(&img));
        let mean = |o: &[f32]| o.chunks_exact(4).map(|p| p[0]).sum::<f32>() / (w * h) as f32;
        assert!(mean(&lc(0.0, 0.0, 100.0)) < mean(&img), "dehaze lowers the haze floor");
        assert!(mean(&lc(0.0, 0.0, -100.0)) > mean(&img), "adding haze lifts it");
    }

    #[test]
    fn settings_parse_and_clamp() {
        let d = DetailSettings::from_values(&[200.0, 9.0, -5.0, 50.0, 50.0, 50.0, 0.5]).unwrap();
        assert_eq!((d.amount, d.radius, d.edges), (150.0, 3.0, 0.0));
        assert!((d.sharpen_sigma() - 1.5).abs() < 1e-6);
        assert!(DetailSettings::from_values(&[1.0; 6]).is_err());
        assert!(LocalContrastSettings::from_values(&[f32::NAN, 0.0, 0.0, 1.0]).is_err());
        assert!(!LocalContrastSettings::from_values(&[0.0, 0.0, 0.0, 1.0]).unwrap().is_active());
    }

    /// The widened ends are taken and the real ends still hold.
    #[test]
    fn settings_take_the_wide_ends_and_stop_at_the_real_ones() {
        let d = DetailSettings::from_values(&[150.0, 1.0, 150.0, 150.0, 150.0, 150.0, 1.0]).unwrap();
        assert_eq!((d.amount, d.edges, d.nr_luminance, d.nr_color, d.nr_detail), (150.0, 150.0, 150.0, 100.0, 100.0));
        let d = DetailSettings::from_values(&[151.0, 1.0, 400.0, 151.0, 0.0, 0.0, 1.0]).unwrap();
        assert_eq!((d.amount, d.edges, d.nr_luminance), (150.0, 150.0, 150.0));
        let lc = LocalContrastSettings::from_values(&[150.0, 150.0, -150.0, 1.0]).unwrap();
        assert_eq!((lc.large, lc.small, lc.haze), (150.0, 150.0, -150.0));
        let lc = LocalContrastSettings::from_values(&[-150.0, 300.0, 150.0, 1.0]).unwrap();
        assert_eq!((lc.large, lc.small, lc.haze), (-100.0, 150.0, 100.0));
    }

    /// Noise reduction past 100 mixes in the whole filtered luminance, as at
    /// 100, over a wider range: it smooths more, and stays as it was below 100.
    #[test]
    fn noise_reduction_past_100_widens_the_range_without_overshooting() {
        let s = |l: f32| DetailSettings::from_values(&[0.0, 1.0, 0.0, l, 0.0, 50.0, 1.0]).unwrap();
        assert_eq!(nr_luminance_mix(&s(50.0)), 0.5);
        assert_eq!(nr_luminance_mix(&s(100.0)), 1.0);
        assert_eq!(nr_luminance_mix(&s(150.0)), 1.0);
        assert!(nr_range_sigma(&s(150.0)) > nr_range_sigma(&s(100.0)));
        let (w, h) = (8usize, 8usize);
        let img: Vec<f32> = (0..w * h).flat_map(|i| {
            let v = 0.4 + if (i * 7919) % 5 < 2 { 0.08 } else { -0.05 };
            [v, v, v, 1.0]
        }).collect();
        let blur = gaussian(&img, w, h, NR_CHROMA_SIGMA);
        let spread = |o: &[f32]| {
            let ys: Vec<f32> = o.chunks_exact(4).map(|p| luma([p[0], p[1], p[2]])).collect();
            ys.iter().cloned().fold(f32::MIN, f32::max) - ys.iter().cloned().fold(f32::MAX, f32::min)
        };
        let at = |l: f32| noise_reduce_reference(&img, &blur, w, h, &s(l));
        let (a100, a150) = (at(100.0), at(150.0));
        assert!(spread(&a150) <= spread(&a100) && spread(&a100) < spread(&img), "{} {} {}", spread(&img), spread(&a100), spread(&a150));
        assert!(a150.iter().all(|v| v.is_finite()));
    }
}
