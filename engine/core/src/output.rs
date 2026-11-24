//! The develop chain's output step, on the CPU: rendered linear Rec. 2020
//! (`crate::working_space`) to what a screen or a file holds. The GPU side
//! is `engine/src/gpu/shaders/develop/output.wgsl`; change the two together.
//!
//! In order:
//!
//! 1. **Highlight roll-off.** Luminance above `knee` is brought under
//!    `peak` by scaling the three channels together, so hue is kept:
//!    `knee + e / (1 + e / (peak − knee))` with `e = L − knee`, which leaves
//!    the slope at 1 where it starts and never reaches `peak`. An SDR target
//!    has `knee = peak = 1`: luminance above white becomes white and nothing
//!    below it moves, because the tone step's curve already shoulders into
//!    white. An HDR target (a later phase) sets `peak` to its headroom and
//!    `knee` below it.
//! 2. **Gamut mapping**, in the target's linear RGB, toward the neutral
//!    axis, in two parts.
//!    - *Below 0* (a colour more saturated than the target's primaries):
//!      each channel's distance from the largest one, `d = (max − c) / max`,
//!      is 0 for the largest channel, 1 for a channel at 0 and above 1 for a
//!      negative one. A distance above `gamut_threshold` is compressed to
//!      `t + x / (1 + x / (1 − t))`, `x = d − t`, which has slope 1 at the
//!      threshold and approaches 1 (the boundary) without reaching it. This
//!      is the method of ACES' reference gamut compression, without its
//!      limit, so a saturation ramp never meets a hard edge. It keeps the
//!      largest channel, so a colour that is out of gamut because a channel
//!      went negative keeps its brightness; mapping at constant luminance
//!      instead darkened such colours badly, since their negative channel
//!      had pulled their luminance down.
//!    - *Above `peak`* (a bright colour whose largest channel is over the
//!      top though its luminance is not): `u = (max − Y) / (peak − Y)`,
//!      how far the largest channel is toward the top from the colour's own
//!      grey, is compressed the same way, which gives the largest channel's
//!      new value; the colour is then moved along the line toward the grey
//!      at `a = Y · Y / peak` until its largest channel has that value.
//!      Every point of that line has the colour's hue, so a bright orange
//!      stays orange where a clipped channel turned it yellow. The anchor
//!      slides with luminance: a darker colour keeps most of its saturation
//!      and loses brightness, one near white keeps its brightness and turns
//!      pale, and at `Y = peak` the anchor is the colour's own grey, so
//!      brightening a colour into white is continuous and its luminance
//!      never falls. (Aiming always at the colour's own luminance made
//!      bright skies and lamps pale; always at black, dark; always at half
//!      of it, a colour got darker as it neared white and then jumped.) A
//!      grey has `u` below 1 for any luminance under `peak`, so it is never
//!      moved; a colour whose luminance is at or above `peak` is white.
//!
//!    A threshold of 1 compresses nothing: what is outside is moved onto
//!    the boundary along the same lines (a negative channel to 0). That is
//!    used when the image cannot hold a colour outside the target to begin
//!    with (an sRGB photo to an sRGB file), so an unedited photo comes back
//!    as it went in. A colour with no positive channel is black.
//! 3. **The transfer curve**: the sRGB curve for sRGB and Display P3; for
//!    Rec. 2020, [`REC2020_TRANSFER`] (the BT.709 / BT.2020 OETF its ICC
//!    profile declares).
//! 4. **Dither**, for 8-bit targets only: one value per pixel from a hash
//!    of its position (`finish::hash`), uniform in ±`dither` / 2 of an
//!    encoded step, the same on every channel so a grey stays grey. It does
//!    not change from frame to frame.

use crate::working_space::{apply, conversion, luma, srgb_encode, Gamut};

/// What a pixel is encoded with after the gamut mapping.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Transfer {
    /// The sRGB curve.
    Srgb,
    /// A pure power, `v^(1/γ)`.
    Gamma(f32),
    /// The BT.709 / BT.2020 OETF: `4.5·v` below β, `α·v^0.45 − (α − 1)`
    /// above ([`bt709_oetf`]).
    Bt709,
}

/// The transfer curve of a Rec. 2020 output: the curve its ICC profile
/// declares (the BT.709 / BT.2020 OETF). One constant, so the export's
/// profile and the pixels can be kept in agreement by changing it here.
pub const REC2020_TRANSFER: Transfer = Transfer::Bt709;

/// BT.2020's α and β, at the precision BT.2020 gives for 12-bit systems.
pub const BT709_ALPHA: f32 = 1.099_296_8;
pub const BT709_BETA: f32 = 0.018_053_97;

/// The BT.709 / BT.2020 OETF on `v` (0 or more).
pub fn bt709_oetf(v: f32) -> f32 {
    if v < BT709_BETA {
        4.5 * v
    } else {
        BT709_ALPHA * v.powf(0.45) - (BT709_ALPHA - 1.0)
    }
}

/// Where gamut compression starts, as a fraction of the way to the
/// target's boundary, when the image may hold colours outside the target.
/// Colours outside are brought into the last 5% before the boundary. A
/// wider zone (ACES uses about 0.8) also pales the saturated colours inside
/// it, which a RAW photo has plenty of: at 0.8 the median golden-render
/// cell of a saturated scene moved by 2% against the old clipping chain, at
/// 0.95 by under 1%.
pub const GAMUT_THRESHOLD: f32 = 0.95;

/// The dither of an 8-bit target: one 8-bit step from end to end.
pub const DITHER_8BIT: f32 = 1.0 / 255.0;

/// The seed of the dither's hash.
pub const DITHER_SEED: u32 = 0x5d17;

/// A space the output step renders for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OutputTarget {
    Srgb,
    DisplayP3,
    Rec2020,
}

impl OutputTarget {
    /// The code the exports take: 0 sRGB, 1 Display P3, 2 Rec. 2020.
    pub fn from_code(code: u8) -> Result<Self, String> {
        match code {
            0 => Ok(Self::Srgb),
            1 => Ok(Self::DisplayP3),
            2 => Ok(Self::Rec2020),
            _ => Err(format!("Colour space {code} is not 0 (sRGB), 1 (Display P3) or 2 (Rec. 2020)")),
        }
    }

    pub const fn gamut(self) -> Gamut {
        match self {
            Self::Srgb => Gamut::Srgb,
            Self::DisplayP3 => Gamut::DisplayP3,
            Self::Rec2020 => Gamut::Rec2020,
        }
    }

    pub const fn transfer(self) -> Transfer {
        match self {
            Self::Srgb | Self::DisplayP3 => Transfer::Srgb,
            Self::Rec2020 => REC2020_TRANSFER,
        }
    }
}

/// Everything the output step needs.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OutputSettings {
    pub target: OutputTarget,
    /// The brightest value the target holds, in rendered units: 1 (white)
    /// for SDR.
    pub peak: f32,
    /// Luminance where the roll-off starts; `peak` for none below white.
    pub knee: f32,
    /// See the module notes, step 2.
    pub gamut_threshold: f32,
    /// Dither from end to end, in encoded units; 0 for none.
    pub dither: f32,
}

impl OutputSettings {
    /// An SDR output to `target` of an image whose colours can lie anywhere
    /// in `source`: compression only when `source` reaches outside
    /// `target`. `dither` for an 8-bit target.
    pub fn sdr(target: OutputTarget, source: Gamut, dither: bool) -> Self {
        OutputSettings {
            target,
            peak: 1.0,
            knee: 1.0,
            gamut_threshold: if source.is_inside(target.gamut()) { 1.0 } else { GAMUT_THRESHOLD },
            dither: if dither { DITHER_8BIT } else { 0.0 },
        }
    }
}

/// Step 1's curve on luminance.
pub fn rolloff(l: f32, knee: f32, peak: f32) -> f32 {
    if l <= knee {
        return l;
    }
    if knee >= peak {
        return peak;
    }
    let e = l - knee;
    knee + e / (1.0 + e / (peak - knee))
}

/// Step 2's curve on `u`, the distance toward the boundary.
pub fn compress(u: f32, threshold: f32) -> f32 {
    if threshold >= 1.0 {
        return u.min(1.0);
    }
    if u <= threshold {
        return u;
    }
    let x = u - threshold;
    threshold + x / (1.0 + x / (1.0 - threshold))
}

/// Snaps a channel this close under `peak` to it: a value the maths meant to
/// be the peak (white after the roll-off) can come out a rounding error
/// below it, which a GPU that rounds toward zero would then store a whole
/// half-float step lower.
const PEAK_SNAP: f32 = 1e-5;

/// Step 2 on one colour in the target's linear RGB, luminance weights
/// `w`: see the module notes.
pub fn gamut_map(c: [f32; 3], w: [f32; 3], peak: f32, threshold: f32) -> [f32; 3] {
    let ach = c[0].max(c[1]).max(c[2]);
    if ach <= 0.0 {
        return [0.0; 3];
    }
    let start = threshold.min(1.0);
    let mut t = c.map(|v| {
        let d = (ach - v) / ach;
        if d > start { ach - compress(d, threshold) * ach } else { v }
    });
    let y = w[0] * t[0] + w[1] * t[1] + w[2] * t[2];
    if y >= peak {
        return [peak; 3];
    }
    let u = (ach - y) / (peak - y);
    if u > start {
        // The largest channel's new value, then the move toward the anchor
        // that gives it.
        let top = y + compress(u, threshold) * (peak - y);
        let a = y * (y / peak);
        let k = (top - a) / (ach - a);
        t = t.map(|v| a + k * (v - a));
    }
    t.map(|v| if v > peak * (1.0 - PEAK_SNAP) { peak } else { v.max(0.0) })
}

/// One pixel of rendered linear Rec. 2020 through steps 1–3.
pub fn output_rgb(c: [f32; 3], s: &OutputSettings) -> [f32; 3] {
    let w = luma(Gamut::Rec2020);
    let y = w[0] * c[0] + w[1] * c[1] + w[2] * c[2];
    let mut c = c;
    if y > s.knee {
        let rolled = rolloff(y, s.knee, s.peak);
        c = c.map(|v| v * (rolled / y));
    }
    let t = apply(&conversion(Gamut::Rec2020, s.target.gamut()), c);
    let t = gamut_map(t, luma(s.target.gamut()), s.peak, s.gamut_threshold);
    t.map(|v| encode(v, s.target.transfer()))
}

/// `v` (0 or more) through `transfer`.
pub fn encode(v: f32, transfer: Transfer) -> f32 {
    match transfer {
        Transfer::Srgb => srgb_encode(v),
        Transfer::Gamma(g) => v.powf(1.0 / g),
        Transfer::Bt709 => bt709_oetf(v),
    }
}

/// The inverse of [`encode`].
pub fn decode(e: f32, transfer: Transfer) -> f32 {
    match transfer {
        Transfer::Srgb => crate::working_space::srgb_decode(e),
        Transfer::Gamma(g) => e.max(0.0).powf(g),
        Transfer::Bt709 => {
            if e < 4.5 * BT709_BETA {
                e / 4.5
            } else {
                ((e + BT709_ALPHA - 1.0) / BT709_ALPHA).powf(1.0 / 0.45)
            }
        }
    }
}

/// The dither added at pixel (`x`, `y`) with amplitude `dither`.
pub fn dither_at(x: u32, y: u32, dither: f32) -> f32 {
    (crate::finish::hash(x, y, DITHER_SEED) - 0.5) * dither
}

/// The output step on the CPU over a `width`-wide straight-alpha RGBA image
/// of rendered linear Rec. 2020: encoded values for the target, alpha
/// untouched.
pub fn output_reference(rgba: &[f32], width: u32, s: &OutputSettings) -> Vec<f32> {
    let mut out = Vec::with_capacity(rgba.len());
    for (i, px) in rgba.chunks_exact(4).enumerate() {
        let e = output_rgb([px[0], px[1], px[2]], s);
        let n = if s.dither > 0.0 { dither_at(i as u32 % width, i as u32 / width, s.dither) } else { 0.0 };
        out.extend_from_slice(&[e[0] + n, e[1] + n, e[2] + n, px[3]]);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::working_space::{srgb_decode, SourceEncoding};

    fn sdr(target: OutputTarget) -> OutputSettings {
        OutputSettings::sdr(target, Gamut::Rec2020, false)
    }

    #[test]
    fn an_srgb_photo_comes_back_out_as_it_went_in() {
        let s = OutputSettings::sdr(OutputTarget::Srgb, Gamut::Srgb, false);
        assert_eq!(s.gamut_threshold, 1.0);
        for px in [[1.0f32, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0], [1.0, 1.0, 1.0], [0.2, 0.5, 0.9], [0.0, 0.0, 0.0]] {
            let linear = crate::working_space::input_reference(&[px[0], px[1], px[2], 1.0], SourceEncoding::Srgb);
            let out = output_rgb([linear[0], linear[1], linear[2]], &s);
            for (o, p) in out.iter().zip(px) {
                assert!((o - p).abs() < 1e-4, "{px:?} came out {out:?}");
            }
        }
    }

    #[test]
    fn above_white_becomes_white_and_below_white_is_untouched() {
        let s = sdr(OutputTarget::Srgb);
        let white = output_rgb([3.0, 3.0, 3.0], &s);
        assert!(white.iter().all(|v| (v - 1.0).abs() < 1e-5), "{white:?}");
        let grey = output_rgb([0.18, 0.18, 0.18], &s);
        assert!(grey.iter().all(|v| (v - srgb_encode(0.18)).abs() < 1e-5));
        assert_eq!(rolloff(0.7, 0.8, 4.0), 0.7);
        assert!(rolloff(100.0, 0.8, 4.0) < 4.0 && rolloff(1.0, 0.8, 4.0) > 0.98);
    }

    #[test]
    fn colours_well_inside_are_untouched_and_outside_come_inside() {
        let s = sdr(OutputTarget::Srgb);
        let to_2020 = conversion(Gamut::Srgb, Gamut::Rec2020);
        let muted = [0.4f32, 0.3, 0.25];
        let out = output_rgb(apply(&to_2020, muted), &s);
        assert!(out.iter().zip(muted).all(|(o, m)| (srgb_decode(*o) - m).abs() < 1e-5), "{out:?}");
        // Rec. 2020 green is far outside sRGB.
        let green = output_rgb([0.0, 0.5, 0.0], &s);
        assert!(green.iter().all(|v| (0.0..=1.0).contains(v)) && green[1] > green[0] && green[1] > green[2], "{green:?}");
        assert!(green[0] > 0.0 && green[2] > 0.0, "compressed, not clipped to a channel at 0: {green:?}");
    }

    #[test]
    fn brightening_a_colour_never_darkens_its_output() {
        for target in [OutputTarget::Srgb, OutputTarget::DisplayP3, OutputTarget::Rec2020] {
            let s = sdr(target);
            let wt = luma(target.gamut());
            for colour in [[1.3f32, 0.9, 0.6], [0.2, 1.0, 0.1], [0.1, 0.2, 1.2], [1.0, 0.0, 0.8], [0.0, 0.5, 0.0], [0.6, 0.6, 0.6]] {
                let mut last = -1.0f32;
                for i in 0..2000 {
                    let k = i as f32 / 1999.0 * 4.0;
                    let out = output_rgb(colour.map(|v| v * k), &s);
                    let lin = out.map(|v| decode(v, target.transfer()));
                    let y: f32 = (0..3).map(|c| wt[c] * lin[c]).sum();
                    assert!(y >= last - 1e-4, "{target:?} {colour:?} at {k}: {last} -> {y}");
                    last = y;
                }
            }
        }
    }

    #[test]
    fn compression_is_continuous_and_monotonic() {
        let mut last = 0.0;
        for i in 0..400 {
            let u = i as f32 * 0.01;
            let v = compress(u, GAMUT_THRESHOLD);
            assert!(v >= last && v < 1.0);
            last = v;
        }
        assert_eq!(compress(0.5, GAMUT_THRESHOLD), 0.5);
        assert_eq!(compress(1.5, 1.0), 1.0);
    }

    #[test]
    fn rec2020_uses_its_own_curve_and_dither_keeps_grey_grey() {
        let s = sdr(OutputTarget::Rec2020);
        let out = output_rgb([0.18, 0.18, 0.18], &s);
        assert!((out[0] - (1.099_296_8 * 0.18f32.powf(0.45) - 0.099_296_8)).abs() < 1e-5);
        // The two pieces of the OETF meet at β.
        assert!((bt709_oetf(BT709_BETA - 1e-7) - bt709_oetf(BT709_BETA)).abs() < 1e-5);
        let dithered = OutputSettings { dither: DITHER_8BIT, ..s };
        let img = output_reference(&[0.3, 0.3, 0.3, 1.0, 0.3, 0.3, 0.3, 1.0], 2, &dithered);
        assert_eq!(img[0], img[1]);
        assert_eq!(img[1], img[2]);
        assert!((img[0] - out[0]).abs() > 0.0 || (img[4] - out[0]).abs() > 0.0);
        assert!(img.iter().zip(output_reference(&[0.3, 0.3, 0.3, 1.0, 0.3, 0.3, 0.3, 1.0], 2, &s)).all(|(a, b)| (a - b).abs() <= DITHER_8BIT / 2.0 + 1e-6));
    }
}
