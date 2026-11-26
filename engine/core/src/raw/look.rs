//! What a file without a maker's film look opens with: the base curve and
//! saturation of its develop defaults and, for a DNG, whether its opening
//! exposure is matched to the camera's own preview. The default
//! ([`OpeningLook::default`]) is the Standard look: the gentle Standard
//! curve (`raf::standard_curve::STANDARD`), [`STANDARD_SATURATION`], and a
//! ProRAW's exposure matched to its preview (`dng::preview`).
//!
//! **Saturation.** The tone step mixes each channel away from luminance by
//! this factor (`tone::tone_reference`, as a RAF film look does with its
//! own factor): greys stay grey, luminance is kept, and the curve, applied
//! to luminance with the ratios kept, leaves Oklab saturation (C / L)
//! exactly as it finds it. Camera pictures are rendered more colourful
//! than a colorimetric conversion on purpose; measured against the
//! camera-made previews of the samples with measured colour (two Sony
//! bodies and a ProRAW, `tests/saturation_gap.rs`), our colorimetric
//! rendering holds 0.81 to 0.95 of their chroma, and the factor that would
//! meet each is 1.05 to 1.21. [`STANDARD_SATURATION`] is one value for
//! every camera between them, chosen so that none of the three ends more
//! than a tenth from its preview either way; it sits at the soft end of
//! the RAF film looks' factors (1.10 to 1.40), since Standard is the
//! starting point to grade from, not a vivid look. `OpeningLook::parse("neutral")` is the
//! look these formats opened with before: the `NEUTRAL` curve and every
//! DNG at its BaselineExposure. RAF never reads it: its defaults are the
//! film simulation's.
//!
//! [`prepare_with`](super::prepare_with) takes one; [`prepare`](super::prepare)
//! uses the default. The ARW exposure match always runs through whichever
//! curve is chosen (`arw::exposure::match_develop_exposure_with`), so a
//! curve that lifts the midtones opens at a lower exposure rather than
//! counting the lift twice.

use crate::raf::base_curves;
use crate::raf::standard_curve::{StandardCurve, CANDIDATES, STANDARD};

/// The base curve a DNG or ARW opens with.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum OpeningCurve {
    /// `base_curves::NEUTRAL`: near-linear, the look before Standard.
    Neutral,
    Standard(StandardCurve),
}

impl Default for OpeningCurve {
    fn default() -> Self {
        OpeningCurve::Standard(STANDARD)
    }
}

impl OpeningCurve {
    /// The table the develop settings carry.
    pub fn lut(&self) -> Vec<f32> {
        match self {
            OpeningCurve::Neutral => base_curves::curve_lut(&base_curves::NEUTRAL).to_vec(),
            OpeningCurve::Standard(c) => c.lut(),
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            OpeningCurve::Neutral => "Neutral",
            OpeningCurve::Standard(c) => c.name,
        }
    }
}

/// The Standard look's saturation: the tone step's mix away from
/// luminance (see the module notes).
pub const STANDARD_SATURATION: f32 = 1.15;

/// The opening look of a file without a film look.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OpeningLook {
    pub curve: OpeningCurve,
    /// The develop defaults' saturation: 1 adds none.
    pub saturation: f32,
    /// Match a DNG's opening exposure to its preview when the preview was
    /// made by the camera and the file relies on a gain map the develop
    /// chain does not apply (`dng::preview`); otherwise BaselineExposure.
    pub dng_preview_exposure: bool,
}

impl Default for OpeningLook {
    fn default() -> Self {
        OpeningLook { curve: OpeningCurve::default(), saturation: STANDARD_SATURATION, dng_preview_exposure: true }
    }
}

impl OpeningLook {
    /// A look by name: `neutral` (the near-linear curve, saturation 1), `a`,
    /// `b` or `c` (the Standard candidates, gentle to punchy, with the
    /// Standard saturation), each optionally followed by `+preview` for
    /// the DNG preview match. `None` for anything else.
    pub fn parse(name: &str) -> Option<Self> {
        let (curve, preview) = match name.strip_suffix("+preview") {
            Some(c) => (c, true),
            None => (name, false),
        };
        let curve = match curve {
            "neutral" => OpeningCurve::Neutral,
            "a" => OpeningCurve::Standard(CANDIDATES[0]),
            "b" => OpeningCurve::Standard(CANDIDATES[1]),
            "c" => OpeningCurve::Standard(CANDIDATES[2]),
            _ => return None,
        };
        let saturation = if curve == OpeningCurve::Neutral { 1.0 } else { STANDARD_SATURATION };
        Some(OpeningLook { curve, saturation, dng_preview_exposure: preview })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_is_the_standard_look_with_the_preview_match() {
        let d = OpeningLook::default();
        assert_eq!(d.curve, OpeningCurve::Standard(STANDARD));
        assert!(d.dng_preview_exposure);
        assert_eq!(d.saturation, STANDARD_SATURATION);
        assert_eq!(OpeningLook::parse("a+preview"), Some(d));
        // The look before: the neutral curve, no added saturation, every
        // DNG at its baseline.
        let before = OpeningLook::parse("neutral").unwrap();
        assert!(!before.dng_preview_exposure);
        assert_eq!(before.saturation, 1.0);
        assert_eq!(before.curve.lut(), base_curves::curve_lut(&base_curves::NEUTRAL).to_vec());
    }

    #[test]
    fn the_standard_saturation_keeps_greys_and_luminance() {
        use crate::tone::{tone_reference, ToneSettings};
        use crate::working_space::{luma, Gamut};
        let settings = ToneSettings { saturation: STANDARD_SATURATION, highlight_desaturation: false, curve: None };
        let w = luma(Gamut::Rec2020);
        let px = [0.18f32, 0.18, 0.18, 1.0, 0.4, 0.2, 0.1, 1.0, 0.05, 0.3, 0.6, 1.0];
        let out = tone_reference(&px, &settings);
        assert!(out[..3].iter().all(|&v| (v - 0.18).abs() < 1e-6), "a grey moved: {:?}", &out[..3]);
        for i in [4, 8] {
            let y = |p: &[f32]| w[0] * p[0] + w[1] * p[1] + w[2] * p[2];
            assert!((y(&out[i..]) - y(&px[i..])).abs() < 1e-6);
            // Further from grey than it was, by the factor.
            let spread = |p: &[f32]| (p[0] - y(p)).abs() + (p[2] - y(p)).abs();
            assert!((spread(&out[i..]) / spread(&px[i..]) - STANDARD_SATURATION).abs() < 1e-4);
        }
    }

    #[test]
    fn looks_parse_by_name() {
        assert_eq!(OpeningLook::parse("b+preview"), Some(OpeningLook { curve: OpeningCurve::Standard(CANDIDATES[1]), saturation: STANDARD_SATURATION, dng_preview_exposure: true }));
        assert_eq!(OpeningLook::parse("c").map(|l| l.curve), Some(OpeningCurve::Standard(CANDIDATES[2])));
        assert_eq!(OpeningLook::parse("provia"), None);
    }
}
