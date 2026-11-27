//! Canon CR3: the container, read; the sensor data, not decoded.
//!
//! A CR3 is an ISO base media file (ISO/IEC 14496-12): an `ftyp` box whose
//! major brand is "crx ", a `moov` box, and an `mdat` box that holds every
//! picture. Inside `moov`, a `uuid` box of Canon's
//! (85c0b687-820f-11e0-8111-f4ce462b6a48) holds the compressor's version
//! (`CNCV`) and the TIFF metadata: `CMT1` is a TIFF whose IFD0 has `Make`,
//! `Model` and `Orientation`, and `CMT3` a TIFF whose IFD0 is Canon's maker
//! note, with the same sensor information (0x00E0) and colour data
//! (0x4001) as a CR2's. Each `trak` is one picture: its sample
//! description (`stsd`) is a `CRAW` entry with the picture's width and
//! height, its `stsz` and `co64` say how long it is and where in the file.
//! A `CRAW` holding a `JPEG` box is the camera's full-size preview; one
//! holding `CMP1` is sensor data in Canon's own codec ("crx"), whose
//! header `CMP1` is, with `CDI1` and its `IAD1` (the crop and the masked
//! areas, as the sensor information gives them).
//!
//! Read from the files listed in `cr3`'s tests (EOS R, M50, R6 Mark III;
//! RAW and C-RAW) and the standard; the `CMP1` fields used here are the
//! ones the files show plainly, counted from the start of its body: the
//! width and height (bytes 8 and 12, big-endian), the tile size (16 and
//! 20), the bit depth (24: 14 on every sample), the number of colour planes
//! (the high four bits of 25: 4 for a mosaic) and the number of wavelet
//! levels (the low four bits of 26): 0 on every RAW, 3 on every C-RAW,
//! which is lossy. `IAD1`'s crop (its body's bytes 16 to 24: left, top,
//! right, bottom, inclusive) is the size of the camera's JPEG on every
//! sample.
//!
//! **The codec is not decoded**, and [`prepare_cr3`] refuses every file
//! with a sentence. It is Canon's own adaptive Golomb-Rice coding (with a
//! wavelet transform and quantization for C-RAW). No published
//! description of its bitstream exists outside the code of other raw
//! decoders, which this engine may not draw on, and Canon's patent on the
//! method does not give it bit for bit.

use crate::dng::tiff::{IfdEntry, TagId, TiffReader};
use crate::dng::get_tag_u16;

/// Canon's `uuid` inside `moov`.
const CANON_UUID: [u8; 16] = [0x85, 0xc0, 0xb6, 0x87, 0x82, 0x0f, 0x11, 0xe0, 0x81, 0x11, 0xf4, 0xce, 0x46, 0x2b, 0x6a, 0x48];
/// The most boxes read at one level: real files have a dozen or so.
const MAX_BOXES: usize = 1024;

/// The sentences a CR3 is refused with.
pub const RAW_REFUSAL: &str = "This Canon CR3 is compressed with Canon's own lossless codec, which this app cannot decode yet";
pub const CRAW_REFUSAL: &str = "This Canon CR3 is a C-RAW, compressed with Canon's own lossy codec, which this app cannot decode yet";

/// Whether `data` is a Canon CR3: an ISO base media file whose `ftyp`
/// box's major brand is "crx ". Reads 12 bytes.
pub fn is_canon_cr3(data: &[u8]) -> bool {
    data.len() >= 12 && &data[4..8] == b"ftyp" && &data[8..12] == b"crx "
}

/// One box: its type, and its body (after the header) with the body's
/// offset in the file.
#[derive(Clone, Copy)]
struct Bx<'a> {
    typ: [u8; 4],
    body: &'a [u8],
    at: usize,
}

/// The boxes in `buf` (which starts at file offset `base`), in order. An
/// error when a box's size runs past `buf` or is too small for its header.
fn boxes(buf: &[u8], base: usize) -> Result<Vec<Bx<'_>>, String> {
    let mut out = Vec::new();
    let mut p = 0usize;
    while p + 8 <= buf.len() {
        if out.len() >= MAX_BOXES {
            return Err("This Canon CR3 has too many boxes".into());
        }
        let size32 = u32::from_be_bytes([buf[p], buf[p + 1], buf[p + 2], buf[p + 3]]);
        let typ = [buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]];
        let (size, header) = match size32 {
            0 => ((buf.len() - p) as u64, 8usize),
            1 => {
                let b = buf.get(p + 8..p + 16).ok_or("This Canon CR3 is cut short in a box header")?;
                (u64::from_be_bytes(b.try_into().map_err(|_| "a box header")?), 16)
            }
            n => (u64::from(n), 8),
        };
        let end = usize::try_from(size).ok().and_then(|s| p.checked_add(s)).filter(|&e| e <= buf.len());
        let Some(end) = end.filter(|_| size >= header as u64) else {
            return Err(format!("This Canon CR3 is damaged or cut short: its '{}' box runs past its end", String::from_utf8_lossy(&typ)));
        };
        out.push(Bx { typ, body: &buf[p + header..end], at: base + p + header });
        p = end;
    }
    Ok(out)
}

fn child<'a>(list: &[Bx<'a>], typ: &[u8; 4]) -> Option<Bx<'a>> {
    list.iter().find(|b| &b.typ == typ).copied()
}

fn be32(b: &[u8], at: usize) -> Option<u32> {
    b.get(at..at + 4).map(|v| u32::from_be_bytes([v[0], v[1], v[2], v[3]]))
}

fn be16(b: &[u8], at: usize) -> Option<u16> {
    b.get(at..at + 2).map(|v| u16::from_be_bytes([v[0], v[1]]))
}

/// How a track's picture is stored.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cr3Encoding {
    /// The camera's JPEG.
    Jpeg,
    /// Canon's codec without a wavelet transform (RAW).
    Lossless,
    /// Canon's codec with wavelet levels and quantization (C-RAW).
    Lossy,
}

/// One picture of the file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Cr3Track {
    pub width: u32,
    pub height: u32,
    pub encoding: Cr3Encoding,
    /// For Canon's codec (`CMP1`): bits per sample, colour planes, tile
    /// size and wavelet levels; 0 for a JPEG.
    pub bits: u8,
    pub planes: u8,
    pub tile_width: u32,
    pub tile_height: u32,
    pub levels: u8,
    /// Where its data is in the file, checked to lie inside it.
    pub offset: usize,
    pub size: usize,
    /// `IAD1`'s crop (left, top, right, bottom, inclusive), when the
    /// track has one with masked areas (the full-size picture).
    pub crop: Option<[u16; 4]>,
}

/// What a CR3's boxes say.
pub struct Cr3Info {
    /// `CNCV`: "CanonCR3_001/…".
    pub compressor: String,
    pub camera_model: String,
    pub orientation: u16,
    pub tracks: Vec<Cr3Track>,
    /// Canon's maker note (`CMT3`), as a CR2's.
    pub maker_note: Vec<IfdEntry>,
    /// The as-shot white balance as channel gains, green 1, when the
    /// colour data has it where a CR2's does (`cr2::colour_data`).
    pub as_shot_gain: Option<[f32; 3]>,
}

impl Cr3Info {
    /// The full-size sensor data: the largest track in Canon's codec.
    pub fn sensor_track(&self) -> Option<&Cr3Track> {
        self.tracks.iter().filter(|t| t.encoding != Cr3Encoding::Jpeg).max_by_key(|t| u64::from(t.width) * u64::from(t.height))
    }
}

/// One `trak`: its `CRAW` sample entry and where its sample is.
fn track(data: &[u8], trak: Bx) -> Result<Option<Cr3Track>, String> {
    let path = [b"mdia", b"minf", b"stbl"];
    let mut level = boxes(trak.body, trak.at)?;
    for name in path {
        let Some(b) = child(&level, name) else { return Ok(None) };
        level = boxes(b.body, b.at)?;
    }
    let Some(stsd) = child(&level, b"stsd") else { return Ok(None) };
    // A full box (version, flags) and an entry count, then the entries.
    let entries = boxes(stsd.body.get(8..).unwrap_or(&[]), stsd.at + 8)?;
    let Some(craw) = child(&entries, b"CRAW") else { return Ok(None) };
    // A visual sample entry: width and height at 24, its own boxes at 82.
    let (Some(width), Some(height)) = (be16(craw.body, 24), be16(craw.body, 26)) else {
        return Err("This Canon CR3's picture description is damaged".into());
    };
    let inner = boxes(craw.body.get(82..).unwrap_or(&[]), craw.at + 82)?;
    // Where the sample is: one sample, in one chunk.
    let size = child(&level, b"stsz").and_then(|b| {
        let fixed = be32(b.body, 4)?;
        if fixed != 0 { Some(fixed) } else { be32(b.body, 12) }
    });
    let offset = child(&level, b"co64").and_then(|b| b.body.get(8..16).map(|v| u64::from_be_bytes(v.try_into().unwrap_or_default())));
    let (Some(size), Some(offset)) = (size, offset) else {
        return Err("This Canon CR3's picture has no place in the file".into());
    };
    let offset = usize::try_from(offset).map_err(|_| "This Canon CR3's picture is outside the file")?;
    let size = size as usize;
    if offset.checked_add(size).is_none_or(|end| end > data.len()) {
        return Err("This Canon CR3 is cut short: a picture runs past the end of the file".into());
    }
    let mut t = Cr3Track { width: u32::from(width), height: u32::from(height), encoding: Cr3Encoding::Jpeg, bits: 0, planes: 0, tile_width: 0, tile_height: 0, levels: 0, offset, size, crop: None };
    if child(&inner, b"JPEG").is_some() {
        return Ok(Some(t));
    }
    let Some(cmp1) = child(&inner, b"CMP1") else { return Ok(None) };
    let c = cmp1.body;
    let (Some(w), Some(h), Some(tw), Some(th), Some(&bits), Some(&planes), Some(&levels)) = (be32(c, 8), be32(c, 12), be32(c, 16), be32(c, 20), c.get(24), c.get(25), c.get(26)) else {
        return Err("This Canon CR3's codec header is damaged".into());
    };
    t.width = w;
    t.height = h;
    t.tile_width = tw;
    t.tile_height = th;
    t.bits = bits;
    t.planes = planes >> 4;
    t.levels = levels & 15;
    t.encoding = if t.levels == 0 { Cr3Encoding::Lossless } else { Cr3Encoding::Lossy };
    // `CDI1` (a full box) holds `IAD1`; a full-size one has the crop at 16.
    if let Some(cdi1) = child(&inner, b"CDI1") {
        let iad = boxes(cdi1.body.get(4..).unwrap_or(&[]), cdi1.at + 4)?;
        if let Some(iad1) = child(&iad, b"IAD1").filter(|b| b.body.len() >= 48) {
            let at = |i: usize| be16(iad1.body, i).unwrap_or(0);
            t.crop = Some([at(16), at(18), at(20), at(22)]);
        }
    }
    Ok(Some(t))
}

/// Read a CR3's boxes and metadata, without decoding any picture. An
/// error is a sentence (a damaged or cut-short file).
pub fn read_info(data: &[u8]) -> Result<Cr3Info, String> {
    if !is_canon_cr3(data) {
        return Err("This is not a Canon CR3 file".into());
    }
    let top = boxes(data, 0)?;
    let moov = child(&top, b"moov").ok_or("This Canon CR3 has no movie box")?;
    let moov_boxes = boxes(moov.body, moov.at)?;
    let canon = moov_boxes.iter().find(|b| &b.typ == b"uuid" && b.body.starts_with(&CANON_UUID)).ok_or("This Canon CR3 has no Canon metadata")?;
    let meta = boxes(&canon.body[16..], canon.at + 16)?;
    let compressor = child(&meta, b"CNCV").map(|b| String::from_utf8_lossy(b.body).trim_end_matches('\0').to_string()).unwrap_or_default();
    let tiff_ifd0 = |name: &[u8; 4]| -> Option<Vec<IfdEntry>> { TiffReader::new(child(&meta, name)?.body).ok()?.read_ifd(0).ok() };
    let ifd0 = tiff_ifd0(b"CMT1").ok_or("This Canon CR3 has no camera metadata")?;
    let maker_note = tiff_ifd0(b"CMT3").unwrap_or_default();
    let camera_model = crate::cr2::camera_model(&ifd0);
    let orientation = get_tag_u16(&ifd0, TagId::Orientation).ok().filter(|o| (1..=8).contains(o)).unwrap_or(1);
    let as_shot_gain = crate::cr2::shorts(&maker_note, 0x4001).and_then(|cd| crate::cr2::colour_data::as_shot_levels(&cd)).map(|(l, _)| crate::cr2::colour_data::gains(l));
    let mut tracks = Vec::new();
    for trak in moov_boxes.iter().filter(|b| &b.typ == b"trak") {
        if let Some(t) = track(data, *trak)? {
            tracks.push(t);
        }
    }
    Ok(Cr3Info { compressor, camera_model, orientation, tracks, maker_note, as_shot_gain })
}

/// Why a CR3 cannot be prepared: a damaged file's sentence, or the codec's.
pub fn refusal(data: &[u8]) -> String {
    match read_info(data) {
        Err(e) => e,
        Ok(info) => match info.sensor_track() {
            None => "This Canon CR3 has no sensor data this decoder can find".into(),
            Some(t) if t.encoding == Cr3Encoding::Lossy => CRAW_REFUSAL.into(),
            Some(_) => RAW_REFUSAL.into(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bx(typ: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut v = ((body.len() + 8) as u32).to_be_bytes().to_vec();
        v.extend_from_slice(typ);
        v.extend_from_slice(body);
        v
    }

    #[test]
    fn a_cr3_is_known_by_its_brand() {
        let ftyp = bx(b"ftyp", b"crx \0\0\0\x01crx isom");
        assert!(is_canon_cr3(&ftyp));
        assert!(!is_canon_cr3(&bx(b"ftyp", b"isom\0\0\0\x01")));
        assert!(!is_canon_cr3(&ftyp[..10]));
    }

    /// Made-up box sequences (not a camera's file): sizes that run past
    /// their parent, are smaller than their header or claim 64-bit sizes
    /// past the end are refused with a sentence, never a panic.
    #[test]
    fn damaged_boxes_are_refused() {
        let ftyp = bx(b"ftyp", b"crx \0\0\0\x01crx isom");
        assert!(read_info(&ftyp).is_err(), "no moov");
        let mut long = ftyp.clone();
        long.extend_from_slice(&[0, 0, 0x10, 0, b'm', b'o', b'o', b'v']);
        assert!(read_info(&long).err().unwrap_or_default().contains("runs past"));
        let mut tiny = ftyp.clone();
        tiny.extend_from_slice(&[0, 0, 0, 4, b'm', b'o', b'o', b'v']);
        assert!(read_info(&tiny).is_err());
        let mut large = ftyp.clone();
        large.extend_from_slice(&[0, 0, 0, 1, b'm', b'd', b'a', b't', 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
        assert!(read_info(&large).is_err());
        // A moov with no Canon metadata.
        let mut no_meta = ftyp.clone();
        no_meta.extend(bx(b"moov", &bx(b"mvhd", &[0; 8])));
        assert_eq!(read_info(&no_meta).err().as_deref(), Some("This Canon CR3 has no Canon metadata"));
        assert_eq!(refusal(&no_meta), "This Canon CR3 has no Canon metadata");
        // Canon's uuid with a truncated metadata box inside.
        let mut uuid = CANON_UUID.to_vec();
        uuid.extend_from_slice(&[0, 0, 1, 0, b'C', b'M', b'T', b'1']);
        let mut cut = ftyp;
        cut.extend(bx(b"moov", &bx(b"uuid", &uuid)));
        assert!(read_info(&cut).is_err());
    }
}
