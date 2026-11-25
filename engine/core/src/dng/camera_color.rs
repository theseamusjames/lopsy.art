//! Camera colour by the DNG method: a camera's calibration as the DNG
//! specification defines it, and, for a chosen white balance, the camera
//! neutral, the camera-to-XYZ (D50) matrix and from it what the develop
//! chain's RAW step takes (a white-balance gain on camera RGB and a matrix
//! to linear sRGB, which `raf::develop::cam_to_working` carries on to
//! linear Rec. 2020).
//!
//! Written from the Adobe DNG Specification 1.6.0.0, chapter "Mapping
//! Camera Color Space to CIE XYZ Space", for a three-colour camera:
//!
//! - `XYZtoCamera = AB · CC · CM`, where CM and CC are interpolated between
//!   the two calibrations and AB is `AnalogBalance` as a diagonal.
//! - Interpolation is linear in inverse correlated colour temperature
//!   between the two calibration illuminants, and uses the nearer set when
//!   the white balance lies outside them.
//! - A white point xy (taken at Y = 1) gives `CameraNeutral = XYZtoCamera ·
//!   XYZ`; the way back is the iterative solve the specification describes
//!   (guess xy, interpolate, `XYZ = XYZtoCamera⁻¹ · CameraNeutral`, repeat).
//! - Without forward matrices, `CameraToXYZ_D50 = CA · XYZtoCamera⁻¹`, CA
//!   the linear Bradford adaptation from the white point to D50. With them,
//!   `CameraToXYZ_D50 = FM · D · (AB · CC)⁻¹`, D the inverse of the
//!   diagonal of `ReferenceNeutral = (AB · CC)⁻¹ · CameraNeutral`.
//! - CameraCalibration is used only when `CameraCalibrationSignature`
//!   equals `ProfileCalibrationSignature` (both absent counts as equal);
//!   otherwise it is the identity, as the specification asks.
//!
//! What the specification leaves to the converter, and is chosen here:
//!
//! - **Scale.** A camera neutral is normalized to green = 1 before it is
//!   used, and the camera-to-XYZ matrix of the colour-matrix path is scaled
//!   so that this neutral maps to Y = 1, which is what the forward-matrix
//!   path does by construction. So in both paths a neutral surface whose
//!   green channel reaches the white level is diffuse white (Y = 1) before
//!   `BaselineExposure`.
//! - **Temperatures of the calibration illuminants.** The EXIF LightSource
//!   codes are mapped to kelvin by [`illuminant_kelvin`]: the CIE standard
//!   illuminants (A, B, C, D50, D55, D65, D75) by the correlated colour
//!   temperature `cct` computes for their chromaticities, so the weight is
//!   exactly 0 or 1 at their white points (A reads 2848 K, not its nominal
//!   2856 K, which used an older radiation constant; D65 reads 6501 K);
//!   the named lights by the middle of the range EXIF gives them. The
//!   codes, ranges and chromaticities were written from memory of the
//!   EXIF standard and CIE 15, not from their text. A code with no
//!   temperature (0 unknown, 255 other with `IlluminantData`) makes the
//!   profile use one calibration, the second when it has one.
//! - **D50** is the ICC connection-space white (`colorimetry::PCS_D50`),
//!   and the output white is D65.
//!
//! The third calibration of DNG 1.6 (`ColorMatrix3`) and four-colour
//! cameras are not handled: the decoder falls back for the latter, and
//! ignores the former.

use serde::{Deserialize, Serialize};

use crate::cct;
use crate::colorimetry::{self, Mat3};

/// One calibration set: `ColorMatrixN` (XYZ → reference camera, row-major),
/// with `ForwardMatrixN` and `CameraCalibrationN` when the file has them.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Calibration {
    /// The EXIF LightSource code of `CalibrationIlluminantN`.
    pub illuminant: u16,
    pub color_matrix: [f64; 9],
    #[serde(default)]
    pub forward_matrix: Option<[f64; 9]>,
    #[serde(default)]
    pub camera_calibration: Option<[f64; 9]>,
}

/// A DNG's colour calibration as data: what the specification's colour
/// method needs, read from the file (`dng::linear::calibration_from_tags`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DngCalibration {
    /// The first calibration. Every profile has one.
    pub first: Calibration,
    /// The second, when the file has two.
    #[serde(default)]
    pub second: Option<Calibration>,
    /// `AnalogBalance`, `[1, 1, 1]` when absent.
    pub analog_balance: [f64; 3],
    /// `AsShotNeutral`, as stored.
    #[serde(default)]
    pub as_shot_neutral: Option<[f64; 3]>,
    /// `AsShotWhiteXY`, used when there is no `AsShotNeutral`.
    #[serde(default)]
    pub as_shot_white_xy: Option<[f64; 2]>,
    /// `BaselineExposure` plus `BaselineExposureOffset`, in EV.
    pub baseline_exposure: f64,
}

/// The white point used when a file records neither an as-shot neutral nor
/// an as-shot white: D65.
pub const DEFAULT_WHITE_XY: (f64, f64) = (0.31271, 0.32902);

/// The CIE 1931 chromaticity of a CIE standard illuminant by its EXIF
/// LightSource code.
pub fn standard_illuminant_xy(code: u16) -> Option<(f64, f64)> {
    Some(match code {
        17 => (0.44757, 0.40745), // A
        18 => (0.34842, 0.35161), // B
        19 => (0.31006, 0.31616), // C
        20 => (0.33242, 0.34743), // D55
        21 => (0.31271, 0.32902), // D65
        22 => (0.29902, 0.31485), // D75
        23 => (0.34567, 0.35850), // D50
        _ => return None,
    })
}

/// The correlated colour temperature of an EXIF LightSource code, in
/// kelvin, or `None` for a code without one.
pub fn illuminant_kelvin(code: u16) -> Option<f64> {
    if let Some((x, y)) = standard_illuminant_xy(code) {
        return Some(cct::temperature_from_xy(x, y).0);
    }
    Some(match code {
        1 | 4 | 9 => 5500.0, // Daylight, Flash, Fine weather
        2 => 4150.0,          // Fluorescent, taken as cool white
        3 => 2850.0,          // Tungsten
        10 => 6500.0,         // Cloudy
        11 => 7500.0,         // Shade
        12 => 6400.0,         // Daylight fluorescent, 5700–7100 K
        13 => 5050.0,         // Day white fluorescent, 4600–5500 K
        14 => 4150.0,         // Cool white fluorescent, 3800–4500 K
        15 => 3525.0,         // White fluorescent, 3250–3800 K
        16 => 2925.0,         // Warm white fluorescent, 2600–3250 K
        24 => 3200.0,         // ISO studio tungsten
        _ => return None,
    })
}

fn mat(m: &[f64; 9]) -> Mat3 {
    [[m[0], m[1], m[2]], [m[3], m[4], m[5]], [m[6], m[7], m[8]]]
}

const IDENTITY: Mat3 = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];

fn det(m: &Mat3) -> f64 {
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
}

/// The inverse, or `None` for a matrix too close to singular to invert
/// meaningfully (relative to its own scale).
fn inverse(m: &Mat3) -> Option<Mat3> {
    let scale = m.iter().flatten().fold(0.0f64, |a, v| a.max(v.abs()));
    let d = det(m);
    if !d.is_finite() || scale == 0.0 || d.abs() < 1e-9 * scale.powi(3) {
        return None;
    }
    Some(colorimetry::mat_inverse(m))
}

fn diag(v: [f64; 3]) -> Mat3 {
    [[v[0], 0.0, 0.0], [0.0, v[1], 0.0], [0.0, 0.0, v[2]]]
}

fn lerp(a: &Mat3, b: &Mat3, w: f64) -> Mat3 {
    std::array::from_fn(|r| std::array::from_fn(|c| w * a[r][c] + (1.0 - w) * b[r][c]))
}

/// What the develop chain's RAW step needs for one white balance, and the
/// white balance as a person reads it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DngWhiteBalance {
    /// Per-channel multipliers on the decoded camera RGB (which is already
    /// at the as-shot balance): `[1, 1, 1]` is as shot.
    pub wb_ratio: [f32; 3],
    /// White-balanced camera RGB → linear sRGB (D65), row-major. `[1, 1, 1]`
    /// maps to `[1, 1, 1]`: the camera neutral at green 1 is diffuse white.
    pub cam_to_rgb: [f32; 9],
    /// The white point's correlated colour temperature, in kelvin.
    pub kelvin: f32,
    /// Its tint (`cct::TINT_PER_DUV` × Duv; positive is greener light,
    /// rendered more magenta).
    pub tint: f32,
    /// The white point, CIE 1931 xy.
    pub white_xy: [f32; 2],
}

impl DngCalibration {
    /// Check that the calibration can be used: finite, invertible matrices
    /// and a positive analog balance.
    pub fn validate(&self) -> Result<(), String> {
        let sets = std::iter::once(&self.first).chain(self.second.as_ref());
        for (i, c) in sets.enumerate() {
            let all = c.color_matrix.iter().chain(c.forward_matrix.iter().flatten()).chain(c.camera_calibration.iter().flatten());
            if all.clone().any(|v| !v.is_finite()) {
                return Err(format!("calibration {} has a value that is not a number", i + 1));
            }
            if inverse(&mat(&c.color_matrix)).is_none() {
                return Err(format!("ColorMatrix{} cannot be inverted", i + 1));
            }
            if let Some(fm) = &c.forward_matrix {
                if det(&mat(fm)).abs() < 1e-12 {
                    return Err(format!("ForwardMatrix{} cannot be inverted", i + 1));
                }
            }
            if let Some(cc) = &c.camera_calibration {
                if inverse(&mat(cc)).is_none() {
                    return Err(format!("CameraCalibration{} cannot be inverted", i + 1));
                }
            }
        }
        if self.analog_balance.iter().any(|&v| !(v.is_finite() && v > 0.0)) {
            return Err("AnalogBalance is not positive".into());
        }
        if !self.baseline_exposure.is_finite() {
            return Err("BaselineExposure is not a number".into());
        }
        Ok(())
    }

    /// The weight of the first calibration (the second gets `1 − w`) for a
    /// white balance of `kelvin`: linear in inverse temperature between the
    /// two illuminants, the nearer one's set outside them. 1 with one
    /// calibration.
    pub fn weight_for_kelvin(&self, kelvin: f64) -> f64 {
        let Some(second) = &self.second else { return 1.0 };
        let (Some(t1), Some(t2)) = (illuminant_kelvin(self.first.illuminant), illuminant_kelvin(second.illuminant)) else {
            return 0.0;
        };
        if (t1 - t2).abs() < 1.0 {
            return 1.0;
        }
        let inv = |t: f64| 1.0 / t;
        let w = (inv(kelvin) - inv(t2)) / (inv(t1) - inv(t2));
        w.clamp(0.0, 1.0)
    }

    /// The weight for a white point given as xy, through its correlated
    /// colour temperature.
    pub fn weight_for_xy(&self, xy: (f64, f64)) -> f64 {
        self.weight_for_kelvin(cct::temperature_from_xy(xy.0, xy.1).0)
    }

    fn camera_calibration(&self, w: f64) -> Mat3 {
        let cc = |c: &Calibration| c.camera_calibration.as_ref().map_or(IDENTITY, mat);
        match &self.second {
            Some(s) => lerp(&cc(&self.first), &cc(s), w),
            None => cc(&self.first),
        }
    }

    /// `AB · CC`, interpolated with weight `w`.
    fn ab_cc(&self, w: f64) -> Mat3 {
        colorimetry::mat_mul(&diag(self.analog_balance), &self.camera_calibration(w))
    }

    /// `XYZtoCamera = AB · CC · CM`, interpolated with weight `w`.
    pub fn xyz_to_camera(&self, w: f64) -> Mat3 {
        let cm = match &self.second {
            Some(s) => lerp(&mat(&self.first.color_matrix), &mat(&s.color_matrix), w),
            None => mat(&self.first.color_matrix),
        };
        colorimetry::mat_mul(&self.ab_cc(w), &cm)
    }

    fn forward_matrix(&self, w: f64) -> Option<Mat3> {
        let f1 = self.first.forward_matrix.as_ref().map(mat);
        let f2 = self.second.as_ref().and_then(|s| s.forward_matrix.as_ref()).map(mat);
        match (f1, f2) {
            (Some(a), Some(b)) if self.second.is_some() => Some(lerp(&a, &b, w)),
            (Some(a), _) => Some(a),
            (None, Some(b)) => Some(b),
            (None, None) => None,
        }
    }

    /// The camera neutral of the white point `xy`, normalized to green = 1
    /// (the specification's `XYZtoCamera · XYZ`, at the weight of that
    /// white). `None` when the result is not a positive colour.
    pub fn neutral_for_xy(&self, xy: (f64, f64)) -> Option<[f64; 3]> {
        let w = self.weight_for_xy(xy);
        let n = colorimetry::mat_vec(&self.xyz_to_camera(w), &cct::xy_to_xyz(xy.0, xy.1));
        normalize_green(n)
    }

    /// The white point (xy) whose camera neutral is `neutral`: the
    /// specification's iterative solve, from D50, until xy moves by less
    /// than 1e-9 or 100 rounds have run. `None` when the neutral does not
    /// map to a colour with a chromaticity.
    pub fn xy_for_neutral(&self, neutral: [f64; 3]) -> Option<(f64, f64)> {
        let mut xy = (0.3457, 0.3585);
        for _ in 0..100 {
            let w = self.weight_for_xy(xy);
            let inv = inverse(&self.xyz_to_camera(w))?;
            let next = cct::xyz_to_xy(colorimetry::mat_vec(&inv, &neutral))?;
            if !(next.0 > 0.0 && next.1 > 0.0 && next.0 + next.1 < 1.0) {
                return None;
            }
            let moved = (next.0 - xy.0).abs() + (next.1 - xy.1).abs();
            xy = next;
            if moved < 1e-9 {
                break;
            }
        }
        Some(xy)
    }

    /// The as-shot white balance: its white point and camera neutral
    /// (green = 1). From `AsShotNeutral`, else `AsShotWhiteXY`, else D65.
    pub fn as_shot(&self) -> Option<((f64, f64), [f64; 3])> {
        if let Some(n) = self.as_shot_neutral.and_then(normalize_green) {
            return Some((self.xy_for_neutral(n)?, n));
        }
        let xy = self.as_shot_white_xy.map_or(DEFAULT_WHITE_XY, |v| (v[0], v[1]));
        Some((xy, self.neutral_for_xy(xy)?))
    }

    /// `CameraToXYZ_D50` for the white point `xy` with camera neutral
    /// `neutral` (green = 1): through the forward matrices when the profile
    /// has them, else the inverse colour matrix and a Bradford adaptation.
    /// Either way `neutral` maps to D50 at Y = 1.
    pub fn camera_to_xyz_d50(&self, xy: (f64, f64), neutral: [f64; 3]) -> Option<Mat3> {
        let w = self.weight_for_xy(xy);
        let d50 = colorimetry::PCS_D50;
        if let Some(fm) = self.forward_matrix(w) {
            let inv_ab_cc = inverse(&self.ab_cc(w))?;
            let reference = colorimetry::mat_vec(&inv_ab_cc, &neutral);
            if reference.iter().any(|&v| !(v.is_finite() && v > 0.0)) {
                return None;
            }
            let d = diag(reference.map(|v| 1.0 / v));
            let m = colorimetry::mat_mul(&fm, &colorimetry::mat_mul(&d, &inv_ab_cc));
            // The forward matrix maps a unit vector to D50 by definition;
            // its stored rationals are rounded, so set Y exactly to 1.
            let y = colorimetry::mat_vec(&m, &neutral)[1];
            return (y > 0.0).then(|| scale(&m, 1.0 / y));
        }
        let camera_to_xyz = inverse(&self.xyz_to_camera(w))?;
        let ca = colorimetry::bradford_adaptation(&cct::xy_to_xyz(xy.0, xy.1), &d50);
        let m = colorimetry::mat_mul(&ca, &camera_to_xyz);
        let y = colorimetry::mat_vec(&m, &neutral)[1];
        (y > 0.0 && y.is_finite()).then(|| scale(&m, 1.0 / y))
    }

    /// The RAW step's settings for the camera neutral `neutral` (green = 1),
    /// with `as_shot_gain` the gain the decode already applied
    /// (`1 / as-shot neutral`, green = 1).
    pub fn white_balance_for_neutral(&self, neutral: [f64; 3], as_shot_gain: [f32; 3]) -> Option<DngWhiteBalance> {
        let neutral = normalize_green(neutral)?;
        let xy = self.xy_for_neutral(neutral)?;
        self.white_balance_at(xy, neutral, as_shot_gain)
    }

    /// The RAW step's settings for a white point in kelvin and tint.
    pub fn white_balance_for_temperature(&self, kelvin: f64, tint: f64, as_shot_gain: [f32; 3]) -> Option<DngWhiteBalance> {
        let xy = cct::xy_from_temperature(kelvin, tint);
        let neutral = self.neutral_for_xy(xy)?;
        self.white_balance_at(xy, neutral, as_shot_gain)
    }

    /// The RAW step's settings for a `wbRatio` on top of the as-shot
    /// balance: the camera neutral that ratio makes neutral, and the matrix
    /// and Kelvin that go with it.
    pub fn white_balance_for_ratio(&self, wb_ratio: [f32; 3], as_shot_gain: [f32; 3]) -> Option<DngWhiteBalance> {
        let gain: [f64; 3] = std::array::from_fn(|i| f64::from(as_shot_gain[i]) * f64::from(wb_ratio[i]));
        if gain.iter().any(|&g| !(g.is_finite() && g > 0.0)) {
            return None;
        }
        self.white_balance_for_neutral(gain.map(|g| 1.0 / g), as_shot_gain)
    }

    fn white_balance_at(&self, xy: (f64, f64), neutral: [f64; 3], as_shot_gain: [f32; 3]) -> Option<DngWhiteBalance> {
        let camera_to_xyz = self.camera_to_xyz_d50(xy, neutral)?;
        // The RAW step multiplies the decoded data by `wbRatio` first, so
        // the matrix it applies after sees camera RGB times the full gain
        // `1 / neutral`; undo that gain inside the matrix.
        let m = colorimetry::mat_mul(&xyz_d50_to_linear_srgb(), &colorimetry::mat_mul(&camera_to_xyz, &diag(neutral)));
        let cam_to_rgb = cct::flatten(&m);
        if cam_to_rgb.iter().any(|v| !v.is_finite()) {
            return None;
        }
        let wb_ratio: [f32; 3] = std::array::from_fn(|i| (1.0 / (neutral[i] * f64::from(as_shot_gain[i]))) as f32);
        if wb_ratio.iter().any(|v| !(v.is_finite() && *v > 0.0)) {
            return None;
        }
        let (kelvin, tint) = cct::temperature_from_xy(xy.0, xy.1);
        Some(DngWhiteBalance {
            wb_ratio,
            cam_to_rgb,
            kelvin: kelvin as f32,
            tint: tint as f32,
            white_xy: [xy.0 as f32, xy.1 as f32],
        })
    }
}

fn scale(m: &Mat3, k: f64) -> Mat3 {
    m.map(|row| row.map(|v| v * k))
}

/// `v` divided by its green, or `None` unless every channel is positive.
pub fn normalize_green(v: [f64; 3]) -> Option<[f64; 3]> {
    if v.iter().any(|&c| !(c.is_finite() && c > 0.0)) {
        return None;
    }
    Some(v.map(|c| c / v[1]))
}

/// XYZ relative to D50 → linear sRGB (D65): Bradford D50 → D65, then the
/// sRGB primaries.
pub fn xyz_d50_to_linear_srgb() -> Mat3 {
    let d65 = colorimetry::xy_to_xyz(colorimetry::D65_XY.0, colorimetry::D65_XY.1);
    let adapt = colorimetry::bradford_adaptation(&colorimetry::PCS_D50, &d65);
    let srgb_to_xyz = colorimetry::rgb_to_xyz_matrix(&colorimetry::SRGB_PRIMARIES_XY, &d65);
    colorimetry::mat_mul(&colorimetry::mat_inverse(&srgb_to_xyz), &adapt)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A plausible camera: sRGB-like primaries seen through a mild cross
    /// talk, as XYZ (D65) → camera, and the same camera under illuminant A.
    fn colour_matrix_d65() -> [f64; 9] {
        [0.7034, -0.0804, -0.1014, -0.4420, 1.3564, 0.0717, -0.0567, 0.1660, 0.5841]
    }
    fn colour_matrix_a() -> [f64; 9] {
        [0.6520, -0.0129, -0.1022, -0.5137, 1.3297, 0.1591, -0.1206, 0.2387, 0.5786]
    }

    fn single(cm: [f64; 9], illuminant: u16) -> DngCalibration {
        DngCalibration {
            first: Calibration { illuminant, color_matrix: cm, forward_matrix: None, camera_calibration: None },
            second: None,
            analog_balance: [1.0, 1.0, 1.0],
            as_shot_neutral: Some([0.5, 1.0, 0.7]),
            as_shot_white_xy: None,
            baseline_exposure: 0.0,
        }
    }

    fn dual() -> DngCalibration {
        DngCalibration {
            first: Calibration { illuminant: 17, color_matrix: colour_matrix_a(), forward_matrix: None, camera_calibration: None },
            second: Some(Calibration { illuminant: 21, color_matrix: colour_matrix_d65(), forward_matrix: None, camera_calibration: None }),
            ..single(colour_matrix_d65(), 21)
        }
    }

    fn apply(m: &[f32; 9], v: [f32; 3]) -> [f32; 3] {
        std::array::from_fn(|r| m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2])
    }

    fn close(a: &[f32], b: &[f32], tol: f32) -> bool {
        a.iter().zip(b).all(|(x, y)| (x - y).abs() <= tol)
    }

    #[test]
    fn weight_is_one_and_zero_at_the_illuminants_and_monotonic_between() {
        let cal = dual();
        let a = standard_illuminant_xy(17).unwrap();
        let d65 = standard_illuminant_xy(21).unwrap();
        assert_eq!(cal.weight_for_xy(a), 1.0);
        assert!(cal.weight_for_xy(d65).abs() < 1e-12);
        assert_eq!(cal.weight_for_kelvin(2000.0), 1.0, "colder than A uses A's set");
        assert_eq!(cal.weight_for_kelvin(12000.0), 0.0, "warmer than D65 uses D65's set");
        let mut last = 1.0;
        for k in (2900..6500).step_by(50) {
            let w = cal.weight_for_kelvin(k as f64);
            assert!(w < last, "{k}: {w} not below {last}");
            last = w;
        }
        // Linear in inverse temperature: halfway in mireds is weight 0.5.
        let (ta, td) = (illuminant_kelvin(17).unwrap(), illuminant_kelvin(21).unwrap());
        let mid = 2.0 / (1.0 / ta + 1.0 / td);
        assert!((cal.weight_for_kelvin(mid) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn equal_matrices_reduce_to_the_single_matrix_case() {
        let mut both = dual();
        both.first.color_matrix = colour_matrix_d65();
        both.first.illuminant = 21;
        let one = single(colour_matrix_d65(), 21);
        let gain = [2.0, 1.0, 1.0 / 0.7];
        for neutral in [[0.5, 1.0, 0.7], [0.8, 1.0, 0.4], [0.35, 1.0, 0.9]] {
            let a = both.white_balance_for_neutral(neutral, gain).unwrap();
            let b = one.white_balance_for_neutral(neutral, gain).unwrap();
            assert!(close(&a.cam_to_rgb, &b.cam_to_rgb, 1e-6), "{a:?} {b:?}");
            assert!(close(&a.wb_ratio, &b.wb_ratio, 1e-6));
        }
    }

    #[test]
    fn single_d65_matrix_at_d65_is_the_inverse_colour_matrix() {
        // At the calibration white itself there is nothing to adapt but
        // D65 → D50 and back, so the result is sRGB of CM⁻¹, column-scaled.
        let cal = single(colour_matrix_d65(), 21);
        let xy = DEFAULT_WHITE_XY;
        let n = cal.neutral_for_xy(xy).unwrap();
        let wb = cal.white_balance_for_neutral(n, [1.0, 1.0, 1.0]).unwrap();
        let srgb_to_xyz = colorimetry::rgb_to_xyz_matrix(&colorimetry::SRGB_PRIMARIES_XY, &colorimetry::xy_to_xyz(0.3127, 0.3290));
        let cam_to_xyz = colorimetry::mat_inverse(&mat(&colour_matrix_d65()));
        let direct = colorimetry::mat_mul(&colorimetry::mat_inverse(&srgb_to_xyz), &colorimetry::mat_mul(&cam_to_xyz, &diag(n)));
        let y = colorimetry::mat_vec(&cam_to_xyz, &n)[1];
        let expected = cct::flatten(&scale(&direct, 1.0 / y));
        // D65 here is 0.31271, 0.32902 and sRGB's is 0.3127, 0.3290.
        assert!(close(&wb.cam_to_rgb, &expected, 2e-3), "{:?}\n{expected:?}", wb.cam_to_rgb);
    }

    #[test]
    fn a_neutral_under_the_chosen_white_comes_out_neutral() {
        let cal = dual();
        let as_shot_gain = [2.0f32, 1.0, 1.0 / 0.7];
        for (kelvin, tint) in [(2400.0, 0.0), (2856.0, 10.0), (4000.0, -20.0), (5200.0, 0.0), (6504.0, 9.0), (9000.0, 30.0)] {
            let wb = cal.white_balance_for_temperature(kelvin, tint, as_shot_gain).unwrap();
            // A grey surface under that light, as the camera saw it and the
            // decode stored it (times the as-shot gain).
            let xy = cct::xy_from_temperature(kelvin, tint);
            let raw = colorimetry::mat_vec(&cal.xyz_to_camera(cal.weight_for_xy(xy)), &cct::xy_to_xyz(xy.0, xy.1).map(|v| v * 0.18));
            let stored: [f32; 3] = std::array::from_fn(|i| raw[i] as f32 * as_shot_gain[i]);
            let balanced: [f32; 3] = std::array::from_fn(|i| stored[i] * wb.wb_ratio[i]);
            let out = apply(&wb.cam_to_rgb, balanced);
            let spread = out.iter().cloned().fold(f32::MIN, f32::max) - out.iter().cloned().fold(f32::MAX, f32::min);
            assert!(spread < 1e-4 * out[1].abs().max(1e-3), "{kelvin} K: {out:?}");
            assert!((wb.kelvin as f64 - kelvin).abs() < 1.0 && (wb.tint as f64 - tint).abs() < 0.05, "{wb:?}");
            // White-balanced [1, 1, 1] is diffuse white.
            assert!(close(&apply(&wb.cam_to_rgb, [1.0, 1.0, 1.0]), &[1.0, 1.0, 1.0], 1e-4));
        }
    }

    #[test]
    fn neutral_and_white_point_round_trip_through_the_iterative_solve() {
        let cal = dual();
        for kelvin in [2500.0, 3300.0, 4500.0, 5600.0, 7000.0] {
            let xy = cct::xy_from_temperature(kelvin, 5.0);
            let n = cal.neutral_for_xy(xy).unwrap();
            let back = cal.xy_for_neutral(n).unwrap();
            assert!((back.0 - xy.0).abs() < 1e-7 && (back.1 - xy.1).abs() < 1e-7, "{kelvin}: {xy:?} → {back:?}");
        }
    }

    #[test]
    fn the_ratio_and_temperature_routes_agree() {
        let cal = dual();
        let gain = [2.0f32, 1.0, 1.0 / 0.7];
        let by_k = cal.white_balance_for_temperature(3800.0, -12.0, gain).unwrap();
        let by_ratio = cal.white_balance_for_ratio(by_k.wb_ratio, gain).unwrap();
        assert!(close(&by_k.cam_to_rgb, &by_ratio.cam_to_rgb, 1e-4));
        assert!((by_ratio.kelvin - 3800.0).abs() < 1.0 && (by_ratio.tint + 12.0).abs() < 0.05, "{by_ratio:?}");
        // As shot is ratio 1.
        let as_shot = cal.white_balance_for_ratio([1.0, 1.0, 1.0], gain).unwrap();
        assert!(close(&as_shot.wb_ratio, &[1.0, 1.0, 1.0], 1e-6));
    }

    #[test]
    fn forward_matrices_map_the_neutral_to_d50_and_neutral_out() {
        // A forward matrix whose rows map [1, 1, 1] to D50.
        let fm = [0.6, 0.25, 0.1142, 0.25, 0.7, 0.05, 0.02, 0.1, 0.7049];
        let mut cal = dual();
        cal.first.forward_matrix = Some(fm);
        cal.second.as_mut().unwrap().forward_matrix = Some(fm);
        cal.analog_balance = [1.1, 1.0, 0.95];
        let gain = [2.0f32, 1.0, 1.0 / 0.7];
        let wb = cal.white_balance_for_temperature(4300.0, 0.0, gain).unwrap();
        assert!(close(&apply(&wb.cam_to_rgb, [1.0, 1.0, 1.0]), &[1.0, 1.0, 1.0], 1e-4), "{wb:?}");
        let xy = cct::xy_from_temperature(4300.0, 0.0);
        let n = cal.neutral_for_xy(xy).unwrap();
        let xyz = colorimetry::mat_vec(&cal.camera_to_xyz_d50(xy, n).unwrap(), &n);
        assert!((xyz[0] - colorimetry::PCS_D50[0]).abs() < 2e-3 && (xyz[1] - 1.0).abs() < 1e-9, "{xyz:?}");
    }

    #[test]
    fn a_singular_matrix_is_refused_not_panicked_on() {
        let mut cal = single([1.0, 2.0, 3.0, 2.0, 4.0, 6.0, 0.0, 0.0, 1.0], 21);
        assert!(cal.validate().is_err());
        cal.first.color_matrix = colour_matrix_d65();
        assert!(cal.validate().is_ok());
        assert!(cal.white_balance_for_ratio([0.0, 1.0, 1.0], [1.0; 3]).is_none());
    }
}
