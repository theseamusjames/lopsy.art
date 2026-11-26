//! A DNG decoded as RAF is for the develop chain: linear camera RGB at the
//! as-shot white balance, unclamped below black, with the file's own colour
//! calibration carried as data (`camera_color::DngCalibration`), so the RAW
//! step's white balance and camera matrix follow the DNG method and the
//! rest of the chain is the same as for a RAF.
//!
//! [`prepare_dng`] does the whole-frame work once. It reads the main image,
//! maps raw values to linear reference values as the specification's
//! chapter "Mapping Raw Values to Linear Reference Values" says
//! (`LinearizationTable`, then the black level of each sample's position
//! with `BlackLevelDeltaH` and `DeltaV`, then a scale of `1 / (WhiteLevel −
//! the plane's largest black level)`), crops to `ActiveArea`, and multiplies
//! each sample by the as-shot gain (`1 / camera neutral`, green = 1). The
//! specification then clips to 0..1; here values above 1 are clipped and
//! values below 0 are kept, the RAF decode's contract (noise in the
//! shadows averages to black instead of being rectified above it).
//!
//! The prepared plane is the RAF mosaic's counterpart: `width × height`
//! values for a Bayer DNG, `width × height × 3` (interleaved) for a
//! LinearRaw one. [`render_linear_band`] renders rows of it exactly as
//! `raf::develop::render_linear_band` does (oriented RGBA f32, alpha 1, a
//! band bit-identical to the same rows of the whole frame), and
//! [`render_binned_linear_for`] is the binned first view. One unit
//! throughout: 1.0 is the white level of the green channel before the
//! as-shot gain, and channel `c` clips at `as_shot_gain[c]`
//! (`clip_levels`).
//!
//! The kept area is the `ActiveArea` and, inside it, the `DefaultCrop`
//! when it is whole pixels at `DefaultScale` 1 (`dng::image_area`); the
//! black level tile and `CFAPattern` start at the active area's top-left.
//!
//! **Demosaic.** A Bayer DNG is demosaiced with the engine's bilinear
//! Bayer interpolation (`dng::demosaic::bilinear`), the same one a Bayer
//! RAF gets: soft, with colour fringes on fine detail. A LinearRaw DNG is
//! already demosaiced.
//!
//! **Checked on real files**: Apple ProRAW (LinearRaw, `dng_develop.rs`),
//! and Adobe DNG Converter 9.8 files of one Canon EOS 5D Mark III frame
//! (`dng_adobe.rs`): the Bayer mosaic uncompressed (16-bit strips) and
//! lossless (256 × 256 lossless JPEG tiles), with an active area that
//! masks a border, a 2 × 2 black level, a white level of 15000 and a
//! default crop to 5760 × 3840; and its LinearRaw variants. Each lines up
//! with the file's own preview and macOS's decode at no shift, with hues
//! within 1° of them. The lossy JPEG variants (compression 34892: 8-bit
//! LinearRaw RGB in baseline JPEG tiles, stored through a curve) are read
//! too, here and by the baked decode: their `OpcodeList2` `MapPolynomial` opcodes, applied to the linear
//! reference values (0..1) before the as-shot gain as the specification
//! orders (`dng::opcodes`), make them linear, and they open like their
//! lossless siblings (`tests/dng_lossy.rs`). A lossy file whose
//! `OpcodeList2` cannot be applied whole is refused with the reason.
//!
//! **The gain table map.** A LinearRaw file's `ProfileGainTableMap`
//! (Apple's local tone map) is applied to the prepared plane in place,
//! after the as-shot gain, with its table input in RIMM at the
//! BaselineExposure (`dng::gain_map`, which says how that matches the
//! specification). The plane's clip levels are then a lower bound on where
//! a clipped channel ended up. A Bayer DNG's map, a malformed one and the
//! DNG 1.7 `ProfileGainTableMap2` are listed as not applied, with why.
//! With the map applied, the file's own `ProfileToneCurve`, the map's pair
//! in the format, is the camera look the develop defaults open with
//! (`camera_curve`, [`develop_defaults_with`]), when it is usable
//! ([`camera_curve_points`]).
//!
//! **What is not applied**, each a fallback-free omission the picture
//! shows: opcode lists (`OpcodeList1–3`: lens shading `GainMap`, distortion
//! and vignette corrections, bad pixels), `ProfileHueSatMap` and `ProfileLookTable` (the
//! profile's hue and saturation twists), `ProfileToneCurve` (the engine's
//! Standard curve is used instead, except as above), a `DefaultCrop` that is not whole
//! pixels or comes with a `DefaultScale` (the whole active area is kept
//! then), semantic masks, a third calibration, and highlight
//! reconstruction on a LinearRaw plane (its clipped channels stay
//! clipped). [`unhandled_features`] lists the ones a file carries.
//!
//! **Highlight reconstruction** of a Bayer plane is RAF's
//! (`raf::highlights`, with the 2×2 period): the RAW interface's prepare
//! measures the chroma grid once over the whole plane
//! ([`measure_highlight_chroma`], into the params' `highlight_chroma`), and
//! the band and binned renders reconstruct each sample near its clip level
//! from it, so a band stays bit-identical to the whole frame. `prepare_dng`
//! alone measures nothing, and the baked decode never reconstructs.

use serde::{Deserialize, Serialize};

use super::camera_color::{Calibration, DngCalibration, DngWhiteBalance};
use super::tiff::{IfdEntry, TagId};
use super::{get_rational_array, get_rational_array_either, get_tag_u16, get_tag_u16_vec, get_tag_u32_vec, image_area, read_stored_image, shift_cfa};
use crate::black_level::BlackLevels;
use crate::raf::develop::RawDevelopSettings;
use crate::raf::highlights::ChromaGrid;
use crate::raf::{RafBand, RafBandPixels};

/// What a DNG's samples are.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DngKind {
    /// Three samples a pixel, already demosaiced (`LinearRaw`).
    Linear,
    /// One sample a pixel behind a 2×2 Bayer colour filter.
    Bayer,
}

/// Every per-image decision the band renders need, settled once by
/// [`prepare_dng`]. Serializable so each worker gets exactly the same.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DngRenderParams {
    /// The prepared plane's size: the active area, before orientation.
    pub width: u32,
    pub height: u32,
    pub kind: DngKind,
    /// Values a pixel in the prepared plane: 3 for `Linear`, 1 for `Bayer`.
    pub samples_per_pixel: u32,
    /// The 2×2 Bayer pattern from the active area's top-left (0 R, 1 G,
    /// 2 B; top-left, top-right, bottom-left, bottom-right). `[0, 1, 1, 2]`
    /// and unused for `Linear`.
    pub cfa: [u8; 4],
    /// EXIF orientation (1..=8).
    pub orientation: u16,
    /// The white level, raw units after linearization (the largest of the
    /// planes'), which 1.0 stands for before the as-shot gain.
    pub white_level: u32,
    /// The gain the plane already carries: `1 / as-shot camera neutral`,
    /// green = 1.
    pub as_shot_gain: [f32; 3],
    /// Each channel's clip level in the renders' units, `as_shot_gain`.
    pub clip_levels: Option<[f32; 3]>,
    /// The colour calibration, for the RAW step's matrix.
    pub calibration: DngCalibration,
    /// `UniqueCameraModel`, else `Make Model`, for the host to show.
    #[serde(default)]
    pub camera_model: String,
    /// What the renders need to reconstruct clipped channels of a Bayer
    /// plane (`raf::highlights`, period 2), measured once over the whole
    /// plane by the RAW interface's prepare. `None` (and not written) when
    /// nothing comes near its clip level, for LinearRaw, and from
    /// `prepare_dng` alone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub highlight_chroma: Option<ChromaGrid>,
    /// The exposure the develop chain opens with, in stops, when it is
    /// matched to the camera's preview rather than the file's
    /// BaselineExposure (`dng::preview`, an opening look's
    /// `dng_preview_exposure`). `None` (and not written): the baseline.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_exposure_ev: Option<f32>,
    /// The file's own `ProfileToneCurve`, (input, output) points in linear
    /// light, when its `ProfileGainTableMap` was applied and the curve is
    /// usable ([`camera_curve_points`]): the camera look, the pair the
    /// format describes, which the develop defaults then open with
    /// ([`develop_defaults_with`]). `None` (and not written) otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub camera_curve: Option<Vec<[f32; 2]>>,
    /// For a file with a `camera_curve`: the exposure at which the
    /// Standard look matches the camera's preview (`dng::preview`), for
    /// the Standard entry the profile list offers beside the camera look.
    /// `None` (and not written) otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub standard_exposure_ev: Option<f32>,
}

impl DngRenderParams {
    /// The final (displayed) size after orientation.
    pub fn oriented_size(&self) -> (u32, u32) {
        self.layout().oriented_size()
    }

    #[cfg(test)]
    fn row_len(&self) -> usize {
        self.layout().row_len()
    }
}

/// [`prepare_dng`]'s result: the parameters, the prepared plane and what
/// the decode noticed on the way.
pub struct DngPrepared {
    pub params: DngRenderParams,
    pub plane: Vec<f32>,
    /// The DNG features that affect the picture and were not applied.
    pub unhandled: Vec<String>,
    pub debug_log: Vec<String>,
}

fn rational9(ifd0: &[IfdEntry], main: &[IfdEntry], tag: TagId) -> Result<Option<[f64; 9]>, String> {
    let v = get_rational_array_either(ifd0, main, tag);
    match v.len() {
        0 => Ok(None),
        9 => Ok(Some(std::array::from_fn(|i| v[i]))),
        n => Err(format!("{tag:?} has {n} values; only three-colour cameras are supported")),
    }
}

fn has_tag(ifd0: &[IfdEntry], main: &[IfdEntry], tag: TagId) -> bool {
    ifd0.iter().chain(main).any(|e| e.tag == tag as u16)
}

fn ascii(ifd0: &[IfdEntry], main: &[IfdEntry], tag: TagId) -> String {
    let e = main.iter().find(|e| e.tag == tag as u16).or_else(|| ifd0.iter().find(|e| e.tag == tag as u16));
    e.map(|e| String::from_utf8_lossy(&e.raw_bytes).trim_end_matches('\0').trim().to_string()).unwrap_or_default()
}

fn u32s(ifd0: &[IfdEntry], main: &[IfdEntry], tag: TagId) -> Option<Vec<u32>> {
    get_tag_u32_vec(main, tag).or_else(|_| get_tag_u32_vec(ifd0, tag)).ok()
}

/// The colour calibration a DNG carries, or why it cannot be used.
pub fn calibration_from_tags(ifd0: &[IfdEntry], main: &[IfdEntry]) -> Result<DngCalibration, String> {
    let illuminant = |tag| get_tag_u16(ifd0, tag).or_else(|_| get_tag_u16(main, tag)).unwrap_or(0);
    let signatures_match = ascii(ifd0, main, TagId::CameraCalibrationSignature) == ascii(ifd0, main, TagId::ProfileCalibrationSignature);
    let calibration_matrix = |tag| -> Result<Option<[f64; 9]>, String> {
        Ok(if signatures_match { rational9(ifd0, main, tag)? } else { None })
    };
    let cm1 = rational9(ifd0, main, TagId::ColorMatrix1)?;
    let cm2 = rational9(ifd0, main, TagId::ColorMatrix2)?;
    let set = |cm: [f64; 9], ill: TagId, fm: TagId, cc: TagId| -> Result<Calibration, String> {
        Ok(Calibration {
            illuminant: illuminant(ill),
            color_matrix: cm,
            forward_matrix: rational9(ifd0, main, fm)?,
            camera_calibration: calibration_matrix(cc)?,
        })
    };
    let first = match cm1 {
        Some(cm) => set(cm, TagId::CalibrationIlluminant1, TagId::ForwardMatrix1, TagId::CameraCalibration1)?,
        None => return Err("the file has no ColorMatrix1".into()),
    };
    let second = match cm2 {
        Some(cm) => Some(set(cm, TagId::CalibrationIlluminant2, TagId::ForwardMatrix2, TagId::CameraCalibration2)?),
        None => None,
    };
    let triple = |tag| {
        let v = get_rational_array_either(ifd0, main, tag);
        (v.len() == 3).then(|| [v[0], v[1], v[2]])
    };
    let white_xy = get_rational_array_either(ifd0, main, TagId::AsShotWhiteXY);
    let baseline = get_rational_array_either(ifd0, main, TagId::BaselineExposure).first().copied().unwrap_or(0.0)
        + get_rational_array_either(ifd0, main, TagId::BaselineExposureOffset).first().copied().unwrap_or(0.0);
    let cal = DngCalibration {
        first,
        second,
        analog_balance: triple(TagId::AnalogBalance).unwrap_or([1.0; 3]),
        as_shot_neutral: triple(TagId::AsShotNeutral),
        as_shot_white_xy: (white_xy.len() == 2).then(|| [white_xy[0], white_xy[1]]),
        baseline_exposure: baseline,
    };
    cal.validate()?;
    Ok(cal)
}

/// How [`unhandled_features`] names a `ProfileToneCurve`.
const TONE_CURVE_NOTE: &str = "ProfileToneCurve (the Standard curve is used instead)";

/// The most points a `ProfileToneCurve` may have to be used.
pub const MAX_TONE_CURVE_POINTS: usize = 4096;

/// A file's `ProfileToneCurve` (IFD0, else the raw IFD) as points, when it
/// is one the develop chain can use: 2 to [`MAX_TONE_CURVE_POINTS`]
/// finite (input, output) pairs, inputs strictly increasing and outputs
/// never falling, from (0, 0) to (1, 1) (within 1e-4) as the
/// specification requires. `Ok(None)` when the file has none; an error says
/// why one is not used.
pub fn camera_curve_points(ifd0: &[IfdEntry], main: &[IfdEntry]) -> Result<Option<Vec<[f32; 2]>>, String> {
    let entry = ifd0.iter().find(|e| e.tag == TagId::ProfileToneCurve as u16).or_else(|| main.iter().find(|e| e.tag == TagId::ProfileToneCurve as u16));
    let Some(entry) = entry else { return Ok(None) };
    if entry.typ != 11 {
        return Err(format!("it is TIFF type {}, not FLOAT", entry.typ));
    }
    let v = entry.as_rational_vec();
    if v.len() % 2 != 0 || v.len() < 4 || v.len() / 2 > MAX_TONE_CURVE_POINTS {
        return Err(format!("{} values are not 2 to {MAX_TONE_CURVE_POINTS} pairs", v.len()));
    }
    let pts: Vec<[f32; 2]> = v.chunks_exact(2).map(|p| [p[0] as f32, p[1] as f32]).collect();
    if !pts.iter().flatten().all(|x| x.is_finite() && (0.0..=1.0).contains(x)) {
        return Err("a point is outside 0..1".into());
    }
    if !pts.windows(2).all(|w| w[1][0] > w[0][0] && w[1][1] >= w[0][1]) {
        return Err("it is not increasing".into());
    }
    let (first, last) = (pts[0], pts[pts.len() - 1]);
    let near = |a: f32, b: f32| (a - b).abs() <= 1e-4;
    if !(near(first[0], 0.0) && near(first[1], 0.0) && near(last[0], 1.0) && near(last[1], 1.0)) {
        return Err(format!("it runs from {first:?} to {last:?}, not (0, 0) to (1, 1)"));
    }
    Ok(Some(pts))
}

/// The table the develop settings carry for a camera curve: monotone cubic
/// through its points (`raf::base_curves::curve_lut_from_points`), the way
/// the built-in curves are sampled. The specification asks for a cubic
/// spline; a monotone one cannot overshoot between dense points.
pub fn camera_curve_lut(points: &[[f32; 2]]) -> Vec<f32> {
    let pts: Vec<(f32, f32)> = points.iter().map(|p| (p[0], p[1])).collect();
    crate::raf::base_curves::curve_lut_from_points(&pts)
}

/// How [`unhandled_features`] names a `ProfileGainTableMap`. A prepare that
/// applies the map takes this out; one that cannot says why instead.
const GAIN_MAP_NOTE: &str = "ProfileGainTableMap (local tone map)";

/// The DNG features that change the picture, which this decode does not
/// apply, that the file carries. A `ProfileGainTableMap` is among them
/// here; [`prepare_dng`] applies it to a LinearRaw plane and drops it from
/// its list.
pub fn unhandled_features(ifd0: &[IfdEntry], main: &[IfdEntry]) -> Vec<String> {
    let checks: [(TagId, &str); 12] = [
        (TagId::OpcodeList1, "OpcodeList1 (corrections on the stored data)"),
        (TagId::OpcodeList2, "OpcodeList2 (corrections on linear data: lens shading GainMap, bad pixels)"),
        (TagId::OpcodeList3, "OpcodeList3 (corrections after demosaic: distortion, vignette, chromatic aberration)"),
        (TagId::ProfileGainTableMap, GAIN_MAP_NOTE),
        (TagId::ProfileGainTableMap2, "ProfileGainTableMap2 (the DNG 1.7 local tone map; not read)"),
        (TagId::ProfileHueSatMapData1, "ProfileHueSatMap (the profile's hue and saturation corrections)"),
        (TagId::ProfileLookTableData, "ProfileLookTable (the profile's look)"),
        (TagId::ProfileToneCurve, TONE_CURVE_NOTE),
        (TagId::DefaultCropOrigin, "DefaultCrop (not whole pixels at scale 1, so the whole active area is kept)"),
        (TagId::SemanticName, "semantic masks"),
        (TagId::ColorMatrix3, "a third calibration (ColorMatrix3)"),
        (TagId::ProfileHueSatMapData2, "a second ProfileHueSatMap"),
    ];
    checks.iter().filter(|(tag, _)| has_tag(ifd0, main, *tag)).map(|(_, what)| what.to_string()).collect()
}

/// The as-shot gain for a calibration: `1 / as-shot neutral`, green = 1.
pub fn as_shot_gain(cal: &DngCalibration) -> Result<[f32; 3], String> {
    let (_, neutral) = cal.as_shot().ok_or("the as-shot white balance is not a colour")?;
    Ok(neutral.map(|n| (1.0 / n) as f32))
}

/// The stored samples a prepared plane is cut from: `width` × rows ×
/// `samples` values, of which the `width_out` × `height_out` area from
/// (`top`, `left`) is kept.
pub(crate) struct StoredPlane<'a> {
    pub values: &'a [u16],
    pub width: usize,
    pub samples: usize,
    pub top: usize,
    pub left: usize,
    pub width_out: usize,
    pub height_out: usize,
}

/// How stored values become the prepared plane's: the linearization
/// table, the black level of each position (relative to the kept area's
/// top-left), the scale of each sample plane (`plane_scales`), and the
/// as-shot gain of each colour.
pub(crate) struct PlaneMapping<'a> {
    pub kind: DngKind,
    /// The Bayer pattern from the kept area's top-left.
    pub cfa: [u8; 4],
    pub table: Option<&'a [u16]>,
    pub black: &'a BlackLevels,
    /// Where the kept area's top-left falls in the black level tile (rows,
    /// columns): the tile starts at the active area's top-left.
    pub black_origin: (usize, usize),
    pub scales: &'a [f64],
    pub gain: [f32; 3],
    /// The file's `OpcodeList2` polynomials, applied to each linear
    /// reference value (0..1) before the as-shot gain (`dng::opcodes`).
    pub maps: Option<&'a super::opcodes::LinearMaps>,
}

/// Each sample plane's scale, `1 / (white level − the plane's largest
/// black level over the kept area)`, and that largest black level. An
/// error when a white level is not above its black level.
pub(crate) fn plane_scales(
    black: &BlackLevels,
    delta_h: &[f64],
    delta_v: &[f64],
    whites: &[u32],
    w: usize,
    h: usize,
    spp: usize,
) -> Result<(Vec<f64>, Vec<f64>), String> {
    if whites.is_empty() {
        return Err("there is no white level".into());
    }
    let white_of = |s: usize| f64::from(*whites.get(s).unwrap_or(&whites[0]));
    // The largest black level of each sample plane over the active area.
    let (br, bc) = black.period();
    // A delta list shorter than the area leaves the rest of it at 0.
    let max_delta = |d: &[f64], n: usize| {
        let m = d.iter().take(n).copied().fold(f64::NEG_INFINITY, f64::max);
        if d.len() < n { m.max(0.0) } else { m }
    };
    let plane_black_max: Vec<f64> = (0..spp)
        .map(|s| {
            let tile = (0..br).flat_map(|r| (0..bc).map(move |c| (r, c))).map(|(r, c)| black.at(r, c, s) - delta_h.get(c).copied().unwrap_or(0.0) - delta_v.get(r).copied().unwrap_or(0.0));
            tile.fold(f64::MIN, f64::max) + max_delta(delta_h, w) + max_delta(delta_v, h)
        })
        .collect();
    let scales: Vec<f64> = (0..spp)
        .map(|s| {
            let range = white_of(s) - plane_black_max[s];
            if range > 0.0 && range.is_finite() {
                Ok(1.0 / range)
            } else {
                Err(format!("the white level {} is not above the black level {}", white_of(s), plane_black_max[s]))
            }
        })
        .collect::<Result<_, _>>()?;
    Ok((scales, plane_black_max))
}

/// The prepared plane: each kept stored value through `raw_of` (what the
/// file stores), the linearization table, minus its position's black
/// level, times its plane's scale, clipped at 1 (values below 0 are kept),
/// times its colour's as-shot gain. The DNG specification's mapping of raw
/// values to linear reference values, shared by the DNG and the Sony ARW
/// decodes.
pub(crate) fn fill_plane(src: &StoredPlane, raw_of: impl Fn(u16) -> u16, m: &PlaneMapping) -> Result<Vec<f32>, String> {
    let (w, h) = (src.width_out, src.height_out);
    let spp = match m.kind {
        DngKind::Linear => 3usize,
        DngKind::Bayer => 1usize,
    };
    // Every index below stays inside the stored values.
    let need = (src.top + h).checked_mul(src.width).and_then(|n| n.checked_mul(src.samples));
    if src.left + w > src.width || spp > src.samples || need.is_none_or(|n| n > src.values.len()) || m.scales.len() < spp {
        return Err(format!("the {w}×{h} area at {},{} is outside the stored image", src.left, src.top));
    }
    let mut plane: Vec<f32> = Vec::new();
    plane.try_reserve_exact(w * h * spp).map_err(|_| "not enough memory for the raw pixels".to_string())?;
    let colour_of = |row: usize, col: usize, s: usize| -> usize {
        match m.kind {
            DngKind::Linear => s,
            DngKind::Bayer => m.cfa[(row & 1) * 2 + (col & 1)] as usize,
        }
    };
    let last = m.table.map_or(0, |t| t.len().saturating_sub(1));
    for row in 0..h {
        for col in 0..w {
            let i = ((row + src.top) * src.width + col + src.left) * src.samples;
            for s in 0..spp {
                let raw = raw_of(src.values[i + s]);
                let lin = match m.table {
                    Some(t) if !t.is_empty() => t[(raw as usize).min(last)],
                    _ => raw,
                };
                let mut v = ((f64::from(lin) - m.black.at(row + m.black_origin.0, col + m.black_origin.1, s)) * m.scales[s]).min(1.0);
                if let Some(maps) = m.maps {
                    v = maps.apply(s, v);
                }
                plane.push(v as f32 * m.gain[colour_of(row, col, s)]);
            }
        }
    }
    Ok(plane)
}

/// Choices [`prepare_dng_with`] takes. The default is what [`prepare_dng`]
/// does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PrepareOptions {
    /// Apply a LinearRaw file's `ProfileGainTableMap` (`dng::gain_map`).
    /// Off, the plane is exactly what it was before the map was applied
    /// (for comparisons).
    pub apply_gain_table_map: bool,
}

impl Default for PrepareOptions {
    fn default() -> Self {
        PrepareOptions { apply_gain_table_map: true }
    }
}

/// Decode a DNG to linear camera RGB for the develop chain. An error says
/// why this DNG cannot take this path; the host then uses the baked decode
/// (`dng::read_dng`).
pub fn prepare_dng(data: &[u8]) -> Result<DngPrepared, String> {
    prepare_dng_with(data, PrepareOptions::default())
}

/// The gain table map of a prepared LinearRaw plane, applied in place
/// (`dng::gain_map`): the clip levels it leaves, or why it was not applied
/// (the not-applied note).
fn apply_gain_table_map(
    raw: &[u8],
    big_endian: bool,
    plane: &mut [f32],
    area: &super::ImageArea,
    calibration: &DngCalibration,
    clip: [f32; 3],
    debug_log: &mut Vec<String>,
) -> Result<[f32; 3], String> {
    let refused = |why: String| format!("ProfileGainTableMap (local tone map; refused: {why})");
    let map = super::gain_map::parse(raw, big_endian).map_err(refused)?;
    let to_rimm = super::gain_map::camera_to_rimm(calibration, calibration.baseline_exposure)
        .ok_or_else(|| refused("the colour calibration gives no matrix for the as-shot white".into()))?;
    let at = super::gain_map::MapPlacement { active_width: area.active_width, active_height: area.active_height, from_active: area.from_active };
    map.apply(plane, area.width, area.height, at, &to_rimm).map_err(refused)?;
    let levels = map.clip_levels_after(clip, &to_rimm);
    debug_log.push(format!(
        "[DNG linear] ProfileGainTableMap applied: {} × {} tables of {} points, origin {:.4},{:.4}, spacing {:.4},{:.4}, weights {:?}, gains {:.3}..{:.3}; clip levels now {levels:?}",
        map.points_v,
        map.points_h,
        map.points_n,
        map.origin_v,
        map.origin_h,
        map.spacing_v,
        map.spacing_h,
        map.weights,
        map.gains.iter().copied().fold(f32::INFINITY, f32::min),
        map.gains.iter().copied().fold(0.0, f32::max),
    ));
    Ok(levels)
}

/// [`prepare_dng`] with its choices given.
pub fn prepare_dng_with(data: &[u8], options: PrepareOptions) -> Result<DngPrepared, String> {
    let mut debug_log = Vec::new();
    let mut stored = read_stored_image(data, &mut debug_log)?;
    let pixel_data = std::mem::take(&mut stored.pixel_data);
    let (ifd0, main) = (&stored.ifd0, &stored.main_ifd);
    let (kind, spp) = if stored.is_linear() {
        if stored.samples != 3 {
            return Err(format!("LinearRaw with {} samples a pixel is not supported", stored.samples));
        }
        (DngKind::Linear, 3usize)
    } else if stored.is_cfa() {
        if stored.samples != 1 {
            return Err(format!("CFA data with {} samples a pixel is not supported", stored.samples));
        }
        (DngKind::Bayer, 1usize)
    } else {
        return Err(format!("PhotometricInterpretation {} is not raw data", stored.photo_interp));
    };

    let mut cfa = [0u8, 1, 1, 2];
    if kind == DngKind::Bayer {
        if let Some(dim) = u32s(ifd0, main, TagId::CfaRepeatPatternDim) {
            if dim != [2, 2] {
                return Err(format!("a {dim:?} colour filter pattern is not a 2×2 Bayer pattern"));
            }
        }
        if let Some(layout) = get_tag_u16(main, TagId::CfaLayout).ok().filter(|&l| l != 1) {
            return Err(format!("CFALayout {layout} is not a rectangular grid"));
        }
        let planes = main.iter().find(|e| e.tag == TagId::CfaPlaneColor as u16).map(|e| e.raw_bytes.clone());
        if planes.as_ref().is_some_and(|p| p.as_slice() != [0, 1, 2]) {
            return Err("CFAPlaneColor is not red, green, blue".into());
        }
        let pattern = main.iter().find(|e| e.tag == TagId::CfaPattern as u16).map(|e| e.raw_bytes.clone());
        match pattern {
            Some(p) if p.len() == 4 && p.iter().all(|&c| c <= 2) && (0..3).all(|c| p.contains(&c)) => {
                cfa = [p[0], p[1], p[2], p[3]];
            }
            _ => return Err("the colour filter pattern is missing or not a Bayer pattern".into()),
        }
    }

    let calibration = calibration_from_tags(ifd0, main)?;
    let gain = as_shot_gain(&calibration)?;
    // The active area, and the default crop inside it (`dng::image_area`).
    let sw = stored.width as usize;
    let area = image_area(ifd0, main, stored.width, stored.height)?;
    let (top, left, w, h) = (area.top, area.left, area.width, area.height);
    let mut unhandled = unhandled_features(ifd0, main);
    if area.default_crop_applied {
        unhandled.retain(|u| !u.starts_with("DefaultCrop"));
    }
    // The pattern and black levels start at the active area's top-left.
    cfa = shift_cfa(cfa, area.from_active);
    crate::decode::check_image_size(w as u32, h as u32, 4 * spp as u64)?;

    // Linearization, black level and white level, from the raw IFD.
    // These belong in the raw IFD; IFD0 is read when it is not there, as
    // the baked decode does.
    let table = get_tag_u16_vec(main, TagId::LinearizationTable).or_else(|_| get_tag_u16_vec(ifd0, TagId::LinearizationTable)).ok().filter(|t| !t.is_empty());
    let black_values: Vec<f64> = {
        let r = get_rational_array_either(main, ifd0, TagId::BlackLevel);
        if r.is_empty() {
            u32s(ifd0, main, TagId::BlackLevel).map(|v| v.iter().map(|&x| f64::from(x)).collect()).unwrap_or_default()
        } else {
            r
        }
    };
    let repeat = get_tag_u32_vec(main, TagId::BlackLevelRepeatDim).ok().and_then(|v| (v.len() == 2 && v[0] > 0 && v[1] > 0 && v[0] <= 64 && v[1] <= 64).then(|| (v[0], v[1])));
    let delta_h = get_rational_array(main, TagId::BlackLevelDeltaH);
    let delta_v = get_rational_array(main, TagId::BlackLevelDeltaV);
    let black = if black_values.is_empty() { BlackLevels::uniform(0.0) } else { BlackLevels::from_dng(repeat, &black_values, spp) }
        .with_deltas(delta_h.clone(), delta_v.clone());
    let default_white = if stored.bits >= 1 && stored.bits <= 16 { (1u32 << stored.bits) - 1 } else { 65535 };
    let whites: Vec<u32> = u32s(ifd0, main, TagId::WhiteLevel).filter(|v| !v.is_empty()).unwrap_or_else(|| vec![default_white]);
    let (scales, plane_black_max) = plane_scales(&black, &delta_h, &delta_v, &whites, w, h, spp)?;

    let (eight_bit_shifted, byte_swapped) = (stored.eight_bit_shifted, stored.byte_swapped);
    let raw_of = |stored_value: u16| {
        if eight_bit_shifted {
            stored_value >> 8
        } else if byte_swapped {
            stored_value.swap_bytes()
        } else {
            stored_value
        }
    };
    let source = StoredPlane { values: &pixel_data, width: sw, samples: stored.samples as usize, top, left, width_out: w, height_out: h };
    // OpcodeList2, when it can be applied whole (`dng::opcodes`): lossy
    // data needs it to be linear, so a lossy file whose list cannot be
    // applied is refused; a lossless one leaves it unapplied, as before.
    let opcode_list2 = main.iter().find(|e| e.tag == TagId::OpcodeList2 as u16).or_else(|| ifd0.iter().find(|e| e.tag == TagId::OpcodeList2 as u16));
    let maps = match opcode_list2.map(|e| super::opcodes::read_opcode_list2(&e.raw_bytes, stored.width, stored.height, spp)) {
        Some(Ok(maps)) => {
            unhandled.retain(|u| !u.starts_with("OpcodeList2"));
            debug_log.push(format!("[DNG linear] OpcodeList2 applied: {} MapPolynomial", maps.polynomials.len()));
            Some(maps)
        }
        Some(Err(why)) if stored.lossy => return Err(format!("{}: its OpcodeList2 cannot be applied ({why})", super::LOSSY_REFUSAL)),
        Some(Err(why)) => {
            debug_log.push(format!("[DNG linear] OpcodeList2 not applied: {why}"));
            None
        }
        None if stored.lossy => return Err(format!("{}: it has no OpcodeList2 to make its samples linear", super::LOSSY_REFUSAL)),
        None => None,
    };
    let mapping = PlaneMapping { kind, cfa, table: table.as_deref(), black: &black, black_origin: area.from_active, scales: &scales, gain, maps: maps.as_ref() };
    let mut plane = fill_plane(&source, raw_of, &mapping)?;
    drop(pixel_data);

    // The gain table map, on the prepared plane in place, so every band
    // and the binned view see it alike (`dng::gain_map`).
    let mut clip_levels = gain;
    let mut map_applied = false;
    let map_entry = main.iter().chain(ifd0.iter()).find(|e| e.tag == TagId::ProfileGainTableMap as u16);
    if let (Some(entry), true) = (map_entry, options.apply_gain_table_map) {
        let note = if kind == DngKind::Bayer {
            Err("ProfileGainTableMap (local tone map; not applied to a Bayer mosaic)".to_string())
        } else {
            let big_endian = data.starts_with(b"MM");
            apply_gain_table_map(&entry.raw_bytes, big_endian, &mut plane, &area, &calibration, gain, &mut debug_log)
        };
        let at = unhandled.iter().position(|u| u == GAIN_MAP_NOTE);
        match (note, at) {
            (Ok(levels), Some(i)) => {
                (clip_levels, map_applied) = (levels, true);
                unhandled.remove(i);
            }
            (Ok(levels), None) => (clip_levels, map_applied) = (levels, true),
            (Err(why), Some(i)) => unhandled[i] = why,
            (Err(why), None) => unhandled.push(why),
        }
    }
    // With the map applied, the file's own tone curve is its pair: the
    // camera look the develop defaults open with. A curve that cannot be
    // used says why, and the Standard look stays.
    let mut camera_curve = None;
    if map_applied {
        let at = unhandled.iter().position(|u| u == TONE_CURVE_NOTE);
        match (camera_curve_points(ifd0, main), at) {
            (Ok(Some(points)), Some(i)) => {
                debug_log.push(format!("[DNG linear] the camera look: the file's ProfileToneCurve, {} points, with its gain table map", points.len()));
                camera_curve = Some(points);
                unhandled.remove(i);
            }
            (Err(why), Some(i)) => unhandled[i] = format!("ProfileToneCurve (refused: {why}; the Standard curve is used instead)"),
            _ => {}
        }
    }

    let orientation = get_tag_u16(ifd0, TagId::Orientation).ok().filter(|o| (1..=8).contains(o)).unwrap_or(1);
    let unique = ascii(ifd0, main, TagId::UniqueCameraModel);
    let camera_model = if unique.is_empty() {
        format!("{} {}", ascii(ifd0, main, TagId::Make), ascii(ifd0, main, TagId::Model)).trim().to_string()
    } else {
        unique
    };
    let white_level = whites.iter().copied().max().unwrap_or(default_white);
    debug_log.push(format!(
        "[DNG linear] {camera_model}: {kind:?} {w}×{h}, white {white_level}, black max {plane_black_max:?}, as-shot gain {gain:?}, baseline {:.3} EV",
        calibration.baseline_exposure
    ));
    for what in &unhandled {
        debug_log.push(format!("[DNG linear] not applied: {what}"));
    }
    let params = DngRenderParams {
        width: w as u32,
        height: h as u32,
        kind,
        samples_per_pixel: spp as u32,
        cfa,
        orientation,
        white_level,
        as_shot_gain: gain,
        clip_levels: Some(clip_levels),
        calibration,
        camera_model,
        highlight_chroma: None,
        default_exposure_ev: None,
        camera_curve,
        standard_exposure_ev: None,
    };
    Ok(DngPrepared { params, plane, unhandled, debug_log })
}

/// What the band and binned renders need to know about a prepared plane:
/// its size, what its samples are, its Bayer pattern and its orientation.
/// The renders below take anything that has one ([`PlaneParams`]): a DNG's
/// `DngRenderParams` or a Sony ARW's (`arw::ArwRenderParams`), so both
/// formats render through the same code.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PlaneLayout {
    pub width: u32,
    pub height: u32,
    pub kind: DngKind,
    pub samples_per_pixel: u32,
    pub cfa: [u8; 4],
    pub orientation: u16,
}

impl PlaneLayout {
    /// The final (displayed) size after orientation.
    pub fn oriented_size(&self) -> (u32, u32) {
        match self.orientation {
            5..=8 => (self.height, self.width),
            _ => (self.width, self.height),
        }
    }

    fn row_len(&self) -> usize {
        self.width as usize * self.samples_per_pixel as usize
    }
}

/// Parameters of a prepared plane the shared renders can draw.
pub trait PlaneParams {
    fn layout(&self) -> PlaneLayout;
    /// The chroma a Bayer plane's clipped channels are reconstructed from,
    /// when it has one.
    fn highlight_chroma(&self) -> Option<&ChromaGrid> {
        None
    }
}

impl PlaneParams for PlaneLayout {
    fn layout(&self) -> PlaneLayout {
        *self
    }
}

impl PlaneParams for DngRenderParams {
    fn layout(&self) -> PlaneLayout {
        PlaneLayout {
            width: self.width,
            height: self.height,
            kind: self.kind,
            samples_per_pixel: self.samples_per_pixel,
            cfa: self.cfa,
            orientation: self.orientation,
        }
    }

    fn highlight_chroma(&self) -> Option<&ChromaGrid> {
        self.highlight_chroma.as_ref()
    }
}

/// How far (in rows) a rendered pixel reaches into the plane: one row for
/// the bilinear demosaic, and the reconstruction's `REACH_ROWS` more when
/// clipped channels are reconstructed; none for LinearRaw.
pub fn reach_rows<P: PlaneParams + ?Sized>(params: &P) -> u32 {
    match params.layout().kind {
        DngKind::Linear => 0,
        DngKind::Bayer => 1 + if params.highlight_chroma().is_some() { crate::raf::highlights::REACH_ROWS } else { 0 },
    }
}

fn check_band(src: &[f32], params: &PlaneLayout, band: RafBand, reach: u32) -> Result<usize, String> {
    let phase_ok = params.kind == DngKind::Linear || band.src_y0 % 2 == 0;
    let valid = phase_ok && band.src_y0 <= band.y0 && band.y0 < band.y1 && band.y1 <= band.src_y1 && band.src_y1 <= params.height;
    if !valid {
        return Err(format!("Invalid DNG band {band:?} for a {}-row frame", params.height));
    }
    // A band edge inside the frame needs the demosaic's context rows.
    let context_ok = (band.y0 == band.src_y0 && band.src_y0 == 0 || band.y0 - band.src_y0 >= reach)
        && (band.src_y1 == params.height || band.src_y1 - band.y1 >= reach);
    if !context_ok {
        return Err(format!("DNG band {band:?} has fewer than {reach} rows of context"));
    }
    let src_h = (band.src_y1 - band.src_y0) as usize;
    if src.len() != params.row_len() * src_h {
        return Err(format!("DNG band source has {} values, expected {}", src.len(), params.row_len() * src_h));
    }
    Ok(src_h)
}

/// The sentence a render returns when its output cannot be allocated.
const NO_MEMORY: &str = "not enough memory for the DNG's linear pixels";

/// An empty vector with room for `n` values, or the sentence.
fn try_capacity(n: usize) -> Result<Vec<f32>, String> {
    let mut v = Vec::new();
    v.try_reserve_exact(n).map_err(|_| NO_MEMORY.to_string())?;
    Ok(v)
}

/// Orient a band's RGBA rows and place them in the oriented image, as the
/// RAF renders do.
fn orient_band(rgba: Vec<f32>, params: &PlaneLayout, band: RafBand) -> Result<RafBandPixels, String> {
    let band_h = band.y1 - band.y0;
    let (ow, oh, pixels) = crate::orientation::try_apply_exif_orientation_owned(params.width, band_h, rgba, params.orientation).ok_or(NO_MEMORY)?;
    let (x, y) = match params.orientation {
        3 | 4 => (0, params.height - band.y1),
        5 | 8 => (band.y0, 0),
        6 | 7 => (params.height - band.y1, 0),
        _ => (0, band.y0),
    };
    Ok(RafBandPixels { x, y, width: ow, height: oh, pixels })
}

/// Render one band to linear camera RGB. `src` holds plane rows
/// `[band.src_y0, band.src_y1)` (`width × samplesPerPixel` values a row).
/// The result is oriented RGBA f32 (alpha 1), unclamped, and bit-identical
/// to the same rows of a whole-frame render. Bands from
/// `raf::plan_bands` have enough context for either kind.
pub fn render_linear_band<P: PlaneParams + ?Sized>(src: &[f32], params: &P, band: RafBand) -> Result<RafBandPixels, String> {
    let (grid, reach) = (params.highlight_chroma(), reach_rows(params));
    let params = &params.layout();
    let src_h = check_band(src, params, band, reach)?;
    let w = params.width as usize;
    let skip = (band.y0 - band.src_y0) as usize;
    let rows = (band.y1 - band.y0) as usize;
    let mut rgba = try_capacity(w * rows * 4)?;
    match params.kind {
        DngKind::Linear => {
            for px in src[skip * w * 3..(skip + rows) * w * 3].chunks_exact(3) {
                rgba.extend_from_slice(&[px[0], px[1], px[2], 1.0]);
            }
        }
        DngKind::Bayer => {
            // Clipped channels first, with the chroma at the rows' place in
            // the frame, as a RAF's are.
            let reconstructed = grid.and_then(|g| g.reconstruct(src, w, src_h, band.src_y0 as usize, &params.cfa, 2));
            let src = reconstructed.as_deref().unwrap_or(src);
            let rgb = super::demosaic::try_bilinear(src, params.width, src_h as u32, &params.cfa).ok_or(NO_MEMORY)?;
            for px in rgb[skip * w * 3..(skip + rows) * w * 3].chunks_exact(3) {
                rgba.extend_from_slice(&[px[0], px[1], px[2], 1.0]);
            }
        }
    }
    orient_band(rgba, params, band)
}

/// Largest factor the binned view considers.
const MAX_BIN_FACTOR: u32 = 24;

/// Whether a `factor`×`factor` block holds every colour: any factor for
/// LinearRaw, an even one for Bayer.
pub fn is_valid_bin_factor<P: PlaneParams + ?Sized>(params: &P, factor: u32) -> bool {
    match params.layout().kind {
        DngKind::Linear => factor >= 1,
        DngKind::Bayer => factor >= 2 && factor % 2 == 0,
    }
}

/// The coarsest valid factor that keeps the long edge at least
/// `min_long_edge`, else the finest valid one.
pub fn binned_factor_for<P: PlaneParams + ?Sized>(params: &P, min_long_edge: u32) -> u32 {
    let params = &params.layout();
    let long = params.width.max(params.height);
    let valid: Vec<u32> = (1..=MAX_BIN_FACTOR).filter(|&f| is_valid_bin_factor(params, f)).collect();
    valid.iter().copied().filter(|&f| long / f >= min_long_edge).max().or_else(|| valid.first().copied()).unwrap_or(2)
}

/// The binned first view of the whole plane: each output pixel is, per
/// colour, the mean of that colour's samples in its block. No demosaic.
/// Oriented RGBA f32 in the same units as [`render_linear_band`]. Returns
/// (width, height, pixels) after orientation.
pub fn render_binned_linear<P: PlaneParams + ?Sized>(plane: &[f32], params: &P, factor: u32) -> Result<(u32, u32, Vec<f32>), String> {
    // A sample near its clip level is reconstructed exactly as the band
    // render reconstructs it, so the two agree.
    let grid = params.highlight_chroma();
    let thresholds = grid.map_or([f32::INFINITY; 3], |g| g.thresholds());
    let params = &params.layout();
    let (w, h) = (params.width as usize, params.height as usize);
    if plane.len() != params.row_len() * h {
        return Err(format!("DNG plane has {} values, expected {}", plane.len(), params.row_len() * h));
    }
    if !is_valid_bin_factor(params, factor) {
        return Err(format!("Bin factor {factor} leaves a colour out of some blocks"));
    }
    let f = factor as usize;
    let (bw, bh) = (w / f, h / f);
    if bw == 0 || bh == 0 {
        return Err(format!("A {w}×{h} frame is smaller than one {f}×{f} block"));
    }
    let mut rgba = try_capacity(bw * bh * 4)?;
    rgba.resize(bw * bh * 4, 0.0);
    let mut sums: Vec<[f32; 3]> = Vec::new();
    sums.try_reserve_exact(bw).map_err(|_| NO_MEMORY.to_string())?;
    sums.resize(bw, [0.0; 3]);
    let mut counts = [0.0f32; 3];
    for c in 0..3 {
        counts[c] = match params.kind {
            DngKind::Linear => (f * f) as f32,
            DngKind::Bayer => (0..f * f).filter(|&i| params.cfa[((i / f) & 1) * 2 + ((i % f) & 1)] as usize == c).count() as f32,
        };
    }
    for by in 0..bh {
        sums.iter_mut().for_each(|s| *s = [0.0; 3]);
        for dy in 0..f {
            let row = by * f + dy;
            match params.kind {
                DngKind::Linear => {
                    let line = &plane[row * w * 3..(row * w + bw * f) * 3];
                    for (sum, block) in sums.iter_mut().zip(line.chunks_exact(f * 3)) {
                        for px in block.chunks_exact(3) {
                            sum[0] += px[0];
                            sum[1] += px[1];
                            sum[2] += px[2];
                        }
                    }
                }
                DngKind::Bayer => {
                    let line = &plane[row * w..row * w + bw * f];
                    let phase = (row & 1) * 2;
                    for (bx, (sum, block)) in sums.iter_mut().zip(line.chunks_exact(f)).enumerate() {
                        for (i, &v) in block.iter().enumerate() {
                            let c = params.cfa[phase + (i & 1)] as usize;
                            let v = match grid {
                                Some(g) if v >= thresholds[c] => g.sample(plane, w, h, bx * f + i, row, 0, &params.cfa, 2),
                                _ => v,
                            };
                            sum[c] += v;
                        }
                    }
                }
            }
        }
        for (bx, sum) in sums.iter().enumerate() {
            let o = (by * bw + bx) * 4;
            rgba[o] = sum[0] / counts[0];
            rgba[o + 1] = sum[1] / counts[1];
            rgba[o + 2] = sum[2] / counts[2];
            rgba[o + 3] = 1.0;
        }
    }
    crate::orientation::try_apply_exif_orientation_owned(bw as u32, bh as u32, rgba, params.orientation).ok_or_else(|| NO_MEMORY.to_string())
}

/// [`render_binned_linear`] with the factor [`binned_factor_for`] picks.
pub fn render_binned_linear_for<P: PlaneParams + ?Sized>(plane: &[f32], params: &P, min_long_edge: u32) -> Result<(u32, u32, Vec<f32>), String> {
    render_binned_linear(plane, params, binned_factor_for(params, min_long_edge))
}

/// The develop settings a DNG opens with: the as-shot white balance
/// (`wbRatio` 1), the DNG method's matrix for it, the file's baseline
/// exposure (or `default_exposure_ev` when the RAW interface matched one
/// to the camera's preview), and the Standard look's base curve and
/// saturation (`raw::OpeningLook::default`; a DNG has no film simulation,
/// and its `ProfileToneCurve` is not used).
pub fn develop_defaults(params: &DngRenderParams) -> Result<RawDevelopSettings, String> {
    develop_defaults_with(params, &crate::raw::OpeningLook::default())
}

/// [`develop_defaults`] with the base curve and saturation of `look`.
///
/// A file with a `camera_curve` (its gain table map applied, its own
/// `ProfileToneCurve` usable) opens with that curve instead, at the
/// Standard saturation, whatever `look` says: like a RAF's film look, the
/// camera's own rendering is the opening, and the look's curve is one of
/// the profiles to choose (`raw::dng`).
pub fn develop_defaults_with(params: &DngRenderParams, look: &crate::raw::OpeningLook) -> Result<RawDevelopSettings, String> {
    let wb = white_balance_for_ratio(params, [1.0, 1.0, 1.0])?;
    let (curve, saturation) = match &params.camera_curve {
        Some(points) => (camera_curve_lut(points), crate::raw::STANDARD_SATURATION),
        None => (look.curve.lut(), look.saturation),
    };
    Ok(RawDevelopSettings {
        wb_ratio: wb.wb_ratio,
        cam_to_rgb: wb.cam_to_rgb,
        exposure_ev: params.default_exposure_ev.unwrap_or(params.calibration.baseline_exposure as f32),
        saturation,
        highlight_desaturation: true,
        base_curve: Some(curve),
        clip_levels: params.clip_levels,
    })
}

/// The RAW step's `wbRatio` and `camToRgb`, and the white point's kelvin
/// and tint, for a `wbRatio` on top of the as-shot balance.
pub fn white_balance_for_ratio(params: &DngRenderParams, wb_ratio: [f32; 3]) -> Result<DngWhiteBalance, String> {
    params
        .calibration
        .white_balance_for_ratio(wb_ratio, params.as_shot_gain)
        .ok_or_else(|| format!("white balance {wb_ratio:?} is not a colour this camera can see"))
}

/// The same for a white point in kelvin and tint.
pub fn white_balance_for_temperature(params: &DngRenderParams, kelvin: f32, tint: f32) -> Result<DngWhiteBalance, String> {
    if !(kelvin.is_finite() && tint.is_finite()) {
        return Err("temperature and tint must be numbers".into());
    }
    params
        .calibration
        .white_balance_for_temperature(f64::from(kelvin), f64::from(tint), params.as_shot_gain)
        .ok_or_else(|| format!("{kelvin} K, tint {tint} is not a white this camera can see"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn calibration() -> DngCalibration {
        DngCalibration {
            first: Calibration {
                illuminant: 17,
                color_matrix: [0.6520, -0.0129, -0.1022, -0.5137, 1.3297, 0.1591, -0.1206, 0.2387, 0.5786],
                forward_matrix: None,
                camera_calibration: None,
            },
            second: Some(Calibration {
                illuminant: 21,
                color_matrix: [0.7034, -0.0804, -0.1014, -0.4420, 1.3564, 0.0717, -0.0567, 0.1660, 0.5841],
                forward_matrix: None,
                camera_calibration: None,
            }),
            analog_balance: [1.0; 3],
            as_shot_neutral: Some([0.5, 1.0, 0.7]),
            as_shot_white_xy: None,
            baseline_exposure: 0.5,
        }
    }

    fn params(kind: DngKind, w: u32, h: u32, orientation: u16) -> DngRenderParams {
        let cal = calibration();
        let gain = as_shot_gain(&cal).unwrap();
        DngRenderParams {
            width: w,
            height: h,
            kind,
            samples_per_pixel: if kind == DngKind::Linear { 3 } else { 1 },
            cfa: [1, 0, 2, 1],
            orientation,
            white_level: 65535,
            as_shot_gain: gain,
            clip_levels: Some(gain),
            calibration: cal,
            camera_model: "Test".into(),
            highlight_chroma: None,
            default_exposure_ev: None,
            camera_curve: None,
            standard_exposure_ev: None,
        }
    }

    /// A deterministic pattern of plane values (not a picture).
    fn plane(p: &DngRenderParams) -> Vec<f32> {
        (0..p.row_len() * p.height as usize).map(|i| ((i * 7919) % 1013) as f32 / 1013.0 - 0.01).collect()
    }

    fn banded(p: &DngRenderParams, data: &[f32], bands: &[RafBand]) -> Vec<f32> {
        let (ow, oh) = p.oriented_size();
        let mut out = vec![f32::NAN; (ow * oh * 4) as usize];
        for &band in bands {
            let src = &data[band.src_y0 as usize * p.row_len()..band.src_y1 as usize * p.row_len()];
            let px = render_linear_band(src, p, band).unwrap();
            for row in 0..px.height {
                let dst = (((px.y + row) * ow + px.x) * 4) as usize;
                let s = (row * px.width * 4) as usize;
                out[dst..dst + (px.width * 4) as usize].copy_from_slice(&px.pixels[s..s + (px.width * 4) as usize]);
            }
        }
        out
    }

    #[test]
    fn bands_equal_the_whole_frame_for_both_kinds_and_every_orientation() {
        for kind in [DngKind::Linear, DngKind::Bayer] {
            for orientation in 1..=8 {
                let p = params(kind, 131, 250, orientation);
                let data = plane(&p);
                let whole = banded(&p, &data, &[RafBand { y0: 0, y1: 250, src_y0: 0, src_y1: 250 }]);
                let parts = banded(&p, &data, &crate::raf::plan_bands(250, 3));
                assert!(whole.iter().zip(&parts).all(|(a, b)| a.to_bits() == b.to_bits()), "{kind:?} {orientation}");
            }
        }
    }

    #[test]
    fn linear_band_keeps_values_below_black_and_adds_alpha() {
        let p = params(DngKind::Linear, 2, 1, 1);
        let px = render_linear_band(&[-0.01, 0.5, 1.2, 0.1, 0.2, 0.3], &p, RafBand { y0: 0, y1: 1, src_y0: 0, src_y1: 1 }).unwrap();
        assert_eq!(px.pixels, vec![-0.01, 0.5, 1.2, 1.0, 0.1, 0.2, 0.3, 1.0]);
    }

    #[test]
    fn a_bayer_band_needs_its_context_rows() {
        let p = params(DngKind::Bayer, 8, 12, 1);
        let data = plane(&p);
        let band = RafBand { y0: 4, y1: 8, src_y0: 4, src_y1: 8 };
        assert!(render_linear_band(&data[4 * 8..8 * 8], &p, band).is_err());
        let odd = RafBand { y0: 4, y1: 8, src_y0: 3, src_y1: 9 };
        assert!(render_linear_band(&data[3 * 8..9 * 8], &p, odd).is_err(), "odd source start breaks the CFA phase");
    }

    #[test]
    fn binned_bayer_means_each_colour_of_its_block() {
        let p = params(DngKind::Bayer, 4, 2, 1);
        // cfa [G R; B G]: block of 2×2 is one of each.
        let data = vec![0.5, 0.2, 0.6, 0.3, 0.1, 0.7, 0.2, 0.9];
        let (w, h, px) = render_binned_linear(&data, &p, 2).unwrap();
        assert_eq!((w, h), (2, 1));
        assert_eq!(&px[0..4], &[0.2, 0.6, 0.1, 1.0]);
        assert_eq!(&px[4..8], &[0.3, (0.6 + 0.9) / 2.0, 0.2, 1.0]);
        assert!(!is_valid_bin_factor(&p, 3));
    }

    #[test]
    fn binned_linear_is_the_block_mean() {
        let p = params(DngKind::Linear, 2, 2, 1);
        let data = vec![0.0, 0.1, 0.2, 0.4, 0.5, 0.6, 0.8, 0.9, 1.0, 0.0, 0.1, 0.2];
        let (w, h, px) = render_binned_linear(&data, &p, 2).unwrap();
        assert_eq!((w, h), (1, 1));
        for (c, v) in px[..3].iter().enumerate() {
            let mean = (data[c] + data[3 + c] + data[6 + c] + data[9 + c]) / 4.0;
            assert!((v - mean).abs() < 1e-6);
        }
        assert_eq!(binned_factor_for(&p, 1), 2);
        assert_eq!(binned_factor_for(&params(DngKind::Linear, 4032, 3024, 1), 2048), 1);
        assert_eq!(binned_factor_for(&params(DngKind::Linear, 8064, 6048, 1), 2048), 3);
    }

    /// A ProfileGainTableMap entry of 3 × 4 constant tables, each its own
    /// gain (weights 0, so the input is always 0), spread over the image.
    fn map_entry_bytes() -> Vec<u8> {
        let gains: Vec<f32> = (0..12).flat_map(|i| [1.0 + i as f32 * 0.25; 2]).collect();
        super::super::gain_map::tag_bytes(3, 4, 2, [0.4, 0.3], [0.1, 0.05], [0.0; 5], &gains, true)
    }

    fn long_entry(tag: TagId, values: &[u32]) -> IfdEntry {
        IfdEntry { tag: tag as u16, typ: 4, count: values.len() as u32, raw_bytes: values.iter().flat_map(|v| v.to_ne_bytes()).collect() }
    }

    /// Under an `ActiveArea` and a `DefaultCrop`, each kept pixel gets the
    /// gain of its place in the active area: the cropped plane equals the
    /// same pixels of the whole active area with the map applied.
    #[test]
    fn the_gain_map_is_placed_in_the_active_area_under_a_default_crop() {
        let main = vec![
            long_entry(TagId::ActiveArea, &[1, 2, 11, 14]),
            long_entry(TagId::DefaultCropOrigin, &[3, 2]),
            long_entry(TagId::DefaultCropSize, &[6, 5]),
        ];
        let area = image_area(&[], &main, 16, 12).unwrap();
        assert!(area.default_crop_applied);
        assert_eq!((area.width, area.height, area.from_active, area.active_width, area.active_height), (6, 5, (2, 3), 12, 10));
        let cal = calibration();
        let gain = as_shot_gain(&cal).unwrap();
        let raw = map_entry_bytes();
        let mut log = Vec::new();
        let whole_area = super::super::ImageArea { top: 1, left: 2, width: 12, height: 10, from_active: (0, 0), default_crop_applied: false, active_width: 12, active_height: 10 };
        let mut whole = vec![0.25f32; 12 * 10 * 3];
        apply_gain_table_map(&raw, true, &mut whole, &whole_area, &cal, gain, &mut log).unwrap();
        let mut kept = vec![0.25f32; 6 * 5 * 3];
        apply_gain_table_map(&raw, true, &mut kept, &area, &cal, gain, &mut log).unwrap();
        for y in 0..5 {
            for x in 0..6 {
                let k = (y * 6 + x) * 3;
                let w = ((y + 2) * 12 + x + 3) * 3;
                assert_eq!(kept[k].to_bits(), whole[w].to_bits(), "{x},{y}");
            }
        }
        // The map is not constant over the crop, so placement mattered.
        assert!(kept.chunks_exact(3).any(|p| p[0] != kept[0]));
    }

    fn float_entry(tag: TagId, values: &[f32]) -> IfdEntry {
        IfdEntry { tag: tag as u16, typ: 11, count: values.len() as u32, raw_bytes: values.iter().flat_map(|v| v.to_ne_bytes()).collect() }
    }

    /// A `ProfileToneCurve` is used only when it is a curve the tone step
    /// can take; anything else is refused with a sentence.
    #[test]
    fn a_tone_curve_is_checked_before_it_is_used() {
        let curve = |v: &[f32]| camera_curve_points(&[float_entry(TagId::ProfileToneCurve, v)], &[]);
        let good = curve(&[0.0, 0.0, 0.25, 0.1, 0.5, 0.45, 1.0, 1.0]).unwrap().unwrap();
        assert_eq!(good, vec![[0.0, 0.0], [0.25, 0.1], [0.5, 0.45], [1.0, 1.0]]);
        let lut = camera_curve_lut(&good);
        assert!(lut.windows(2).all(|w| w[1] >= w[0]) && lut[0] == 0.0 && lut[lut.len() - 1] == 1.0);
        assert_eq!(camera_curve_points(&[], &[]), Ok(None));
        for bad in [
            &[0.0, 0.0, 1.0][..],                      // not pairs
            &[0.0, 0.0][..],                           // one point
            &[0.0, 0.0, 0.5, 0.6, 0.4, 0.7, 1.0, 1.0][..], // inputs go back
            &[0.0, 0.0, 0.5, 0.6, 0.7, 0.5, 1.0, 1.0][..], // outputs fall
            &[0.0, 0.0, 0.5, f32::NAN, 1.0, 1.0][..],  // not a number
            &[0.0, 0.0, 0.5, 1.5, 1.0, 1.0][..],       // outside 0..1
            &[0.0, 0.1, 1.0, 1.0][..],                 // does not start at black
            &[0.0, 0.0, 1.0, 0.8][..],                 // does not end at white
        ] {
            assert!(curve(bad).is_err(), "{bad:?}");
        }
        let long = vec![0.5f32; 2 * (MAX_TONE_CURVE_POINTS + 1)];
        assert!(curve(&long).unwrap_err().contains("pairs"));
        // A curve stored as another type is refused, not misread.
        let wrong = IfdEntry { tag: TagId::ProfileToneCurve as u16, typ: 4, count: 4, raw_bytes: vec![0; 16] };
        assert!(camera_curve_points(&[wrong], &[]).is_err());
    }

    /// The map is applied in the stored orientation, before the renders
    /// turn the picture: a gain at the stored top-left ends where the
    /// orientation puts that pixel, in the band and the binned view alike.
    #[test]
    fn the_gain_map_follows_the_stored_orientation() {
        let cal = calibration();
        let gain = as_shot_gain(&cal).unwrap();
        let raw = map_entry_bytes();
        let area = super::super::ImageArea { top: 0, left: 0, width: 8, height: 6, from_active: (0, 0), default_crop_applied: false, active_width: 8, active_height: 6 };
        let mut plane = vec![0.5f32; 8 * 6 * 3];
        apply_gain_table_map(&raw, true, &mut plane, &area, &cal, gain, &mut Vec::new()).unwrap();
        let corner = plane[0];
        assert!(corner < 0.55, "near the top-left table, whose gain is 1: {corner}");
        let far = plane[(5 * 8 + 7) * 3];
        assert!(far > 1.8, "near the bottom-right table, whose gain is 3.75: {far}");
        for orientation in 1..=8 {
            let p = params(DngKind::Linear, 8, 6, orientation);
            let band = render_linear_band(&plane, &p, RafBand { y0: 0, y1: 6, src_y0: 0, src_y1: 6 }).unwrap();
            let (bw, _, binned) = render_binned_linear(&plane, &p, 1).unwrap();
            assert_eq!(band.pixels, binned, "{orientation}");
            // Where the stored top-left pixel lands.
            let (ow, oh) = p.oriented_size();
            let (x, y) = match orientation {
                2 => (ow - 1, 0),
                3 => (ow - 1, oh - 1),
                4 => (0, oh - 1),
                6 => (ow - 1, 0),
                7 => (ow - 1, oh - 1),
                8 => (0, oh - 1),
                _ => (0, 0),
            };
            assert_eq!(bw, ow);
            assert_eq!(binned[((y * ow + x) * 4) as usize], corner, "{orientation}");
        }
    }

    #[test]
    fn a_malformed_gain_map_is_refused_with_a_sentence_and_the_plane_kept() {
        let cal = calibration();
        let gain = as_shot_gain(&cal).unwrap();
        let area = super::super::ImageArea { top: 0, left: 0, width: 4, height: 2, from_active: (0, 0), default_crop_applied: false, active_width: 4, active_height: 2 };
        let mut plane = vec![0.5f32; 4 * 2 * 3];
        let raw = map_entry_bytes();
        let why = apply_gain_table_map(&raw[..raw.len() - 4], true, &mut plane, &area, &cal, gain, &mut Vec::new()).unwrap_err();
        assert!(why.starts_with("ProfileGainTableMap (local tone map; refused: the map holds"), "{why}");
        assert!(plane.iter().all(|&v| v == 0.5));
    }

    #[test]
    fn defaults_are_the_as_shot_balance_and_neutral_at_white() {
        let p = params(DngKind::Linear, 4, 4, 1);
        let s = develop_defaults(&p).unwrap();
        assert_eq!(s.wb_ratio, [1.0, 1.0, 1.0]);
        let m = s.cam_to_rgb;
        for r in 0..3 {
            let sum = m[r * 3] + m[r * 3 + 1] + m[r * 3 + 2];
            assert!((sum - 1.0).abs() < 1e-4, "row {r} sums to {sum}");
        }
        assert_eq!(s.exposure_ev, 0.5);
        assert_eq!(s.clip_levels, Some(p.as_shot_gain));
        // The params travel through JSON unchanged.
        let json = serde_json::to_string(&p).unwrap();
        let back: DngRenderParams = serde_json::from_str(&json).unwrap();
        assert_eq!(back, p);
        let wb = white_balance_for_temperature(&p, 3200.0, 0.0).unwrap();
        assert!((wb.kelvin - 3200.0).abs() < 1.0);
        assert!(white_balance_for_temperature(&p, f32::NAN, 0.0).is_err());
    }
}

/// Measure, once over a whole prepared Bayer plane, the chroma its clipped
/// channels are reconstructed from (`raf::highlights::ChromaGrid`, period
/// 2), with each channel clipping at `clip`. `None` for LinearRaw, without
/// clip levels, or when nothing comes near its clip level.
pub fn measure_highlight_chroma(plane: &[f32], layout: &PlaneLayout, clip: Option<[f32; 3]>) -> Option<ChromaGrid> {
    if layout.kind != DngKind::Bayer {
        return None;
    }
    ChromaGrid::measure(plane, layout.width as usize, layout.height as usize, &layout.cfa, 2, clip?)
}
