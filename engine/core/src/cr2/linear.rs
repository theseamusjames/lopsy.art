//! A Canon CR2 decoded for the develop chain: linear camera RGB at the
//! as-shot white balance, the counterpart of `arw::linear` and drawn by the
//! DNG renders. [`prepare_cr2`] makes the prepared plane with the DNG
//! decode's own `fill_plane` (each sample minus its position's black level,
//! over the white level, cropped, times the as-shot gains);
//! [`Cr2RenderParams`] is a `dng::linear::PlaneParams`, so
//! `dng::linear::render_linear_band` and `render_binned_linear_for` render
//! it, with the same units and the same band contract as a Bayer DNG's.
//!
//! The develop settings follow a RAF's model: one fixed matrix and white
//! balance as channel gains (`wbRatio`), because a CR2 carries no
//! calibration (see the `cr2` module docs).

use serde::{Deserialize, Serialize};

use super::{levels, preview_ranges, preview_rgb, read_info, read_mosaic, Cr2Colour};
use crate::black_level::BlackLevels;
use crate::dng::linear::{fill_plane, plane_scales, DngKind, PlaneLayout, PlaneMapping, PlaneParams, StoredPlane};
use crate::raf::develop::RawDevelopSettings;

/// Every per-image decision the renders need, settled by [`prepare_cr2`].
/// Serializable so each worker gets exactly the same.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cr2RenderParams {
    /// The prepared plane's size: the crop, before orientation.
    pub width: u32,
    pub height: u32,
    /// The 2×2 Bayer pattern from the crop's top-left (0 R, 1 G, 2 B).
    pub cfa: [u8; 4],
    /// EXIF orientation (1..=8).
    pub orientation: u16,
    /// The white level the plane was scaled by.
    pub white_level: u32,
    /// The gain the plane already carries: the as-shot white balance,
    /// green 1.
    pub as_shot_gain: [f32; 3],
    /// Each channel's clip level in the renders' units (`as_shot_gain`).
    pub clip_levels: Option<[f32; 3]>,
    /// White-balanced camera RGB → linear sRGB, row-major; rows sum to 1.
    pub cam_to_rgb: [f32; 9],
    /// Where `cam_to_rgb` came from.
    pub colour: Cr2Colour,
    /// `Make Model`, for the host to show.
    pub camera_model: String,
    /// The exposure the develop chain opens with, in stops: matched to the
    /// camera's embedded preview by the RAW interface's prepare, 0
    /// otherwise. Carried here so every worker and mode gets the same; the
    /// baked decode never reads it.
    #[serde(default)]
    pub default_exposure_ev: f32,
    /// What the renders need to reconstruct clipped channels, measured by
    /// the RAW interface's prepare; `None` (and not written) otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub highlight_chroma: Option<crate::raf::highlights::ChromaGrid>,
}

impl Cr2RenderParams {
    /// The final (displayed) size after orientation.
    pub fn oriented_size(&self) -> (u32, u32) {
        self.layout().oriented_size()
    }
}

impl PlaneParams for Cr2RenderParams {
    fn layout(&self) -> PlaneLayout {
        PlaneLayout { width: self.width, height: self.height, kind: DngKind::Bayer, samples_per_pixel: 1, cfa: self.cfa, orientation: self.orientation }
    }

    fn highlight_chroma(&self) -> Option<&crate::raf::highlights::ChromaGrid> {
        self.highlight_chroma.as_ref()
    }
}

/// [`prepare_cr2`]'s result.
pub struct Cr2Prepared {
    pub params: Cr2RenderParams,
    /// `width × height` values, the Bayer mosaic of the crop.
    pub plane: Vec<f32>,
    /// Corrections the file records that this decode does not apply.
    pub unhandled: Vec<String>,
    pub debug_log: Vec<String>,
}

/// Decode a CR2 to linear camera RGB for the develop chain. An error is a
/// sentence a person can read (an unsupported variant or a damaged file).
pub fn prepare_cr2(data: &[u8]) -> Result<Cr2Prepared, String> {
    let info = read_info(data)?;
    let mosaic = read_mosaic(data, &info)?;
    let preview = preview_rgb(data, info.crop);
    let measured = levels::measure(&mosaic, info.width as usize, info.crop, info.bits, info.as_shot_gain, preview.as_ref(), &info.camera_model)?;
    let c = info.crop;
    let (top, left, w, h) = (c.top as usize, c.left as usize, c.width as usize, c.height as usize);
    // The pattern and the black levels from the crop's top-left.
    let at = |r: usize, col: usize| ((r + top) & 1) * 2 + ((col + left) & 1);
    let cfa = [measured.cfa[at(0, 0)], measured.cfa[at(0, 1)], measured.cfa[at(1, 0)], measured.cfa[at(1, 1)]];
    let black_tile = vec![measured.black[at(0, 0)], measured.black[at(0, 1)], measured.black[at(1, 0)], measured.black[at(1, 1)]];
    let black = BlackLevels::tile(2, 2, 1, black_tile).ok_or("This Canon RAW's black level is damaged")?;
    let (scales, _) = plane_scales(&black, &[], &[], &[measured.white], w, h, 1)?;
    let source = StoredPlane { values: &mosaic, width: info.width as usize, samples: 1, top, left, width_out: w, height_out: h };
    let mapping = PlaneMapping { kind: DngKind::Bayer, cfa, table: None, black: &black, black_origin: (0, 0), scales: &scales, gain: info.as_shot_gain, maps: None };
    let plane = fill_plane(&source, |v| v, &mapping)?;
    drop(mosaic);
    let mut debug_log = info.debug_log;
    debug_log.push(format!(
        "[CR2] black {:?} (masked border), white {} ({}), colour filter {:?} from the sensor's corner ({}), {:?} from the crop's",
        measured.black, measured.white, measured.white_source, measured.cfa, measured.cfa_source, cfa
    ));
    let params = Cr2RenderParams {
        width: c.width,
        height: c.height,
        cfa,
        orientation: info.orientation,
        white_level: measured.white,
        as_shot_gain: info.as_shot_gain,
        clip_levels: Some(info.as_shot_gain),
        cam_to_rgb: info.cam_to_rgb,
        colour: info.colour,
        camera_model: info.camera_model,
        default_exposure_ev: 0.0,
        highlight_chroma: None,
    };
    Ok(Cr2Prepared { params, plane, unhandled: info.unhandled, debug_log })
}

/// The aspects the camera's preview may have for a picture of `ow` × `oh`
/// after orientation: Canon stores the preview unturned, so either way
/// round.
pub fn preview_aspects(ow: u32, oh: u32) -> [f64; 2] {
    let a = f64::from(ow) / f64::from(oh.max(1));
    [a, 1.0 / a]
}

/// The exposure (stops) at which the develop chain's rendering of a
/// prepared CR2 with `settings` has the median brightness of the camera's
/// embedded preview, or `None` without a usable preview: an ARW's method
/// (`arw::exposure::match_develop_exposure_with`) on the CR2's previews.
pub fn match_develop_exposure(data: &[u8], params: &Cr2RenderParams, plane: &[f32], settings: &RawDevelopSettings) -> Option<f32> {
    use crate::arw::exposure;
    let (ow, oh) = params.oriented_size();
    let preview = exposure::preview_of(data, &preview_ranges(data), &preview_aspects(ow, oh), ow.max(oh))?;
    let (sw, sh, rgba) = exposure::preview_sized_view(plane, params, &preview)?;
    Some(exposure::match_rendered_median(&rgba, sw, sh, settings, preview.median, (exposure::MIN_EV, exposure::MAX_EV)))
}

/// The develop settings a CR2 opens with: the as-shot white balance
/// (`wbRatio` 1), the fixed matrix, `default_exposure_ev`, and the base
/// curve and saturation of `look`.
pub fn develop_defaults_with(params: &Cr2RenderParams, look: &crate::raw::OpeningLook) -> RawDevelopSettings {
    RawDevelopSettings {
        wb_ratio: [1.0, 1.0, 1.0],
        cam_to_rgb: params.cam_to_rgb,
        exposure_ev: params.default_exposure_ev,
        saturation: look.saturation,
        highlight_desaturation: true,
        base_curve: Some(look.curve.lut()),
        clip_levels: params.clip_levels,
    }
}

/// [`develop_defaults_with`] the Standard look.
pub fn develop_defaults(params: &Cr2RenderParams) -> RawDevelopSettings {
    develop_defaults_with(params, &crate::raw::OpeningLook::default())
}
