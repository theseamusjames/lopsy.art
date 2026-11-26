//! DNG on the RAW interface: delegation to `dng::linear`. Its white
//! balance follows the DNG colour method (`white_balance::measured_white`):
//! the matrix per white, measured Kelvin, CIE illuminant presets.

use super::white_balance::{illuminant_presets, measured_white, temperature_for_kelvin};
use super::{standard_profiles, KelvinModel, MatrixModel, OpeningLook, PresetSource, RawDescription, RawFormat, RawFormatId, RawPlane, RawWhite, WhiteBalanceModel};
use crate::dng::linear::{self, DngRenderParams, PlaneParams};
use crate::raf::{RafBand, RafBandPixels};

pub struct Dng;

/// The opening exposure matched to the camera's preview (`dng::preview`),
/// or `None` when the file does not qualify or has no usable preview.
fn preview_exposure(data: &[u8], params: &DngRenderParams, plane: &[f32], look: &OpeningLook) -> Option<f32> {
    use crate::arw::exposure::{match_rendered_median, preview_sized_view};
    use crate::dng::preview::{camera_preview_for_exposure, MAX_ABOVE_BASELINE, MIN_BELOW_BASELINE};
    let (ow, oh) = params.oriented_size();
    let preview = camera_preview_for_exposure(data, f64::from(ow) / f64::from(oh))?;
    let (sw, sh, rgba) = preview_sized_view(plane, params, &preview)?;
    let settings = linear::develop_defaults_with(params, look).ok()?;
    let base = params.calibration.baseline_exposure as f32;
    Some(match_rendered_median(&rgba, sw, sh, &settings, preview.median, (base - MIN_BELOW_BASELINE, base + MAX_ABOVE_BASELINE)))
}

impl RawFormat for Dng {
    const ID: RawFormatId = RawFormatId::Dng;
    type Params = DngRenderParams;

    fn prepare(data: &[u8], look: &OpeningLook) -> Result<RawPlane<DngRenderParams>, String> {
        let mut prep = linear::prepare_dng(data).map_err(|e| format!("DNG cannot open as RAW: {e}"))?;
        // Clipped channels of a Bayer plane are reconstructed, as a RAF's.
        prep.params.highlight_chroma = linear::measure_highlight_chroma(&prep.plane, &prep.params.layout(), prep.params.clip_levels);
        // A prototype, off by default: a file that relies on a gain map
        // opens as bright as the camera's preview, through the curve.
        if look.dng_preview_exposure {
            if let Some(ev) = preview_exposure(data, &prep.params, &prep.plane, look) {
                prep.params.default_exposure_ev = Some(ev);
                prep.debug_log.push(format!("[DNG] develop exposure {ev:+.3} EV, matched to the camera's preview (baseline {:+.3})", prep.params.calibration.baseline_exposure));
            }
        }
        Ok(RawPlane { params: prep.params, plane: prep.plane, not_applied: prep.unhandled, debug_log: prep.debug_log })
    }

    fn describe(_data: &[u8], prep: &RawPlane<DngRenderParams>, look: &OpeningLook) -> Result<RawDescription, String> {
        let p = &prep.params;
        let defaults = linear::develop_defaults_with(p, look).map_err(|e| format!("DNG cannot open as RAW: {e}"))?;
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
            profiles: standard_profiles(&defaults),
            develop_defaults: defaults,
            white_balance: WhiteBalanceModel {
                matrix: MatrixModel::PerWhite,
                kelvin: KelvinModel::Measured { as_shot_kelvin: as_shot.kelvin.unwrap_or(0.0), as_shot_tint: as_shot.tint.unwrap_or(0.0) },
                preset_source: PresetSource::Illuminants,
                presets: illuminant_presets(&p.calibration, p.as_shot_gain),
            },
            finished_bands: Self::FINISHED_BANDS,
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
