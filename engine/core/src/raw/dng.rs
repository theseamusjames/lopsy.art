//! DNG on the RAW interface: delegation to `dng::linear`. Its white
//! balance follows the DNG colour method (`white_balance::measured_white`):
//! the matrix per white, measured Kelvin, CIE illuminant presets.

use super::white_balance::{illuminant_presets, measured_white, temperature_for_kelvin};
use super::{camera_and_monochrome, KelvinModel, MatrixModel, PresetSource, RawDescription, RawFormat, RawFormatId, RawPlane, RawWhite, WhiteBalanceModel};
use crate::dng::linear::{self, DngRenderParams};
use crate::raf::{RafBand, RafBandPixels};

pub struct Dng;

impl RawFormat for Dng {
    const ID: RawFormatId = RawFormatId::Dng;
    type Params = DngRenderParams;

    fn prepare(data: &[u8]) -> Result<RawPlane<DngRenderParams>, String> {
        let prep = linear::prepare_dng(data).map_err(|e| format!("DNG cannot open as RAW: {e}"))?;
        Ok(RawPlane { params: prep.params, plane: prep.plane, not_applied: prep.unhandled, debug_log: prep.debug_log })
    }

    fn describe(_data: &[u8], prep: &RawPlane<DngRenderParams>) -> Result<RawDescription, String> {
        let p = &prep.params;
        let defaults = linear::develop_defaults(p).map_err(|e| format!("DNG cannot open as RAW: {e}"))?;
        let as_shot = measured_white(&p.calibration, p.as_shot_gain, 0.0, 0.0).map_err(|e| format!("DNG cannot open as RAW: {e}"))?;
        let (width, height) = p.oriented_size();
        Ok(RawDescription {
            format: RawFormatId::Dng,
            width,
            height,
            plane_width: p.width,
            plane_height: p.height,
            samples_per_pixel: p.samples_per_pixel,
            clip_levels: p.clip_levels,
            camera_model: p.camera_model.clone(),
            color_note: None,
            not_applied: prep.not_applied.clone(),
            profiles: camera_and_monochrome(&defaults),
            develop_defaults: defaults,
            white_balance: WhiteBalanceModel {
                matrix: MatrixModel::PerWhite,
                kelvin: KelvinModel::Measured { as_shot_kelvin: as_shot.kelvin.unwrap_or(0.0), as_shot_tint: as_shot.tint.unwrap_or(0.0) },
                preset_source: PresetSource::Illuminants,
                presets: illuminant_presets(&p.calibration, p.as_shot_gain),
            },
            finished_bands: false,
        })
    }

    fn plane_height(p: &DngRenderParams) -> u32 {
        p.height
    }

    fn render_linear_band(src: &[f32], p: &DngRenderParams, band: RafBand) -> Result<RafBandPixels, String> {
        linear::render_linear_band(src, p, band)
    }

    fn render_binned_linear(plane: &[f32], p: &DngRenderParams, min_long_edge: u32) -> Result<(u32, u32, Vec<f32>), String> {
        linear::render_binned_linear_for(plane, p, min_long_edge)
    }

    fn white_for_recipe(p: &DngRenderParams, temperature: f32, tint: f32) -> Result<RawWhite, String> {
        measured_white(&p.calibration, p.as_shot_gain, temperature, tint)
    }

    fn temperature_for_kelvin(p: &DngRenderParams, kelvin: f32, tint: f32) -> Result<f32, String> {
        temperature_for_kelvin(&p.calibration, p.as_shot_gain, kelvin, tint)
    }
}
