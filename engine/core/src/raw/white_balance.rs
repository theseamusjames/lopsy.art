//! White balance in the recipe's units for every RAW format.
//!
//! The recipe's Temperature and Tint stay relative to the as-shot balance
//! (−200..200, 0 as shot) whatever the format. They become the RAW step's
//! channel gains by the app's `wbRatioFor` ([`wb_ratio_for`], the same
//! formula: red `2^(0.6 t/100)`, blue `2^(−0.6 t/100)`, green
//! `2^(−0.4 m/100)`, scaled so their (¼, ½, ¼) weighted sum is 1, the stops
//! of `develop_stats::RAW_TEMPERATURE_STOPS` and `RAW_TINT_STOPS`).
//!
//! - **Fixed matrix** (RAF, an ARW without measured colour): those gains,
//!   and the profile's matrix; no Kelvin here (RAF's fitted scale comes
//!   with its description).
//! - **Per-white matrix** (DNG, a measured ARW): the gains give the camera
//!   neutral being made white, and `dng::camera_color` gives the matrix
//!   that goes with it and that white's correlated colour temperature and
//!   tint ([`measured_white`]). The gains it returns are scaled back to the
//!   same (¼, ½, ¼) normalisation, so a change of white keeps brightness as
//!   it does for a RAF; at (0, 0) they are exactly 1, 1, 1.
//! - Typed Kelvin ([`temperature_for_kelvin`]): the recipe temperature whose
//!   white has that colour temperature at the recipe's own Tint, by
//!   bisection (Kelvin rises with Temperature: a warmer rendering is the
//!   white of a bluer light), clamped to the slider's ends.
//! - Presets ([`illuminant_presets`]): CIE standard illuminants, their
//!   chromaticities from `dng::camera_color::standard_illuminant_xy` (CIE
//!   15's published values, already used by the DNG colour method):
//!   Daylight D55, Cloudy D65, Shade D75, Tungsten A. Each is the recipe's
//!   (Temperature, Tint) whose gains make that illuminant's camera neutral
//!   white. There is no fluorescent preset: the code base holds no CIE F
//!   series chromaticity.

use crate::develop_stats::{RAW_TEMPERATURE_STOPS, RAW_TINT_STOPS};
use crate::dng::camera_color::{standard_illuminant_xy, DngCalibration};
use crate::raf::wb_presets::RecipeWbPreset;
use crate::scene_tone::WB_SLIDER_END;

use super::RawWhite;

/// `develop_stats::RAW_TEMPERATURE_STOPS` and `RAW_TINT_STOPS` as the app
/// holds them, in f64 (a test keeps them equal).
const TEMPERATURE_STOPS_F64: f64 = 0.6;
const TINT_STOPS_F64: f64 = 0.4;

/// The weights the gains are normalised by (the app's `WB_LUMA_WEIGHTS`).
pub const WB_LUMA_WEIGHTS: [f32; 3] = [0.25, 0.5, 0.25];

/// The RAW step's gains for the recipe's Temperature and Tint: the app's
/// `wbRatioFor`, operation for operation.
pub fn wb_ratio_for(temperature: f32, tint: f32) -> [f32; 3] {
    // In f64, as the app's JavaScript computes it.
    let (t, m) = (f64::from(temperature) / 100.0, f64::from(tint) / 100.0);
    let (ts, ms) = (TEMPERATURE_STOPS_F64, TINT_STOPS_F64);
    let r = (ts * t).exp2();
    let g = (-ms * m).exp2();
    let b = (-ts * t).exp2();
    let w = WB_LUMA_WEIGHTS.map(f64::from);
    let luma = w[0] * r + w[1] * g + w[2] * b;
    [(r / luma) as f32, (g / luma) as f32, (b / luma) as f32]
}

/// The (Temperature, Tint) whose gains match `ratio` up to scale,
/// unclamped: the inverse of [`wb_ratio_for`].
pub fn recipe_for_ratio(ratio: [f32; 3]) -> (f32, f32) {
    let [r, g, b] = ratio;
    let t = (r / b).log2() / (2.0 * RAW_TEMPERATURE_STOPS) * 100.0;
    let m = -(g / (r * b).sqrt()).log2() / RAW_TINT_STOPS * 100.0;
    (t, m)
}

/// A fixed matrix's white: the gains, no matrix, no Kelvin.
pub fn fixed_white(temperature: f32, tint: f32) -> RawWhite {
    RawWhite { wb_ratio: wb_ratio_for(temperature, tint), cam_to_rgb: None, kelvin: None, tint: None }
}

/// A calibrated file's white for the recipe: the gains made the white, its
/// matrix, and its colour temperature and tint.
pub fn measured_white(cal: &DngCalibration, as_shot_gain: [f32; 3], temperature: f32, tint: f32) -> Result<RawWhite, String> {
    let ratio = wb_ratio_for(temperature, tint);
    let wb = cal
        .white_balance_for_ratio(ratio, as_shot_gain)
        .ok_or_else(|| format!("Temperature {temperature}, Tint {tint} is not a white this camera can see"))?;
    let luma: f32 = wb.wb_ratio.iter().zip(WB_LUMA_WEIGHTS).map(|(v, w)| v * w).sum();
    if !(luma.is_finite() && luma > 0.0) {
        return Err(format!("Temperature {temperature}, Tint {tint} is not a white this camera can see"));
    }
    Ok(RawWhite { wb_ratio: wb.wb_ratio.map(|v| v / luma), cam_to_rgb: Some(wb.cam_to_rgb), kelvin: Some(wb.kelvin), tint: Some(wb.tint) })
}

/// The recipe temperature whose white reads `kelvin` at the recipe's
/// `tint`, within ±`WB_SLIDER_END` (the end when `kelvin` lies beyond).
pub fn temperature_for_kelvin(cal: &DngCalibration, as_shot_gain: [f32; 3], kelvin: f32, tint: f32) -> Result<f32, String> {
    if !(kelvin.is_finite() && kelvin > 0.0 && tint.is_finite()) {
        return Err("Kelvin and tint must be numbers".into());
    }
    let k = |t: f32| -> Result<f32, String> { measured_white(cal, as_shot_gain, t, tint)?.kelvin.ok_or_else(|| "no Kelvin".to_string()) };
    let (mut lo, mut hi) = (-WB_SLIDER_END, WB_SLIDER_END);
    if k(lo)? >= kelvin {
        return Ok(lo);
    }
    if k(hi)? <= kelvin {
        return Ok(hi);
    }
    for _ in 0..40 {
        let mid = (lo + hi) / 2.0;
        if k(mid)? < kelvin {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    Ok((lo + hi) / 2.0)
}

/// The CIE standard illuminants offered as presets: (menu name, EXIF
/// LightSource code).
pub const ILLUMINANT_PRESETS: [(&str, u16); 4] = [("Daylight", 20), ("Cloudy", 21), ("Shade", 22), ("Tungsten", 17)];

/// The presets for a calibrated file shot at `as_shot_gain`: each
/// illuminant's recipe (Temperature, Tint), rounded and clamped to the
/// sliders, in menu order; one a camera cannot see is left out.
pub fn illuminant_presets(cal: &DngCalibration, as_shot_gain: [f32; 3]) -> Vec<RecipeWbPreset> {
    ILLUMINANT_PRESETS
        .iter()
        .filter_map(|&(name, code)| {
            let xy = standard_illuminant_xy(code)?;
            let neutral = cal.neutral_for_xy(xy)?;
            // The gains on top of the as-shot ones that make `neutral` white.
            let ratio: [f32; 3] = std::array::from_fn(|i| (1.0 / (neutral[i] * f64::from(as_shot_gain[i]))) as f32);
            if ratio.iter().any(|v| !(v.is_finite() && *v > 0.0)) {
                return None;
            }
            let (t, m) = recipe_for_ratio(ratio);
            let slider = |v: f32| v.clamp(-WB_SLIDER_END, WB_SLIDER_END).round() + 0.0;
            Some(RecipeWbPreset { name: name.to_string(), temperature: slider(t), tint: slider(m) })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_stops_are_the_engines() {
        assert_eq!(TEMPERATURE_STOPS_F64 as f32, RAW_TEMPERATURE_STOPS);
        assert_eq!(TINT_STOPS_F64 as f32, RAW_TINT_STOPS);
    }

    #[test]
    fn gains_and_recipe_invert_each_other() {
        assert_eq!(wb_ratio_for(0.0, 0.0), [1.0, 1.0, 1.0]);
        for (t, m) in [(37.0, -12.0), (-150.0, 80.0), (200.0, 200.0)] {
            let r = wb_ratio_for(t, m);
            let luma: f32 = r.iter().zip(WB_LUMA_WEIGHTS).map(|(v, w)| v * w).sum();
            assert!((luma - 1.0).abs() < 1e-6);
            let (t2, m2) = recipe_for_ratio(r);
            assert!((t2 - t).abs() < 1e-3 && (m2 - m).abs() < 1e-3, "{t} {m}: {t2} {m2}");
        }
        let f = fixed_white(10.0, 5.0);
        assert_eq!(f.wb_ratio, wb_ratio_for(10.0, 5.0));
        assert!(f.cam_to_rgb.is_none() && f.kelvin.is_none());
    }
}
