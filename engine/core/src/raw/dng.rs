//! DNG on the RAW interface: delegation to `dng::linear`. Its white
//! balance follows the DNG colour method (`white_balance::measured_white`):
//! the matrix per white, measured Kelvin, CIE illuminant presets.

use super::white_balance::{illuminant_presets, measured_white, temperature_for_kelvin};
use super::{standard_profiles, KelvinModel, MatrixModel, OpeningLook, PresetSource, RawDescription, RawFormat, RawFormatId, RawPlane, RawWhite, WhiteBalanceModel};
use crate::dng::linear::{self, DngRenderParams, PlaneParams};
use crate::raf::develop::{DevelopProfile, ProfileRole, ProfileSettings, RawDevelopSettings};
use crate::raf::{RafBand, RafBandPixels};

pub struct Dng;

/// The exposure at which `look`'s curve and saturation match the camera's
/// preview (`dng::preview`), or `None` when the file does not qualify or
/// has no usable preview.
fn preview_exposure(data: &[u8], params: &DngRenderParams, plane: &[f32], look: &OpeningLook) -> Option<f32> {
    use crate::dng::preview::{matched_exposure, MAX_ABOVE_BASELINE, MIN_BELOW_BASELINE};
    let defaults = linear::develop_defaults_with(params, look).ok()?;
    let settings = RawDevelopSettings { base_curve: Some(look.curve.lut()), saturation: look.saturation, ..defaults };
    matched_exposure(data, params, plane, &settings, (MIN_BELOW_BASELINE, MAX_ABOVE_BASELINE))
}

/// The profiles of a file that opens with its own curve (its gain table
/// map applied, its `ProfileToneCurve` usable): the camera look first,
/// named "Camera" and standing for the maker's standard; then the
/// Standard look, at the exposure that matches the camera's preview, when
/// there is one (at the BaselineExposure the Standard curve opens these
/// files a stop or more too bright, so without a preview it is left out);
/// then Neutral, and Monochrome as the camera look without colour.
fn camera_curve_profiles(defaults: &RawDevelopSettings, standard_ev: Option<f32>, look: &OpeningLook) -> Vec<DevelopProfile> {
    let mut list = standard_profiles(defaults);
    if let Some(camera) = list.iter_mut().find(|p| p.role == ProfileRole::Camera) {
        camera.name = "Camera".into();
        camera.menu_name = "Camera".into();
        camera.maker_standard = true;
    }
    if let Some(ev) = standard_ev {
        let standard = DevelopProfile {
            id: "standard".into(),
            name: "Standard".into(),
            settings: ProfileSettings {
                cam_to_rgb: defaults.cam_to_rgb,
                exposure_ev: ev,
                saturation: look.saturation,
                highlight_desaturation: defaults.highlight_desaturation,
                base_curve: Some(look.curve.lut()),
            },
            role: ProfileRole::Look,
            menu_name: "Standard".into(),
            listed: true,
            same_as: None,
            maker_standard: false,
        };
        list.insert(1, standard);
    }
    list
}

impl RawFormat for Dng {
    const ID: RawFormatId = RawFormatId::Dng;
    type Params = DngRenderParams;

    fn prepare(data: &[u8], look: &OpeningLook) -> Result<RawPlane<DngRenderParams>, String> {
        let mut prep = linear::prepare_dng(data).map_err(|e| format!("DNG cannot open as RAW: {e}"))?;
        // Clipped channels of a Bayer plane are reconstructed, as a RAF's.
        prep.params.highlight_chroma = linear::measure_highlight_chroma(&prep.plane, &prep.params.layout(), prep.params.clip_levels);
        // A file with a gain map opens as bright as the camera's preview
        // through the Standard curve (`dng::preview` says why), unless the
        // map was applied and the file has its own curve: that pair opens
        // at the BaselineExposure, and the match is kept for the Standard
        // entry of its profile list.
        if look.dng_preview_exposure {
            if let Some(ev) = preview_exposure(data, &prep.params, &prep.plane, look) {
                if prep.params.camera_curve.is_some() {
                    prep.params.standard_exposure_ev = Some(ev);
                    prep.debug_log.push(format!("[DNG] develop exposure: the BaselineExposure {:+.3} with the file's own curve; Standard {ev:+.3} EV, matched to the camera's preview", prep.params.calibration.baseline_exposure));
                } else {
                    prep.params.default_exposure_ev = Some(ev);
                    prep.debug_log.push(format!("[DNG] develop exposure {ev:+.3} EV, matched to the camera's preview (baseline {:+.3})", prep.params.calibration.baseline_exposure));
                }
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
            profiles: if p.camera_curve.is_some() { camera_curve_profiles(&defaults, p.standard_exposure_ev, look) } else { standard_profiles(&defaults) },
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
