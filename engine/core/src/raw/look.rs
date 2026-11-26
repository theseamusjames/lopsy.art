//! What a file without a maker's film look opens with: the base curve of
//! its develop defaults and, for a DNG, whether its opening exposure is
//! matched to the camera's own preview. The default
//! ([`OpeningLook::default`]) is the Standard look: the gentle Standard
//! curve (`raf::standard_curve::STANDARD`), and a ProRAW's exposure matched
//! to its preview (`dng::preview`). `OpeningLook::parse("neutral")` is the
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

/// The opening look of a file without a film look.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OpeningLook {
    pub curve: OpeningCurve,
    /// Match a DNG's opening exposure to its preview when the preview was
    /// made by the camera and the file relies on a gain map the develop
    /// chain does not apply (`dng::preview`); otherwise BaselineExposure.
    pub dng_preview_exposure: bool,
}

impl Default for OpeningLook {
    fn default() -> Self {
        OpeningLook { curve: OpeningCurve::default(), dng_preview_exposure: true }
    }
}

impl OpeningLook {
    /// A look by name: `neutral`, `a`, `b` or `c` (the Standard
    /// candidates, gentle to punchy), each optionally followed by
    /// `+preview` for the DNG preview match. `None` for anything else.
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
        Some(OpeningLook { curve, dng_preview_exposure: preview })
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
        assert_eq!(OpeningLook::parse("a+preview"), Some(d));
        // The look before: the neutral curve, every DNG at its baseline.
        let before = OpeningLook::parse("neutral").unwrap();
        assert!(!before.dng_preview_exposure);
        assert_eq!(before.curve.lut(), base_curves::curve_lut(&base_curves::NEUTRAL).to_vec());
    }

    #[test]
    fn looks_parse_by_name() {
        assert_eq!(OpeningLook::parse("b+preview"), Some(OpeningLook { curve: OpeningCurve::Standard(CANDIDATES[1]), dng_preview_exposure: true }));
        assert_eq!(OpeningLook::parse("c").map(|l| l.curve), Some(OpeningCurve::Standard(CANDIDATES[2])));
        assert_eq!(OpeningLook::parse("provia"), None);
    }
}
