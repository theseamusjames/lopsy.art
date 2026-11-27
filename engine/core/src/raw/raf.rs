//! RAF on the RAW interface: delegation to `raf` and `raf::develop` only.
//! The parameters are `RafRenderParams` exactly as `rafPrepare` writes
//! them, and every render is the function the `raf…` exports call.

use super::{KelvinModel, MatrixModel, PresetSource, RawDescription, RawFormat, RawFormatId, RawPlane, RawWhite, WhiteBalanceModel};
use crate::raf::{self, develop, wb_presets, RafBand, RafBandPixels, RafDecodeOpts, RafRenderParams};

pub struct Raf;

impl RawFormat for Raf {
    const ID: RawFormatId = RawFormatId::Raf;
    type Params = RafRenderParams;

    fn prepare(data: &[u8]) -> Result<RawPlane<RafRenderParams>, String> {
        let prep = raf::prepare_raf(data, RafDecodeOpts::default()).map_err(|e| format!("RAF decode failed: {e}"))?;
        Ok(RawPlane { params: prep.params, plane: prep.mosaic, not_applied: Vec::new(), debug_log: prep.debug_log })
    }

    fn describe(data: &[u8], prep: &RawPlane<RafRenderParams>) -> Result<RawDescription, String> {
        let p = &prep.params;
        let (model, as_shot) = raf::read_wb_info(data)?;
        let (width, height) = p.oriented_size();
        let presets = as_shot.map(|a| wb_presets::recipe_presets(&model, a)).unwrap_or_default();
        let kelvin = match as_shot.and_then(|a| wb_presets::kelvin_scale(&model, a)) {
            Some(k) => KelvinModel::Fitted { mired_at_zero: k.mired_at_zero, mired_per_unit: k.mired_per_unit, as_shot_kelvin: k.as_shot_kelvin },
            None => KelvinModel::None,
        };
        Ok(RawDescription {
            format: RawFormatId::Raf,
            width,
            height,
            plane_width: p.width,
            plane_height: p.height,
            samples_per_pixel: 1,
            clip_levels: p.clip_levels,
            camera_model: model,
            color_note: None,
            not_applied: prep.not_applied.clone(),
            develop_defaults: develop::develop_defaults(p),
            profiles: develop::develop_profiles(p),
            white_balance: WhiteBalanceModel {
                matrix: MatrixModel::Fixed,
                kelvin,
                preset_source: if presets.is_empty() { PresetSource::None } else { PresetSource::Camera },
                presets,
            },
            finished_bands: true,
        })
    }

    fn plane_height(p: &RafRenderParams) -> u32 {
        p.height
    }

    fn render_linear_band(src: &[f32], p: &RafRenderParams, band: RafBand) -> Result<RafBandPixels, String> {
        develop::render_linear_band(src, p, band)
    }

    fn render_binned_linear(plane: &[f32], p: &RafRenderParams, min_long_edge: u32) -> Result<(u32, u32, Vec<f32>), String> {
        develop::render_binned_linear_for(plane, p, min_long_edge)
    }

    fn render_finished_band(src: &[f32], p: &RafRenderParams, band: RafBand) -> Option<Result<RafBandPixels, String>> {
        Some(raf::render_band(src, p, band))
    }

    fn white_for_recipe(_p: &RafRenderParams, temperature: f32, tint: f32) -> Result<RawWhite, String> {
        Ok(super::white_balance::fixed_white(temperature, tint))
    }

    fn temperature_for_kelvin(_p: &RafRenderParams, _kelvin: f32, _tint: f32) -> Result<f32, String> {
        Err("A RAF's Kelvin is its description's fitted scale: convert with that".into())
    }
}
