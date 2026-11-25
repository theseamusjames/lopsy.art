//! The develop chain's tone step, on the CPU: scene data to rendered data,
//! both linear Rec. 2020 (`crate::working_space`). The GPU side is
//! `engine/src/gpu/shaders/develop/tone.wgsl`; change the two together.
//!
//! For now it holds what used to sit at the end of the RAW step, in the
//! same order: the profile's saturation, the highlight desaturation, and
//! the base curve. Each is made to give an in-gamut colour exactly what the
//! old step gave it in sRGB primaries:
//!
//! - **Saturation** mixes each channel toward luminance. Luminance with the
//!   working space's own weights is the same number in any primaries, and a
//!   linear mix toward a neutral commutes with a change of primaries that
//!   keeps white, so this is done in Rec. 2020 directly.
//! - **Highlight desaturation** blends channels above 1 toward the largest
//!   channel. Which channel is largest, and whether it is above 1, depends
//!   on the primaries, so it is done in sRGB primaries, as before, and the
//!   result converted back. It goes when highlights are reconstructed.
//! - **The base curve** maps luminance and scales the three channels
//!   together, which does not depend on the primaries. Where the old step
//!   clamped negative channels to 0 afterwards (a per-channel operation),
//!   nothing is clamped now: an out-of-gamut colour is left for the output
//!   step to bring in.
//!
//! **The shoulder.** The curve's table covers scene luminance 0..1. Above
//! that the lookup used to clamp, so everything brighter than white came
//! out at the table's last value. It now continues along a shoulder that
//! joins the table's last segment with the same value and slope and
//! flattens toward a ceiling `SHOULDER_HEADROOM` above it:
//!
//! ```text
//! d = L - 1,  y(L) = top + s·d / (1 + s·d / H)
//! ```
//!
//! where `top` is the table's last entry, `s` the slope of its last segment
//! (clamped to ≥ 0) and `H` the headroom. It is monotonic, its slope falls
//! from `s` toward zero, and it never reaches `top + H`. Rendered values
//! above 1.0 are HDR headroom; an SDR output step brings them to white.

use crate::working_space::{apply, conversion, luma, map_rgb, Gamut};

/// How far above the table's last value the shoulder can reach: rendered
/// luminance stays below `top + SHOULDER_HEADROOM`, two stops above white
/// for a curve that ends at 1.
pub const SHOULDER_HEADROOM: f32 = 3.0;

/// The tone step's settings: what the RAW develop settings had after the
/// exposure.
#[derive(Clone, Copy, Debug)]
pub struct ToneSettings<'a> {
    /// Factor of the mix toward luminance; 1 leaves colour alone.
    pub saturation: f32,
    /// Blend sRGB channels above 1.0 toward their maximum.
    pub highlight_desaturation: bool,
    /// The base curve on scene luminance, evenly spaced over 0..1, at least
    /// 2 entries; `None` for no curve (rendered equals scene in luminance).
    pub curve: Option<&'a [f32]>,
}

/// The table's last value and the slope of its last segment, per unit of
/// luminance, clamped to ≥ 0: where the shoulder starts and how steeply.
pub fn curve_top(curve: &[f32]) -> (f32, f32) {
    let n = curve.len();
    if n < 2 {
        return (curve.first().copied().unwrap_or(1.0), 0.0);
    }
    let slope = (curve[n - 1] - curve[n - 2]) * (n - 1) as f32;
    (curve[n - 1], slope.max(0.0))
}

/// The shoulder at `d` above the table's end: see the module notes.
pub fn shoulder(d: f32, top: f32, slope: f32) -> f32 {
    let rise = slope * d;
    top + rise / (1.0 + rise / SHOULDER_HEADROOM)
}

/// The curve at scene luminance `l`: the table, interpolated linearly
/// between entries as the shader does, below 1; the shoulder above.
pub fn curve_at(curve: &[f32], l: f32) -> f32 {
    let max_idx = (curve.len() - 1) as f32;
    if l > 1.0 {
        let (top, slope) = curve_top(curve);
        return shoulder(l - 1.0, top, slope);
    }
    let idx = (l * max_idx).clamp(0.0, max_idx);
    let lo = idx as usize;
    let hi = (lo + 1).min(curve.len() - 1);
    let frac = idx - lo as f32;
    curve[lo] * (1.0 - frac) + curve[hi] * frac
}

/// The tone step on the CPU: straight-alpha RGBA of scene linear Rec. 2020
/// to rendered linear Rec. 2020, alpha untouched, nothing clamped.
pub fn tone_reference(scene_rgba: &[f32], settings: &ToneSettings) -> Vec<f32> {
    let w = luma(Gamut::Rec2020);
    let to_srgb = conversion(Gamut::Rec2020, Gamut::Srgb);
    let from_srgb = conversion(Gamut::Srgb, Gamut::Rec2020);
    let lum = |c: [f32; 3]| w[0] * c[0] + w[1] * c[1] + w[2] * c[2];
    let curve = settings.curve.filter(|c| c.len() >= 2);
    map_rgb(scene_rgba, |mut c| {
        let sat = settings.saturation;
        if (sat - 1.0).abs() >= 1e-4 {
            let l = lum(c);
            c = c.map(|v| l + sat * (v - l));
        }
        if settings.highlight_desaturation {
            let mut s = apply(&to_srgb, c);
            let m = s[0].max(s[1]).max(s[2]);
            if m > 1.0 {
                let t = ((m - 1.0) / 0.5).min(1.0);
                s = s.map(|v| v + t * (m - v));
                c = apply(&from_srgb, s);
            }
        }
        if let Some(curve) = curve {
            let l = lum(c);
            c = if l <= 0.0 { [curve_at(curve, 0.0); 3] } else { c.map(|v| v * (curve_at(curve, l) / l)) };
        }
        c
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::raf::base_curves;

    fn provia() -> Vec<f32> {
        base_curves::curve_lut(base_curves::curve_for_film_mode(None)).to_vec()
    }

    #[test]
    fn the_shoulder_joins_the_table_smoothly_and_flattens() {
        let curve = provia();
        let (top, slope) = curve_top(&curve);
        assert!(slope > 0.0 && (top - 1.0).abs() < 1e-3, "{top} {slope}");
        let below = curve_at(&curve, 1.0 - 1e-4);
        let at = curve_at(&curve, 1.0);
        let above = curve_at(&curve, 1.0 + 1e-4);
        assert!((at - top).abs() < 1e-6);
        // The same slope on both sides of the join.
        let left = (at - below) / 1e-4;
        let right = (above - at) / 1e-4;
        assert!((left - right).abs() < 0.02 * slope.max(1e-3), "{left} {right}");
        // Monotonic, slope falling, bounded.
        let mut last = at;
        let mut last_step = f32::INFINITY;
        for i in 1..=150 {
            let l = 1.0 + i as f32 * 0.1;
            let y = curve_at(&curve, l);
            assert!(y > last, "not rising at {l}");
            let step = y - last;
            assert!(step <= last_step + 1e-6, "slope rises at {l}");
            assert!(y < top + SHOULDER_HEADROOM);
            last = y;
            last_step = step;
        }
    }

    #[test]
    fn an_in_gamut_colour_tones_as_the_old_raw_step_did() {
        // The old step's maths, in sRGB primaries, from `raf::develop`.
        let curve = provia();
        let settings = ToneSettings { saturation: 1.25, highlight_desaturation: true, curve: Some(&curve) };
        let srgb = [0.5f32, 0.3, 0.2, 1.0, 0.9, 0.95, 0.7, 1.0];
        let to_2020 = conversion(Gamut::Srgb, Gamut::Rec2020);
        let to_srgb = conversion(Gamut::Rec2020, Gamut::Srgb);
        let scene = map_rgb(&srgb, |c| apply(&to_2020, c));
        let rendered = map_rgb(&tone_reference(&scene, &settings), |c| apply(&to_srgb, c));

        let mut old: Vec<f32> = srgb.chunks(4).flat_map(|p| [p[0], p[1], p[2]]).collect();
        for c in old.chunks_mut(3) {
            let l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
            for v in c.iter_mut() {
                *v = l + 1.25 * (*v - l);
            }
        }
        crate::dng::color::apply_lut(&mut old, &curve);
        for (i, want) in old.iter().enumerate() {
            let got = rendered[i / 3 * 4 + i % 3];
            assert!((got - want).abs() < 2e-4, "channel {i}: {got} against {want}");
        }
    }

    #[test]
    fn without_a_curve_luminance_passes_through_unclamped() {
        let settings = ToneSettings { saturation: 1.0, highlight_desaturation: false, curve: None };
        let px = [4.0f32, -0.2, 0.5, 0.25];
        assert_eq!(tone_reference(&px, &settings), px);
    }
}
