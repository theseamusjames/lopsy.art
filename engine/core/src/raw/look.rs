//! What a file without a maker's film look opens with: the base curve of
//! its develop defaults and, for a DNG, whether its opening exposure is
//! matched to the camera's own preview. A switch for comparing the
//! Standard candidates (`raf::standard_curve`) against today's look; the
//! default ([`OpeningLook::default`]) is today's: the `NEUTRAL` curve, and
//! a DNG's BaselineExposure as it is. RAF never reads it: its defaults are
//! the film simulation's.
//!
//! [`prepare_with`](super::prepare_with) takes one; [`prepare`](super::prepare)
//! uses the default. The ARW exposure match always runs through whichever
//! curve is chosen (`arw::exposure::match_develop_exposure_with`), so a
//! curve that lifts the midtones opens at a lower exposure rather than
//! counting the lift twice.

use crate::raf::base_curves;
use crate::raf::standard_curve::{StandardCurve, CANDIDATES};

/// The base curve a DNG or ARW opens with.
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub enum OpeningCurve {
    /// `base_curves::NEUTRAL`, today's.
    #[default]
    Neutral,
    Standard(StandardCurve),
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
            OpeningCurve::Neutral => "Neutral (today)",
            OpeningCurve::Standard(c) => c.name,
        }
    }
}

/// The opening look of a file without a film look.
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct OpeningLook {
    pub curve: OpeningCurve,
    /// Match a DNG's opening exposure to its preview when the preview was
    /// made by the camera and the file relies on a gain map the develop
    /// chain does not apply (`dng::preview`); otherwise BaselineExposure.
    pub dng_preview_exposure: bool,
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
    fn the_default_is_todays_neutral_curve_without_the_preview_match() {
        let d = OpeningLook::default();
        assert_eq!(d.curve, OpeningCurve::Neutral);
        assert!(!d.dng_preview_exposure);
        assert_eq!(d.curve.lut(), base_curves::curve_lut(&base_curves::NEUTRAL).to_vec());
        assert_eq!(OpeningLook::parse("neutral"), Some(d));
    }

    #[test]
    fn looks_parse_by_name() {
        assert_eq!(OpeningLook::parse("b+preview"), Some(OpeningLook { curve: OpeningCurve::Standard(CANDIDATES[1]), dng_preview_exposure: true }));
        assert_eq!(OpeningLook::parse("c").map(|l| l.curve), Some(OpeningCurve::Standard(CANDIDATES[2])));
        assert_eq!(OpeningLook::parse("provia"), None);
    }
}
