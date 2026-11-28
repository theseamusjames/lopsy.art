//! A Nikon NEF decoded for the develop chain: linear camera RGB at the
//! as-shot white balance, the counterpart of `arw::linear` and drawn by
//! the same DNG renders. [`prepare_nef`] makes the prepared plane with the
//! DNG decode's own `fill_plane` (the stored values minus Nikon's black
//! level, over the white level, cropped, times the as-shot gains);
//! [`NefRenderParams`] is a `dng::linear::PlaneParams`.
//!
//! The develop settings follow a RAF's model: one fixed matrix and white
//! balance as channel gains (`wbRatio`); a NEF carries no calibration.

use serde::{Deserialize, Serialize};

use super::{read_info, read_mosaic, NefColour};
use crate::black_level::BlackLevels;
use crate::dng::linear::{fill_plane, plane_scales, DngKind, PlaneLayout, PlaneMapping, PlaneParams, StoredPlane};
use crate::raf::develop::RawDevelopSettings;

/// Every per-image decision the renders need, settled by [`prepare_nef`].
/// Serializable so each worker gets exactly the same.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NefRenderParams {
    /// The prepared plane's size: the crop, before orientation.
    pub width: u32,
    pub height: u32,
    /// The 2×2 Bayer pattern from the crop's top-left (0 R, 1 G, 2 B).
    pub cfa: [u8; 4],
    /// EXIF orientation (1..=8).
    pub orientation: u16,
    pub white_level: u32,
    /// The gain the plane already carries: the as-shot white balance,
    /// green 1.
    pub as_shot_gain: [f32; 3],
    /// Each channel's clip level in the renders' units (`as_shot_gain`).
    pub clip_levels: Option<[f32; 3]>,
    /// White-balanced camera RGB → linear sRGB, row-major; rows sum to 1.
    pub cam_to_rgb: [f32; 9],
    pub colour: NefColour,
    /// `Make Model`, for the host to show.
    pub camera_model: String,
    /// The exposure the develop chain opens with, in stops: matched to the
    /// camera's embedded preview by the RAW interface's prepare, 0
    /// otherwise.
    #[serde(default)]
    pub default_exposure_ev: f32,
    /// What the renders need to reconstruct clipped channels, measured by
    /// the RAW interface's prepare; `None` (and not written) otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub highlight_chroma: Option<crate::raf::highlights::ChromaGrid>,
}

impl NefRenderParams {
    /// The final (displayed) size after orientation.
    pub fn oriented_size(&self) -> (u32, u32) {
        self.layout().oriented_size()
    }
}

impl PlaneParams for NefRenderParams {
    fn layout(&self) -> PlaneLayout {
        PlaneLayout { width: self.width, height: self.height, kind: DngKind::Bayer, samples_per_pixel: 1, cfa: self.cfa, orientation: self.orientation }
    }

    fn highlight_chroma(&self) -> Option<&crate::raf::highlights::ChromaGrid> {
        self.highlight_chroma.as_ref()
    }
}

/// [`prepare_nef`]'s result.
pub struct NefPrepared {
    pub params: NefRenderParams,
    /// `width × height` values, the Bayer mosaic of the crop.
    pub plane: Vec<f32>,
    pub debug_log: Vec<String>,
}

/// Decode a NEF to linear camera RGB for the develop chain. An error is a
/// sentence a person can read (an unsupported variant or a damaged file).
pub fn prepare_nef(data: &[u8]) -> Result<NefPrepared, String> {
    let mut stored = read_info(data)?;
    let mosaic = read_mosaic(data, &stored)?;
    super::crop::place_by_preview(data, &mut stored, &mosaic);
    let c = stored.crop;
    let (top, left, w, h) = (c.top as usize, c.left as usize, c.width as usize, c.height as usize);
    // The pattern and the black levels from the crop's top-left.
    let at = |r: usize, col: usize| ((r + top) & 1) * 2 + ((col + left) & 1);
    let cfa = [stored.cfa[at(0, 0)], stored.cfa[at(0, 1)], stored.cfa[at(1, 0)], stored.cfa[at(1, 1)]];
    let black_tile = vec![stored.black[at(0, 0)], stored.black[at(0, 1)], stored.black[at(1, 0)], stored.black[at(1, 1)]];
    let black = BlackLevels::tile(2, 2, 1, black_tile).ok_or("This Nikon RAW's black level is damaged")?;
    let (scales, _) = plane_scales(&black, &[], &[], &[stored.white], w, h, 1)?;
    let source = StoredPlane { values: &mosaic, width: stored.width as usize, samples: 1, top, left, width_out: w, height_out: h };
    let mapping = PlaneMapping { kind: DngKind::Bayer, cfa, table: None, black: &black, black_origin: (0, 0), scales: &scales, gain: stored.as_shot_gain, maps: None };
    let plane = fill_plane(&source, |v| v, &mapping)?;
    let params = NefRenderParams {
        width: c.width,
        height: c.height,
        cfa,
        orientation: stored.orientation,
        white_level: stored.white,
        as_shot_gain: stored.as_shot_gain,
        clip_levels: Some(stored.as_shot_gain),
        cam_to_rgb: stored.cam_to_rgb,
        colour: stored.colour,
        camera_model: stored.camera_model,
        default_exposure_ev: 0.0,
        highlight_chroma: None,
    };
    Ok(NefPrepared { params, plane, debug_log: stored.debug_log })
}

/// The develop settings a NEF opens with: the as-shot white balance
/// (`wbRatio` 1), the file's matrix, `default_exposure_ev`, and the
/// Standard look's base curve and saturation (`raw::OpeningLook::default`).
pub fn develop_defaults(params: &NefRenderParams) -> RawDevelopSettings {
    develop_defaults_with(params, &crate::raw::OpeningLook::default())
}

/// [`develop_defaults`] with the base curve and saturation of `look`.
pub fn develop_defaults_with(params: &NefRenderParams, look: &crate::raw::OpeningLook) -> RawDevelopSettings {
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
