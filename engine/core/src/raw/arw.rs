//! Sony ARW on the RAW interface: delegation to `arw::linear`. A body with
//! measured colour takes the DNG colour method (matrix per white, measured
//! Kelvin, CIE illuminant presets); any other has a fixed matrix, no Kelvin
//! and no presets.

use super::white_balance::{fixed_white, illuminant_presets, measured_white, temperature_for_kelvin};
use super::{standard_profiles, KelvinModel, MatrixModel, OpeningLook, PresetSource, RawDescription, RawFormat, RawFormatId, RawPlane, RawWhite, WhiteBalanceModel};
use crate::arw::linear::{self, ArwRenderParams};
use crate::dng::linear::{render_binned_linear_for, render_linear_band, PlaneParams};
use crate::raf::{RafBand, RafBandPixels};

pub struct Arw;

impl RawFormat for Arw {
    const ID: RawFormatId = RawFormatId::Arw;
    type Params = ArwRenderParams;

    fn prepare(data: &[u8], look: &OpeningLook) -> Result<RawPlane<ArwRenderParams>, String> {
        let mut prep = linear::prepare_arw(data)?;
        // Clipped channels are reconstructed, as a RAF's.
        prep.params.highlight_chroma = crate::dng::linear::measure_highlight_chroma(&prep.plane, &prep.params.layout(), prep.params.clip_levels);
        // The develop chain opens as bright as the camera's own preview,
        // through the curve it opens with.
        let settings = linear::develop_defaults_with(&prep.params, look);
        if let Some(ev) = crate::arw::exposure::match_develop_exposure_with(data, &prep.params, &prep.plane, &settings) {
            prep.params.default_exposure_ev = ev;
            prep.debug_log.push(format!("[ARW] develop exposure {ev:+.3} EV, matched to the camera's preview"));
        }
        Ok(RawPlane { params: prep.params, plane: prep.plane, not_applied: prep.unhandled, debug_log: prep.debug_log })
    }

    fn describe(_data: &[u8], prep: &RawPlane<ArwRenderParams>, look: &OpeningLook) -> Result<RawDescription, String> {
        let p = &prep.params;
        let defaults = linear::develop_defaults_with(p, look);
        let (width, height) = p.oriented_size();
        let white_balance = match &p.calibration {
            Some(cal) => {
                let as_shot = measured_white(cal, p.as_shot_gain, 0.0, 0.0)?;
                WhiteBalanceModel {
                    matrix: MatrixModel::PerWhite,
                    kelvin: KelvinModel::Measured { as_shot_kelvin: as_shot.kelvin.unwrap_or(0.0), as_shot_tint: as_shot.tint.unwrap_or(0.0) },
                    preset_source: PresetSource::Illuminants,
                    presets: illuminant_presets(cal, p.as_shot_gain),
                }
            }
            None => WhiteBalanceModel { matrix: MatrixModel::Fixed, kelvin: KelvinModel::None, preset_source: PresetSource::None, presets: Vec::new() },
        };
        Ok(RawDescription {
            format: RawFormatId::Arw,
            width,
            height,
            plane_width: p.width,
            plane_height: p.height,
            samples_per_pixel: 1,
            clip_levels: p.clip_levels,
            camera_model: p.camera_model.clone(),
            color_note: p.colour.note().map(str::to_string),
            not_applied: prep.not_applied.clone(),
            profiles: standard_profiles(&defaults),
            develop_defaults: defaults,
            white_balance,
            finished_bands: Self::FINISHED_BANDS,
        })
    }

    fn plane_height(p: &ArwRenderParams) -> u32 {
        p.height
    }

    fn render_linear_band(src: &[f32], p: &ArwRenderParams, band: RafBand) -> Result<RafBandPixels, String> {
        render_linear_band(src, p, band)
    }

    fn render_binned_linear(plane: &[f32], p: &ArwRenderParams, min_long_edge: u32) -> Result<(u32, u32, Vec<f32>), String> {
        render_binned_linear_for(plane, p, min_long_edge)
    }

    fn white_for_recipe(p: &ArwRenderParams, temperature: f32, tint: f32) -> Result<RawWhite, String> {
        match &p.calibration {
            Some(cal) => measured_white(cal, p.as_shot_gain, temperature, tint),
            None => Ok(fixed_white(temperature, tint)),
        }
    }

    fn temperature_for_kelvin(p: &ArwRenderParams, kelvin: f32, tint: f32) -> Result<f32, String> {
        let cal = p.calibration.as_ref().ok_or("This camera has no measured colour data, so its white balance has no colour temperature")?;
        temperature_for_kelvin(cal, p.as_shot_gain, kelvin, tint)
    }
}
