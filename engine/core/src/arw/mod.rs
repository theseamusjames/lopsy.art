//! Sony ARW raw image decoder.
//!
//! An ARW is a little-endian TIFF: IFD0 is a preview JPEG with Sony's
//! `Make` ("SONY"), the sensor mosaic is in a SubIFD (the "raw IFD", the
//! one with a colour filter array) with Sony's raw tags (0x7000 onwards),
//! and Sony's private "SR2" block, reached through IFD0's `DNGPrivateData`
//! (0xC634), holds more of the camera's tags, enciphered ([`sr2`]).
//!
//! ## What decodes, and on which files it was checked
//!
//! Three encodings of a 2×2 red, green and blue mosaic:
//!
//! - **lossy compressed** (`Compression` 32767, 8 bits a pixel; [`lossy`]),
//!   14-bit (ILCE-7M4, ILCE-7M3) and 12-bit `BitsPerSample` (ILCE-6000,
//!   DSC-RX100M3): the same blocks and `SonyCurve` either way, and the
//!   curve gives 14-bit-range values for both;
//! - **uncompressed** (`Compression` 1): one little-endian 16-bit word a
//!   pixel (ILCE-7M4);
//! - **lossless compressed, full size** (`Compression` 7, lossless JPEG
//!   tiles; [`lossless`]) (ILCE-7M4).
//!
//! Each was checked on a real file from raw.pixls.us (CC0) against the
//! camera's own JPEG embedded in the file and macOS's decode (`sips`):
//! the size, crop and orientation line up (best alignment at no shift),
//! there is no cast on neutral surfaces, tone ranks the same, and the
//! block and tile edges are no rougher than their insides.
//! `tests/arw_decode.rs` measures and prints all of it.
//!
//! Refused, each with a sentence a person can read, because there is no
//! real file to check them on: reduced-size (Medium and Small) lossless
//! raws, uncompressed or lossless data at a depth other than 14 bits, the early
//! compressed format of the first ARW bodies, big-endian files, and
//! Sony's older formats, SR2 (DSC-R1) and SRF (DSC-F828, DSC-V3).
//!
//! ## Calibration, from Sony's tags
//!
//! Newer bodies (the A7 III and A7 IV here) record their levels and crop
//! in the clear in the raw IFD; older ones (the A6000 and RX100 III) only
//! in the SR2 block, which on the newer ones holds the same values.
//!
//! - **Black level**: 0x7310, four values, per position of the stored 2×2
//!   pattern (equal on every sample, so the order of unequal values is
//!   unverified): the raw IFD's, else the SR2 block's. The darkest
//!   samples of every file sit just around it (512, or 800 on the RX100
//!   III).
//! - **White level**: `WhiteLevel` (0xC61D) in the raw IFD, where clipped
//!   highlights pile up on every file that has it (16383). Without it (the
//!   12-bit lossy bodies), 16383, the top of the range the curve maps
//!   to; neither of those samples has clipped highlights, so this is
//!   consistent with them (their brightest values are 10132 and 14708)
//!   but not pinned by them. The SR2 block's 0x787F (15360) is not used:
//!   the A7 IV's highlights clip above it.
//! - **As-shot white balance**: 0x7313, the R, G, G, B multipliers, as
//!   channel gains (green 1): the raw IFD's, else the SR2 block's.
//! - **Crop**: Sony's 0x74C7 (left, top) and 0x74C8 (width, height) in the
//!   raw IFD, else `DefaultCropOrigin` and `DefaultCropSize`, else the SR2
//!   block's 0x74C3 (left, top, right, bottom), else the whole mosaic. On
//!   every sample the result is the size `sips` renders and lines up with
//!   it at no shift.
//! - **Orientation**: IFD0's `Orientation`.
//!
//! ## Colour
//!
//! An ARW carries no DNG colour matrix. The only matrix in the file is
//! Sony's `ColorMatrix` (0x7800 in the SR2 block, nine 1024ths whose rows
//! each sum to one, so it applies to white-balanced camera RGB). It is
//! close to the identity, differs from frame to frame on one body, and is
//! not the camera's whole colour transform: read as camera RGB → linear
//! sRGB it turns hues the right way (within 2–9° of the references over a
//! grid of cells) but leaves the A7 IV's colour at about half the
//! saturation of its JPEG and of `sips` (the older bodies' matrices are
//! stronger: 0.7–0.9). The rest of the camera's transform is not in the
//! file. So the decode uses it and says the colour is approximate
//! ([`ArwColour`], whose note the host shows); a file without a readable
//! matrix gets white balance only, and says so too. A per-camera matrix
//! table would fix this and is the project owner's decision.
//!
//! ## The two decodes, on the DNG pipeline
//!
//! After the samples are unpacked, an ARW goes through the DNG decode's
//! own steps, not a copy of them:
//!
//! - [`linear::prepare_arw`] makes the prepared plane with
//!   `dng::linear::fill_plane` (the `SonyCurve` table as the linearization
//!   table, Sony's black and white levels, the crop as the active area, the
//!   as-shot gains), and renders it with the DNG renders (`ArwRenderParams`
//!   is a `dng::linear::PlaneParams`). Its develop settings are a RAF's
//!   model: a fixed matrix and channel-gain white balance.
//! - [`read_arw`], the baked decode, takes that plane, demosaics it with
//!   `dng::demosaic::bilinear` and finishes it with the DNG baked decode's
//!   `bake_colour` (the matrix) and `bake_finish` (the engine's neutral
//!   base curve where a DNG's profile tone curve goes, as the RAW develop
//!   defaults use it; sRGB, auto-levels, orientation), to the same sRGB f32
//!   RGBA `DngImage` `read_dng` gives. The curve is close to the identity
//!   (18 % grey to 19.5 %), so the picture stays darker than the camera's
//!   JPEG, which also lifts the exposure: an ARW records no baseline
//!   exposure.
//!
//! ## What is not applied
//!
//! Sony's lens corrections (vignetting, chromatic aberration and
//! distortion parameters, tags 0x7032, 0x7035 and 0x7037, which the JPEG
//! and `sips` do apply: the RX100 III's barrel distortion shows), the
//! camera's tone curve and creative style, and highlight reconstruction
//! (clipped channels stay clipped). [`linear::ArwPrepared::unhandled`]
//! lists the corrections a file carries.
//!
//! Written from the published descriptions of the formats and from what
//! the real files show; no code of another raw decoder was read or used.

pub mod linear;
pub mod lossless;
pub mod lossy;
pub mod sr2;

use crate::dng::tiff::{IfdEntry, TagId, TiffReader};
use crate::dng::{get_tag_u16, get_tag_u32, get_tag_u32_vec, DngImage};
use serde::{Deserialize, Serialize};

const TAG_DNG_VERSION: u16 = 0xC612;
const TAG_DNG_PRIVATE_DATA: u16 = 0xC634;
const TAG_SONY_CURVE: u16 = 0x7010;
const TAG_SONY_BLACK_LEVEL: u16 = 0x7310;
const TAG_SONY_WB_RGGB: u16 = 0x7313;
const TAG_SONY_CROP_TOP_LEFT: u16 = 0x74C7;
const TAG_SONY_CROP_SIZE: u16 = 0x74C8;
const TAG_SONY_CROP_CORNERS: u16 = 0x74C3;
const TAG_SONY_VIGNETTING: u16 = 0x7032;
const TAG_SONY_CHROMATIC_ABERRATION: u16 = 0x7035;
const TAG_SONY_DISTORTION: u16 = 0x7037;

/// The white level of a lossy compressed raw whose raw IFD records none:
/// the top of the 14-bit range its curve maps to (see `lossy`).
const LOSSY_DEFAULT_WHITE: u32 = 16383;

/// Where an ARW's colour came from. Either way it is approximate (see the
/// module docs), and [`ArwColour::note`] says so for a person.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ArwColour {
    /// Sony's `ColorMatrix` from the SR2 block.
    SonyColorMatrix,
    /// No usable matrix: the as-shot white balance only.
    WhiteBalanceOnly,
}

impl ArwColour {
    /// What a person should be told about the colour.
    pub fn note(self) -> &'static str {
        match self {
            ArwColour::SonyColorMatrix => {
                "Colour is approximate: this Sony RAW carries only part of the camera's colour matrix, so colours look less saturated than in the camera's own JPEG."
            }
            ArwColour::WhiteBalanceOnly => {
                "Colour is approximate: this Sony RAW carries no colour matrix, so only its white balance is applied and colours look washed out."
            }
        }
    }
}

/// How the mosaic is stored.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ArwEncoding {
    /// `Compression` 32767: Sony's lossy 8-bit-a-pixel blocks (`lossy`).
    Lossy,
    /// `Compression` 1: one 16-bit word a pixel.
    Uncompressed,
    /// `Compression` 7: lossless JPEG tiles (`lossless`).
    Lossless,
}

/// Whether `data` looks like a Sony raw: a TIFF whose IFD0 says the camera
/// is Sony's (`Make` "SONY") and has no `DNGVersion`. Reads IFD0 only, so
/// it is cheap. A `true` here does not mean the decoder supports the file:
/// [`read_info`] says why when it does not (the SRF format, a variant not
/// supported yet).
pub fn is_sony_raw(data: &[u8]) -> bool {
    let Ok(reader) = TiffReader::new(data) else { return false };
    let Ok(ifd0) = reader.read_ifd(0) else { return false };
    ascii(&ifd0, TagId::Make as u16).eq_ignore_ascii_case("SONY") && !ifd0.iter().any(|e| e.tag == TAG_DNG_VERSION)
}

fn ascii(entries: &[IfdEntry], tag: u16) -> String {
    entries
        .iter()
        .find(|e| e.tag == tag)
        .map(|e| String::from_utf8_lossy(&e.raw_bytes).trim_end_matches('\0').trim().to_string())
        .unwrap_or_default()
}

fn u16s(entries: &[IfdEntry], tag: u16) -> Option<Vec<u16>> {
    let e = entries.iter().find(|e| e.tag == tag)?;
    match e.typ {
        3 | 8 => Some(e.raw_bytes.chunks_exact(2).map(|b| u16::from_le_bytes([b[0], b[1]])).collect()),
        _ => None,
    }
}

fn u32s(entries: &[IfdEntry], tag: u16) -> Option<Vec<u32>> {
    entries.iter().find(|e| e.tag == tag).and_then(|e| e.as_u32_vec())
}

/// The crop Sony intends, in the stored mosaic: left, top, width, height.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Crop {
    pub left: u32,
    pub top: u32,
    pub width: u32,
    pub height: u32,
}

/// Where each calibration value was read from, for the debug log and the
/// tests' report.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArwSources {
    pub black: String,
    pub white: String,
    pub white_balance: String,
    pub crop: String,
    pub matrix: String,
}

/// What an ARW's tags say, without its pixels.
pub struct ArwInfo {
    pub ifd0: Vec<IfdEntry>,
    pub raw_ifd: Vec<IfdEntry>,
    /// The stored mosaic's size.
    pub width: u32,
    pub height: u32,
    pub encoding: ArwEncoding,
    /// `BitsPerSample` of the raw IFD.
    pub bits: u16,
    /// The 2×2 Bayer pattern from the stored mosaic's top-left (0 R, 1 G,
    /// 2 B).
    pub cfa: [u8; 4],
    /// The black level of each position of the stored 2×2 pattern.
    pub black: [f64; 4],
    pub white: u32,
    /// The as-shot white balance as channel gains, green 1.
    pub as_shot_gain: [f32; 3],
    pub crop: Crop,
    pub orientation: u16,
    /// White-balanced camera RGB → linear sRGB.
    pub cam_to_rgb: [f32; 9],
    pub colour: ArwColour,
    /// `Make Model`.
    pub camera_model: String,
    pub sources: ArwSources,
    /// Corrections the file records that the decode does not apply.
    pub unhandled: Vec<String>,
    pub debug_log: Vec<String>,
}

impl ArwInfo {
    /// The decoded picture's size: the crop, after orientation.
    pub fn oriented_size(&self) -> (u32, u32) {
        match self.orientation {
            5..=8 => (self.crop.height, self.crop.width),
            _ => (self.crop.width, self.crop.height),
        }
    }
}

/// Read a Sony raw's tags (and its SR2 block) without decoding pixels.
/// Every variant the decoder does not support is refused here, with a
/// sentence a person can read.
pub fn read_info(data: &[u8]) -> Result<ArwInfo, String> {
    if !is_sony_raw(data) {
        return Err("This is not a Sony RAW file".into());
    }
    let reader = TiffReader::new(data)?;
    if !reader.is_little_endian() {
        return Err("This Sony RAW is stored big-endian, which is not supported".into());
    }
    let ifd0 = reader.read_ifd(0)?;
    let mut debug_log = Vec::new();

    // Sony's two formats before ARW. The DSC-R1 alone wrote SR2 (its
    // mosaic is stored differently, and it has no colour matrix); SRF files
    // (DSC-F828, DSC-V3) have neither SubIFDs nor Sony's private data in
    // the clear: their layout is enciphered.
    if ascii(&ifd0, TagId::Model as u16).eq_ignore_ascii_case("DSC-R1") {
        return Err("This older Sony RAW format (SR2) is not supported".into());
    }
    let has_subs = ifd0.iter().any(|e| e.tag == TagId::SubIFDs as u16);
    if !has_subs && !ifd0.iter().any(|e| e.tag == TAG_DNG_PRIVATE_DATA) {
        return Err("This older Sony RAW format (SRF) is not supported".into());
    }

    // The raw IFD: the SubIFD holding a colour filter array.
    let subs: Vec<Vec<IfdEntry>> = get_tag_u32_vec(&ifd0, TagId::SubIFDs)
        .unwrap_or_default()
        .iter()
        .filter_map(|&o| reader.read_ifd_at(o).ok())
        .collect();
    let photometric = |ifd: &[IfdEntry]| get_tag_u16(ifd, TagId::PhotometricInterpretation).ok();
    let Some(raw_ifd) = subs.iter().find(|ifd| photometric(ifd) == Some(32803)).cloned() else {
        return Err(if subs.is_empty() {
            "This Sony RAW has no sensor data this decoder can find (an early ARW?), which is not supported".into()
        } else {
            "This Sony RAW is not a full-size sensor mosaic (a Medium or Small RAW), which is not supported".into()
        });
    };

    let width = get_tag_u32(&raw_ifd, TagId::ImageWidth)?;
    let height = get_tag_u32(&raw_ifd, TagId::ImageLength)?;
    let compression = get_tag_u16(&raw_ifd, TagId::Compression).unwrap_or(1);
    let bits = get_tag_u16(&raw_ifd, TagId::BitsPerSample).unwrap_or(0);
    let encoding = match compression {
        32767 => ArwEncoding::Lossy,
        1 => ArwEncoding::Uncompressed,
        7 => ArwEncoding::Lossless,
        c => return Err(format!("This Sony RAW uses compression {c}, which is not supported")),
    };
    // The depths checked on real files.
    if !matches!((encoding, bits), (ArwEncoding::Lossy, 12 | 14) | (ArwEncoding::Uncompressed | ArwEncoding::Lossless, 14)) {
        let what = match encoding {
            ArwEncoding::Lossy => "compressed",
            ArwEncoding::Uncompressed => "uncompressed",
            ArwEncoding::Lossless => "lossless compressed",
        };
        return Err(format!("This Sony RAW stores {bits}-bit {what} data, which is not supported yet"));
    }
    // The stored mosaic as u16, then the f32 plane made from it.
    crate::decode::check_image_size(width, height, 6)?;

    let cfa = {
        let dim = u32s(&raw_ifd, TagId::CfaRepeatPatternDim as u16);
        let pattern = raw_ifd.iter().find(|e| e.tag == TagId::CfaPattern as u16).map(|e| e.raw_bytes.clone());
        match (dim.as_deref(), pattern) {
            (None | Some([2, 2]), Some(p)) if p.len() == 4 && p.iter().all(|&c| c <= 2) && (0..3).all(|c| p.contains(&c)) => [p[0], p[1], p[2], p[3]],
            _ => return Err("This Sony RAW's colour filter is not a 2×2 red, green and blue pattern, which is not supported".into()),
        }
    };

    let sr2 = match sr2::read_sr2(data, &ifd0) {
        Ok(s) => s,
        Err(e) => {
            debug_log.push(format!("[ARW] SR2 block not read: {e}"));
            None
        }
    };
    let sr2_values = |tag: u16| sr2.as_deref().and_then(|s| sr2::values_i32(s, tag));
    let raw_values = |tag: u16| sr2::values_i32(&raw_ifd, tag);
    let mut sources = ArwSources::default();

    let (black_values, black_source) = if let Some(v) = raw_values(TAG_SONY_BLACK_LEVEL) {
        (v, "raw IFD 0x7310")
    } else if let Some(v) = sr2_values(TAG_SONY_BLACK_LEVEL) {
        (v, "SR2 0x7310")
    } else {
        return Err("This Sony RAW has no black level".into());
    };
    sources.black = black_source.into();
    let black: [f64; 4] = match black_values.as_slice() {
        [a, b, c, d] => [*a, *b, *c, *d].map(f64::from),
        [a] => [f64::from(*a); 4],
        _ => return Err(format!("This Sony RAW's black level has {} values", black_values.len())),
    };
    let (white, white_source) = match (get_tag_u32(&raw_ifd, TagId::WhiteLevel), encoding) {
        (Ok(w), _) => (w, "raw IFD WhiteLevel".to_string()),
        (Err(_), ArwEncoding::Lossy) => (LOSSY_DEFAULT_WHITE, "the curve's 14-bit range".to_string()),
        (Err(_), _) => ((1 << bits) - 1, format!("{bits}-bit range")),
    };
    sources.white = white_source;
    if black.iter().any(|&b| !(0.0..f64::from(white)).contains(&b)) {
        return Err(format!("This Sony RAW's black level {black:?} is not below its white level {white}"));
    }

    // White balance as R, G, G, B levels.
    let (levels, wb_source) = if let Some(v) = raw_values(TAG_SONY_WB_RGGB) {
        (v, "raw IFD 0x7313")
    } else if let Some(v) = sr2_values(TAG_SONY_WB_RGGB) {
        (v, "SR2 0x7313")
    } else {
        return Err("This Sony RAW has no as-shot white balance".into());
    };
    sources.white_balance = wb_source.into();
    let as_shot_gain = match levels.as_slice() {
        [r, g1, g2, b] if *r > 0 && *g1 > 0 && *g2 > 0 && *b > 0 => {
            let g = (f64::from(*g1) + f64::from(*g2)) / 2.0;
            [(f64::from(*r) / g) as f32, 1.0, (f64::from(*b) / g) as f32]
        }
        _ => return Err(format!("This Sony RAW's white balance {levels:?} is not four positive levels")),
    };

    let pair = |tag: u16| u32s(&raw_ifd, tag).filter(|v| v.len() == 2);
    let corners = sr2_values(TAG_SONY_CROP_CORNERS).filter(|v| v.len() == 4 && v.iter().all(|&x| x >= 0));
    let (crop, crop_source) = if let (Some(o), Some(s)) = (pair(TAG_SONY_CROP_TOP_LEFT), pair(TAG_SONY_CROP_SIZE)) {
        (Crop { left: o[0], top: o[1], width: s[0], height: s[1] }, "raw IFD 0x74C7/0x74C8")
    } else if let (Some(o), Some(s)) = (pair(TagId::DefaultCropOrigin as u16), pair(TagId::DefaultCropSize as u16)) {
        (Crop { left: o[0], top: o[1], width: s[0], height: s[1] }, "raw IFD DefaultCrop")
    } else if let Some(c) = corners.filter(|c| c[2] > c[0] && c[3] > c[1]) {
        let c: Vec<u32> = c.iter().map(|&v| v as u32).collect();
        (Crop { left: c[0], top: c[1], width: c[2] - c[0], height: c[3] - c[1] }, "SR2 0x74C3")
    } else {
        (Crop { left: 0, top: 0, width, height }, "none (the whole mosaic)")
    };
    sources.crop = crop_source.into();
    let fits = |o: u32, s: u32, total: u32| s > 0 && o.checked_add(s).is_some_and(|end| end <= total);
    if !(fits(crop.left, crop.width, width) && fits(crop.top, crop.height, height)) {
        return Err(format!("This Sony RAW's crop {crop:?} is outside its {width}×{height} sensor data"));
    }

    let orientation = get_tag_u16(&ifd0, TagId::Orientation).ok().filter(|o| (1..=8).contains(o)).unwrap_or(1);
    let (cam_to_rgb, colour) = match sr2.as_deref().and_then(sr2::color_matrix) {
        Some(m) => {
            sources.matrix = "SR2 0x7800".into();
            (m, ArwColour::SonyColorMatrix)
        }
        None => {
            sources.matrix = "none".into();
            ([1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0], ArwColour::WhiteBalanceOnly)
        }
    };
    let camera_model = format!("{} {}", ascii(&ifd0, TagId::Make as u16), ascii(&ifd0, TagId::Model as u16)).trim().to_string();
    let has = |tag: u16| raw_ifd.iter().any(|e| e.tag == tag);
    let unhandled: Vec<String> = [
        (TAG_SONY_VIGNETTING, "Sony's vignetting correction"),
        (TAG_SONY_CHROMATIC_ABERRATION, "Sony's chromatic aberration correction"),
        (TAG_SONY_DISTORTION, "Sony's distortion correction"),
    ]
    .iter()
    .filter(|(tag, _)| has(*tag))
    .map(|(_, what)| what.to_string())
    .collect();
    debug_log.push(format!(
        "[ARW] {camera_model}: {encoding:?} {bits}-bit {width}×{height}, crop {crop:?}, black {black:?}, white {white}, as-shot gain {as_shot_gain:?}, colour {colour:?} {cam_to_rgb:?}, orientation {orientation}, from {sources:?}"
    ));
    Ok(ArwInfo {
        ifd0,
        raw_ifd,
        width,
        height,
        encoding,
        bits,
        cfa,
        black,
        white,
        as_shot_gain,
        crop,
        orientation,
        cam_to_rgb,
        colour,
        camera_model,
        sources,
        unhandled,
        debug_log,
    })
}

/// The stored mosaic: `width × height` values, and the table that maps
/// them to linear values when they are not linear already (the lossy
/// format's `SonyCurve`).
pub struct StoredMosaic {
    pub values: Vec<u16>,
    pub table: Option<Vec<u16>>,
}

fn strips<'a>(data: &'a [u8], info: &ArwInfo) -> Result<Vec<&'a [u8]>, String> {
    let offsets = get_tag_u32_vec(&info.raw_ifd, TagId::StripOffsets)?;
    let counts = get_tag_u32_vec(&info.raw_ifd, TagId::StripByteCounts)?;
    if offsets.is_empty() || offsets.len() != counts.len() {
        return Err("This Sony RAW's strip table is damaged".into());
    }
    offsets
        .iter()
        .zip(&counts)
        .map(|(&o, &c)| {
            (o as usize)
                .checked_add(c as usize)
                .filter(|&end| end <= data.len())
                .map(|end| &data[o as usize..end])
                .ok_or_else(|| "This Sony RAW is cut short: its sensor data runs past the end of the file".to_string())
        })
        .collect()
}

/// The strips as one slice, joined only when there is more than one.
fn joined<'a>(parts: Vec<&'a [u8]>, buf: &'a mut Vec<u8>) -> Result<&'a [u8], String> {
    if parts.len() == 1 {
        return Ok(parts[0]);
    }
    let total = parts.iter().map(|p| p.len()).sum();
    buf.try_reserve_exact(total).map_err(|_| "not enough memory for the Sony RAW's data".to_string())?;
    for p in parts {
        buf.extend_from_slice(p);
    }
    Ok(buf)
}

/// Decode the stored mosaic of a file [`read_info`] accepted.
pub fn read_mosaic(data: &[u8], info: &ArwInfo) -> Result<StoredMosaic, String> {
    let (w, h) = (info.width as usize, info.height as usize);
    match info.encoding {
        ArwEncoding::Lossy => {
            let parts = strips(data, info)?;
            let total: usize = parts.iter().map(|p| p.len()).sum();
            if total != w * h {
                return Err("This Sony RAW uses an early compressed format (ARW 1), which is not supported".into());
            }
            let mut buf = Vec::new();
            let bytes = joined(parts, &mut buf)?;
            let values = lossy::decode_codes(bytes, w, h)?;
            let curve = u16s(&info.raw_ifd, TAG_SONY_CURVE).ok_or("This Sony RAW has no SonyCurve to linearize its data")?;
            Ok(StoredMosaic { values, table: Some(lossy::code_to_linear(&curve)?) })
        }
        ArwEncoding::Uncompressed => {
            let parts = strips(data, info)?;
            let total: usize = parts.iter().map(|p| p.len()).sum();
            if total != w * h * 2 {
                return Err(format!("This Sony RAW's uncompressed data is {total} bytes, not the {} a {w}×{h} mosaic of 16-bit words needs", w * h * 2));
            }
            let mut buf = Vec::new();
            let bytes = joined(parts, &mut buf)?;
            let mut values: Vec<u16> = Vec::new();
            values.try_reserve_exact(w * h).map_err(|_| "not enough memory for the Sony RAW's pixels".to_string())?;
            values.extend(bytes.chunks_exact(2).map(|b| u16::from_le_bytes([b[0], b[1]])));
            Ok(StoredMosaic { values, table: None })
        }
        ArwEncoding::Lossless => {
            let tw = get_tag_u32(&info.raw_ifd, TagId::TileWidth).map_err(|_| "This Sony RAW's lossless data has no tile size")? as usize;
            let th = get_tag_u32(&info.raw_ifd, TagId::TileLength).map_err(|_| "This Sony RAW's lossless data has no tile size")? as usize;
            let offsets = get_tag_u32_vec(&info.raw_ifd, TagId::TileOffsets)?;
            let counts = get_tag_u32_vec(&info.raw_ifd, TagId::TileByteCounts)?;
            let values = lossless::decode_tiles(data, w, h, tw, th, &offsets, &counts)?;
            Ok(StoredMosaic { values, table: None })
        }
    }
}

/// [`read_arw`]'s result: the baked image, and where its colour came from.
pub struct ArwImage {
    /// sRGB f32 RGBA in 0..1, upright and cropped, as `read_dng` gives.
    /// `baseline_exposure` is 0 and `tone_curve` empty: an ARW has neither.
    pub image: DngImage,
    pub colour: ArwColour,
    pub camera_model: String,
    /// Corrections the file records that the decode does not apply.
    pub not_applied: Vec<String>,
}

/// The baked decode: a Sony raw to sRGB f32 RGBA, upright and cropped,
/// through the DNG baked decode's steps (bilinear demosaic, the camera
/// matrix, the sRGB transfer, auto-levels, orientation).
pub fn read_arw(data: &[u8]) -> Result<ArwImage, String> {
    let prep = linear::prepare_arw(data)?;
    let linear::ArwPrepared { params, mut plane, unhandled, mut debug_log } = prep;
    // The baked decode starts from black, as `read_dng`'s normalization
    // does; the plane already carries the as-shot white balance.
    for v in plane.iter_mut() {
        *v = v.max(0.0);
    }
    let mut rgb = crate::dng::demosaic::bilinear(&plane, params.width, params.height, &params.cfa);
    drop(plane);
    let ci = crate::dng::centre_index(params.width, params.height);
    crate::dng::bake_colour(&mut rgb, None, Some(&params.cam_to_rgb), None, &mut debug_log, ci);
    // An ARW has no profile tone curve: in its place, the engine's neutral
    // base curve, which the RAW develop path's defaults use
    // (`linear::develop_defaults`), sampled as the curve's own lookup table.
    let base = crate::raf::base_curves::curve_lut(&crate::raf::base_curves::NEUTRAL);
    let last = (base.len() - 1) as f64;
    let tone_curve: Vec<(f64, f64)> = base.iter().enumerate().map(|(i, &y)| (i as f64 / last, f64::from(y))).collect();
    let (width, height, pixels) = crate::dng::bake_finish(rgb, params.width, params.height, &tone_curve, params.orientation, &mut debug_log)?;
    Ok(ArwImage {
        image: DngImage { width, height, pixels, baseline_exposure: 0.0, tone_curve: Vec::new(), debug_log },
        colour: params.colour,
        camera_model: params.camera_model,
        not_applied: unhandled,
    })
}
