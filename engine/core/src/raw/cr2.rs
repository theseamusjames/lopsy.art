//! Canon CR2 on the RAW interface: delegation to `cr2::linear`. A CR2
//! carries no calibration, so its matrix is fixed (the body's from
//! `camera_colour`, or none), with no Kelvin and no presets, as a Sony ARW
//! without measured colour.

use super::white_balance::fixed_white;
use super::{standard_profiles, KelvinModel, MatrixModel, OpeningLook, PresetSource, RawDescription, RawFormat, RawFormatId, RawPlane, RawWhite, WhiteBalanceModel};
use crate::cr2::linear::{self, Cr2RenderParams};
use crate::dng::linear::{render_binned_linear_for, render_linear_band, PlaneParams};
use crate::raf::{RafBand, RafBandPixels};

pub struct Cr2;

impl RawFormat for Cr2 {
    const ID: RawFormatId = RawFormatId::Cr2;
    type Params = Cr2RenderParams;

    fn prepare(data: &[u8], look: &OpeningLook) -> Result<RawPlane<Cr2RenderParams>, String> {
        let mut prep = linear::prepare_cr2(data)?;
        // Clipped channels are reconstructed, as an ARW's.
        prep.params.highlight_chroma = crate::dng::linear::measure_highlight_chroma(&prep.plane, &prep.params.layout(), prep.params.clip_levels);
        // The develop chain opens as bright as the camera's own preview,
        // through the curve it opens with.
        let settings = linear::develop_defaults_with(&prep.params, look);
        if let Some(ev) = linear::match_develop_exposure(data, &prep.params, &prep.plane, &settings) {
            prep.params.default_exposure_ev = ev;
            prep.debug_log.push(format!("[CR2] develop exposure {ev:+.3} EV, matched to the camera's preview"));
        }
        Ok(RawPlane { params: prep.params, plane: prep.plane, not_applied: prep.unhandled, debug_log: prep.debug_log })
    }

    fn describe(_data: &[u8], prep: &RawPlane<Cr2RenderParams>, look: &OpeningLook) -> Result<RawDescription, String> {
        let p = &prep.params;
        let defaults = linear::develop_defaults_with(p, look);
        let (width, height) = p.oriented_size();
        Ok(RawDescription {
            format: RawFormatId::Cr2,
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
            white_balance: WhiteBalanceModel { matrix: MatrixModel::Fixed, kelvin: KelvinModel::None, preset_source: PresetSource::None, presets: Vec::new() },
            finished_bands: Self::FINISHED_BANDS,
        })
    }

    fn plane_height(p: &Cr2RenderParams) -> u32 {
        p.height
    }

    fn orientation(p: &Cr2RenderParams) -> u16 {
        p.orientation
    }

    fn oriented_size(p: &Cr2RenderParams) -> (u32, u32) {
        p.oriented_size()
    }

    fn render_linear_band(src: &[f32], p: &Cr2RenderParams, band: RafBand) -> Result<RafBandPixels, String> {
        render_linear_band(src, p, band)
    }

    fn render_binned_linear(plane: &[f32], p: &Cr2RenderParams, min_long_edge: u32) -> Result<(u32, u32, Vec<f32>), String> {
        render_binned_linear_for(plane, p, min_long_edge)
    }

    fn white_for_recipe(_p: &Cr2RenderParams, temperature: f32, tint: f32) -> Result<RawWhite, String> {
        Ok(fixed_white(temperature, tint))
    }

    fn temperature_for_kelvin(_p: &Cr2RenderParams, _kelvin: f32, _tint: f32) -> Result<f32, String> {
        Err("This camera has no measured colour data, so its white balance has no colour temperature".into())
    }
}
