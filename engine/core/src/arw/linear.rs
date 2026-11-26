//! A Sony ARW decoded for the develop chain: linear camera RGB at the
//! as-shot white balance, the counterpart of `dng::linear` and drawn by its
//! renders. [`prepare_arw`] makes the prepared plane with the DNG decode's
//! own `fill_plane` (the stored values through the file's linearization,
//! minus Sony's black level, over its white level, cropped, times the
//! as-shot gains); [`ArwRenderParams`] is a `dng::linear::PlaneParams`, so
//! `dng::linear::render_linear_band` and `render_binned_linear_for` render
//! it, with the same units and the same band contract as a Bayer DNG's.
//!
//! The develop settings follow a RAF's model, not a DNG's: one fixed
//! matrix (white-balanced camera RGB → linear sRGB) and white balance as
//! channel gains (`wbRatio`), because an ARW carries no two-illuminant
//! calibration. See the `arw` module docs for where the matrix comes from
//! and why its colour is approximate.

use serde::{Deserialize, Serialize};

use super::{read_info, read_mosaic, ArwColour};
use crate::black_level::BlackLevels;
use crate::dng::linear::{fill_plane, plane_scales, DngKind, PlaneLayout, PlaneMapping, PlaneParams, StoredPlane};
use crate::raf::base_curves;
use crate::dng::camera_color::{DngCalibration, DngWhiteBalance};
use crate::raf::develop::RawDevelopSettings;

/// Every per-image decision the renders need, settled by [`prepare_arw`].
/// Serializable so each worker gets exactly the same.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArwRenderParams {
    /// The prepared plane's size: the crop, before orientation.
    pub width: u32,
    pub height: u32,
    /// The 2×2 Bayer pattern from the crop's top-left (0 R, 1 G, 2 B).
    pub cfa: [u8; 4],
    /// EXIF orientation (1..=8).
    pub orientation: u16,
    /// The white level, in the linearized units the black level uses.
    pub white_level: u32,
    /// The gain the plane already carries: the as-shot white balance,
    /// green 1.
    pub as_shot_gain: [f32; 3],
    /// Each channel's clip level in the renders' units (`as_shot_gain`).
    pub clip_levels: Option<[f32; 3]>,
    /// White-balanced camera RGB → linear sRGB, row-major; rows sum to 1.
    pub cam_to_rgb: [f32; 9],
    /// Where `cam_to_rgb` came from.
    pub colour: ArwColour,
    /// The body's measured calibration, when it has one: white balance
    /// then follows the DNG colour method (`white_balance_for_ratio`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calibration: Option<DngCalibration>,
    /// `Make Model`, for the host to show.
    pub camera_model: String,
}

impl ArwRenderParams {
    /// The final (displayed) size after orientation.
    pub fn oriented_size(&self) -> (u32, u32) {
        self.layout().oriented_size()
    }
}

impl PlaneParams for ArwRenderParams {
    fn layout(&self) -> PlaneLayout {
        PlaneLayout { width: self.width, height: self.height, kind: DngKind::Bayer, samples_per_pixel: 1, cfa: self.cfa, orientation: self.orientation }
    }
}

/// [`prepare_arw`]'s result.
pub struct ArwPrepared {
    pub params: ArwRenderParams,
    /// `width × height` values, the Bayer mosaic of the crop.
    pub plane: Vec<f32>,
    /// Corrections the file records that this decode does not apply.
    pub unhandled: Vec<String>,
    pub debug_log: Vec<String>,
}

/// Decode an ARW to linear camera RGB for the develop chain. An error is a
/// sentence a person can read (an unsupported variant or a damaged file).
pub fn prepare_arw(data: &[u8]) -> Result<ArwPrepared, String> {
    let stored = read_info(data)?;
    let mosaic = read_mosaic(data, &stored)?;
    let c = stored.crop;
    let (top, left, w, h) = (c.top as usize, c.left as usize, c.width as usize, c.height as usize);
    // The pattern and the black levels from the crop's top-left.
    let at = |r: usize, col: usize| ((r + top) & 1) * 2 + ((col + left) & 1);
    let cfa = [stored.cfa[at(0, 0)], stored.cfa[at(0, 1)], stored.cfa[at(1, 0)], stored.cfa[at(1, 1)]];
    let black_tile = vec![stored.black[at(0, 0)], stored.black[at(0, 1)], stored.black[at(1, 0)], stored.black[at(1, 1)]];
    let black = BlackLevels::tile(2, 2, 1, black_tile).ok_or("This Sony RAW's black level is damaged")?;
    let (scales, _) = plane_scales(&black, &[], &[], &[stored.white], w, h, 1)?;
    let source = StoredPlane { values: &mosaic.values, width: stored.width as usize, samples: 1, top, left, width_out: w, height_out: h };
    let table = mosaic.table.as_deref();
    let mapping = PlaneMapping { kind: DngKind::Bayer, cfa, table, black: &black, black_origin: (0, 0), scales: &scales, gain: stored.as_shot_gain };
    let plane = fill_plane(&source, |v| v, &mapping)?;
    let params = ArwRenderParams {
        width: c.width,
        height: c.height,
        cfa,
        orientation: stored.orientation,
        white_level: stored.white,
        as_shot_gain: stored.as_shot_gain,
        clip_levels: Some(stored.as_shot_gain),
        cam_to_rgb: stored.cam_to_rgb,
        colour: stored.colour,
        calibration: stored.calibration,
        camera_model: stored.camera_model,
    };
    Ok(ArwPrepared { params, plane, unhandled: stored.unhandled, debug_log: stored.debug_log })
}

/// The develop settings an ARW opens with: the as-shot white balance
/// (`wbRatio` 1), the file's matrix, no baseline exposure (an ARW records
/// none), no extra saturation, and the engine's neutral base curve. The
/// exposure stays 0 here for now: the baked decode matches the camera's
/// preview (`arw::exposure`), this path does not yet.
pub fn develop_defaults(params: &ArwRenderParams) -> RawDevelopSettings {
    RawDevelopSettings {
        wb_ratio: [1.0, 1.0, 1.0],
        cam_to_rgb: params.cam_to_rgb,
        exposure_ev: 0.0,
        saturation: 1.0,
        highlight_desaturation: true,
        base_curve: Some(base_curves::curve_lut(&base_curves::NEUTRAL).to_vec()),
        clip_levels: params.clip_levels,
    }
}

/// The RAW step's `wbRatio` and `camToRgb`, and the white point's kelvin
/// and tint, for a `wbRatio` on top of the as-shot balance, by the DNG
/// colour method. An error for a body without measured colour, whose
/// matrix is fixed (`develop_defaults`' `camToRgb` holds for every white
/// balance) and whose white balance has no colour temperature.
pub fn white_balance_for_ratio(params: &ArwRenderParams, wb_ratio: [f32; 3]) -> Result<DngWhiteBalance, String> {
    let cal = params.calibration.as_ref().ok_or(NO_CALIBRATION)?;
    cal.white_balance_for_ratio(wb_ratio, params.as_shot_gain)
        .ok_or_else(|| format!("white balance {wb_ratio:?} is not a colour this camera can see"))
}

/// The same for a white point in kelvin and tint.
pub fn white_balance_for_temperature(params: &ArwRenderParams, kelvin: f32, tint: f32) -> Result<DngWhiteBalance, String> {
    if !(kelvin.is_finite() && tint.is_finite()) {
        return Err("temperature and tint must be numbers".into());
    }
    let cal = params.calibration.as_ref().ok_or(NO_CALIBRATION)?;
    cal.white_balance_for_temperature(f64::from(kelvin), f64::from(tint), params.as_shot_gain)
        .ok_or_else(|| format!("{kelvin} K, tint {tint} is not a white this camera can see"))
}

const NO_CALIBRATION: &str = "This camera has no measured colour data, so its white balance has no colour temperature";
