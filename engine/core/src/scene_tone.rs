//! Tone on scene data, on the CPU: the first part of the develop chain's
//! tone pass (`engine/src/gpu/shaders/develop/tone.wgsl`), before the
//! profile's saturation and base curve (`crate::tone`). Change the two
//! together.
//!
//! The image is scene linear Rec. 2020 (`crate::working_space`), where 0.18
//! is middle grey and nothing is clamped. Per pixel, in this order:
//!
//! 1. **The values are blended.** The photo's own sliders ([`ToneSliders`])
//!    plus, for each area (`crate::areas`), its mask `m` at the pixel times
//!    the area's built-in Exposure, Temperature, Tint, Contrast, Highlights
//!    and Shadows and its layer's Whites and Blacks ([`AreaTone`]). Every
//!    slider adds: exposure in stops, white balance in the log domain (the
//!    gains below are powers of two of the blended values), tone sliders in
//!    their own units, which move knots. A mask therefore costs no pass, and
//!    where `m` is 0 the pixel gets exactly the photo's own values. Each
//!    slider runs to ±[`SLIDER_END`] (150), Temperature and Tint to
//!    ±[`WB_SLIDER_END`] (200), and a mask's adds up to as much again, so
//!    the blended values reach ±300, and ±400 for white balance.
//! 2. **Exposure and white balance**, a gain on all three channels:
//!    `2^ev` times the white-balance gains, red `2^(WB_TEMPERATURE_STOPS·t)`,
//!    blue `2^(−WB_TEMPERATURE_STOPS·t)`, green `2^(−WB_TINT_STOPS·tint)`
//!    (`t`, `tint` the sliders over 100), divided by their Rec. 2020
//!    luminance so white keeps its brightness. For a RAW photo the RAW step
//!    has already applied the photo's own (its `wbRatio` and exposure): the
//!    host sends 0 for them and only the areas' act here.
//! 3. **The tone map**, a curve from scene luminance to scene luminance in
//!    stops around middle grey (`x = log2(Y / 0.18)`), applied by scaling
//!    the three channels together by `Y′ / Y`, so it shifts neither hue nor
//!    saturation. A pixel whose luminance is 0 or below is left alone.
//!
//! **The tone map's construction.** Six knots at fixed scene positions
//! ([`KNOT_STOPS`]): blacks, shadows, middle grey, highlights, white (scene
//! 1.0, which the base curve takes to white) and three stops above white.
//! Each knot's output starts at its input; Contrast multiplies every output
//! by `2^(CONTRAST_STOPS · c)` (a change of slope about middle grey, which
//! stays put); then each slider adds its row of [`HIGHLIGHTS`],
//! [`SHADOWS`], [`WHITES`] or [`BLACKS`] (stops at −100 and at +100) times
//! its value over 100, so ±150 moves a knot one and a half times as far as
//! ±100 along the same straight line. The outputs are then forced into increasing order
//! with a slope of at least [`MIN_SLOPE`], outward from middle grey, and a
//! monotone cubic (Fritsch–Carlson) is drawn through them; beyond the end
//! knots it continues straight (in stops) at the end tangent. Every tangent
//! is positive, so the map is strictly increasing for every combination of
//! slider values, and it is continuous in value and slope. Below
//! [`TONE_FLOOR`] luminance the gain is held at its value there, so a
//! near-black pixel is not multiplied without bound.
//!
//! Zero on every slider gives knots on the identity and the map is skipped:
//! the pass is then exactly the identity. The map is evaluated analytically
//! from uniforms in the shader, not baked into a table, because with masks
//! the knots differ from pixel to pixel.

use crate::areas::{self, Area};
use crate::working_space::{luma, Gamut};

/// Scene luminance of middle grey.
pub const MIDDLE_GREY: f32 = 0.18;
/// `log2(1 / 0.18)`: scene luminance 1.0 in stops above middle grey, the
/// value the base curves' tables end at, so the knot the profile's curve
/// takes to white.
pub const WHITE_STOPS: f32 = 2.473_931_2;
/// Knots of the tone map.
pub const KNOTS: usize = 6;
/// Where the knots sit, in stops from middle grey: blacks, shadows, middle
/// grey, highlights, white, three stops above white.
pub const KNOT_STOPS: [f32; KNOTS] = [-5.5, -2.5, 0.0, 1.5, WHITE_STOPS, WHITE_STOPS + 3.0];

/// A slider's effect on the knots' outputs, in stops: at −100 (`neg`) and at
/// +100 (`pos`); between, the row for its sign times its value over 100.
#[derive(Clone, Copy, Debug)]
pub struct KnotRow {
    pub neg: [f32; KNOTS],
    pub pos: [f32; KNOTS],
}

/// Highlights. −100 brings the highlights knot down 0.6 stop, white 1.2
/// and the knot three stops above white 3.2, so scene values up to three
/// stops above white come back below the base curve's white (recovery);
/// +100 lifts them 0.5, 0.6 and 0.6.
pub const HIGHLIGHTS: KnotRow = KnotRow {
    neg: [0.0, 0.0, 0.0, -0.6, -1.2, -3.2],
    pos: [0.0, 0.0, 0.0, 0.5, 0.6, 0.6],
};
/// Shadows. +100 lifts the shadows knot 1.2 stops and blacks 0.5; −100
/// lowers them 1.0 and 0.4.
pub const SHADOWS: KnotRow = KnotRow {
    neg: [-0.4, -1.0, 0.0, 0.0, 0.0, 0.0],
    pos: [0.5, 1.2, 0.0, 0.0, 0.0, 0.0],
};
/// Whites: the white end of the scene range the profile's curve maps to
/// white. +100 lifts the white knot (and the one above it) a stop, so a
/// scene value a stop below white now reaches white; −100 lowers them a
/// stop. The highlights knot follows by 0.3 stop.
pub const WHITES: KnotRow = KnotRow {
    neg: [0.0, 0.0, 0.0, -0.3, -1.0, -1.0],
    pos: [0.0, 0.0, 0.0, 0.3, 1.0, 1.0],
};
/// Blacks: the black end. −100 lowers the blacks knot 2 stops (deeper
/// blacks), +100 lifts it 1.5; the shadows knot follows by 0.3.
pub const BLACKS: KnotRow = KnotRow {
    neg: [-2.0, -0.3, 0.0, 0.0, 0.0, 0.0],
    pos: [1.5, 0.3, 0.0, 0.0, 0.0, 0.0],
};
/// Contrast: the slope about middle grey is multiplied by `2^(0.4 · c/100)`,
/// ×1.32 at +100 (white then sits 0.8 stop higher, blacks 1.8 stops lower)
/// and ×0.76 at −100.
pub const CONTRAST_STOPS: f32 = 0.4;
/// The least slope between neighbouring knots, in stops out per stop in.
pub const MIN_SLOPE: f32 = 0.05;
/// Scene luminance below which the tone map's gain is held constant.
pub const TONE_FLOOR: f32 = 1.0 / 65536.0;
/// White balance strength at Temperature ±100: red and blue gains of
/// `2^(±0.6)` and `2^(∓0.6)`, as the RAW step's `wbRatio` has it
/// (Photonamous' `RAW_TEMPERATURE_STOPS`).
pub const WB_TEMPERATURE_STOPS: f32 = 0.6;
/// At Tint ±100: a green gain of `2^(∓0.4)` (+ is magenta), as
/// Photonamous' `RAW_TINT_STOPS`.
pub const WB_TINT_STOPS: f32 = 0.4;
/// Floats in `setDevelopTone`.
pub const TONE_LEN: usize = 8;
/// The far end of a develop slider whose 100 is not a real limit, in
/// recipe units: the tone sliders run ±150, and the other sliders that
/// widened run to it at their open end. Every mapping from such a slider
/// is linear in it, or a power of two of it, so 150 is one and a half
/// times as far along the same curve as 100.
pub const SLIDER_END: f32 = 150.0;

/// The far end of Temperature and Tint, the photo's and a mask's: ±200.
/// They run further than the other sliders because a camera's own
/// white-balance presets do: a photo shot under tungsten light with the
/// camera set for shade needs more than 150 to reach the Tungsten preset.
/// White balance is a power of two of the value, so 200 is the same curve
/// twice as far along as 100.
pub const WB_SLIDER_END: f32 = 200.0;

/// The photo's own sliders, in the recipe's units: exposure in EV
/// (−5..5), Temperature and Tint −200..200, the rest −150..150. Exposure,
/// Temperature and Tint are for a photo that is not RAW; a RAW photo's are
/// applied by the RAW step.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ToneSliders {
    pub exposure: f32,
    pub temperature: f32,
    pub tint: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub whites: f32,
    pub blacks: f32,
}

impl ToneSliders {
    /// `setDevelopTone`'s 8 floats: exposure, temperature, tint, contrast,
    /// highlights, shadows, whites, blacks. Exposure is clamped to ±10 EV,
    /// temperature and tint to ±[`WB_SLIDER_END`], the rest to
    /// ±[`SLIDER_END`].
    pub fn parse(values: &[f32]) -> Result<Self, String> {
        if values.len() != TONE_LEN {
            return Err(format!("Develop tone needs {TONE_LEN} floats, got {}", values.len()));
        }
        if !values.iter().all(|v| v.is_finite()) {
            return Err("Develop tone values must be finite".to_string());
        }
        let s = |v: f32| v.clamp(-SLIDER_END, SLIDER_END);
        let wb = |v: f32| v.clamp(-WB_SLIDER_END, WB_SLIDER_END);
        Ok(Self {
            exposure: values[0].clamp(-10.0, 10.0),
            temperature: wb(values[1]),
            tint: wb(values[2]),
            contrast: s(values[3]),
            highlights: s(values[4]),
            shadows: s(values[5]),
            whites: s(values[6]),
            blacks: s(values[7]),
        })
    }

    pub fn is_identity(&self) -> bool {
        *self == Self::default()
    }

    /// The five tone sliders, in the order the shader takes them.
    pub fn tone(&self) -> [f32; 5] {
        [self.contrast, self.highlights, self.shadows, self.whites, self.blacks]
    }
}

/// What an area's layer adds to the tone map through the area's mask: its
/// Whites and Blacks (`setImageAreaTone`, or `setDevelopAreaLook`).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct AreaTone {
    pub whites: f32,
    pub blacks: f32,
}

/// Every knot's output for the five tone sliders (contrast, highlights,
/// shadows, whites, blacks; −150..150, or to ±300 where masks add up),
/// forced increasing.
pub fn knot_outputs(sliders: [f32; 5]) -> [f32; KNOTS] {
    let [c, h, s, w, b] = sliders;
    let gain = (CONTRAST_STOPS * c / 100.0).exp2();
    let mut y = KNOT_STOPS.map(|x| gain * x);
    for (row, v) in [(HIGHLIGHTS, h), (SHADOWS, s), (WHITES, w), (BLACKS, b)] {
        let (side, k) = if v < 0.0 { (row.neg, -v / 100.0) } else { (row.pos, v / 100.0) };
        for i in 0..KNOTS {
            y[i] += k * side[i];
        }
    }
    for i in 3..KNOTS {
        y[i] = y[i].max(y[i - 1] + MIN_SLOPE * (KNOT_STOPS[i] - KNOT_STOPS[i - 1]));
    }
    for i in (0..2).rev() {
        y[i] = y[i].min(y[i + 1] - MIN_SLOPE * (KNOT_STOPS[i + 1] - KNOT_STOPS[i]));
    }
    y
}

/// Fritsch–Carlson tangents through the knots `(KNOT_STOPS, y)`: secant
/// means inside, the end secants at the ends, then each interval's pair
/// scaled into the circle of radius 3 that keeps it monotone, in order.
pub fn tangents(y: &[f32; KNOTS]) -> [f32; KNOTS] {
    let x = KNOT_STOPS;
    let d: [f32; KNOTS - 1] = std::array::from_fn(|i| (y[i + 1] - y[i]) / (x[i + 1] - x[i]));
    let mut m = [0.0f32; KNOTS];
    m[0] = d[0];
    m[KNOTS - 1] = d[KNOTS - 2];
    for i in 1..KNOTS - 1 {
        m[i] = 0.5 * (d[i - 1] + d[i]);
    }
    for i in 0..KNOTS - 1 {
        let a = m[i] / d[i];
        let b = m[i + 1] / d[i];
        let s = a * a + b * b;
        if s > 9.0 {
            let t = 3.0 / s.sqrt();
            m[i] = t * a * d[i];
            m[i + 1] = t * b * d[i];
        }
    }
    m
}

/// The tone map at `x` stops from middle grey, through knots `y` with
/// tangents `m`.
pub fn eval(x: f32, y: &[f32; KNOTS], m: &[f32; KNOTS]) -> f32 {
    let k = KNOT_STOPS;
    if x <= k[0] {
        return y[0] + m[0] * (x - k[0]);
    }
    if x >= k[KNOTS - 1] {
        return y[KNOTS - 1] + m[KNOTS - 1] * (x - k[KNOTS - 1]);
    }
    let mut i = 0;
    while i < KNOTS - 2 && x > k[i + 1] {
        i += 1;
    }
    let h = k[i + 1] - k[i];
    let t = (x - k[i]) / h;
    let (t2, t3) = (t * t, t * t * t);
    (2.0 * t3 - 3.0 * t2 + 1.0) * y[i] + (t3 - 2.0 * t2 + t) * h * m[i] + (-2.0 * t3 + 3.0 * t2) * y[i + 1] + (t3 - t2) * h * m[i + 1]
}

/// The map from scene luminance to scene luminance for `sliders`.
pub fn map_luminance(l: f32, sliders: [f32; 5]) -> f32 {
    let y = knot_outputs(sliders);
    let m = tangents(&y);
    l * gain_at(l, &y, &m)
}

/// The factor the three channels are scaled by at luminance `l > 0`.
pub fn gain_at(l: f32, y: &[f32; KNOTS], m: &[f32; KNOTS]) -> f32 {
    let x = (l.max(TONE_FLOOR) / MIDDLE_GREY).log2();
    (eval(x, y, m) - x).exp2()
}

/// The white-balance gains for blended Temperature `t` and Tint `tint`
/// (recipe units), luminance kept.
pub fn white_balance_gains(t: f32, tint: f32) -> [f32; 3] {
    let w = luma(Gamut::Rec2020);
    let g = [(WB_TEMPERATURE_STOPS * t / 100.0).exp2(), (-WB_TINT_STOPS * tint / 100.0).exp2(), (-WB_TEMPERATURE_STOPS * t / 100.0).exp2()];
    let y = w[0] * g[0] + w[1] * g[1] + w[2] * g[2];
    g.map(|v| v / y)
}

/// The photo's sliders with every area's added through its mask at
/// document point (`x`, `y`): exposure, temperature, tint, then the five
/// tone sliders.
pub fn blended(sliders: &ToneSliders, areas: &[Area], area_tone: &[AreaTone], px: f32, py: f32) -> (f32, f32, f32, [f32; 5]) {
    let (mut ev, mut t, mut tint) = (sliders.exposure, sliders.temperature, sliders.tint);
    let mut tone = sliders.tone();
    for (i, a) in areas.iter().enumerate() {
        let m = areas::mask(a, px, py);
        if m <= 0.0 {
            continue;
        }
        let extra = area_tone.get(i).copied().unwrap_or_default();
        ev += m * a.exposure;
        t += m * a.temperature;
        tint += m * a.tint;
        tone[0] += m * a.contrast;
        tone[1] += m * a.highlights;
        tone[2] += m * a.shadows;
        tone[3] += m * extra.whites;
        tone[4] += m * extra.blacks;
    }
    (ev, t, tint, tone)
}

/// One scene pixel through steps 2 and 3 with blended values.
pub fn tone_pixel(c: [f32; 3], ev: f32, t: f32, tint: f32, tone: [f32; 5]) -> [f32; 3] {
    let mut c = c;
    if ev != 0.0 || t != 0.0 || tint != 0.0 {
        let wb = white_balance_gains(t, tint);
        let e = ev.exp2();
        c = [c[0] * e * wb[0], c[1] * e * wb[1], c[2] * e * wb[2]];
    }
    if tone.iter().any(|&v| v != 0.0) {
        let w = luma(Gamut::Rec2020);
        let l = w[0] * c[0] + w[1] * c[1] + w[2] * c[2];
        if l > 0.0 {
            let y = knot_outputs(tone);
            let m = tangents(&y);
            let k = gain_at(l, &y, &m);
            c = c.map(|v| v * k);
        }
    }
    c
}

/// Steps 1 to 3 over straight-alpha RGBA f32 (`w`×`h`, scene linear
/// Rec. 2020), alpha untouched, nothing clamped.
pub fn scene_tone_reference(rgba: &[f32], w: usize, h: usize, sliders: &ToneSliders, areas: &[Area], area_tone: &[AreaTone]) -> Vec<f32> {
    scene_tone_reference_at(rgba, w, h, sliders, areas, area_tone, None)
}

/// `scene_tone_reference` for a document that is `region` of a larger
/// picture: the masks at each pixel's place in the whole (`tile::whole_point`).
pub fn scene_tone_reference_at(
    rgba: &[f32],
    w: usize,
    h: usize,
    sliders: &ToneSliders,
    areas: &[Area],
    area_tone: &[AreaTone],
    region: Option<crate::tile::Region>,
) -> Vec<f32> {
    let mut out = rgba.to_vec();
    for y in 0..h {
        for x in 0..w {
            let i = (y * w + x) * 4;
            let (px, py) = crate::tile::whole_point(region, x, y);
            let (ev, t, tint, tone) = blended(sliders, areas, area_tone, px, py);
            let c = tone_pixel([out[i], out[i + 1], out[i + 2]], ev, t, tint, tone);
            out[i..i + 3].copy_from_slice(&c);
        }
    }
    out
}

/// The knot positions and slider rows as the shader takes them: 8 floats
/// of knot positions (6 used), then 8 rows of 6 floats (highlights,
/// shadows, whites, blacks; each −100 then +100).
pub fn shader_tables() -> ([f32; 8], [f32; 48]) {
    let mut knots = [0.0f32; 8];
    knots[..KNOTS].copy_from_slice(&KNOT_STOPS);
    let mut rows = [0.0f32; 48];
    for (r, row) in [HIGHLIGHTS, SHADOWS, WHITES, BLACKS].iter().enumerate() {
        rows[r * 12..r * 12 + 6].copy_from_slice(&row.neg);
        rows[r * 12 + 6..r * 12 + 12].copy_from_slice(&row.pos);
    }
    (knots, rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ENDS: [f32; 5] = [-100.0, -50.0, 0.0, 50.0, 100.0];
    /// The sliders' new ends, and a mask's ±150 on top of them.
    const WIDE: [f32; 7] = [-300.0, -150.0, -100.0, 0.0, 100.0, 150.0, 300.0];

    #[test]
    fn zero_is_the_identity() {
        let px = [0.5f32, 0.2, 3.0, 1.0, 0.0, 0.0, 0.0, 0.5, -0.1, 0.4, 0.2, 1.0];
        assert_eq!(scene_tone_reference(&px, 3, 1, &ToneSliders::default(), &[], &[]), px);
        for x in [-10.0f32, -5.5, -1.0, 0.0, 0.7, 2.47, 4.0, 9.0] {
            let y = knot_outputs([0.0; 5]);
            let m = tangents(&y);
            assert!((eval(x, &y, &m) - x).abs() < 1e-5, "{x}");
        }
    }

    #[test]
    fn the_map_is_monotonic_and_smooth_for_every_combination() {
        let mut count = 0;
        for c in ENDS {
            for h in ENDS {
                for s in ENDS {
                    for w in ENDS {
                        for b in ENDS {
                            let sliders = [c, h, s, w, b];
                            let y = knot_outputs(sliders);
                            let m = tangents(&y);
                            assert!(m.iter().all(|&v| v > 0.0), "{sliders:?}: {m:?}");
                            let mut last = f32::NEG_INFINITY;
                            for k in 0..=800 {
                                let x = -12.0 + k as f32 * 0.025;
                                let v = eval(x, &y, &m);
                                assert!(v > last, "{sliders:?} not rising at {x}");
                                last = v;
                            }
                            // Continuous in value and slope at every knot.
                            for &kx in &KNOT_STOPS {
                                let e = 1e-2;
                                let (a, b0, c0) = (eval(kx - e, &y, &m), eval(kx, &y, &m), eval(kx + e, &y, &m));
                                assert!(((b0 - a) / e - (c0 - b0) / e).abs() < 0.05, "{sliders:?} kink at {kx}");
                            }
                            count += 1;
                        }
                    }
                }
            }
        }
        assert_eq!(count, 3125);
    }

    /// Every tone slider at ±150, and ±150 more from a mask, in every
    /// combination: the map still rises everywhere, has positive tangents,
    /// and stays continuous in value and slope.
    #[test]
    fn the_map_stays_monotonic_at_the_wide_ends_and_with_a_mask_on_top() {
        let mut count = 0;
        for c in WIDE {
            for h in WIDE {
                for s in WIDE {
                    for w in WIDE {
                        for b in WIDE {
                            let sliders = [c, h, s, w, b];
                            let y = knot_outputs(sliders);
                            let m = tangents(&y);
                            assert!(m.iter().all(|&v| v > 0.0 && v.is_finite()), "{sliders:?}: {m:?}");
                            let mut last = f32::NEG_INFINITY;
                            for k in 0..=400 {
                                let x = -12.0 + k as f32 * 0.05;
                                let v = eval(x, &y, &m);
                                assert!(v > last && v.is_finite(), "{sliders:?} not rising at {x}");
                                last = v;
                            }
                            for &kx in &KNOT_STOPS {
                                let e = 1e-3;
                                let (a, b0, c0) = (eval(kx - e, &y, &m), eval(kx, &y, &m), eval(kx + e, &y, &m));
                                assert!(((b0 - a) / e - (c0 - b0) / e).abs() < 0.05, "{sliders:?} kink at {kx}");
                            }
                            count += 1;
                        }
                    }
                }
            }
        }
        assert_eq!(count, 16807);
    }

    /// Within the old range nothing moved: 150 is the same straight line
    /// as 100, one and a half times as far along it.
    #[test]
    fn one_hundred_and_fifty_is_one_and_a_half_times_as_far_as_one_hundred() {
        for i in 0..5 {
            for sign in [-1.0f32, 1.0] {
                let mut at100 = [0.0f32; 5];
                at100[i] = 100.0 * sign;
                let mut at150 = at100;
                at150[i] = 150.0 * sign;
                let (y0, y1, y15) = (knot_outputs([0.0; 5]), knot_outputs(at100), knot_outputs(at150));
                if i == 0 {
                    // Contrast is a power of two of its value: the gain at 150 is the gain at 100 to the 1.5th.
                    let g = |y: &[f32; KNOTS]| y[0] / KNOT_STOPS[0];
                    assert!((g(&y15) - g(&y1).powf(1.5)).abs() < 1e-5, "contrast {sign}");
                    continue;
                }
                for k in 0..KNOTS {
                    let (d1, d15) = (y1[k] - y0[k], y15[k] - y0[k]);
                    // Equal where the forced order did not have to step in.
                    assert!((d15 - 1.5 * d1).abs() < 1e-5 || (d15.abs() > d1.abs()), "slider {i} sign {sign} knot {k}: {d1} {d15}");
                }
            }
        }
        // The parser takes ±150 and stops there; Temperature and Tint, ±200.
        let t = ToneSliders::parse(&[20.0, 150.0, -150.0, 151.0, -400.0, 150.0, 149.5, -150.0]).unwrap();
        assert_eq!((t.exposure, t.temperature, t.tint, t.contrast, t.highlights), (10.0f32.min(20.0), 150.0, -150.0, 150.0, -150.0));
        assert_eq!((t.shadows, t.whites, t.blacks), (150.0, 149.5, -150.0));
        let t = ToneSliders::parse(&[0.0, 200.0, -200.0, 200.0, 0.0, 0.0, 0.0, 0.0]).unwrap();
        assert_eq!((t.temperature, t.tint, t.contrast), (200.0, -200.0, 150.0));
        let t = ToneSliders::parse(&[0.0, 201.0, -900.0, 0.0, 0.0, 0.0, 0.0, 0.0]).unwrap();
        assert_eq!((t.temperature, t.tint), (200.0, -200.0));
        // 200 is the same curve twice as far along: the gains at 100, squared, up to the brightness kept.
        let (g1, g2) = (white_balance_gains(100.0, -100.0), white_balance_gains(200.0, -200.0));
        for (a, b) in [(0, 1), (1, 2)] {
            assert!(((g2[a] / g2[b]) - (g1[a] / g1[b]).powi(2)).abs() < 1e-4 * (g2[a] / g2[b]), "{g1:?} {g2:?}");
        }
        assert!(ToneSliders::parse(&[0.0, f32::NAN, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]).is_err());
    }

    /// Black, white, a bright white, a saturated colour and colours outside
    /// the gamut through every slider at its ends, with a mask on top: no
    /// value comes out NaN or infinite.
    #[test]
    fn no_extreme_gives_nan_or_infinity() {
        let inputs: [[f32; 3]; 7] = [[0.0; 3], [1.0; 3], [16.0; 3], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [-0.1, 0.5, 1.2], [1e-7, 0.0, 0.0]];
        for c in inputs {
            for ev in [-14.0f32, 0.0, 14.0] {
                for t in [-400.0f32, 0.0, 400.0] {
                    for tint in [-400.0f32, 400.0] {
                        for tone in WIDE {
                            let out = tone_pixel(c, ev, t, tint, [tone, -tone, tone, tone, -tone]);
                            assert!(out.iter().all(|v| v.is_finite()), "{c:?} ev {ev} t {t} tint {tint} tone {tone}: {out:?}");
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn highlights_down_brings_three_stops_above_white_below_white() {
        let at = |l: f32, h: f32| map_luminance(l, [0.0, h, 0.0, 0.0, 0.0]);
        let over = 2f32.powi(3);
        assert!(at(over, -100.0) < 1.0, "{}", at(over, -100.0));
        assert!((at(over, 0.0) - over).abs() < 1e-4);
        // Middle grey does not move, shadows barely.
        assert!((at(0.18, -100.0) - 0.18).abs() < 1e-6);
        assert!((at(0.02, -100.0) - 0.02).abs() < 1e-4);
    }

    #[test]
    fn each_slider_moves_its_range_the_right_way() {
        let at = |l: f32, s: [f32; 5]| map_luminance(l, s);
        assert!(at(0.02, [0.0, 0.0, 100.0, 0.0, 0.0]) > 0.03, "shadows lift");
        assert!(at(0.6, [0.0, 0.0, 0.0, 100.0, 0.0]) > 0.75, "whites brighten toward white");
        assert!(at(0.004, [0.0, 0.0, 0.0, 0.0, -100.0]) < 0.0015, "blacks deepen");
        assert!(at(0.6, [100.0, 0.0, 0.0, 0.0, 0.0]) > 0.6 && at(0.05, [100.0, 0.0, 0.0, 0.0, 0.0]) < 0.05, "contrast");
        assert!((at(0.18, [100.0, 0.0, 0.0, 0.0, 0.0]) - 0.18).abs() < 1e-6, "contrast pivots on grey");
    }

    #[test]
    fn grey_stays_grey_and_colour_keeps_its_ratios() {
        let tone = [60.0, -80.0, 40.0, 20.0, -30.0];
        for v in [0.001f32, 0.05, 0.18, 0.9, 6.0] {
            let g = tone_pixel([v, v, v], 0.0, 0.0, 0.0, tone);
            assert!(g[0] == g[1] && g[1] == g[2], "{g:?}");
        }
        let c = tone_pixel([0.6, 0.3, 0.1], 0.0, 0.0, 0.0, tone);
        assert!((c[0] / c[1] - 2.0).abs() < 1e-5 && (c[1] / c[2] - 3.0).abs() < 1e-4);
    }

    #[test]
    fn white_balance_keeps_white_s_luminance_and_exposure_is_in_stops() {
        let w = luma(Gamut::Rec2020);
        let g = white_balance_gains(70.0, -30.0);
        assert!((w[0] * g[0] + w[1] * g[1] + w[2] * g[2] - 1.0).abs() < 1e-6);
        assert!(g[0] > g[2]);
        let c = tone_pixel([0.1, 0.2, 0.3], 1.0, 0.0, 0.0, [0.0; 5]);
        assert_eq!(c, [0.2, 0.4, 0.6]);
    }

    #[test]
    fn an_area_adds_through_its_mask_and_nowhere_else() {
        let mut v = [0.0f32; areas::STRIDE];
        v[0] = 1.0;
        v[2] = 1.0;
        v[3] = 2.0;
        v[4] = 0.5;
        v[5] = 1.0;
        v[6] = 1.0;
        v[8] = 0.01;
        v[9] = 1.0;
        let (a, _) = areas::parse_areas(&v).unwrap();
        let img: Vec<f32> = (0..6).flat_map(|_| [0.1f32, 0.2, 0.3, 1.0]).collect();
        let out = scene_tone_reference(&img, 6, 1, &ToneSliders::default(), &a, &[]);
        // Pixel 2 (centre 2.5) is inside the radius-1 ellipse at x = 2; pixel 5 is not.
        assert!((out[8] - 0.2).abs() < 1e-6 && (out[10] - 0.6).abs() < 1e-6, "{:?}", &out[8..12]);
        assert_eq!(out[20..24], img[20..24]);
    }
}
