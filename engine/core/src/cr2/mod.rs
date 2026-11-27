//! Canon CR2 raw image decoder.
//!
//! A CR2 is a little-endian TIFF with "CR" and the major version 2 after
//! its header (bytes 8 to 10) and, in bytes 12 to 16, the offset of the
//! raw IFD. IFD0 holds the camera's full-size JPEG preview (as a strip),
//! `Make`, `Model`, `Orientation` and the Exif IFD, whose `MakerNote` is
//! Canon's: an IFD whose value offsets count from the start of the file.
//! The raw IFD holds the sensor data as one strip, a lossless JPEG
//! ([`lossless`]), and Canon's tags for how it is laid out.
//!
//! ## What decodes, and on which files it was checked
//!
//! Full-size RAW of a 2×2 red, green and blue mosaic, 12-bit (EOS 20D,
//! PowerShot G16) and 14-bit (EOS 40D, 7D, 5D Mark III, 5D Mark IV): one
//! slice or several, frames of two or four components, a frame row
//! holding one sensor row or two. Each was checked on a real file from
//! raw.pixls.us (CC0) against the camera's own JPEG embedded in the file:
//! the size, crop and orientation line up (best alignment at no shift),
//! there is no cast on neutral surfaces, tone ranks the same, and slice
//! edges are no rougher than their insides. `tests/cr2_decode.rs`
//! measures and prints all of it.
//!
//! A dual-pixel RAW (a second raw IFD after the first, the 5D Mark IV)
//! decodes from its first frame, which is the whole picture (twice the
//! second's signal on the sample); the second frame is not read.
//!
//! Refused, each with a sentence a person can read: reduced-size sRAW and
//! mRAW (Canon's 3-component frames, checked on a 40D sRAW and a 5D Mark
//! III mRAW), a raw kind other than full size, sample depths other than
//! 12 and 14 bits, big-endian files, and a file without the sensor
//! geometry (maker-note tag 0x00E0) or a masked border to measure black
//! on.
//!
//! ## Calibration, from the file
//!
//! - **Geometry**: maker-note tag 0x00E0 gives the sensor's width and
//!   height (index 1 and 2) and the picture's crop as its left, top, right
//!   and bottom columns and rows, inclusive (index 5 to 8). On every
//!   sample that crop is the size of the camera's JPEG and lines up with
//!   it at no shift.
//! - **Black and white levels, and the colour filter's layout**: measured
//!   from the sensor data ([`levels`]).
//! - **As-shot white balance**: Canon's colour data, maker-note tag
//!   0x4001 ([`colour_data`]), as channel gains (green 1).
//! - **Orientation**: IFD0's `Orientation`.
//!
//! ## Colour
//!
//! A CR2 carries no colour matrix. A body with a matrix in
//! `camera_colour` takes it (one matrix, with gains for its white balance
//! and no Kelvin); any other gets its white balance only, and says its
//! colour is approximate ([`Cr2Colour`]).
//!
//! ## The two decodes, on the DNG pipeline
//!
//! As a Sony ARW: [`linear::prepare_cr2`] makes the prepared plane with
//! `dng::linear::fill_plane` and renders it with the DNG renders, and
//! [`read_cr2`], the baked decode, demosaics that plane bilinearly and
//! finishes it with the DNG baked decode's steps, its exposure matched to
//! the camera's preview (`arw::exposure`) when the file has a usable one.
//!
//! Written from the published descriptions of TIFF, Exif and lossless JPEG
//! and from what the real files show; no code of another raw decoder was
//! read or used.

pub mod colour_data;
pub mod levels;
pub mod linear;
pub mod lossless;

use crate::dng::tiff::{IfdEntry, TagId, TiffReader};
use crate::dng::{get_tag_u16, get_tag_u32, DngImage};
use serde::{Deserialize, Serialize};

/// Exif IFD pointer (in IFD0) and the maker note inside it.
const TAG_EXIF_IFD: u16 = 0x8769;
const TAG_MAKER_NOTE: u16 = 0x927C;
/// Canon's maker-note tags this decoder reads.
const TAG_CANON_SENSOR_INFO: u16 = 0x00E0;
const TAG_CANON_COLOR_DATA: u16 = 0x4001;
/// The raw IFD's slice layout: count, width, width of the last slice.
const TAG_CR2_SLICES: u16 = 0xC640;
/// The raw IFD's kind of raw: 1 for a full-size mosaic, 4 for sRAW and
/// mRAW on the samples.
const TAG_CR2_RAW_KIND: u16 = 0xC6C5;

/// The sentence for Canon's reduced-size raws.
pub const SRAW_REFUSAL: &str = "This Canon RAW is a reduced-size sRAW or mRAW, which is not supported";

/// Whether `data` is a Canon CR2: a little-endian TIFF whose header is
/// followed by "CR" and major version 2 (bytes 8 to 10). Reads 16 bytes.
pub fn is_canon_cr2(data: &[u8]) -> bool {
    data.len() >= 16 && data.starts_with(b"II*\0") && &data[8..10] == b"CR" && data[10] == 2
}

pub(crate) fn ascii(entries: &[IfdEntry], tag: u16) -> String {
    entries
        .iter()
        .find(|e| e.tag == tag)
        .map(|e| String::from_utf8_lossy(&e.raw_bytes).trim_end_matches('\0').trim().to_string())
        .unwrap_or_default()
}

/// A tag's values as unsigned 16-bit numbers: SHORT, or UNDEFINED bytes
/// read as little-endian pairs (the G16 stores its colour data that way).
pub fn shorts(entries: &[IfdEntry], tag: u16) -> Option<Vec<u16>> {
    let e = entries.iter().find(|e| e.tag == tag)?;
    match e.typ {
        3 | 8 | 7 => Some(e.raw_bytes.chunks_exact(2).map(|b| u16::from_le_bytes([b[0], b[1]])).collect()),
        _ => None,
    }
}

/// `Make Model`, without the make twice (Canon's `Model` starts with it).
pub(crate) fn camera_model(ifd0: &[IfdEntry]) -> String {
    let (make, model) = (ascii(ifd0, TagId::Make as u16), ascii(ifd0, TagId::Model as u16));
    if model.to_lowercase().starts_with(&make.to_lowercase()) {
        model
    } else {
        format!("{make} {model}").trim().to_string()
    }
}

/// The file offset of a tag's value in the little-endian IFD at
/// `ifd_offset` (the value itself when it fits in four bytes is not an
/// offset; only tags whose values are longer are looked up here).
fn value_offset(data: &[u8], ifd_offset: u32, tag: u16) -> Option<u32> {
    let at = |o: usize, n: usize| data.get(o..o + n);
    let pos = ifd_offset as usize;
    let count = u16::from_le_bytes(at(pos, 2)?.try_into().ok()?) as usize;
    (0..count).find_map(|i| {
        let e = at(pos + 2 + i * 12, 12)?;
        (u16::from_le_bytes([e[0], e[1]]) == tag).then(|| u32::from_le_bytes([e[8], e[9], e[10], e[11]]))
    })
}

/// Canon's maker note: IFD0 → Exif IFD → `MakerNote`, an IFD at the
/// value's offset.
pub fn maker_note(data: &[u8], reader: &TiffReader, ifd0: &[IfdEntry]) -> Result<Vec<IfdEntry>, String> {
    let exif = ifd0.iter().find(|e| e.tag == TAG_EXIF_IFD).and_then(|e| e.as_u32()).ok_or("This Canon RAW has no Exif data")?;
    let offset = value_offset(data, exif, TAG_MAKER_NOTE).ok_or("This Canon RAW has no maker note")?;
    reader.read_ifd_at(offset).map_err(|e| format!("This Canon RAW's maker note is damaged ({e})"))
}

/// The lossless JPEG frame header of the raw data (`SOF3`): what the
/// stream holds before any of it is decoded.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FrameHeader {
    pub precision: u8,
    pub width: u16,
    pub height: u16,
    /// (horizontal, vertical) sampling factors of each component.
    pub sampling: Vec<(u8, u8)>,
}

/// Find the `SOF3` header in a JPEG stream, walking its marker segments.
/// `None` when the stream has none before its scan.
pub fn frame_header(stream: &[u8]) -> Option<FrameHeader> {
    let mut p = 0usize;
    while p + 4 <= stream.len() {
        if stream[p] != 0xFF {
            p += 1;
            continue;
        }
        let marker = stream[p + 1];
        if matches!(marker, 0xD8 | 0x00 | 0xFF) || (0xD0..=0xD7).contains(&marker) {
            p += 2;
            continue;
        }
        let len = u16::from_be_bytes([stream[p + 2], stream[p + 3]]) as usize;
        if len < 2 {
            return None;
        }
        let seg = stream.get(p + 4..p + 2 + len)?;
        match marker {
            0xC3 => {
                let n = *seg.get(5)? as usize;
                let comps = seg.get(6..6 + 3 * n)?;
                return Some(FrameHeader {
                    precision: seg[0],
                    height: u16::from_be_bytes([seg[1], seg[2]]),
                    width: u16::from_be_bytes([seg[3], seg[4]]),
                    sampling: comps.chunks_exact(3).map(|c| (c[1] >> 4, c[1] & 15)).collect(),
                });
            }
            0xDA => return None,
            _ => p += 2 + len,
        }
    }
    None
}

/// The picture's crop in the sensor data: left, top, width, height.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Crop {
    pub left: u32,
    pub top: u32,
    pub width: u32,
    pub height: u32,
}

/// Where a CR2's colour came from. [`Cr2Colour::note`] says what a person
/// should be told.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Cr2Colour {
    /// No matrix: the as-shot white balance only.
    WhiteBalanceOnly,
    /// The body's matrix from the engine's table (`camera_colour`): one
    /// matrix, which does not follow the white balance.
    CameraTable,
}

impl Cr2Colour {
    /// Whether the matrix is a calibrated one (clipped channels are then
    /// clipped together in the baked decode, so highlights stay white).
    pub fn is_calibrated(self) -> bool {
        self == Cr2Colour::CameraTable
    }

    /// What a person should be told about the colour, when anything.
    pub fn note(self) -> Option<&'static str> {
        match self {
            Cr2Colour::WhiteBalanceOnly => Some("Colour is approximate: this Canon RAW carries no colour matrix, so only its white balance is applied and colours look washed out."),
            Cr2Colour::CameraTable => None,
        }
    }
}

/// What a CR2's tags say, without its pixels.
pub struct Cr2Info {
    pub ifd0: Vec<IfdEntry>,
    pub raw_ifd: Vec<IfdEntry>,
    pub maker_note: Vec<IfdEntry>,
    /// The raw strip, inside the file: offset and length.
    pub strip: (usize, usize),
    pub frame: FrameHeader,
    /// The sensor data's size.
    pub width: u32,
    pub height: u32,
    /// The widths of the slices the stream fills, left to right.
    pub slices: Vec<u32>,
    /// `precision` of the frame: the samples' bit depth.
    pub bits: u8,
    pub crop: Crop,
    pub orientation: u16,
    /// The as-shot white balance as channel gains, green 1.
    pub as_shot_gain: [f32; 3],
    /// White-balanced camera RGB → linear sRGB.
    pub cam_to_rgb: [f32; 9],
    pub colour: Cr2Colour,
    pub camera_model: String,
    /// Corrections the file records that the decode does not apply.
    pub unhandled: Vec<String>,
    pub debug_log: Vec<String>,
}

impl Cr2Info {
    /// The decoded picture's size: the crop, after orientation.
    pub fn oriented_size(&self) -> (u32, u32) {
        match self.orientation {
            5..=8 => (self.crop.height, self.crop.width),
            _ => (self.crop.width, self.crop.height),
        }
    }
}

/// Read a CR2's tags without decoding pixels. Every variant the decoder
/// does not support is refused here, with a sentence a person can read.
pub fn read_info(data: &[u8]) -> Result<Cr2Info, String> {
    if !is_canon_cr2(data) {
        return Err("This is not a Canon CR2 file".into());
    }
    let reader = TiffReader::new(data)?;
    let ifd0 = reader.read_ifd(0).map_err(|e| format!("This Canon RAW is damaged ({e})"))?;
    let raw_offset = u32::from_le_bytes([data[12], data[13], data[14], data[15]]);
    let raw_ifd = reader.read_ifd_at(raw_offset).map_err(|_| "This Canon RAW has no raw image data this decoder can find".to_string())?;
    let maker_note = maker_note(data, &reader, &ifd0)?;
    let mut debug_log = Vec::new();

    // The strip: one lossless JPEG.
    if get_tag_u16(&raw_ifd, TagId::Compression).ok() != Some(6) {
        return Err("This Canon RAW's sensor data is not stored as this decoder expects, which is not supported".into());
    }
    let offset = get_tag_u32(&raw_ifd, TagId::StripOffsets).map_err(|_| "This Canon RAW has no sensor data")? as usize;
    let length = get_tag_u32(&raw_ifd, TagId::StripByteCounts).map_err(|_| "This Canon RAW has no sensor data")? as usize;
    if offset.checked_add(length).is_none_or(|end| end > data.len()) || length == 0 {
        return Err("This Canon RAW is cut short: its sensor data runs past the end of the file".into());
    }
    let frame = frame_header(&data[offset..offset + length]).ok_or("This Canon RAW's sensor data has no lossless JPEG frame")?;
    let kind = raw_ifd.iter().find(|e| e.tag == TAG_CR2_RAW_KIND).and_then(|e| e.as_u32());
    if kind.is_some_and(|k| k != 1) || frame.sampling.len() == 3 || frame.sampling.iter().any(|&s| s != (1, 1)) {
        return Err(SRAW_REFUSAL.into());
    }
    if !matches!(frame.sampling.len(), 1 | 2 | 4) {
        return Err(format!("This Canon RAW's frame has {} components, which is not supported", frame.sampling.len()));
    }
    let bits = frame.precision;
    if !matches!(bits, 12 | 14) {
        return Err(format!("This Canon RAW stores {bits}-bit data, which is not supported yet"));
    }

    // The sensor's size and the crop.
    let info = shorts(&maker_note, TAG_CANON_SENSOR_INFO).filter(|v| v.len() >= 9).ok_or("This Canon RAW has no sensor size, which is not supported")?;
    let (width, height) = (u32::from(info[1]), u32::from(info[2]));
    let (left, top, right, bottom) = (u32::from(info[5]), u32::from(info[6]), u32::from(info[7]), u32::from(info[8]));
    // The u16 mosaic and the f32 plane made from it.
    crate::decode::check_image_size(width, height, 6)?;
    let samples = u64::from(frame.width) * u64::from(frame.height) * frame.sampling.len() as u64;
    if samples != u64::from(width) * u64::from(height) {
        return Err(format!("This Canon RAW's data ({samples} samples) is not its {width}×{height} sensor"));
    }
    if !(left < right && right < width && top < bottom && bottom < height) {
        return Err(format!("This Canon RAW's crop ({left}, {top}) to ({right}, {bottom}) is outside its {width}×{height} sensor data"));
    }
    let crop = Crop { left, top, width: right - left + 1, height: bottom - top + 1 };
    let slices = lossless::slice_widths(shorts(&raw_ifd, TAG_CR2_SLICES).as_deref(), width)?;

    // The as-shot white balance.
    let cd = shorts(&maker_note, TAG_CANON_COLOR_DATA).ok_or("This Canon RAW has no colour data, so no white balance")?;
    let (wb, searched) = colour_data::as_shot_levels(&cd).ok_or("This Canon RAW's white balance is not where this decoder can find it, which is not supported")?;
    let as_shot_gain = colour_data::gains(wb);
    if searched {
        debug_log.push(format!("[CR2] colour data of {} numbers (first {}) is a layout not seen before: its white balance was searched for", cd.len(), cd[0]));
    }

    let orientation = get_tag_u16(&ifd0, TagId::Orientation).ok().filter(|o| (1..=8).contains(o)).unwrap_or(1);
    let model = ascii(&ifd0, TagId::Model as u16);
    let (cam_to_rgb, colour) = match crate::camera_colour::canon(&model) {
        Some(m) => (m, Cr2Colour::CameraTable),
        None => ([1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0], Cr2Colour::WhiteBalanceOnly),
    };
    let camera_model = camera_model(&ifd0);
    // A dual-pixel RAW: a second raw frame after the first.
    if reader.read_ifd(4).is_ok_and(|ifd| get_tag_u16(&ifd, TagId::Compression).ok() == Some(6)) {
        debug_log.push("[CR2] dual-pixel RAW: the second frame is not read".into());
    }
    debug_log.push(format!(
        "[CR2] {camera_model}: {bits}-bit {width}×{height} in {} slices {slices:?} (frame {}×{}×{}), crop {crop:?}, as-shot levels {wb:?} gain {as_shot_gain:?}, colour {colour:?}, orientation {orientation}",
        slices.len(),
        frame.width,
        frame.height,
        frame.sampling.len()
    ));
    Ok(Cr2Info {
        ifd0,
        raw_ifd,
        maker_note,
        strip: (offset, length),
        frame,
        width,
        height,
        slices,
        bits,
        crop,
        orientation,
        as_shot_gain,
        cam_to_rgb,
        colour,
        camera_model,
        unhandled: Vec::new(),
        debug_log,
    })
}

/// Decode the sensor mosaic of a file [`read_info`] accepted:
/// `width × height` values.
pub fn read_mosaic(data: &[u8], info: &Cr2Info) -> Result<Vec<u16>, String> {
    let (o, n) = info.strip;
    lossless::decode(&data[o..o + n], info.width as usize, info.height as usize, &info.slices)
}

/// The JPEGs a CR2 embeds as (offset, length), inside the file: IFD0's
/// strip (the full-size preview) and IFD1's thumbnail.
pub fn preview_ranges(data: &[u8]) -> Vec<(usize, usize)> {
    let Ok(reader) = TiffReader::new(data) else { return Vec::new() };
    let mut out = Vec::new();
    for i in 0..2 {
        let Ok(ifd) = reader.read_ifd(i) else { break };
        let get = |tag: u16| ifd.iter().find(|e| e.tag == tag).and_then(|e| e.as_u32());
        let range = match (get(0x201), get(0x202)) {
            (Some(o), Some(n)) => Some((o, n)),
            _ if get(TagId::Compression as u16) == Some(6) => get(TagId::StripOffsets as u16).zip(get(TagId::StripByteCounts as u16)),
            _ => None,
        };
        if let Some((o, n)) = range.map(|(o, n)| (o as usize, n as usize)) {
            if n > 0 && o.checked_add(n).is_some_and(|end| end <= data.len()) {
                out.push((o, n));
            }
        }
    }
    out
}

/// The camera's preview of the crop, decoded at about 800 pixels on its
/// long edge, unturned: the largest embedded JPEG with the crop's aspect
/// whose header fits the picture (`arw::exposure::preview_header_fits`).
pub fn preview_rgb(data: &[u8], crop: Crop) -> Option<levels::PreviewRgb> {
    let aspect = f64::from(crop.width) / f64::from(crop.height);
    let long = crop.width.max(crop.height);
    let mut best: Option<(usize, usize, u32)> = None;
    for (o, n) in preview_ranges(data) {
        let mut dec = jpeg_decoder::Decoder::new(&data[o..o + n]);
        if dec.read_info().is_err() {
            continue;
        }
        let Some(info) = dec.info() else { continue };
        let progressive = info.coding_process == jpeg_decoder::CodingProcess::DctProgressive;
        if info.pixel_format != jpeg_decoder::PixelFormat::RGB24 || !crate::arw::exposure::preview_header_fits(info.width, info.height, 3, progressive, long) {
            continue;
        }
        let (w, h) = (u32::from(info.width), u32::from(info.height));
        if (f64::from(w) / f64::from(h) / aspect - 1.0).abs() > 0.01 || w.max(h) < 256 {
            continue;
        }
        if best.is_none_or(|b| w > b.2) {
            best = Some((o, n, w));
        }
    }
    let (o, n, w) = best?;
    let mut dec = jpeg_decoder::Decoder::new(&data[o..o + n]);
    dec.set_max_decoding_buffer_size(64 << 20);
    let scale = 800.0 / f64::from(w);
    let h = (f64::from(w) / aspect).round();
    dec.scale((f64::from(w) * scale).ceil() as u16, (h * scale).ceil().max(1.0) as u16).ok()?;
    let rgb = dec.decode().ok()?;
    let info = dec.info()?;
    let (width, height) = (usize::from(info.width), usize::from(info.height));
    (rgb.len() == width * height * 3).then_some(levels::PreviewRgb { width, height, rgb })
}

/// [`read_cr2`]'s result: the baked image, and where its colour came from.
pub struct Cr2Image {
    /// sRGB f32 RGBA in 0..1, upright and cropped, as `read_dng` gives.
    pub image: DngImage,
    pub colour: Cr2Colour,
    pub camera_model: String,
    pub not_applied: Vec<String>,
    /// The exposure applied to match the camera's preview, in stops (0
    /// without a usable preview).
    pub exposure_ev: f32,
}

/// The baked decode: a CR2 to sRGB f32 RGBA, upright and cropped, through
/// the DNG baked decode's steps (bilinear demosaic, the matrix, the sRGB
/// transfer, orientation), with its exposure matched to the camera's
/// preview as an ARW's is (`arw::read_arw`), or auto-levels without one.
pub fn read_cr2(data: &[u8]) -> Result<Cr2Image, String> {
    let prep = linear::prepare_cr2(data)?;
    let (ow, oh) = prep.params.oriented_size();
    let preview = crate::arw::exposure::preview_of(data, &preview_ranges(data), &linear::preview_aspects(ow, oh), ow.max(oh));
    let linear::Cr2Prepared { params, mut plane, unhandled, mut debug_log } = prep;
    for v in plane.iter_mut() {
        *v = v.max(0.0);
    }
    let mut rgb = crate::dng::demosaic::try_bilinear(&plane, params.width, params.height, &params.cfa).ok_or("not enough memory for the Canon RAW's pixels")?;
    drop(plane);
    // A clipped channel carries its white-balance gain: clipped at the
    // lowest clip level, a clipped highlight is white before the matrix.
    if preview.is_some() || params.colour.is_calibrated() {
        let clip = params.as_shot_gain.iter().copied().fold(1.0f32, f32::min);
        for v in rgb.iter_mut() {
            *v = v.min(clip);
        }
    }
    let ci = crate::dng::centre_index(params.width, params.height);
    crate::dng::bake_colour(&mut rgb, None, Some(&params.cam_to_rgb), None, &mut debug_log, ci);
    let curve = crate::raf::base_curves::curve_lut(&crate::raf::base_curves::NEUTRAL);
    let last = (curve.len() - 1) as f64;
    let tone_curve: Vec<(f64, f64)> = curve.iter().enumerate().map(|(i, &y)| (i as f64 / last, f64::from(y))).collect();
    let mut ev = 0.0;
    if let Some(preview) = &preview {
        use crate::arw::exposure;
        let (sw, sh, small) = exposure::downscale(&rgb, params.width as usize, params.height as usize, (preview.width * preview.height) as usize);
        ev = exposure::match_exposure(&small, preview.median, &curve);
        let gain = ev.exp2();
        let roll = exposure::rolloff_for(gain, exposure::median_luminance(&small));
        drop(small);
        for px in rgb.chunks_exact_mut(3) {
            let c = exposure::render_pixel([px[0], px[1], px[2]], gain, roll);
            px.copy_from_slice(&c);
        }
        debug_log.push(format!("[CR2] exposure {ev:+.3} EV to the camera's {}×{} preview (median {:.3}, matched on {sw}×{sh}), roll-off {roll:?}", preview.width, preview.height, preview.median));
    }
    let (width, height, pixels) = crate::dng::bake_finish(rgb, params.width, params.height, &tone_curve, params.orientation, preview.is_none(), &mut debug_log)?;
    Ok(Cr2Image {
        image: DngImage { width, height, pixels, baseline_exposure: 0.0, tone_curve: Vec::new(), debug_log },
        colour: params.colour,
        camera_model: params.camera_model,
        not_applied: unhandled,
        exposure_ev: ev,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cr2_is_known_by_its_header() {
        let mut h = b"II*\0\x10\0\0\0CR\x02\0\0\0\0\0".to_vec();
        assert!(is_canon_cr2(&h));
        h[10] = 3;
        assert!(!is_canon_cr2(&h));
        assert!(!is_canon_cr2(b"II*\0\x10\0\0\0CR"));
        assert!(!is_canon_cr2(b"MM\0*\0\0\0\x10CR\x02\0\0\0\0\0"));
    }

    #[test]
    fn the_frame_header_is_found_and_bounded() {
        // DHT (empty), SOF3 14-bit 4×3 with two components, SOS.
        let s = [0xFF, 0xD8, 0xFF, 0xC4, 0, 2, 0xFF, 0xC3, 0, 14, 14, 0, 3, 0, 4, 2, 1, 0x11, 0, 2, 0x11, 0, 0xFF, 0xDA, 0, 2];
        let h = frame_header(&s).unwrap();
        assert_eq!((h.precision, h.width, h.height, h.sampling.clone()), (14, 4, 3, vec![(1, 1), (1, 1)]));
        // Cut inside the frame header, or a zero length: none.
        assert_eq!(frame_header(&s[..14]), None);
        assert_eq!(frame_header(&[0xFF, 0xC4, 0, 0, 0xFF, 0xC3]), None);
        assert_eq!(frame_header(&[]), None);
    }

    /// Headers cut short or pointing outside the file are refused with a
    /// sentence, never a panic.
    #[test]
    fn damaged_headers_are_refused() {
        assert!(read_info(b"").is_err());
        let mut h = b"II*\0\x10\0\0\0CR\x02\0\xff\xff\0\0".to_vec();
        assert!(read_info(&h).is_err());
        // IFD0 with one entry whose value points far outside the file.
        h.extend_from_slice(&[1, 0, 0x69, 0x87, 4, 0, 1, 0, 0, 0, 0xff, 0xff, 0xff, 0x0f, 0, 0, 0, 0]);
        assert!(read_info(&h).is_err());
        h[12..16].copy_from_slice(&16u32.to_le_bytes());
        assert!(read_info(&h).is_err());
        assert!(value_offset(&h, 16, 0x8769).is_some());
        assert!(value_offset(&h, 4000, 0x8769).is_none());
        assert!(preview_ranges(&h).is_empty());
    }
}
