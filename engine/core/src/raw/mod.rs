//! One RAW interface over every format the develop chain takes: RAF, DNG
//! and Sony ARW. A host asks for a file's format ([`sniff`]), prepares it
//! once ([`prepare`]: the plane, the parameters as the format's own JSON,
//! and a [`RawDescription`] of everything the app needs to show and develop
//! it), then renders bands and the binned first view through functions that
//! take the format and its parameters string ([`render_linear_band`],
//! [`render_binned_linear`], [`plan_bands`], [`render_finished_band`]).
//!
//! Each format implements [`RawFormat`] by delegating to its own decoder and
//! nothing else (`raf.rs`, `dng.rs`, `arw.rs`): RAF's parameters are exactly
//! the string `rafPrepare` writes, and its renders exactly `raf::develop`'s.
//! The parameters travel as the format's own JSON, with the format named
//! beside them, rather than as one tagged enum, so no format's floats are
//! parsed twice on their way to a worker.
//!
//! **White balance** stays in the recipe's relative units for every format
//! (`white_balance`); what differs is the model the description reports:
//! the matrix is fixed (RAF, an ARW without measured colour) or follows the
//! white (DNG, a measured ARW), and Kelvin is fitted (RAF), measured (DNG,
//! measured ARW) or absent.
//!
//! **A fourth format** brings a decoder under `core/src/<fmt>/`, an `impl
//! RawFormat`, one [`RawFormatId`] variant, one [`sniff`] arm and the arms of
//! the `dispatch!` matches below (the compiler lists every one).

pub mod arw;
pub mod dng;
pub mod look;
pub mod raf;
pub mod scaled;
pub mod white_balance;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::raf::develop::{DevelopProfile, ProfileRole, ProfileSettings, RawDevelopSettings};
pub use look::{OpeningCurve, OpeningLook, STANDARD_SATURATION};
use crate::raf::wb_presets::RecipeWbPreset;
use crate::raf::{RafBand, RafBandPixels};
pub use scaled::ScaledBand;

/// Rows of a plane to render: output rows `[y0, y1)` from plane rows
/// `[src_y0, src_y1)` (the halo included). Every format's bands are this
/// type, which RAF introduced.
pub type RawBand = RafBand;

/// Rendered rows: where they go in the oriented frame, their size and RGBA
/// f32 pixels. Every format's renders are this type, which RAF introduced.
pub type RawBandPixels = RafBandPixels;

/// The formats the RAW interface knows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RawFormatId {
    Raf,
    Dng,
    Arw,
}

impl RawFormatId {
    pub fn as_str(self) -> &'static str {
        match self {
            RawFormatId::Raf => "raf",
            RawFormatId::Dng => "dng",
            RawFormatId::Arw => "arw",
        }
    }

    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "raf" => Ok(RawFormatId::Raf),
            "dng" => Ok(RawFormatId::Dng),
            "arw" => Ok(RawFormatId::Arw),
            other => Err(format!("'{other}' is not a RAW format this engine reads")),
        }
    }
}

/// The format of a file, from its header only: a RAF by its magic, a DNG by
/// a TIFF IFD0 with `DNGVersion`, a Sony raw by `arw::is_sony_raw` (which
/// includes Sony's older SR2 and SRF; preparing them says they are not
/// supported). `None` for anything else.
pub fn sniff(data: &[u8]) -> Option<RawFormatId> {
    if data.starts_with(b"FUJIFILMCCD-RAW") {
        return Some(RawFormatId::Raf);
    }
    let reader = crate::dng::tiff::TiffReader::new(data).ok()?;
    let ifd0 = reader.read_ifd(0).ok()?;
    if ifd0.iter().any(|e| e.tag == 0xC612) {
        return Some(RawFormatId::Dng);
    }
    crate::arw::is_sony_raw(data).then_some(RawFormatId::Arw)
}

/// A prepared file: its parameters, its plane (the RAF mosaic, the DNG or
/// ARW prepared plane), and what the decode noticed.
pub struct RawPlane<P> {
    pub params: P,
    pub plane: Vec<f32>,
    pub not_applied: Vec<String>,
    pub debug_log: Vec<String>,
}

/// How the matrix of the RAW step relates to the white balance.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MatrixModel {
    /// One matrix whatever the white (the profile's `camToRgb`).
    Fixed,
    /// The matrix follows the white: ask `white_for_recipe` for it.
    PerWhite,
}

/// Where Kelvin comes from, if anywhere.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum KelvinModel {
    /// A line fitted through the camera's calibration whites (RAF):
    /// `kelvin = 1e6 / (miredAtZero + miredPerUnit · temperature)`.
    Fitted { mired_at_zero: f32, mired_per_unit: f32, as_shot_kelvin: f32 },
    /// From the file's calibration (DNG, measured ARW): the correlated
    /// colour temperature of each white, through `white_for_recipe`.
    Measured { as_shot_kelvin: f32, as_shot_tint: f32 },
    /// No Kelvin: Temperature shows the recipe's relative numbers.
    None,
}

/// Where the white-balance presets come from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PresetSource {
    /// The body's own presets (RAF).
    Camera,
    /// CIE standard illuminants, through the file's calibration.
    Illuminants,
    None,
}

/// A format's white-balance model for the app.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhiteBalanceModel {
    pub matrix: MatrixModel,
    pub kelvin: KelvinModel,
    pub preset_source: PresetSource,
    /// In the recipe's units, in menu order (for a RAF, what
    /// `rafWhiteBalancePresets` gives).
    pub presets: Vec<RecipeWbPreset>,
}

/// Everything the app needs to show and develop a prepared file.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawDescription {
    pub format: RawFormatId,
    /// The final (oriented) size: the size of the developed picture, and of
    /// the baked decode.
    pub width: u32,
    pub height: u32,
    /// The plane's size, before orientation; a plane row is
    /// `plane_width · samples_per_pixel` values.
    pub plane_width: u32,
    pub plane_height: u32,
    pub samples_per_pixel: u32,
    pub clip_levels: Option<[f32; 3]>,
    pub camera_model: String,
    /// A sentence to show under the Profile control, when there is one.
    pub color_note: Option<String>,
    pub not_applied: Vec<String>,
    /// `setRawDevelop`'s settings to open with.
    pub develop_defaults: RawDevelopSettings,
    /// The Profile control's entries (`id`, `name`, `settings`).
    pub profiles: Vec<DevelopProfile>,
    pub white_balance: WhiteBalanceModel,
    /// Whether `render_finished_band` renders the finished look (RAF's
    /// legacy path); for the others the host uses the baked decode. Always
    /// the format's [`RawFormat::FINISHED_BANDS`], which
    /// [`renders_finished_bands`] answers before a file is prepared.
    pub finished_bands: bool,
}

/// The RAW step's white balance for recipe values (see `white_balance`).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawWhite {
    pub wb_ratio: [f32; 3],
    /// `None`: the matrix is fixed (the profile's `camToRgb`).
    pub cam_to_rgb: Option<[f32; 9]>,
    pub kelvin: Option<f32>,
    /// `cct::TINT_PER_DUV` × Duv, for display only.
    pub tint: Option<f32>,
}

/// One format on the RAW interface.
pub trait RawFormat {
    const ID: RawFormatId;
    /// Whether the format renders finished bands
    /// ([`RawFormat::render_finished_band`] gives `Some`), which its
    /// description's `finished_bands` repeats.
    const FINISHED_BANDS: bool = false;
    type Params: Serialize + DeserializeOwned;

    /// `look` is what a format without film looks opens with (RAF ignores
    /// it); [`OpeningLook::default`] is today's.
    fn prepare(data: &[u8], look: &OpeningLook) -> Result<RawPlane<Self::Params>, String>;
    /// Needs the bytes: RAF's presets and Kelvin scale come from its
    /// makernote. `look` as for `prepare`.
    fn describe(data: &[u8], prep: &RawPlane<Self::Params>, look: &OpeningLook) -> Result<RawDescription, String>;
    /// The plane's height, which bands are planned over.
    fn plane_height(p: &Self::Params) -> u32;
    /// The EXIF orientation (1..=8) the renders apply, which says where a
    /// band of plane rows lands in the oriented frame (`scaled`).
    fn orientation(p: &Self::Params) -> u16;
    /// The final (oriented) size, the description's `width` and `height`.
    fn oriented_size(p: &Self::Params) -> (u32, u32);
    fn plan_bands(p: &Self::Params, max_bands: u32) -> Vec<RawBand> {
        crate::raf::plan_bands(Self::plane_height(p), max_bands)
    }
    /// A band that renders plane rows `[y0, y1)` (and perhaps a few more),
    /// with the context the format's renders need.
    fn band_for_rows(p: &Self::Params, y0: u32, y1: u32) -> RawBand {
        crate::raf::band_for_rows(Self::plane_height(p), y0, y1)
    }
    fn render_linear_band(src: &[f32], p: &Self::Params, band: RawBand) -> Result<RawBandPixels, String>;
    fn render_binned_linear(plane: &[f32], p: &Self::Params, min_long_edge: u32) -> Result<(u32, u32, Vec<f32>), String>;
    /// The finished look of a band, for formats that have one (RAF).
    fn render_finished_band(_src: &[f32], _p: &Self::Params, _band: RawBand) -> Option<Result<RawBandPixels, String>> {
        None
    }
    /// The RAW step's white balance for the recipe's temperature and tint.
    fn white_for_recipe(p: &Self::Params, temperature: f32, tint: f32) -> Result<RawWhite, String>;
    /// The recipe temperature whose white reads `kelvin`, holding the
    /// recipe's `tint`.
    fn temperature_for_kelvin(p: &Self::Params, kelvin: f32, tint: f32) -> Result<f32, String>;
}

/// The Profile control of a format without film looks (DNG, ARW), with
/// the same fields as RAF's (`raf::develop::DevelopProfile`): the camera
/// entry is the maker-neutral standard look and stands for no other entry.
/// - `camera`, "Standard": the develop defaults, the Standard look
///   (`look::OpeningLook::default`). The app reads the engine's `camera`
///   entry as its recipe's default profile, `standard`.
/// - `neutral`, "Neutral": the near-linear `NEUTRAL` curve and no added
///   saturation, the look these formats opened with before Standard: a flat
///   start for grading. Same exposure as Standard.
/// - `monochrome`, "Monochrome": Standard with no colour.
///
/// A DNG that opens with its own curve (its gain table map applied, its
/// `ProfileToneCurve` used) lists its camera look first instead, "Camera",
/// then Standard matched to the camera's preview (`raw::dng`), id
/// `standard-look`: the app's recipe already calls the camera entry
/// `standard`, so no other entry may.
pub(crate) fn standard_profiles(defaults: &RawDevelopSettings) -> Vec<DevelopProfile> {
    let settings = |saturation: f32, base_curve: Option<Vec<f32>>| ProfileSettings {
        cam_to_rgb: defaults.cam_to_rgb,
        exposure_ev: defaults.exposure_ev,
        saturation,
        highlight_desaturation: defaults.highlight_desaturation,
        base_curve,
    };
    let entry = |id: &str, name: &str, role: ProfileRole, settings: ProfileSettings| DevelopProfile {
        id: id.into(),
        name: name.into(),
        settings,
        role,
        menu_name: name.into(),
        listed: true,
        same_as: None,
        maker_standard: role == ProfileRole::Camera,
    };
    vec![
        entry("camera", "Standard", ProfileRole::Camera, settings(defaults.saturation, defaults.base_curve.clone())),
        entry("neutral", "Neutral", ProfileRole::Neutral, settings(1.0, Some(OpeningCurve::Neutral.lut()))),
        entry("monochrome", "Monochrome", ProfileRole::Monochrome, settings(0.0, defaults.base_curve.clone())),
    ]
}

fn params_from<P: DeserializeOwned>(format: RawFormatId, json: &str) -> Result<P, String> {
    serde_json::from_str(json).map_err(|e| format!("{} params: {e}", format.as_str().to_uppercase()))
}

/// Run `$body` with `$F` the format's type.
macro_rules! dispatch {
    ($format:expr, $F:ident => $body:expr) => {
        match $format {
            RawFormatId::Raf => {
                type $F = raf::Raf;
                $body
            }
            RawFormatId::Dng => {
                type $F = dng::Dng;
                $body
            }
            RawFormatId::Arw => {
                type $F = arw::Arw;
                $body
            }
        }
    };
}

/// A prepared file of any format.
pub enum Prepared {
    Raf(RawPlane<<raf::Raf as RawFormat>::Params>),
    Dng(RawPlane<<dng::Dng as RawFormat>::Params>),
    Arw(RawPlane<<arw::Arw as RawFormat>::Params>),
}

/// What [`prepare`] gives: the file prepared, its description and its
/// parameters as the format's own JSON.
pub struct PreparedRaw {
    pub format: RawFormatId,
    pub description: RawDescription,
    pub params_json: String,
    pub prepared: Prepared,
}

impl PreparedRaw {
    pub fn plane(&self) -> &[f32] {
        match &self.prepared {
            Prepared::Raf(p) => &p.plane,
            Prepared::Dng(p) => &p.plane,
            Prepared::Arw(p) => &p.plane,
        }
    }

    pub fn take_plane(&mut self) -> Vec<f32> {
        match &mut self.prepared {
            Prepared::Raf(p) => std::mem::take(&mut p.plane),
            Prepared::Dng(p) => std::mem::take(&mut p.plane),
            Prepared::Arw(p) => std::mem::take(&mut p.plane),
        }
    }

    pub fn debug_log(&self) -> &[String] {
        match &self.prepared {
            Prepared::Raf(p) => &p.debug_log,
            Prepared::Dng(p) => &p.debug_log,
            Prepared::Arw(p) => &p.debug_log,
        }
    }

    /// The binned first view of the plane this still holds.
    pub fn binned_linear(&self, min_long_edge: u32) -> Result<(u32, u32, Vec<f32>), String> {
        match &self.prepared {
            Prepared::Raf(p) => raf::Raf::render_binned_linear(&p.plane, &p.params, min_long_edge),
            Prepared::Dng(p) => dng::Dng::render_binned_linear(&p.plane, &p.params, min_long_edge),
            Prepared::Arw(p) => arw::Arw::render_binned_linear(&p.plane, &p.params, min_long_edge),
        }
    }
}

fn finish<F: RawFormat>(data: &[u8], look: &OpeningLook, wrap: fn(RawPlane<F::Params>) -> Prepared) -> Result<PreparedRaw, String> {
    let prep = F::prepare(data, look)?;
    let description = F::describe(data, &prep, look)?;
    let params_json = serde_json::to_string(&prep.params).map_err(|e| format!("JSON serialize: {e}"))?;
    Ok(PreparedRaw { format: F::ID, description, params_json, prepared: wrap(prep) })
}

/// Prepare a file of any format the interface knows. An error is a
/// sentence; a DNG's starts "DNG cannot open as RAW:" (the host then uses
/// the baked decode).
pub fn prepare(data: &[u8]) -> Result<PreparedRaw, String> {
    prepare_with(data, &OpeningLook::default())
}

/// [`prepare`] with an opening look other than today's (`look`), for
/// comparing the Standard candidates.
pub fn prepare_with(data: &[u8], look: &OpeningLook) -> Result<PreparedRaw, String> {
    match sniff(data).ok_or("This file is not a RAW format this app reads")? {
        RawFormatId::Raf => finish::<raf::Raf>(data, look, Prepared::Raf),
        RawFormatId::Dng => finish::<dng::Dng>(data, look, Prepared::Dng),
        RawFormatId::Arw => finish::<arw::Arw>(data, look, Prepared::Arw),
    }
}

/// Bands for the plane of a prepared file.
pub fn plan_bands(format: RawFormatId, params_json: &str, max_bands: u32) -> Result<Vec<RawBand>, String> {
    dispatch!(format, F => Ok(F::plan_bands(&params_from::<<F as RawFormat>::Params>(format, params_json)?, max_bands)))
}

/// Bands that render the frame reduced to `dst_width`×`dst_height`
/// (`scaled`): each a [`RawBand`] of plane rows and the destination rows or
/// columns it makes.
pub fn plan_scaled_bands(format: RawFormatId, params_json: &str, dst_width: u32, dst_height: u32, max_bands: u32) -> Result<Vec<ScaledBand>, String> {
    dispatch!(format, F => scaled::plan::<F>(&params_from::<<F as RawFormat>::Params>(format, params_json)?, dst_width, dst_height, max_bands))
}

/// One band of the frame reduced to `dst_width`×`dst_height` (`scaled`):
/// `src` holds plane rows `[band.src_y0, band.src_y1)`, and the result is
/// destination rows (or columns) `[d0, d1)`, oriented RGBA f32, placed in
/// the reduced frame: linear camera RGB, or with `linear` false the
/// format's finished look (an error for a format without one).
pub fn render_scaled_band(format: RawFormatId, src: &[f32], params_json: &str, scaled: ScaledBand, dst_width: u32, dst_height: u32, linear: bool) -> Result<RawBandPixels, String> {
    dispatch!(format, F => scaled::render::<F>(src, &params_from::<<F as RawFormat>::Params>(format, params_json)?, scaled, dst_width, dst_height, linear))
}

/// Render plane rows `[band.src_y0, band.src_y1)` (`src`) to linear camera
/// RGB: oriented RGBA f32, bit-identical to the same rows of the whole frame.
pub fn render_linear_band(format: RawFormatId, src: &[f32], params_json: &str, band: RawBand) -> Result<RawBandPixels, String> {
    dispatch!(format, F => F::render_linear_band(src, &params_from::<<F as RawFormat>::Params>(format, params_json)?, band))
}

/// The binned first view of a whole plane.
pub fn render_binned_linear(format: RawFormatId, plane: &[f32], params_json: &str, min_long_edge: u32) -> Result<(u32, u32, Vec<f32>), String> {
    dispatch!(format, F => F::render_binned_linear(plane, &params_from::<<F as RawFormat>::Params>(format, params_json)?, min_long_edge))
}

/// Whether `format` renders finished bands (RAF's legacy look), from the
/// format alone, before any file is prepared: what every description of
/// that format says in `finished_bands`.
pub fn renders_finished_bands(format: RawFormatId) -> bool {
    dispatch!(format, F => F::FINISHED_BANDS)
}

/// The finished look of a band (RAF); an error for a format without one.
pub fn render_finished_band(format: RawFormatId, src: &[f32], params_json: &str, band: RawBand) -> Result<RawBandPixels, String> {
    dispatch!(format, F => {
        let p = params_from::<<F as RawFormat>::Params>(format, params_json)?;
        F::render_finished_band(src, &p, band).unwrap_or_else(|| Err(format!("{} has no finished bands: use the baked decode", format.as_str().to_uppercase())))
    })
}

/// The RAW step's white balance for the recipe's temperature and tint.
pub fn white_for_recipe(format: RawFormatId, params_json: &str, temperature: f32, tint: f32) -> Result<RawWhite, String> {
    dispatch!(format, F => F::white_for_recipe(&params_from::<<F as RawFormat>::Params>(format, params_json)?, temperature, tint))
}

/// The recipe temperature whose white reads `kelvin` at the recipe's tint.
pub fn temperature_for_kelvin(format: RawFormatId, params_json: &str, kelvin: f32, tint: f32) -> Result<f32, String> {
    dispatch!(format, F => F::temperature_for_kelvin(&params_from::<<F as RawFormat>::Params>(format, params_json)?, kelvin, tint))
}

/// A profile list's ids are unique, the camera entry (and only it) is
/// `camera`, and no entry is `standard`: the app reads the camera entry
/// under its recipe id `standard`, so another entry with that id would
/// collide with it.
#[cfg(test)]
pub(crate) fn assert_profile_ids_are_safe(list: &[crate::raf::develop::DevelopProfile]) {
    use crate::raf::develop::ProfileRole;
    let ids: Vec<&str> = list.iter().map(|p| p.id.as_str()).collect();
    let mut unique = ids.clone();
    unique.sort_unstable();
    unique.dedup();
    assert_eq!(unique.len(), ids.len(), "repeated ids: {ids:?}");
    for p in list {
        assert_ne!(p.id, "standard", "{ids:?}");
        assert_eq!(p.id == "camera", p.role == ProfileRole::Camera, "{}: {:?}", p.id, p.role);
    }
}
