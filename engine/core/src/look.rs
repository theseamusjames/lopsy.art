//! Colour, colour grading and curves on rendered linear data, on the CPU:
//! the develop chain's look pass (`engine/src/gpu/shaders/develop/look.wgsl`),
//! after the tone pass and the display-encoded detail stages. Change the
//! two together.
//!
//! The image is rendered linear Rec. 2020: 1.0 is white, above it is HDR
//! headroom, and nothing here clamps. Per pixel, in this order:
//!
//! 1. **Colour, in OkLab.** OkLab is reached from linear Rec. 2020 through
//!    OkLab's own matrices composed with `working_space::conversion`
//!    ([`OkLabMatrices`]). Saturation scales chroma by `1 + s/100` (grey at
//!    −100, exactly: the colour is replaced by the grey of the same OkLab
//!    lightness; ×2.5 at its top, 150), Vibrance by `1 + v/100 · VIBRANCE_STRENGTH · (1 −
//!    smoothstep(0, VIBRANCE_CHROMA, C))`, so it moves muted colours most
//!    (−100 takes a grey's chroma to 0; its top is 150).
//!    Each area adds its built-in Saturation and its layer's Vibrance through
//!    its mask, as the tone pass does (`crate::scene_tone`). Then Color by
//!    hue: the eight bands of `crate::color_mixer` (its centres, weights
//!    and strengths, its 24-value layout), on OkLab hue, without its sRGB
//!    gamut limit and without clamping; the output step maps the gamut. Its
//!    hue and luminance run ±150 and its saturation −100..150 here
//!    ([`MIXER_LIMITS`]); the old pass keeps ±100.
//! 2. **Colour grading**, the 18 values of `setImageColorGrading` (four
//!    wheels of tint and luminance offsets, the balance exponent and the
//!    crossover width), with its ranges on rendered luminance through the
//!    display-like encoding below. A wheel's offset is added to the encoded
//!    value of each channel; a negative one eases toward 0 the way Lopsy's
//!    does, so it never pushes a channel below black. Nothing caps it at 1.
//! 3. **Curves**: four tables of [`CURVE_ENTRIES`] floats over 0..1
//!    (master, red, green, blue), read with linear interpolation, applied
//!    per channel to the encoded value (master first, then the channel's
//!    own). Below 0 and above 1 each continues along its end segment's
//!    slope. A table equal to the identity is skipped, so an identity curve
//!    is exactly the identity.
//!
//! **The display-like encoding** of steps 2 and 3 is the sRGB curve,
//! extended odd and past 1 (`working_space::srgb_encode`), on Rec. 2020
//! primaries: nothing in gamut is negative, and a curve or a wheel feels
//! as it does on an sRGB image.

use crate::areas::{self, Area};
use crate::scene_tone::SLIDER_END;
use crate::color_mixer::{band_weights, HUE_SHIFT_MAX_DEG, LUM_FULL_CHROMA, LUM_SHIFT_MAX, VALUES_LEN as MIXER_LEN};
use crate::working_space::{conversion, luma, srgb_decode, srgb_encode, Gamut};

/// Vibrance's chroma factor on a grey at ±100: ×2 and ×0.
pub const VIBRANCE_STRENGTH: f32 = 1.0;
/// OkLab chroma at and above which Vibrance does nothing.
pub const VIBRANCE_CHROMA: f32 = 0.2;
/// Entries in each curve's table.
pub const CURVE_ENTRIES: usize = 4096;
/// Floats in `setDevelopCurves`: master, red, green, blue.
pub const CURVES_LEN: usize = 4 * CURVE_ENTRIES;
/// Floats of a colour grade (`setImageColorGrading`'s layout).
pub const GRADING_LEN: usize = 18;

/// The smallest balance exponent and crossover width (grading values 16
/// and 17) a grade is given.
pub const MIN_GRADE_SHAPE: f32 = 1e-3;
/// Floats in `setDevelopLook`: vibrance, saturation, Color by hue, grading.
pub const LOOK_LEN: usize = 2 + MIXER_LEN + GRADING_LEN;

/// OkLab's two matrices (Björn Ottosson's definition, from linear sRGB),
/// row-major: linear sRGB to LMS, and cube-rooted LMS to Lab.
const OKLAB_M1: [f32; 9] = [
    0.412_221_47, 0.536_332_55, 0.051_445_995,
    0.211_903_5, 0.680_699_5, 0.107_396_96,
    0.088_302_46, 0.281_718_85, 0.629_978_7,
];
const OKLAB_M2: [f32; 9] = [
    0.210_454_26, 0.793_617_8, -0.004_072_047,
    1.977_998_5, -2.428_592_2, 0.450_593_7,
    0.025_904_037, 0.782_771_77, -0.808_675_77,
];

fn mul(a: &[f32; 9], b: &[f32; 9]) -> [f32; 9] {
    std::array::from_fn(|i| {
        let (r, c) = (i / 3, i % 3);
        (0..3).map(|k| f64::from(a[r * 3 + k]) * f64::from(b[k * 3 + c])).sum::<f64>() as f32
    })
}

fn invert(m: &[f32; 9]) -> [f32; 9] {
    let a: [f64; 9] = m.map(f64::from);
    let c0 = a[4] * a[8] - a[5] * a[7];
    let c1 = a[5] * a[6] - a[3] * a[8];
    let c2 = a[3] * a[7] - a[4] * a[6];
    let det = a[0] * c0 + a[1] * c1 + a[2] * c2;
    let inv = [
        c0, a[2] * a[7] - a[1] * a[8], a[1] * a[5] - a[2] * a[4],
        c1, a[0] * a[8] - a[2] * a[6], a[2] * a[3] - a[0] * a[5],
        c2, a[1] * a[6] - a[0] * a[7], a[0] * a[4] - a[1] * a[3],
    ];
    inv.map(|v| (v / det) as f32)
}

fn apply(m: &[f32; 9], c: [f32; 3]) -> [f32; 3] {
    crate::working_space::apply(m, c)
}

/// OkLab from and to linear Rec. 2020, row-major.
#[derive(Clone, Copy, Debug)]
pub struct OkLabMatrices {
    pub lms_from_rgb: [f32; 9],
    pub rgb_from_lms: [f32; 9],
    pub lab_from_lms: [f32; 9],
    pub lms_from_lab: [f32; 9],
}

pub fn oklab_matrices() -> OkLabMatrices {
    let lms_from_rgb = mul(&OKLAB_M1, &conversion(Gamut::Rec2020, Gamut::Srgb));
    OkLabMatrices {
        lms_from_rgb,
        rgb_from_lms: invert(&lms_from_rgb),
        lab_from_lms: OKLAB_M2,
        lms_from_lab: invert(&OKLAB_M2),
    }
}

/// Linear Rec. 2020 to OkLab. The cube root is odd, so a colour outside
/// the gamut (a negative LMS value) still converts and comes back.
pub fn to_oklab(m: &OkLabMatrices, c: [f32; 3]) -> [f32; 3] {
    apply(&m.lab_from_lms, apply(&m.lms_from_rgb, c).map(f32::cbrt))
}

pub fn from_oklab(m: &OkLabMatrices, lab: [f32; 3]) -> [f32; 3] {
    apply(&m.rgb_from_lms, apply(&m.lms_from_lab, lab).map(|v| v * v * v))
}

/// The lower end of Saturation, Vibrance and a band's saturation: −100
/// scales chroma by 0 (grey), and below it the factor would go negative,
/// which the passes hold at 0, so a lower value could only repeat grey.
pub const CHROMA_FLOOR: f32 = -100.0;

/// Each Color by hue value's range, (hue, saturation, luminance): hue and
/// luminance ±150, saturation from [`CHROMA_FLOOR`] to 150.
pub const MIXER_LIMITS: [(f32, f32); 3] = [(-SLIDER_END, SLIDER_END), (CHROMA_FLOOR, SLIDER_END), (-SLIDER_END, SLIDER_END)];

/// The look's settings: Vibrance and Saturation (−100..150), Color by hue
/// (24 values, `crate::color_mixer`'s layout) and a colour grade, `None`
/// when its wheels are all neutral.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LookSettings {
    pub vibrance: f32,
    pub saturation: f32,
    pub mixer: [f32; MIXER_LEN],
    pub grading: Option<[f32; GRADING_LEN]>,
}

impl Default for LookSettings {
    fn default() -> Self {
        Self { vibrance: 0.0, saturation: 0.0, mixer: [0.0; MIXER_LEN], grading: None }
    }
}

impl LookSettings {
    /// Vibrance, saturation, then Color by hue's 24 and the grade's 18, from
    /// `values` (`LOOK_LEN` floats). Vibrance and Saturation are clamped to
    /// −100..150, Color by hue to [`MIXER_LIMITS`].
    pub fn parse(values: &[f32]) -> Result<Self, String> {
        if values.len() != LOOK_LEN {
            return Err(format!("Develop look needs {LOOK_LEN} floats, got {}", values.len()));
        }
        Self::parse_parts(values[0], values[1], &values[2..2 + MIXER_LEN], &values[2 + MIXER_LEN..])
    }

    pub fn parse_parts(vibrance: f32, saturation: f32, mixer: &[f32], grading: &[f32]) -> Result<Self, String> {
        let all = [vibrance, saturation].into_iter().chain(mixer.iter().copied()).chain(grading.iter().copied());
        if !all.into_iter().all(f32::is_finite) {
            return Err("Develop look values must be finite".to_string());
        }
        let mut m = [0.0f32; MIXER_LEN];
        for (i, (d, s)) in m.iter_mut().zip(mixer).enumerate() {
            let (lo, hi) = MIXER_LIMITS[i % 3];
            *d = s.clamp(lo, hi);
        }
        let mut g = [0.0f32; GRADING_LEN];
        g.copy_from_slice(grading);
        // The balance exponent and the crossover width must be positive:
        // `pow(0, e)` for e ≤ 0 is undefined on a GPU, and a width of 0
        // makes the smoothstep divide 0 by 0. Either gives NaN, which the
        // blurs after the look pass then spread. The CPU reference and the
        // uniforms both read these parsed values.
        g[16] = g[16].max(MIN_GRADE_SHAPE);
        g[17] = g[17].max(MIN_GRADE_SHAPE);
        let has_grade = g[..16].iter().any(|&v| v != 0.0);
        Ok(Self {
            vibrance: vibrance.clamp(CHROMA_FLOOR, SLIDER_END),
            saturation: saturation.clamp(CHROMA_FLOOR, SLIDER_END),
            mixer: m,
            grading: has_grade.then_some(g),
        })
    }

    pub fn has_mixer(&self) -> bool {
        self.mixer.iter().any(|&v| v != 0.0)
    }

    pub fn is_identity(&self) -> bool {
        self.vibrance == 0.0 && self.saturation == 0.0 && !self.has_mixer() && self.grading.is_none()
    }
}

/// Whether a table is the identity, entry `i` equal to `i / (n − 1)`.
pub fn is_identity_curve(table: &[f32]) -> bool {
    let n = (table.len() - 1) as f32;
    table.iter().enumerate().all(|(i, &v)| (v - i as f32 / n).abs() <= 1e-6)
}

/// `values` (`CURVES_LEN` floats) as four tables, each `None` when it is
/// the identity: master, red, green, blue.
pub fn parse_curves(values: &[f32]) -> Result<[Option<Vec<f32>>; 4], String> {
    if values.len() != CURVES_LEN {
        return Err(format!("Develop curves need {CURVES_LEN} floats, got {}", values.len()));
    }
    if !values.iter().all(|v| v.is_finite()) {
        return Err("Develop curves must be finite".to_string());
    }
    Ok(std::array::from_fn(|k| {
        let t = &values[k * CURVE_ENTRIES..(k + 1) * CURVE_ENTRIES];
        (!is_identity_curve(t)).then(|| t.to_vec())
    }))
}

/// A table at `v`: linear between entries over 0..1, the end segments'
/// slopes outside.
pub fn curve_at(t: &[f32], v: f32) -> f32 {
    let n = t.len() - 1;
    let max = n as f32;
    if v <= 0.0 {
        return t[0] + (t[1] - t[0]) * max * v;
    }
    if v >= 1.0 {
        return t[n] + (t[n] - t[n - 1]) * max * (v - 1.0);
    }
    let idx = v * max;
    let lo = (idx as usize).min(n - 1);
    let frac = idx - lo as f32;
    t[lo] * (1.0 - frac) + t[lo + 1] * frac
}

fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Step 1 on one pixel with blended Saturation `sat` and Vibrance `vib`.
pub fn color_pixel(m: &OkLabMatrices, c: [f32; 3], sat: f32, vib: f32, mixer: &[f32; MIXER_LEN]) -> [f32; 3] {
    let lab = to_oklab(m, c);
    let chroma = (lab[1] * lab[1] + lab[2] * lab[2]).sqrt();
    let hue = lab[2].atan2(lab[1]).to_degrees();
    let w = band_weights(hue);
    let (mut dh, mut ds, mut dl) = (0.0f32, 0.0f32, 0.0f32);
    for i in 0..8 {
        dh += w[i] * mixer[i * 3];
        ds += w[i] * mixer[i * 3 + 1];
        dl += w[i] * mixer[i * 3 + 2];
    }
    if sat == 0.0 && vib == 0.0 && dh == 0.0 && ds == 0.0 && dl == 0.0 {
        return c;
    }
    let vib_k = 1.0 + vib / 100.0 * VIBRANCE_STRENGTH * (1.0 - smoothstep(0.0, VIBRANCE_CHROMA, chroma));
    // (100 + s) / 100 is exactly 0 at −100 however the GPU divides, so
    // Saturation −100 is exactly grey there too.
    let k = ((100.0 + sat) / 100.0).max(0.0) * vib_k.max(0.0) * ((100.0 + ds) / 100.0).max(0.0);
    let new_c = chroma * k;
    let new_l = lab[0] + dl / 100.0 * LUM_SHIFT_MAX * (chroma / LUM_FULL_CHROMA).min(1.0);
    if new_c == 0.0 {
        let g = new_l * new_l * new_l;
        return [g, g, g];
    }
    let h = (hue + dh / 100.0 * HUE_SHIFT_MAX_DEG).to_radians();
    from_oklab(m, [new_l, new_c * h.cos(), new_c * h.sin()])
}

/// Step 2 on one pixel.
pub fn grade_pixel(c: [f32; 3], g: &[f32; GRADING_LEN]) -> [f32; 3] {
    let w = luma(Gamut::Rec2020);
    let l = w[0] * c[0] + w[1] * c[1] + w[2] * c[2];
    let tone = srgb_encode(l).clamp(0.0, 1.0).powf(g[16]);
    let width = g[17];
    let sw = 1.0 - smoothstep(1.0 / 3.0 - width, 1.0 / 3.0 + width, tone);
    let hw = smoothstep(2.0 / 3.0 - width, 2.0 / 3.0 + width, tone);
    let mw = 1.0 - sw - hw;
    let grade: [f32; 4] = std::array::from_fn(|k| g[12 + k] + g[k] * sw + g[4 + k] * mw + g[8 + k] * hw);
    let o = [grade[0] + grade[3], grade[1] + grade[3], grade[2] + grade[3]];
    if o == [0.0; 3] {
        return c;
    }
    std::array::from_fn(|k| {
        let e = srgb_encode(c[k]);
        let x = e + o[k];
        let e2 = if o[k] < 0.0 {
            let f = 0.25 * -o[k];
            0.5 * (x + (x * x + 4.0 * f * f).sqrt())
        } else {
            x
        };
        srgb_decode(e2)
    })
}

/// Step 3 on one pixel, with each table `None` where it is the identity.
pub fn curves_pixel(c: [f32; 3], curves: &[Option<Vec<f32>>; 4]) -> [f32; 3] {
    if curves.iter().all(Option::is_none) {
        return c;
    }
    std::array::from_fn(|k| {
        let mut e = srgb_encode(c[k]);
        if let Some(master) = &curves[0] {
            e = curve_at(master, e);
        }
        if let Some(own) = &curves[k + 1] {
            e = curve_at(own, e);
        }
        srgb_decode(e)
    })
}

/// What the look pass is given: the settings, the curves, and each area's
/// built-in Saturation (from its 16 floats) and its layer's Vibrance.
pub struct LookInputs<'a> {
    pub settings: LookSettings,
    pub curves: &'a [Option<Vec<f32>>; 4],
    pub areas: &'a [Area],
    pub area_vibrance: &'a [f32],
}

/// The look pass over straight-alpha RGBA f32 (`w`×`h`, rendered linear
/// Rec. 2020), alpha untouched, nothing clamped.
pub fn look_reference(rgba: &[f32], w: usize, h: usize, inputs: &LookInputs) -> Vec<f32> {
    look_reference_at(rgba, w, h, inputs, None)
}

/// `look_reference` for a document that is `region` of a larger picture:
/// the masks at each pixel's place in the whole (`tile::whole_point`).
pub fn look_reference_at(rgba: &[f32], w: usize, h: usize, inputs: &LookInputs, region: Option<crate::tile::Region>) -> Vec<f32> {
    let m = oklab_matrices();
    let s = &inputs.settings;
    let mut out = rgba.to_vec();
    for y in 0..h {
        for x in 0..w {
            let i = (y * w + x) * 4;
            let (mut sat, mut vib) = (s.saturation, s.vibrance);
            for (k, a) in inputs.areas.iter().enumerate() {
                let (px, py) = crate::tile::whole_point(region, x, y);
                let mk = areas::mask(a, px, py);
                if mk > 0.0 {
                    sat += mk * a.saturation;
                    vib += mk * inputs.area_vibrance.get(k).copied().unwrap_or(0.0);
                }
            }
            let mut c = color_pixel(&m, [out[i], out[i + 1], out[i + 2]], sat, vib, &s.mixer);
            if let Some(g) = &s.grading {
                c = grade_pixel(c, g);
            }
            c = curves_pixel(c, inputs.curves);
            out[i..i + 3].copy_from_slice(&c);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const NO_CURVES: [Option<Vec<f32>>; 4] = [None, None, None, None];

    fn run(px: &[f32], settings: LookSettings, curves: &[Option<Vec<f32>>; 4]) -> Vec<f32> {
        look_reference(px, px.len() / 4, 1, &LookInputs { settings, curves, areas: &[], area_vibrance: &[] })
    }

    fn picture() -> Vec<f32> {
        vec![0.5, 0.2, 0.1, 1.0, 2.5, 1.2, 0.3, 0.5, 0.0, 0.0, 0.0, 1.0, 0.18, 0.18, 0.18, 1.0, -0.02, 0.3, 0.6, 1.0]
    }

    #[test]
    fn oklab_round_trips_and_white_is_l_one() {
        let m = oklab_matrices();
        let w = to_oklab(&m, [1.0, 1.0, 1.0]);
        assert!((w[0] - 1.0).abs() < 1e-4 && w[1].abs() < 1e-4 && w[2].abs() < 1e-4, "{w:?}");
        for c in [[0.3f32, 0.6, 0.1], [2.0, 0.1, 0.05], [-0.05, 0.2, 0.9]] {
            let back = from_oklab(&m, to_oklab(&m, c));
            assert!(c.iter().zip(back).all(|(a, b)| (a - b).abs() < 1e-4), "{c:?} {back:?}");
        }
    }

    #[test]
    fn zero_is_the_identity() {
        let px = picture();
        assert_eq!(run(&px, LookSettings::default(), &NO_CURVES), px);
        let identity: Vec<f32> = (0..CURVES_LEN).map(|i| (i % CURVE_ENTRIES) as f32 / (CURVE_ENTRIES - 1) as f32).collect();
        assert!(parse_curves(&identity).unwrap().iter().all(Option::is_none));
        let mut values = [0.0f32; LOOK_LEN];
        values[LOOK_LEN - 2] = 1.0;
        values[LOOK_LEN - 1] = 0.2;
        assert!(LookSettings::parse(&values).unwrap().is_identity(), "a neutral grade is off");
    }

    #[test]
    fn saturation_down_is_grey_and_up_is_unclamped() {
        let px = picture();
        let grey = run(&px, LookSettings { saturation: -100.0, ..Default::default() }, &NO_CURVES);
        for p in grey.chunks(4) {
            assert!(p[0] == p[1] && p[1] == p[2], "{p:?}");
        }
        let m = oklab_matrices();
        let l_in = to_oklab(&m, [0.5, 0.2, 0.1])[0];
        assert!((to_oklab(&m, [grey[0], grey[1], grey[2]])[0] - l_in).abs() < 1e-4);
        let more = run(&px, LookSettings { saturation: 100.0, ..Default::default() }, &NO_CURVES);
        assert!(more[4] > 2.5, "the bright orange is not clamped: {:?}", &more[4..8]);
    }

    /// The widened ends are taken, the real ones still hold, and 150 keeps
    /// going the way 100 went.
    #[test]
    fn the_wide_ends_are_taken_and_saturation_still_stops_at_grey() {
        let mut values = [0.0f32; LOOK_LEN];
        values[0] = 400.0;
        values[1] = -400.0;
        for (k, v) in values[2..2 + MIXER_LEN].iter_mut().enumerate() {
            *v = if k % 2 == 0 { 400.0 } else { -400.0 };
        }
        let s = LookSettings::parse(&values).unwrap();
        assert_eq!((s.vibrance, s.saturation), (150.0, -100.0));
        assert_eq!(&s.mixer[..6], &[150.0, -100.0, 150.0, -150.0, 150.0, -150.0]);
        let m = oklab_matrices();
        let chroma = |c: [f32; 3]| {
            let l = to_oklab(&m, c);
            (l[1] * l[1] + l[2] * l[2]).sqrt()
        };
        let c = [0.5f32, 0.2, 0.1];
        let at = |sat: f32| chroma(color_pixel(&m, c, sat, 0.0, &[0.0; MIXER_LEN]));
        assert!((at(150.0) / chroma(c) - 2.5).abs() < 1e-3 && at(150.0) > at(100.0));
        let muted = [0.3f32, 0.27, 0.25];
        assert!(chroma(color_pixel(&m, muted, 0.0, 150.0, &[0.0; MIXER_LEN])) > chroma(color_pixel(&m, muted, 0.0, 100.0, &[0.0; MIXER_LEN])));
    }

    /// Black, white, bright and out-of-gamut colours through every look
    /// control at its ends, with a mask's Saturation and Vibrance added on
    /// top: no NaN or infinity.
    #[test]
    fn no_extreme_gives_nan_or_infinity() {
        let m = oklab_matrices();
        let inputs: [[f32; 3]; 7] = [[0.0; 3], [1.0; 3], [8.0; 3], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [-0.05, 0.4, 1.3], [0.02, 0.0, 0.05]];
        for c in inputs {
            for sat in [-200.0f32, -100.0, 150.0, 300.0] {
                for vib in [-200.0f32, -100.0, 150.0, 300.0] {
                    for v in [-150.0f32, -100.0, 150.0] {
                        let mixer: [f32; MIXER_LEN] = std::array::from_fn(|k| if k % 3 == 1 { v.max(-100.0) } else { v });
                        let mut g = [0.0f32; GRADING_LEN];
                        g[0] = 0.6;
                        g[7] = -0.75;
                        g[11] = 0.75;
                        g[16] = 8.0;
                        g[17] = 1.0 / 3.0;
                        let out = grade_pixel(color_pixel(&m, c, sat, vib, &mixer), &g);
                        assert!(out.iter().all(|x| x.is_finite()), "{c:?} sat {sat} vib {vib} mixer {v}: {out:?}");
                    }
                }
            }
        }
    }

    #[test]
    fn vibrance_moves_muted_colours_more() {
        let m = oklab_matrices();
        let chroma = |c: [f32; 3]| {
            let l = to_oklab(&m, c);
            (l[1] * l[1] + l[2] * l[2]).sqrt()
        };
        let muted = [0.3f32, 0.27, 0.25];
        let vivid = [0.6f32, 0.05, 0.02];
        let gain = |c: [f32; 3]| chroma(color_pixel(&m, c, 0.0, 100.0, &[0.0; MIXER_LEN])) / chroma(c);
        assert!(gain(muted) > 1.8 && gain(vivid) < gain(muted), "{} {}", gain(muted), gain(vivid));
    }

    #[test]
    fn curves_follow_the_table_and_continue_past_its_ends() {
        let lift: Vec<f32> = (0..CURVE_ENTRIES).map(|i| 0.1 + 0.8 * i as f32 / (CURVE_ENTRIES - 1) as f32).collect();
        let curves = [Some(lift), None, None, None];
        let out = curves_pixel([0.0, 1.0, 4.0], &curves);
        assert!((srgb_encode(out[0]) - 0.1).abs() < 1e-5);
        assert!((srgb_encode(out[1]) - 0.9).abs() < 1e-5);
        let e4 = srgb_encode(4.0);
        assert!((srgb_encode(out[2]) - (0.9 + 0.8 * (e4 - 1.0))).abs() < 1e-4);
    }

    /// A balance exponent of 0 or below and a width of 0 or below are
    /// raised to `MIN_GRADE_SHAPE` when parsed, for the photo's look and an
    /// area's, and the grade then gives finite values.
    #[test]
    fn a_zero_exponent_or_width_grades_to_finite_values() {
        for (e, w) in [(0.0, 0.2), (-1.0, 0.2), (1.0, 0.0), (0.0, 0.0), (1.0, -0.5)] {
            let mut values = [0.0f32; LOOK_LEN];
            let grading = &mut values[2 + MIXER_LEN..];
            grading[0] = 0.1;
            grading[10] = -0.05;
            grading[16] = e;
            grading[17] = w;
            let grading = grading.to_vec();
            for s in [LookSettings::parse(&values).unwrap(), LookSettings::parse_parts(0.0, 0.0, &[0.0; MIXER_LEN], &grading).unwrap()] {
                let g = s.grading.expect("a grade");
                assert_eq!((g[16], g[17]), (e.max(MIN_GRADE_SHAPE), w.max(MIN_GRADE_SHAPE)));
                for c in [[0.0, 0.0, 0.0], [0.01, 0.02, 0.03], [0.18, 0.18, 0.18], [1.0, 1.0, 1.0], [4.0, 0.5, 0.1]] {
                    let out = grade_pixel(c, &g);
                    assert!(out.iter().all(|v| v.is_finite()), "exponent {e}, width {w}: {c:?} gave {out:?}");
                }
            }
        }
    }

    #[test]
    fn grading_tints_shadows_without_touching_highlights() {
        let mut g = [0.0f32; GRADING_LEN];
        g[0] = 0.1;
        g[2] = -0.1;
        g[16] = 1.0;
        g[17] = 0.1;
        let dark = grade_pixel([0.01, 0.01, 0.01], &g);
        assert!(dark[0] > 0.01 && dark[2] < 0.01 && dark[2] >= 0.0, "{dark:?}");
        assert_eq!(grade_pixel([0.9, 0.9, 0.9], &g), [0.9, 0.9, 0.9]);
        assert_eq!(grade_pixel([3.0, 2.0, 2.0], &g), [3.0, 2.0, 2.0]);
    }
}
