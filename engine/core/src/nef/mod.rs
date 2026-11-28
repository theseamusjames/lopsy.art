//! Nikon NEF raw image decoder.
//!
//! A NEF is a TIFF (big-endian from the older bodies, little-endian from
//! the newer ones): IFD0 holds a small thumbnail, Nikon's `Make` ("NIKON
//! CORPORATION") and the orientation; its SubIFDs hold JPEG previews and
//! the sensor mosaic (the "raw IFD", the one with a colour filter array).
//! The Exif IFD's maker note is Nikon's: the bytes "Nikon", a NUL, a
//! two-byte version, two zero bytes, then a whole TIFF of its own (header
//! and IFD, offsets from that header), which [`makernote`] reads.
//!
//! ## What decodes, and on which files it was checked
//!
//! Uncompressed mosaics of a 2×2 red, green and blue pattern, in each of
//! the five layouts the sample files use ([`NefLayout`], [`unpack`]):
//!
//! - one 16-bit word a pixel, in the file's byte order: 14-bit, big-endian
//!   (D3) and little-endian (D850);
//! - 12 bits a pixel, packed high bit first, each row on a byte, in a
//!   big-endian file whose raw IFD says `Compression` 1 (D200, D3);
//! - 12 or 14 bits a pixel, packed low bit first, each row padded to a
//!   multiple of 16 bytes, in a little-endian file whose raw IFD says
//!   `Compression` 34713 (Nikon's) but whose strip is exactly that size and
//!   whose maker note has no compression data: 12-bit (D500, Z 6) and
//!   14-bit (D6, Z 6).
//!
//! And Nikon's compressed mosaics ([`compressed`]), lossless (12-bit D3,
//! 14-bit Z 6 and Z 30) and lossy (12-bit D7000, D850 and Z 7II, 14-bit
//! D3).
//!
//! Each was checked on a real file from raw.pixls.us (CC0) against the
//! camera's own full-size JPEG embedded in the file: the size, crop and
//! orientation line up at no shift, there is no cast on neutral surfaces,
//! and tone ranks the same; `tests/nef_decode.rs` measures and prints all
//! of it. The layout and bit order are told apart by the strip's size,
//! and each was chosen as the one under which neighbouring pixels of one
//! colour differ least (any other reading of those files is noise).
//!
//! Refused, each with a sentence a person can read: High Efficiency raws
//! (a third-party codec), Medium and Small raws, the NRW files of COOLPIX
//! compacts, any packing or depth not in the list above, the compressed
//! forms `compressed` lists as refused, and files whose maker note does
//! not carry the values below (the D70's white balance is not in the
//! clear).
//!
//! **Compressed NEFs** carry their curve and starting values (tag 0x0096)
//! but not their Huffman tables, which are Nikon's constants: `compressed`
//! says where the values were taken from.
//!
//! ## Calibration, from Nikon's maker note
//!
//! Each value below was found by matching the maker note against the
//! file's own data and the camera's JPEG:
//!
//! - **Black level**: tag 0x003D, four values, in 14-bit units (1008 on
//!   the Z bodies and the D6, 400 on the D500 and D850): a 12-bit file's
//!   darkest samples sit just above a quarter of it (252 on the Z 6). The
//!   values are equal on every sample, so their order is unverified. The
//!   older bodies (D200, D3) have no such tag and subtract the black level
//!   themselves: their darkest samples reach 0, and black is 0.
//! - **White level**: the top of the stored range, `2^bits − 1`, where
//!   clipped highlights pile up on every sample that has them (D3, D850,
//!   Z 6, 12- and 14-bit); for a lossy compressed file, the curve's top.
//! - **As-shot white balance**: tag 0x000C, four rationals: the red and
//!   blue multipliers, then two for green (1 on every body but the P950's
//!   NRW). It is stored in the clear; Nikon's fuller colour block (0x0097)
//!   is enciphered on these bodies and is not read.
//! - **Crop**: tag 0x0045 (left, top, width, height), which is the size of
//!   the camera's full-size JPEG on every sample that has it. Without it
//!   (D200, D3, whose mosaics carry a few columns of no picture at each
//!   side), the size of the largest whole-picture JPEG in the file,
//!   centred; without that, the whole mosaic.
//! - **Orientation**: IFD0's `Orientation`.
//! - **Image size**: tag 0x003E is 1 on every full-size sample and 3 on
//!   the one Medium raw, whose mosaic is smaller than the sensor's; any
//!   value but 1 is refused as a Medium or Small raw.
//!
//! ## Colour
//!
//! A NEF carries no colour matrix. A body with a matrix in
//! `camera_colour::nikon` takes it (one matrix, gains for its white
//! balance, no Kelvin); any other is developed with its white balance
//! alone and says that its colour is approximate ([`NefColour::note`]).
//!
//! ## The two decodes
//!
//! As for an ARW (`arw`), on the DNG decode's own steps: [`linear`] makes
//! the prepared plane with `dng::linear::fill_plane` and renders it with
//! the DNG renders; [`read_nef`], the baked decode, demosaics that plane
//! bilinearly and finishes it with the DNG baked decode's steps, its
//! exposure matched to the camera's preview ([`exposure`]) when the file
//! has one.
//!
//! Nikon's lens corrections, Picture Controls and Active D-Lighting are
//! not applied.
//!
//! Written from the published TIFF and Exif specifications and from what
//! the real files show; no code or table of another raw decoder was read
//! or used.

pub mod compressed;
pub mod exposure;
pub mod linear;
pub mod makernote;
pub mod unpack;

use crate::dng::tiff::{IfdEntry, TagId, TiffReader};
use crate::dng::DngImage;
use serde::{Deserialize, Serialize};

const TAG_DNG_VERSION: u16 = 0xC612;
const TAG_EXIF_IFD: u16 = 0x8769;
const TAG_MAKER_NOTE: u16 = 0x927C;
const TAG_NIKON_WB_LEVELS: u16 = 0x000C;
const TAG_NIKON_BLACK_LEVEL: u16 = 0x003D;
const TAG_NIKON_IMAGE_SIZE: u16 = 0x003E;
const TAG_NIKON_CROP: u16 = 0x0045;
const TAG_NIKON_COMPRESSION_DATA: u16 = 0x0096;
/// Nikon's own `Compression` value in the raw IFD.
const COMPRESSION_NIKON: u16 = 34713;
/// The most SubIFDs read: a NEF has up to six.
const MAX_SUB_IFDS: usize = 16;
/// The black level tag's units.
const BLACK_LEVEL_BITS: u32 = 14;
/// How many columns or rows a mosaic without a crop tag may be larger than
/// its camera's full-size JPEG on each side (16 and 12 on the samples).
const MAX_PREVIEW_MARGIN: u32 = 64;

/// Where a NEF's colour came from: both are fixed matrices; the first is
/// an approximation a person should be told of.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NefColour {
    /// No matrix for the body: the as-shot white balance only.
    WhiteBalanceOnly,
    /// The body's matrix from the engine's table (`camera_colour::nikon`).
    CameraTable,
}

impl NefColour {
    /// Whether the matrix is a calibrated one (see `arw::ArwColour`).
    pub fn is_calibrated(self) -> bool {
        self == NefColour::CameraTable
    }

    /// What a person should be told about the colour, when anything.
    pub fn note(self) -> Option<&'static str> {
        match self {
            NefColour::WhiteBalanceOnly => Some(
                "Colour is approximate: there is no colour matrix for this Nikon camera yet, so only its white balance is applied and colours look washed out.",
            ),
            NefColour::CameraTable => None,
        }
    }
}

/// How the mosaic is stored (see the module docs).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NefLayout {
    /// One 16-bit word a pixel; `big_endian` as the file.
    Words { big_endian: bool },
    /// `bits` a pixel packed into rows of `row_bytes`, high bit first
    /// (`msb_first`) or low bit first.
    Packed { bits: u8, row_bytes: u32, msb_first: bool },
    /// Nikon's compression (`compressed`): lossless, or lossy through the
    /// file's curve.
    Compressed { lossless: bool },
}

/// The crop Nikon intends, in the stored mosaic.
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
pub struct NefSources {
    pub black: String,
    pub crop: String,
    pub matrix: String,
}

/// What a NEF's tags say, without its pixels.
pub struct NefInfo {
    pub ifd0: Vec<IfdEntry>,
    pub raw_ifd: Vec<IfdEntry>,
    /// The stored mosaic's size.
    pub width: u32,
    pub height: u32,
    pub bits: u16,
    pub layout: NefLayout,
    /// The 2×2 pattern from the stored mosaic's top-left (0 R, 1 G, 2 B).
    pub cfa: [u8; 4],
    /// The black level of each position of the stored 2×2 pattern, in the
    /// stored units.
    pub black: [f64; 4],
    pub white: u32,
    /// The as-shot white balance as channel gains, green 1.
    pub as_shot_gain: [f32; 3],
    pub crop: Crop,
    pub orientation: u16,
    /// White-balanced camera RGB → linear sRGB.
    pub cam_to_rgb: [f32; 9],
    pub colour: NefColour,
    /// `Make Model`.
    pub camera_model: String,
    pub sources: NefSources,
    pub debug_log: Vec<String>,
    /// What the maker note says of a compressed mosaic.
    pub compressed: Option<compressed::NefCompression>,
}

impl NefInfo {
    /// The decoded picture's size: the crop, after orientation.
    pub fn oriented_size(&self) -> (u32, u32) {
        match self.orientation {
            5..=8 => (self.crop.height, self.crop.width),
            _ => (self.crop.width, self.crop.height),
        }
    }
}

fn ascii(entries: &[IfdEntry], tag: u16) -> String {
    entries
        .iter()
        .find(|e| e.tag == tag)
        .map(|e| String::from_utf8_lossy(&e.raw_bytes).trim_end_matches('\0').trim().to_string())
        .unwrap_or_default()
}

fn u32s(entries: &[IfdEntry], tag: u16) -> Option<Vec<u32>> {
    entries.iter().find(|e| e.tag == tag).and_then(|e| e.as_u32_vec())
}

fn u32_of(entries: &[IfdEntry], tag: u16) -> Option<u32> {
    entries.iter().find(|e| e.tag == tag).and_then(|e| e.as_u32())
}

/// Whether `data` looks like a Nikon raw: a TIFF whose IFD0 names Nikon
/// as its `Make` and has no `DNGVersion`. Reads IFD0 only. A `true` here
/// does not mean the decoder supports the file: [`read_info`] says why
/// when it does not.
pub fn is_nikon_raw(data: &[u8]) -> bool {
    let Ok(reader) = TiffReader::new(data) else { return false };
    let Ok(ifd0) = reader.read_ifd(0) else { return false };
    ascii(&ifd0, TagId::Make as u16).to_ascii_uppercase().starts_with("NIKON") && !ifd0.iter().any(|e| e.tag == TAG_DNG_VERSION)
}

/// The SubIFDs of IFD0 that parse, at most [`MAX_SUB_IFDS`].
fn sub_ifds(reader: &TiffReader, ifd0: &[IfdEntry]) -> Vec<Vec<IfdEntry>> {
    u32s(ifd0, TagId::SubIFDs as u16).unwrap_or_default().iter().take(MAX_SUB_IFDS).filter_map(|&o| reader.read_ifd_at(o).ok()).collect()
}

/// A 2×2 colour filter of one red (0), one blue (2) and two greens (1) on
/// a diagonal, as every Bayer sensor has; `None` for any other, such as
/// red, green / blue, green, which holds all three colours but puts its
/// greens side by side.
fn bayer_pattern(p: &[u8]) -> Option<[u8; 4]> {
    let p: [u8; 4] = p.try_into().ok()?;
    let count = |c: u8| p.iter().filter(|&&v| v == c).count();
    let greens_on_a_diagonal = (p[0] == 1 && p[3] == 1) || (p[1] == 1 && p[2] == 1);
    (count(0) == 1 && count(2) == 1 && count(1) == 2 && greens_on_a_diagonal).then_some(p)
}

/// The strips of the raw IFD, each inside the file, in increasing order
/// and not overlapping: the summed length the layout is decided from is
/// then never more than the file holds.
fn strips<'a>(data: &'a [u8], raw_ifd: &[IfdEntry]) -> Result<Vec<&'a [u8]>, String> {
    let offsets = u32s(raw_ifd, TagId::StripOffsets as u16).unwrap_or_default();
    let counts = u32s(raw_ifd, TagId::StripByteCounts as u16).unwrap_or_default();
    if offsets.is_empty() || offsets.len() != counts.len() {
        return Err("This Nikon RAW's strip table is damaged".into());
    }
    let mut next = 0usize;
    let mut out = Vec::with_capacity(offsets.len());
    for (&o, &c) in offsets.iter().zip(&counts) {
        let o = o as usize;
        let end = o
            .checked_add(c as usize)
            .filter(|&end| end <= data.len())
            .ok_or("This Nikon RAW is cut short: its sensor data runs past the end of the file")?;
        if o < next {
            return Err("This Nikon RAW's strip table is damaged: its strips overlap or are out of order".into());
        }
        next = end;
        out.push(&data[o..end]);
    }
    Ok(out)
}

/// The layout of an uncompressed mosaic of `total` bytes, from its size
/// and the file's byte order and `Compression`, or `None` for one not in
/// the module docs' list.
pub fn layout_for(total: u64, width: u32, height: u32, bits: u16, big_endian: bool, compression: u16) -> Option<NefLayout> {
    let (w, h) = (u64::from(width), u64::from(height));
    if !matches!(bits, 12 | 14) || w == 0 || h == 0 {
        return None;
    }
    if total == w * h * 2 && compression == 1 && bits == 14 {
        // Words: the D3 (big-endian) and the D850 (little-endian), both
        // `Compression` 1 at 14 bits.
        return Some(NefLayout::Words { big_endian });
    }
    if !total.is_multiple_of(h) {
        return None;
    }
    let row_bytes = total / h;
    let packed = (w * u64::from(bits)).div_ceil(8);
    let padded = packed.div_ceil(16) * 16;
    if row_bytes != packed && row_bytes != padded {
        return None;
    }
    let row_bytes = u32::try_from(row_bytes).ok()?;
    match (big_endian, compression, bits) {
        (true, 1, 12) => Some(NefLayout::Packed { bits: 12, row_bytes, msb_first: true }),
        (false, COMPRESSION_NIKON, 12 | 14) => Some(NefLayout::Packed { bits: bits as u8, row_bytes, msb_first: false }),
        _ => None,
    }
}

/// The size of the largest whole-picture JPEG preview in the file (IFD0's
/// chain and the SubIFDs), read from its header only.
fn largest_preview_size(data: &[u8]) -> Option<(u32, u32)> {
    exposure::jpeg_ranges(data)
        .into_iter()
        .filter_map(|(o, n)| {
            let mut dec = jpeg_decoder::Decoder::new(&data[o..o + n]);
            dec.read_info().ok()?;
            let info = dec.info()?;
            Some((u32::from(info.width), u32::from(info.height)))
        })
        .max_by_key(|&(w, h)| u64::from(w) * u64::from(h))
}

/// Read a Nikon raw's tags (and its maker note) without decoding pixels.
/// Every variant the decoder does not support is refused here, with a
/// sentence a person can read.
pub fn read_info(data: &[u8]) -> Result<NefInfo, String> {
    if !is_nikon_raw(data) {
        return Err("This is not a Nikon RAW file".into());
    }
    let reader = TiffReader::new(data)?;
    let big_endian = !reader.is_little_endian();
    let ifd0 = reader.read_ifd(0)?;
    let mut debug_log = Vec::new();
    let model = ascii(&ifd0, TagId::Model as u16);
    if model.to_ascii_uppercase().starts_with("COOLPIX") {
        return Err("This RAW file is from a Nikon COOLPIX compact (NRW), which is not supported".into());
    }

    let subs = sub_ifds(&reader, &ifd0);
    let photometric = |ifd: &[IfdEntry]| u32_of(ifd, TagId::PhotometricInterpretation as u16);
    let Some(raw_ifd) = subs.iter().find(|ifd| photometric(ifd) == Some(32803) && u32_of(ifd, TagId::NewSubFileType as u16).unwrap_or(0) == 0).cloned() else {
        return Err("This Nikon RAW has no sensor data this decoder can find, which is not supported".into());
    };

    let exif = u32_of(&ifd0, TAG_EXIF_IFD).and_then(|o| reader.read_ifd_at(o).ok()).unwrap_or_default();
    let maker = exif
        .iter()
        .find(|e| e.tag == TAG_MAKER_NOTE)
        .and_then(|e| makernote::read(&e.raw_bytes))
        .ok_or("This Nikon RAW has no maker note this app can read, which is not supported")?;

    if let Some(size) = makernote::u16s(&maker, TAG_NIKON_IMAGE_SIZE).and_then(|v| v.first().copied()) {
        if size != 1 {
            return Err("This Nikon RAW is a Medium or Small RAW, which is not supported: only full-size (Large) RAW files open".into());
        }
    }

    let width = u32_of(&raw_ifd, TagId::ImageWidth as u16).ok_or("This Nikon RAW's sensor data has no width")?;
    let height = u32_of(&raw_ifd, TagId::ImageLength as u16).ok_or("This Nikon RAW's sensor data has no height")?;
    let bits = u32_of(&raw_ifd, TagId::BitsPerSample as u16).unwrap_or(0) as u16;
    let compression = u32_of(&raw_ifd, TagId::Compression as u16).unwrap_or(1) as u16;
    crate::decode::check_image_size(width, height, 6)?;

    let parts = strips(data, &raw_ifd)?;
    if parts[0].starts_with(&[0xFF, 0x10]) {
        return Err("This Nikon RAW is a High Efficiency RAW, which uses a licensed third-party codec and is not supported".into());
    }
    // Nikon's compressed data when the maker note describes it
    // (`compressed`), else one of the uncompressed layouts.
    let compressed = match maker.iter().find(|e| e.tag == TAG_NIKON_COMPRESSION_DATA) {
        Some(e) => {
            let little_endian = exif.iter().find(|n| n.tag == TAG_MAKER_NOTE).is_some_and(|n| makernote::is_little_endian(&n.raw_bytes));
            Some(compressed::NefCompression::read(&e.raw_bytes, little_endian, bits)?)
        }
        None => None,
    };
    let total: u64 = parts.iter().map(|p| p.len() as u64).sum();
    let layout = match &compressed {
        Some(c) => NefLayout::Compressed { lossless: c.lossless },
        None => layout_for(total, width, height, bits, big_endian, compression).ok_or_else(|| {
            format!("This Nikon RAW stores its {bits}-bit sensor data in a way that is not supported yet (compression {compression}, {total} bytes for {width}×{height})")
        })?,
    };

    let cfa = {
        let dim = u32s(&raw_ifd, TagId::CfaRepeatPatternDim as u16);
        let pattern = raw_ifd.iter().find(|e| e.tag == TagId::CfaPattern as u16).map(|e| e.raw_bytes.clone());
        match (dim.as_deref(), pattern) {
            (None | Some([2, 2]), Some(p)) if bayer_pattern(&p).is_some() => [p[0], p[1], p[2], p[3]],
            _ => return Err("This Nikon RAW's colour filter is not a 2×2 red, green and blue pattern, which is not supported".into()),
        }
    };

    let white = compressed.as_ref().map_or((1u32 << bits) - 1, |c| c.white);
    let mut sources = NefSources::default();
    let black: [f64; 4] = match makernote::u16s(&maker, TAG_NIKON_BLACK_LEVEL).as_deref() {
        Some([a, b, c, d]) => {
            sources.black = "maker note 0x003D".into();
            let scale = f64::from(1u32 << (BLACK_LEVEL_BITS - u32::from(bits).min(BLACK_LEVEL_BITS)));
            [*a, *b, *c, *d].map(|v| f64::from(v) / scale)
        }
        Some(other) => return Err(format!("This Nikon RAW's black level has {} values", other.len())),
        None => {
            sources.black = "none (0)".into();
            [0.0; 4]
        }
    };
    if black.iter().any(|&b| !(0.0..f64::from(white)).contains(&b)) {
        return Err(format!("This Nikon RAW's black level {black:?} is not below its white level {white}"));
    }

    let levels = maker.iter().find(|e| e.tag == TAG_NIKON_WB_LEVELS).map(|e| e.as_rational_vec()).unwrap_or_default();
    let as_shot_gain = match levels.as_slice() {
        [r, b, g1, g2, ..] if [*r, *b, *g1, *g2].iter().all(|v| v.is_finite() && *v > 0.0) => {
            let g = (g1 + g2) / 2.0;
            [(r / g) as f32, 1.0, (b / g) as f32]
        }
        _ => return Err("This Nikon RAW does not record its white balance in a form this app reads, which is not supported".into()),
    };
    if as_shot_gain.iter().any(|g| !(0.05..=20.0).contains(g)) {
        return Err(format!("This Nikon RAW's white balance {as_shot_gain:?} is not one a camera records"));
    }

    let (crop, crop_source) = match makernote::u16s(&maker, TAG_NIKON_CROP).as_deref() {
        Some([l, t, w, h]) => (Crop { left: u32::from(*l), top: u32::from(*t), width: u32::from(*w), height: u32::from(*h) }, "maker note 0x0045".to_string()),
        _ => match largest_preview_size(data).filter(|&(pw, ph)| pw <= width && ph <= height && width - pw <= 2 * MAX_PREVIEW_MARGIN && height - ph <= 2 * MAX_PREVIEW_MARGIN) {
            Some((pw, ph)) => (Crop { left: (width - pw) / 2, top: (height - ph) / 2, width: pw, height: ph }, format!("the {pw}×{ph} preview, centred")),
            None => (Crop { left: 0, top: 0, width, height }, "none (the whole mosaic)".to_string()),
        },
    };
    sources.crop = crop_source;
    let fits = |o: u32, s: u32, total: u32| s > 0 && o.checked_add(s).is_some_and(|end| end <= total);
    if !(fits(crop.left, crop.width, width) && fits(crop.top, crop.height, height)) {
        return Err(format!("This Nikon RAW's crop {crop:?} is outside its {width}×{height} sensor data"));
    }

    let orientation = u32_of(&ifd0, TagId::Orientation as u16).map(|o| o as u16).filter(|o| (1..=8).contains(o)).unwrap_or(1);
    let (cam_to_rgb, colour) = match crate::camera_colour::nikon(&model) {
        Some(m) => {
            sources.matrix = format!("the engine's table ({model})");
            (m, NefColour::CameraTable)
        }
        None => {
            sources.matrix = "none".into();
            ([1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0], NefColour::WhiteBalanceOnly)
        }
    };
    let camera_model = {
        let make = ascii(&ifd0, TagId::Make as u16);
        let make = make.split_whitespace().next().unwrap_or("NIKON").to_string();
        // Nikon's models already start with "NIKON".
        if model.to_ascii_uppercase().starts_with(&make.to_ascii_uppercase()) { model.clone() } else { format!("{make} {model}").trim().to_string() }
    };
    debug_log.push(format!(
        "[NEF] {camera_model}: {layout:?} {bits}-bit {width}×{height}, crop {crop:?}, black {black:?}, white {white}, as-shot gain {as_shot_gain:?}, colour {colour:?}, orientation {orientation}, from {sources:?}"
    ));
    Ok(NefInfo {
        ifd0,
        raw_ifd,
        width,
        height,
        bits,
        layout,
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
        debug_log,
        compressed,
    })
}

/// Decode the stored mosaic of a file [`read_info`] accepted:
/// `width × height` values.
pub fn read_mosaic(data: &[u8], info: &NefInfo) -> Result<Vec<u16>, String> {
    let parts = strips(data, &info.raw_ifd)?;
    let mut buf = Vec::new();
    let bytes: &[u8] = if parts.len() == 1 {
        parts[0]
    } else {
        let total = parts.iter().map(|p| p.len()).sum();
        buf.try_reserve_exact(total).map_err(|_| "not enough memory for the Nikon RAW's data".to_string())?;
        for p in parts {
            buf.extend_from_slice(p);
        }
        &buf
    };
    match &info.compressed {
        Some(c) => compressed::decode(bytes, info.width as usize, info.height as usize, info.bits, c),
        None => unpack::unpack(bytes, info.width as usize, info.height as usize, info.layout),
    }
}

/// [`read_nef`]'s result: the baked image, and where its colour came from.
pub struct NefImage {
    /// sRGB f32 RGBA in 0..1, upright and cropped, as `read_dng` gives.
    pub image: DngImage,
    pub colour: NefColour,
    pub camera_model: String,
    /// The exposure applied to match the camera's preview, in stops (0
    /// when the file has no usable preview).
    pub exposure_ev: f32,
}

/// The baked decode: a Nikon raw to sRGB f32 RGBA, upright and cropped,
/// through the DNG baked decode's steps, as `arw::read_arw` does: matched
/// to the camera's preview when there is one, else with auto-levels.
pub fn read_nef(data: &[u8]) -> Result<NefImage, String> {
    let prep = linear::prepare_nef(data)?;
    let (ow, oh) = prep.params.oriented_size();
    let preview = exposure::whole_picture_preview(data, ow, oh);
    let linear::NefPrepared { params, mut plane, mut debug_log } = prep;
    for v in plane.iter_mut() {
        *v = v.max(0.0);
    }
    let mut rgb = crate::dng::demosaic::try_bilinear(&plane, params.width, params.height, &params.cfa).ok_or("not enough memory for the Nikon RAW's pixels")?;
    drop(plane);
    // A clipped channel carries its white-balance gain; with a calibrated
    // matrix (or with the preview's roll-off) every channel is clipped at
    // the lowest clip level first, so clipped highlights stay white.
    if params.colour.is_calibrated() || preview.is_some() {
        let clip = params.as_shot_gain.iter().copied().fold(1.0f32, f32::min);
        for v in rgb.iter_mut() {
            *v = v.min(clip);
        }
    }
    let ci = crate::dng::centre_index(params.width, params.height);
    crate::dng::bake_colour(&mut rgb, None, Some(&params.cam_to_rgb), None, &mut debug_log, ci);
    let curve = crate::raf::base_curves::curve_lut(&crate::raf::base_curves::NEUTRAL);
    let mut ev = 0.0;
    if let Some(preview) = &preview {
        use crate::arw::exposure as ax;
        let (sw, sh, small) = ax::downscale(&rgb, params.width as usize, params.height as usize, (preview.width * preview.height) as usize);
        ev = ax::match_exposure(&small, preview.median, &curve);
        let gain = ev.exp2();
        let roll = ax::rolloff_for(gain, ax::median_luminance(&small));
        drop(small);
        for px in rgb.chunks_exact_mut(3) {
            let c = ax::render_pixel([px[0], px[1], px[2]], gain, roll);
            px.copy_from_slice(&c);
        }
        debug_log.push(format!(
            "[NEF] exposure {ev:+.3} EV to the camera's {}×{} preview (median {:.3}, matched on {sw}×{sh}), roll-off (knee, peak) {roll:?}",
            preview.width, preview.height, preview.median
        ));
    }
    let last = (curve.len() - 1) as f64;
    let tone_curve: Vec<(f64, f64)> = curve.iter().enumerate().map(|(i, &y)| (i as f64 / last, f64::from(y))).collect();
    let (width, height, pixels) = crate::dng::bake_finish(rgb, params.width, params.height, &tone_curve, params.orientation, preview.is_none(), &mut debug_log)?;
    Ok(NefImage {
        image: DngImage { width, height, pixels, baseline_exposure: 0.0, tone_curve: Vec::new(), debug_log },
        colour: params.colour,
        camera_model: params.camera_model,
        exposure_ev: ev,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layouts_are_told_apart_by_size_byte_order_and_compression() {
        // 16-bit words, either byte order, 14-bit only.
        assert_eq!(layout_for(8 * 4 * 2, 8, 4, 14, true, 1), Some(NefLayout::Words { big_endian: true }));
        assert_eq!(layout_for(8 * 4 * 2, 8, 4, 14, false, 1), Some(NefLayout::Words { big_endian: false }));
        assert_eq!(layout_for(8 * 4 * 2, 8, 4, 12, false, 1), None);
        // 12-bit packed high bit first in a big-endian file, each row on a byte.
        assert_eq!(layout_for(12 * 4, 8, 4, 12, true, 1), Some(NefLayout::Packed { bits: 12, row_bytes: 12, msb_first: true }));
        // Low bit first, rows padded to 16 bytes, Nikon's compression value.
        assert_eq!(layout_for(16 * 4, 8, 4, 12, false, 34713), Some(NefLayout::Packed { bits: 12, row_bytes: 16, msb_first: false }));
        assert_eq!(layout_for(16 * 4, 8, 4, 14, false, 34713), Some(NefLayout::Packed { bits: 14, row_bytes: 16, msb_first: false }));
        // Combinations no sample has, and sizes that fit nothing.
        assert_eq!(layout_for(12 * 4, 8, 4, 12, false, 1), None);
        assert_eq!(layout_for(14 * 4, 8, 4, 14, true, 1), None);
        assert_eq!(layout_for(13 * 4, 8, 4, 12, false, 34713), None);
        assert_eq!(layout_for(12 * 4 + 1, 8, 4, 12, true, 1), None);
        assert_eq!(layout_for(100, 8, 4, 10, false, 34713), None);
        assert_eq!(layout_for(0, 0, 0, 12, false, 34713), None);
    }

    #[test]
    fn bytes_that_are_not_a_nikon_raw_are_refused() {
        assert!(!is_nikon_raw(b"not a raw"));
        assert!(!is_nikon_raw(&[]));
        assert!(read_info(b"II*\0\x08\0\0\0").is_err());
        assert!(read_nef(&[0u8; 64]).is_err());
    }

    /// A hand-built little TIFF (obviously not a camera file): IFD0 with a
    /// Nikon `Make`, SubIFDs pointing at itself and nowhere, an Exif
    /// pointer past the end. Every step refuses rather than panics.
    #[test]
    fn a_hostile_tiff_with_a_nikon_make_is_refused() {
        let mut d = b"II*\0\x08\0\0\0".to_vec();
        let entries: [(u16, u16, u32, u32); 4] = [(0x010F, 2, 6, 220), (0x014A, 4, 2, 200), (0x8769, 4, 1, 0xFFFF_FF00), (0x0110, 2, 4, 0)];
        d.extend_from_slice(&(entries.len() as u16).to_le_bytes());
        for (tag, typ, count, value) in entries {
            d.extend_from_slice(&tag.to_le_bytes());
            d.extend_from_slice(&typ.to_le_bytes());
            d.extend_from_slice(&count.to_le_bytes());
            d.extend_from_slice(&value.to_le_bytes());
        }
        d.extend_from_slice(&0u32.to_le_bytes());
        d.resize(240, 0);
        d[220..226].copy_from_slice(b"NIKON\0");
        // The SubIFD offsets: 8 (IFD0 itself) and past the end.
        d[200..204].copy_from_slice(&8u32.to_le_bytes());
        d[204..208].copy_from_slice(&0xFFFF_FFF0u32.to_le_bytes());
        assert!(is_nikon_raw(&d));
        let e = read_info(&d).err().expect("refused");
        assert!(e.contains("Nikon RAW"), "{e}");
        assert!(read_nef(&d).is_err());
        for cut in 0..d.len() {
            let _ = read_info(&d[..cut]);
        }
    }
    fn strip_table(offsets: &[u32], counts: &[u32]) -> Vec<IfdEntry> {
        let longs = |v: &[u32]| v.iter().flat_map(|x| x.to_ne_bytes()).collect::<Vec<u8>>();
        vec![
            IfdEntry { tag: TagId::StripOffsets as u16, typ: 4, count: offsets.len() as u32, raw_bytes: longs(offsets) },
            IfdEntry { tag: TagId::StripByteCounts as u16, typ: 4, count: counts.len() as u32, raw_bytes: longs(counts) },
        ]
    }

    /// 64 strips all at the same 512 KB of a 0.5 MB file would sum to
    /// 32 MB, enough for a 4096 × 4096 mosaic of 16-bit words.
    #[test]
    fn strips_that_overlap_or_go_back_are_refused() {
        let data = vec![0u8; 512 * 1024 + 16];
        let same = strip_table(&[16; 64], &[512 * 1024; 64]);
        let e = strips(&data, &same).err().expect("refused");
        assert!(e.contains("overlap"), "{e}");
        let backwards = strip_table(&[1000, 16], &[100, 100]);
        assert!(strips(&data, &backwards).is_err());
        // Strips that follow each other, touching or not, are read.
        let ok = strip_table(&[16, 116, 400], &[100, 200, 50]);
        let parts = strips(&data, &ok).unwrap();
        assert_eq!(parts.iter().map(|p| p.len()).collect::<Vec<_>>(), vec![100, 200, 50]);
    }

    #[test]
    fn only_a_bayer_pattern_is_a_colour_filter() {
        for p in [[0, 1, 1, 2], [2, 1, 1, 0], [1, 0, 2, 1], [1, 2, 0, 1]] {
            assert_eq!(bayer_pattern(&p), Some(p));
        }
        // All three colours, greens side by side or one each.
        for p in [[0, 1, 2, 1], [1, 1, 0, 2], [0, 1, 2, 2], [0, 0, 1, 2], [1, 1, 1, 1]] {
            assert_eq!(bayer_pattern(&p), None, "{p:?}");
        }
        assert_eq!(bayer_pattern(&[0, 1, 1]), None);
        assert_eq!(bayer_pattern(&[0, 1, 1, 3]), None);
    }
}
