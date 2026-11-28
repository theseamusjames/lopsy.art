//! Nikon NEF on the RAW interface: delegation to `nef::linear`. A fixed
//! matrix, no Kelvin and no presets, as an ARW without measured colour.

use super::white_balance::fixed_white;
use super::{standard_profiles, KelvinModel, MatrixModel, OpeningLook, PresetSource, RawDescription, RawFormat, RawFormatId, RawPlane, RawWhite, WhiteBalanceModel};
use crate::dng::linear::{render_binned_linear_for, render_linear_band, PlaneParams};
use crate::nef::linear::{self, NefRenderParams};
use crate::raf::{RafBand, RafBandPixels};

pub struct Nef;

impl RawFormat for Nef {
    const ID: RawFormatId = RawFormatId::Nef;
    type Params = NefRenderParams;

    fn prepare(data: &[u8], look: &OpeningLook) -> Result<RawPlane<NefRenderParams>, String> {
        let mut prep = linear::prepare_nef(data)?;
        // Clipped channels are reconstructed, as a RAF's.
        prep.params.highlight_chroma = crate::dng::linear::measure_highlight_chroma(&prep.plane, &prep.params.layout(), prep.params.clip_levels);
        // The develop chain opens as bright as the camera's own preview,
        // through the curve it opens with.
        let settings = linear::develop_defaults_with(&prep.params, look);
        if let Some(ev) = crate::nef::exposure::match_develop_exposure_with(data, &prep.params, &prep.plane, &settings) {
            prep.params.default_exposure_ev = ev;
            prep.debug_log.push(format!("[NEF] develop exposure {ev:+.3} EV, matched to the camera's preview"));
        }
        Ok(RawPlane { params: prep.params, plane: prep.plane, not_applied: Vec::new(), debug_log: prep.debug_log })
    }

    fn describe(_data: &[u8], prep: &RawPlane<NefRenderParams>, look: &OpeningLook) -> Result<RawDescription, String> {
        let p = &prep.params;
        let defaults = linear::develop_defaults_with(p, look);
        let (width, height) = p.oriented_size();
        Ok(RawDescription {
            format: RawFormatId::Nef,
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

    fn plane_height(p: &NefRenderParams) -> u32 {
        p.height
    }

    fn orientation(p: &NefRenderParams) -> u16 {
        p.orientation
    }

    fn oriented_size(p: &NefRenderParams) -> (u32, u32) {
        p.oriented_size()
    }

    fn render_linear_band(src: &[f32], p: &NefRenderParams, band: RafBand) -> Result<RafBandPixels, String> {
        render_linear_band(src, p, band)
    }

    fn render_binned_linear(plane: &[f32], p: &NefRenderParams, min_long_edge: u32) -> Result<(u32, u32, Vec<f32>), String> {
        render_binned_linear_for(plane, p, min_long_edge)
    }

    fn white_for_recipe(_p: &NefRenderParams, temperature: f32, tint: f32) -> Result<RawWhite, String> {
        Ok(fixed_white(temperature, tint))
    }

    fn temperature_for_kelvin(_p: &NefRenderParams, _kelvin: f32, _tint: f32) -> Result<f32, String> {
        Err("This camera has no measured colour data, so its white balance has no colour temperature".into())
    }
}
