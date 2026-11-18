//! Color by hue (the Photos "Color mixer", spec 5.4): eight hue bands, each
//! with a hue shift, a saturation and a luminance control, applied in OkLCh
//! to display-referred (sRGB-encoded) pixels. This is the CPU reference of
//! `engine/src/gpu/shaders/develop/color_mixer.wgsl`; change them together.
//!
//! **Bands.** Centres in OkLCh hue (degrees), near the hue of each name's
//! sRGB colour (measured: red 29°, orange 53°, yellow 110°, green 142°,
//! aqua 195°, blue 264°, purple 294°, magenta 328°), nudged toward the
//! colours photos hold: yellow to 100° (golden yellows sit below pure
//! yellow), red to 25°, blue to 255° (sky blues sit below pure blue).
//!
//! **Weights.** A pixel's hue falls between two neighbouring centres; the
//! upper one gets `smoothstep(t)` of the way between them, the lower one
//! the rest. Weights are therefore smooth (C¹), only two are non-zero, and
//! they sum to 1 everywhere around the circle.
//!
//! **Controls** (recipe units −100..100, interpolated with the weights):
//! - hue: rotates hue by up to ±30°;
//! - saturation: scales chroma by `1 + s/100` (×0 at −100, ×2 at +100),
//!   never pushing a colour out of the sRGB gamut: a chroma increase stops
//!   at the gamut edge (found by bisection at the same L and hue);
//! - luminance: shifts OkLab L by up to ±0.15, scaled by `min(C / 0.08, 1)`
//!   so greys and near-greys do not move.
//!
//! A pixel whose interpolated controls are all zero is returned untouched;
//! everything else is clamped to 0..1. Alpha is never changed.

/// Band centres in OkLCh hue, degrees, in the recipe's band order: red,
/// orange, yellow, green, aqua, blue, purple, magenta.
pub const BAND_HUES: [f32; 8] = [25.0, 55.0, 100.0, 140.0, 195.0, 255.0, 295.0, 330.0];
/// Hue rotation at ±100.
pub const HUE_SHIFT_MAX_DEG: f32 = 30.0;
/// OkLab L shift at ±100.
pub const LUM_SHIFT_MAX: f32 = 0.15;
/// Chroma at and above which the luminance control acts fully.
pub const LUM_FULL_CHROMA: f32 = 0.08;
/// Bisection steps for the gamut edge.
pub const GAMUT_STEPS: u32 = 12;
/// Floats in a mixer's settings: (hue, saturation, luminance) per band.
pub const VALUES_LEN: usize = 24;

/// The weight of each band at OkLCh hue `h` (degrees, any range).
pub fn band_weights(h: f32) -> [f32; 8] {
    let h = h - 360.0 * (h / 360.0).floor();
    let mut w = [0.0f32; 8];
    for i in 0..8 {
        let lo = BAND_HUES[i];
        let hi = if i == 7 { BAND_HUES[0] + 360.0 } else { BAND_HUES[i + 1] };
        // Hues below the first centre belong to the magenta→red gap.
        let hh = if i == 7 && h < BAND_HUES[0] { h + 360.0 } else { h };
        if hh >= lo && hh < hi {
            let t = (hh - lo) / (hi - lo);
            let s = t * t * (3.0 - 2.0 * t);
            w[i] = 1.0 - s;
            w[(i + 1) % 8] = s;
            return w;
        }
    }
    w[0] = 1.0;
    w
}

fn srgb_to_linear(c: f32) -> f32 {
    if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
}

fn linear_to_srgb(c: f32) -> f32 {
    let c = c.max(0.0);
    if c <= 0.003_130_8 { c * 12.92 } else { 1.055 * c.powf(1.0 / 2.4) - 0.055 }
}

/// Linear sRGB → OkLab.
pub fn linear_to_oklab(c: [f32; 3]) -> [f32; 3] {
    let l = 0.412_221_47 * c[0] + 0.536_332_55 * c[1] + 0.051_445_995 * c[2];
    let m = 0.211_903_5 * c[0] + 0.680_699_5 * c[1] + 0.107_396_96 * c[2];
    let s = 0.088_302_46 * c[0] + 0.281_718_85 * c[1] + 0.629_978_7 * c[2];
    let (l, m, s) = (l.cbrt(), m.cbrt(), s.cbrt());
    [
        0.210_454_26 * l + 0.793_617_8 * m - 0.004_072_047 * s,
        1.977_998_5 * l - 2.428_592_2 * m + 0.450_593_7 * s,
        0.025_904_037 * l + 0.782_771_77 * m - 0.808_675_77 * s,
    ]
}

/// OkLab → linear sRGB.
pub fn oklab_to_linear(lab: [f32; 3]) -> [f32; 3] {
    let l = lab[0] + 0.396_337_78 * lab[1] + 0.215_803_76 * lab[2];
    let m = lab[0] - 0.105_561_346 * lab[1] - 0.063_854_17 * lab[2];
    let s = lab[0] - 0.089_484_18 * lab[1] - 1.291_485_5 * lab[2];
    let (l, m, s) = (l * l * l, m * m * m, s * s * s);
    [
        4.076_741_7 * l - 3.307_711_6 * m + 0.230_969_94 * s,
        -1.268_438 * l + 2.609_757_4 * m - 0.341_319_38 * s,
        -0.004_196_086_3 * l - 0.703_418_6 * m + 1.707_614_7 * s,
    ]
}

fn in_gamut(c: [f32; 3]) -> bool {
    c.iter().all(|&v| (-1e-4..=1.0 + 1e-4).contains(&v))
}

/// One sRGB-encoded pixel through the mixer.
pub fn mix_pixel(rgb: [f32; 3], values: &[f32; VALUES_LEN]) -> [f32; 3] {
    let lin = rgb.map(srgb_to_linear);
    let lab = linear_to_oklab(lin);
    let chroma = (lab[1] * lab[1] + lab[2] * lab[2]).sqrt();
    let hue = lab[2].atan2(lab[1]).to_degrees();
    let w = band_weights(hue);
    let (mut dh, mut ds, mut dl) = (0.0f32, 0.0f32, 0.0f32);
    for i in 0..8 {
        dh += w[i] * values[i * 3];
        ds += w[i] * values[i * 3 + 1];
        dl += w[i] * values[i * 3 + 2];
    }
    if dh == 0.0 && ds == 0.0 && dl == 0.0 {
        return rgb;
    }
    let new_hue = (hue + dh / 100.0 * HUE_SHIFT_MAX_DEG).to_radians();
    let new_l = lab[0] + dl / 100.0 * LUM_SHIFT_MAX * (chroma / LUM_FULL_CHROMA).min(1.0);
    let wanted = chroma * (1.0 + ds / 100.0).max(0.0);
    let at = |c: f32| oklab_to_linear([new_l, c * new_hue.cos(), c * new_hue.sin()]);
    let mut out = at(wanted);
    if wanted > chroma && !in_gamut(out) {
        let (mut lo, mut hi) = (chroma, wanted);
        for _ in 0..GAMUT_STEPS {
            let mid = 0.5 * (lo + hi);
            if in_gamut(at(mid)) { lo = mid } else { hi = mid }
        }
        out = at(lo);
    }
    out.map(|v| linear_to_srgb(v).clamp(0.0, 1.0))
}

/// The mixer over straight-alpha RGBA f32 (sRGB-encoded), alpha untouched.
pub fn color_mixer_reference(rgba: &[f32], values: &[f32; VALUES_LEN]) -> Vec<f32> {
    let mut out = Vec::with_capacity(rgba.len());
    for p in rgba.chunks_exact(4) {
        let c = mix_pixel([p[0], p[1], p[2]], values);
        out.extend_from_slice(&[c[0], c[1], c[2], p[3]]);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn band(i: usize, h: f32, s: f32, l: f32) -> [f32; VALUES_LEN] {
        let mut v = [0.0; VALUES_LEN];
        v[i * 3] = h;
        v[i * 3 + 1] = s;
        v[i * 3 + 2] = l;
        v
    }

    fn lch(rgb: [f32; 3]) -> (f32, f32, f32) {
        let lab = linear_to_oklab(rgb.map(srgb_to_linear));
        (lab[0], (lab[1] * lab[1] + lab[2] * lab[2]).sqrt(), lab[2].atan2(lab[1]).to_degrees().rem_euclid(360.0))
    }

    #[test]
    fn weights_sum_to_one_and_peak_at_the_centres() {
        for k in -720..1440 {
            let w = band_weights(k as f32 * 0.5);
            assert!((w.iter().sum::<f32>() - 1.0).abs() < 1e-5, "{k}");
            assert!(w.iter().filter(|&&x| x > 0.0).count() <= 2);
        }
        for (i, &h) in BAND_HUES.iter().enumerate() {
            assert!((band_weights(h)[i] - 1.0).abs() < 1e-6);
        }
        // Halfway between magenta (330) and red (25 + 360): equal weights.
        let w = band_weights((330.0 + 385.0) / 2.0 - 360.0);
        assert!((w[7] - 0.5).abs() < 1e-4 && (w[0] - 0.5).abs() < 1e-4, "{w:?}");
    }

    #[test]
    fn oklab_round_trips_and_matches_the_measured_band_hues() {
        for c in [[0.2f32, 0.5, 0.9], [1.0, 0.0, 0.0], [0.0, 0.0, 0.0], [1.0, 1.0, 1.0]] {
            let back = oklab_to_linear(linear_to_oklab(c));
            for k in 0..3 {
                assert!((back[k] - c[k]).abs() < 1e-4, "{c:?} → {back:?}");
            }
        }
        assert!((lch([1.0, 0.0, 0.0]).2 - 29.2).abs() < 0.2);
        assert!((lch([0.0, 0.0, 1.0]).2 - 264.1).abs() < 0.2);
    }

    #[test]
    fn zero_settings_change_nothing() {
        let px = [0.3f32, 0.6, 0.2, 0.7, 1.2, -0.1, 0.5, 1.0];
        assert_eq!(color_mixer_reference(&px, &[0.0; VALUES_LEN]), px);
    }

    #[test]
    fn greys_do_not_move() {
        let all = [100.0f32; VALUES_LEN];
        for g in [0.0f32, 0.18, 0.5, 1.0] {
            let out = mix_pixel([g, g, g], &all);
            for c in out {
                assert!((c - g).abs() < 2e-3, "{g} → {out:?}");
            }
        }
    }

    #[test]
    fn the_red_band_desaturates_red_and_leaves_blue() {
        let v = band(0, 0.0, -100.0, 0.0);
        // A red at the band's centre loses all its chroma; a warmer red,
        // partly in the orange band, loses most of it.
        let centre = mix_pixel([0.85, 0.1, 0.2], &v);
        assert!(lch([0.85, 0.1, 0.2]).2 < 27.0 && lch(centre).1 < 0.03, "{centre:?}");
        let warm = [0.8f32, 0.2, 0.15];
        assert!(lch(mix_pixel(warm, &v)).1 < 0.35 * lch(warm).1);
        let blue = [0.1f32, 0.2, 0.8];
        assert_eq!(mix_pixel(blue, &v), blue, "blue has no red weight");
    }

    #[test]
    fn hue_and_luminance_move_the_right_way() {
        let orange = [0.9f32, 0.5, 0.1];
        let (l0, _, h0) = lch(orange);
        let i = 1;
        let (_, _, h1) = lch(mix_pixel(orange, &band(i, 100.0, 0.0, 0.0)));
        assert!(h1 > h0 + 15.0, "{h0} → {h1}");
        let (l1, _, _) = lch(mix_pixel(orange, &band(i, 0.0, 0.0, -100.0)));
        assert!(l1 < l0 - 0.08, "{l0} → {l1}");
    }

    #[test]
    fn saturation_stays_in_gamut() {
        let v: [f32; VALUES_LEN] = std::array::from_fn(|k| if k % 3 == 1 { 100.0 } else { 0.0 });
        for rgb in [[0.9f32, 0.2, 0.1], [0.2, 0.8, 0.3], [0.3, 0.3, 0.9], [0.6, 0.5, 0.45]] {
            let out = mix_pixel(rgb, &v);
            assert!(lch(out).1 >= lch(rgb).1 - 1e-3, "{rgb:?} lost chroma: {out:?}");
            let lin = out.map(srgb_to_linear);
            let back = oklab_to_linear(linear_to_oklab(lin));
            assert!(in_gamut(back), "{out:?}");
            // The hue holds while chroma grows.
            let dh = (lch(out).2 - lch(rgb).2 + 540.0).rem_euclid(360.0) - 180.0;
            assert!(dh.abs() < 1.0, "{rgb:?}: hue moved {dh}");
        }
    }
}
