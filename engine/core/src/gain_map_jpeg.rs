//! The JPEG that carries a gain map: an ordinary JPEG (the SDR picture)
//! that also holds the gain map as a second JPEG, readable as Google's
//! Ultra HDR and as ISO 21496-1, and as a plain photo by everything else.
//!
//! The browser encodes both JPEGs; this module only rearranges bytes. It
//! never decodes or encodes image data. Its inputs come from the page, so
//! every length is checked and a malformed or truncated JPEG is an error,
//! never a panic; every loop advances at least one byte a step.
//!
//! The file is the primary image followed directly by the gain map image:
//!
//! ```text
//! primary:  SOI  [APP0 JFIF] [APP1 Exif]  APP1 XMP (GContainer, hdrgm:Version)
//!           APP2 ISO 21496-1 (version only)  [APP2 ICC ...]  APP2 MPF
//!           the base JPEG's other segments, scans and EOI
//! gain map: SOI  [APP0 JFIF]  APP1 XMP (hdrgm values)  APP2 ISO 21496-1 (all values)
//!           the map JPEG's other segments, scans and EOI
//! ```
//!
//! Sources. The XMP follows the examples and attribute tables of Google's
//! "Ultra HDR Image Format v1.1" (developer.android.com), which also puts
//! the ISO segment directly after the XMP in both images. The MPF index
//! follows CIPA DC-007 (Multi-Picture Format), written from memory of that
//! document: the tag numbers, the 16-byte MP entry and the rule that
//! offsets count from the MP header's byte-order mark; Pillow's MPO reader
//! finds both images through it. The ISO 21496-1 binary layout is also
//! written from memory, as the standard's text was not available;
//! `iso_21496_metadata` says what has been checked against a reader.

use crate::gain_map::GainMapMetadata;

const SOI: u8 = 0xD8;
const EOI: u8 = 0xD9;
const SOS: u8 = 0xDA;
const APP0: u8 = 0xE0;
const APP1: u8 = 0xE1;
const APP2: u8 = 0xE2;

const JFIF_ID: &[u8] = b"JFIF\0";
const EXIF_ID: &[u8] = b"Exif\0\0";
const XMP_ID: &[u8] = b"http://ns.adobe.com/xap/1.0/\0";
const XMP_EXTENSION_ID: &[u8] = b"http://ns.adobe.com/xmp/extension/\0";
const ICC_ID: &[u8] = b"ICC_PROFILE\0";
const MPF_ID: &[u8] = b"MPF\0";
/// The identifier ISO 21496-1 gives its APP2 segment.
pub const ISO_21496_ID: &[u8] = b"urn:iso:std:iso:ts:21496:-1\0";

/// One marker segment: the marker byte and where it sits in the stream,
/// from its 0xFF to the end of its payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Segment {
    marker: u8,
    start: usize,
    end: usize,
}

impl Segment {
    fn payload<'a>(&self, bytes: &'a [u8]) -> &'a [u8] {
        &bytes[self.start + 4..self.end]
    }

    fn is(&self, bytes: &[u8], marker: u8, id: &[u8]) -> bool {
        self.marker == marker && self.payload(bytes).starts_with(id)
    }
}

/// A JPEG's structure: the marker segments before the first scan, where
/// the first scan starts, and where the image ends (just past EOI).
#[derive(Debug)]
struct Jpeg {
    header: Vec<Segment>,
    body_start: usize,
    end: usize,
}

/// Walk a JPEG from SOI to EOI. Anything after EOI is not part of it.
fn parse_jpeg(bytes: &[u8]) -> Result<Jpeg, String> {
    if bytes.len() < 4 || bytes[0] != 0xFF || bytes[1] != SOI {
        return Err("not a JPEG: no SOI".into());
    }
    let mut header = Vec::new();
    let mut body_start = None;
    let mut pos = 2;
    loop {
        if pos >= bytes.len() || bytes[pos] != 0xFF {
            return Err(format!("JPEG: expected a marker at byte {pos}"));
        }
        // Any number of 0xFF fill bytes may precede a marker.
        let mut m = pos + 1;
        while m < bytes.len() && bytes[m] == 0xFF {
            m += 1;
        }
        if m >= bytes.len() {
            return Err("JPEG: truncated before EOI".into());
        }
        let marker = bytes[m];
        let start = m - 1;
        match marker {
            EOI => {
                let Some(body_start) = body_start else {
                    return Err("JPEG: no image data before EOI".into());
                };
                return Ok(Jpeg { header, body_start, end: m + 1 });
            }
            SOI | 0x00 => return Err(format!("JPEG: unexpected marker 0x{marker:02X} at byte {start}")),
            // Markers without a length.
            0x01 | 0xD0..=0xD7 => {
                pos = m + 1;
                continue;
            }
            _ => {}
        }
        if m + 3 > bytes.len() {
            return Err("JPEG: truncated segment length".into());
        }
        let len = u16::from_be_bytes([bytes[m + 1], bytes[m + 2]]) as usize;
        if len < 2 || m + 1 + len > bytes.len() {
            return Err(format!("JPEG: segment 0x{marker:02X} at byte {start} runs past the end"));
        }
        let end = m + 1 + len;
        let seg = Segment { marker, start, end };
        if marker == SOS {
            body_start.get_or_insert(start);
            pos = skip_entropy_coded(bytes, end)?;
            continue;
        }
        if body_start.is_none() {
            header.push(seg);
        }
        pos = end;
    }
}

/// The position of the marker that ends the entropy-coded data starting
/// at `from`. In that data 0xFF is followed by 0x00 (a stuffed byte), by a
/// restart marker, or by more fill; anything else is a marker.
fn skip_entropy_coded(bytes: &[u8], from: usize) -> Result<usize, String> {
    let mut i = from;
    while i + 1 < bytes.len() {
        if bytes[i] != 0xFF {
            i += 1;
            continue;
        }
        match bytes[i + 1] {
            0x00 | 0xD0..=0xD7 => i += 2,
            0xFF => i += 1,
            _ => return Ok(i),
        }
    }
    Err("JPEG: truncated inside image data".into())
}

/// A marker segment with `payload`, or an error if it is too long for one.
fn segment(marker: u8, payload: &[&[u8]]) -> Result<Vec<u8>, String> {
    let len: usize = payload.iter().map(|p| p.len()).sum::<usize>() + 2;
    let len16 = u16::try_from(len).map_err(|_| format!("segment 0x{marker:02X} is {len} bytes, more than a JPEG segment holds"))?;
    let mut out = Vec::with_capacity(len + 2);
    out.extend_from_slice(&[0xFF, marker]);
    out.extend_from_slice(&len16.to_be_bytes());
    for p in payload {
        out.extend_from_slice(p);
    }
    Ok(out)
}

/// A number in XMP: the shortest decimal that reads back as the same f64.
fn real(v: f64) -> String {
    format!("{v}")
}

/// The primary image's XMP: Ultra HDR's signal (`hdrgm:Version`) and the
/// GContainer directory that says the second image is the gain map and
/// how long it is.
pub fn primary_xmp(gain_map_len: usize) -> String {
    format!(
        concat!(
            r#"<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Lopsy">"#,
            r#"<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">"#,
            r#"<rdf:Description rdf:about="""#,
            r#" xmlns:Container="http://ns.google.com/photos/1.0/container/""#,
            r#" xmlns:Item="http://ns.google.com/photos/1.0/container/item/""#,
            r#" xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/""#,
            r#" hdrgm:Version="1.0">"#,
            r#"<Container:Directory><rdf:Seq>"#,
            r#"<rdf:li rdf:parseType="Resource"><Container:Item Item:Semantic="Primary" Item:Mime="image/jpeg"/></rdf:li>"#,
            r#"<rdf:li rdf:parseType="Resource"><Container:Item Item:Semantic="GainMap" Item:Mime="image/jpeg" Item:Length="{}"/></rdf:li>"#,
            r#"</rdf:Seq></Container:Directory>"#,
            r#"</rdf:Description></rdf:RDF></x:xmpmeta>"#
        ),
        gain_map_len
    )
}

/// The gain map image's XMP: the `hdrgm` values, one scalar each (a
/// single-channel map).
pub fn gain_map_xmp(m: &GainMapMetadata) -> String {
    format!(
        concat!(
            r#"<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Lopsy">"#,
            r#"<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">"#,
            r#"<rdf:Description rdf:about="""#,
            r#" xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/""#,
            r#" hdrgm:Version="1.0""#,
            r#" hdrgm:GainMapMin="{}""#,
            r#" hdrgm:GainMapMax="{}""#,
            r#" hdrgm:Gamma="{}""#,
            r#" hdrgm:OffsetSDR="{}""#,
            r#" hdrgm:OffsetHDR="{}""#,
            r#" hdrgm:HDRCapacityMin="{}""#,
            r#" hdrgm:HDRCapacityMax="{}""#,
            r#" hdrgm:BaseRenditionIsHDR="{}"/>"#,
            r#"</rdf:RDF></x:xmpmeta>"#
        ),
        real(m.gain_map_min),
        real(m.gain_map_max),
        real(m.gamma),
        real(m.offset_sdr),
        real(m.offset_hdr),
        real(m.hdr_capacity_min),
        real(m.hdr_capacity_max),
        if m.base_rendition_is_hdr { "True" } else { "False" },
    )
}

/// A value as numerator / 2^k with the largest k (up to 30) that keeps
/// the numerator in range, so dyadic values such as 1/64 are exact and
/// others are within 2^-30 relative.
fn fraction(v: f64, max_numerator: f64) -> (f64, u32) {
    if v == 0.0 {
        return (0.0, 1);
    }
    let mut k = 30;
    while k > 0 && (v * (1u64 << k) as f64).abs().round() > max_numerator {
        k -= 1;
    }
    ((v * (1u64 << k) as f64).round(), 1u32 << k)
}

fn signed_fraction(out: &mut Vec<u8>, v: f64) {
    let (n, d) = fraction(v, i32::MAX as f64);
    out.extend_from_slice(&(n.clamp(i32::MIN as f64, i32::MAX as f64) as i32).to_be_bytes());
    out.extend_from_slice(&d.to_be_bytes());
}

fn unsigned_fraction(out: &mut Vec<u8>, v: f64) {
    let (n, d) = fraction(v.max(0.0), u32::MAX as f64);
    out.extend_from_slice(&(n.min(u32::MAX as f64) as u32).to_be_bytes());
    out.extend_from_slice(&d.to_be_bytes());
}

/// The ISO 21496-1 metadata the primary image carries: only the version
/// (minimum version 0, writer version 0, each a big-endian u16), which
/// says that the file has a gain map described in the gain map image.
pub const ISO_21496_VERSION_ONLY: [u8; 4] = [0, 0, 0, 0];

/// The ISO 21496-1 binary metadata for a gain map, all big-endian:
///
/// ```text
/// u16 minimum_version = 0, u16 writer_version = 0
/// u8  flags: bit 7 is_multichannel (0 here), bit 6 use_base_colour_space (1 here),
///     the others 0, so each value below is its own numerator and denominator
/// u32/u32 base_hdr_headroom        = hdr_capacity_min (log2)
/// u32/u32 alternate_hdr_headroom   = hdr_capacity_max (log2)
/// per channel (one here):
///   i32/u32 gain_map_min (log2), i32/u32 gain_map_max (log2), u32/u32 gamma,
///   i32/u32 base_offset (= offset_sdr), i32/u32 alternate_offset (= offset_hdr)
/// ```
///
/// This layout is written from memory of ISO 21496-1, not from its text,
/// and readers prefer this segment to the XMP. macOS 15.6's ImageIO reads
/// every headroom, gain, gamma and offset field back from the bytes this
/// writes, each with a distinct value, and rejects the segment when bit 7
/// (multichannel) is set without three channels; that was checked by hand
/// in November 2026. ImageIO does not show bit 6, so its position is
/// still from memory alone.
pub fn iso_21496_metadata(m: &GainMapMetadata) -> Vec<u8> {
    let mut out = Vec::with_capacity(5 + 16 + 40);
    out.extend_from_slice(&0u16.to_be_bytes());
    out.extend_from_slice(&0u16.to_be_bytes());
    // The map was computed in the SDR picture's own colour space.
    let use_base_colour_space = 0x40;
    out.push(use_base_colour_space);
    unsigned_fraction(&mut out, m.hdr_capacity_min);
    unsigned_fraction(&mut out, m.hdr_capacity_max);
    signed_fraction(&mut out, m.gain_map_min);
    signed_fraction(&mut out, m.gain_map_max);
    unsigned_fraction(&mut out, m.gamma);
    signed_fraction(&mut out, m.offset_sdr);
    signed_fraction(&mut out, m.offset_hdr);
    out
}

/// Size of the MPF segment's payload after "MPF\0": the 8-byte header,
/// an index IFD of three entries, and two 16-byte MP entries.
const MPF_BODY_LEN: usize = 8 + 2 + 3 * 12 + 4 + 2 * 16;

/// MP entry attribute of the primary image (CIPA DC-007): representative
/// image (bit 29), JPEG data (bits 26..24 = 0), type Baseline MP Primary
/// Image (0x030000).
const MP_PRIMARY: u32 = 0x2003_0000;
/// The gain map: not representative, JPEG, type undefined (0), as the
/// Multi-Picture Format has no type for a gain map.
const MP_GAIN_MAP: u32 = 0;

/// The MPF payload (after "MPF\0"), big-endian. `primary_len` is the whole
/// primary image; `gain_map_offset` is where the gain map's SOI is,
/// counted from the first byte of this payload (the byte-order mark), as
/// MPF counts every offset.
fn mpf_body(primary_len: u32, gain_map_len: u32, gain_map_offset: u32) -> Vec<u8> {
    let mut b = Vec::with_capacity(MPF_BODY_LEN);
    b.extend_from_slice(b"MM\0\x2A");
    b.extend_from_slice(&8u32.to_be_bytes()); // first IFD, straight after the header
    b.extend_from_slice(&3u16.to_be_bytes());
    let entry = |b: &mut Vec<u8>, tag: u16, kind: u16, count: u32, value: [u8; 4]| {
        b.extend_from_slice(&tag.to_be_bytes());
        b.extend_from_slice(&kind.to_be_bytes());
        b.extend_from_slice(&count.to_be_bytes());
        b.extend_from_slice(&value);
    };
    const UNDEFINED: u16 = 7;
    const LONG: u16 = 4;
    let entries_at = (8 + 2 + 3 * 12 + 4) as u32;
    entry(&mut b, 0xB000, UNDEFINED, 4, *b"0100"); // MPFVersion
    entry(&mut b, 0xB001, LONG, 1, 2u32.to_be_bytes()); // NumberOfImages
    entry(&mut b, 0xB002, UNDEFINED, 32, entries_at.to_be_bytes()); // MPEntry
    b.extend_from_slice(&0u32.to_be_bytes()); // no next IFD
    for (attr, len, offset) in [(MP_PRIMARY, primary_len, 0), (MP_GAIN_MAP, gain_map_len, gain_map_offset)] {
        b.extend_from_slice(&attr.to_be_bytes());
        b.extend_from_slice(&len.to_be_bytes());
        b.extend_from_slice(&offset.to_be_bytes());
        b.extend_from_slice(&0u16.to_be_bytes()); // dependent image 1
        b.extend_from_slice(&0u16.to_be_bytes()); // dependent image 2
    }
    debug_assert_eq!(b.len(), MPF_BODY_LEN);
    b
}

fn check_metadata(m: &GainMapMetadata) -> Result<(), String> {
    let all = [m.gain_map_min, m.gain_map_max, m.gamma, m.offset_sdr, m.offset_hdr, m.hdr_capacity_min, m.hdr_capacity_max];
    if all.iter().any(|v| !v.is_finite()) {
        return Err("gain map metadata must be finite".into());
    }
    // The ranges Ultra HDR requires; a reader ignores a map outside them.
    if m.gain_map_min > m.gain_map_max {
        return Err("gain map min must not exceed max".into());
    }
    if m.gamma <= 0.0 || m.offset_sdr < 0.0 || m.offset_hdr < 0.0 || m.hdr_capacity_min < 0.0 {
        return Err("gain map gamma must be positive, and offsets and HDR capacity min not negative".into());
    }
    if m.hdr_capacity_max <= m.hdr_capacity_min {
        return Err("HDR capacity max must exceed min".into());
    }
    if m.base_rendition_is_hdr {
        return Err("the base picture must be the SDR rendition".into());
    }
    Ok(())
}

/// Assemble a gain-map JPEG from the SDR picture and the gain map, each
/// already encoded as a JPEG, and the metadata that came with the map
/// (`gain_map::compute_gain_map`).
///
/// `base` keeps its JFIF, Exif and ICC profile segments (the profile says
/// which space the SDR picture is in, and readers apply the map in it);
/// any XMP, MPF or ISO 21496-1 segments it had are replaced. `gain_map`
/// keeps its JFIF segment and loses Exif and ICC, which readers do not
/// use in a gain map. Bytes after either image's EOI are dropped.
pub fn assemble_gain_map_jpeg(base: &[u8], gain_map: &[u8], metadata: &GainMapMetadata) -> Result<Vec<u8>, String> {
    check_metadata(metadata)?;
    let b = parse_jpeg(base).map_err(|e| format!("base image: {e}"))?;
    let g = parse_jpeg(gain_map).map_err(|e| format!("gain map: {e}"))?;

    let replaced = |bytes: &[u8], s: &Segment| {
        s.is(bytes, APP1, XMP_ID)
            || s.is(bytes, APP1, XMP_EXTENSION_ID)
            || s.is(bytes, APP2, MPF_ID)
            || s.is(bytes, APP2, ISO_21496_ID)
    };
    let raw = |bytes: &[u8], s: &Segment| bytes[s.start..s.end].to_vec();

    // The gain map image.
    let mut gm = vec![0xFF, SOI];
    let gm_jfif: Vec<&Segment> = g.header.iter().filter(|s| s.is(gain_map, APP0, JFIF_ID)).collect();
    for s in &gm_jfif {
        gm.extend(raw(gain_map, s));
    }
    gm.extend(segment(APP1, &[XMP_ID, gain_map_xmp(metadata).as_bytes()])?);
    gm.extend(segment(APP2, &[ISO_21496_ID, &iso_21496_metadata(metadata)])?);
    for s in &g.header {
        let dropped = s.is(gain_map, APP0, JFIF_ID)
            || s.is(gain_map, APP1, EXIF_ID)
            || s.is(gain_map, APP2, ICC_ID)
            || replaced(gain_map, s);
        if !dropped {
            gm.extend(raw(gain_map, s));
        }
    }
    gm.extend_from_slice(&gain_map[g.body_start..g.end]);

    // The primary image, with a placeholder MPF segment filled in once its
    // length is known.
    let mut out = vec![0xFF, SOI];
    let first: Vec<&Segment> = b
        .header
        .iter()
        .filter(|s| s.is(base, APP0, JFIF_ID) || s.is(base, APP1, EXIF_ID))
        .collect();
    for s in &first {
        out.extend(raw(base, s));
    }
    out.extend(segment(APP1, &[XMP_ID, primary_xmp(gm.len()).as_bytes()])?);
    out.extend(segment(APP2, &[ISO_21496_ID, &ISO_21496_VERSION_ONLY])?);
    for s in b.header.iter().filter(|s| s.is(base, APP2, ICC_ID)) {
        out.extend(raw(base, s));
    }
    let mpf_at = out.len();
    out.extend(segment(APP2, &[MPF_ID, &[0u8; MPF_BODY_LEN]])?);
    for s in &b.header {
        let placed = s.is(base, APP0, JFIF_ID) || s.is(base, APP1, EXIF_ID) || s.is(base, APP2, ICC_ID);
        if !placed && !replaced(base, s) {
            out.extend(raw(base, s));
        }
    }
    out.extend_from_slice(&base[b.body_start..b.end]);

    let header_at = mpf_at + 4 + MPF_ID.len();
    let too_big = |_| "gain-map JPEG is larger than 4 GB".to_string();
    let primary_len = u32::try_from(out.len()).map_err(too_big)?;
    let gm_len = u32::try_from(gm.len()).map_err(too_big)?;
    let gm_offset = u32::try_from(out.len() - header_at).map_err(too_big)?;
    out[header_at..header_at + MPF_BODY_LEN].copy_from_slice(&mpf_body(primary_len, gm_len, gm_offset));
    u32::try_from(out.len() + gm.len()).map_err(too_big)?;
    out.extend_from_slice(&gm);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 16×8 colour gradient (4:2:0) at quality 75 with optimised Huffman
    /// tables, written by the `jpeg-encoder` crate (0.6.1, this crate's
    /// dev-dependency) and pasted here so that the test does not depend
    /// on that encoder's output staying the same.
    const BASE_JPEG: &[u8] = &[
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
        0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x08, 0x00, 0x10, 0x03, 0x00, 0x22, 0x00, 0x01, 0x11, 0x01, 0x02, 0x11, 0x01, 0xFF,
        0xDB, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C, 0x14,
        0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12, 0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20, 0x24,
        0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29, 0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39,
        0x3D, 0x38, 0x32, 0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xDB, 0x00, 0x43, 0x01, 0x09, 0x09, 0x09, 0x0C, 0x0B, 0x0C, 0x18,
        0x0D, 0x0D, 0x18, 0x32, 0x21, 0x1C, 0x21, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32,
        0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32,
        0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0xFF, 0xC4, 0x00,
        0x15, 0x00, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x05, 0x06,
        0xFF, 0xC4, 0x00, 0x19, 0x10, 0x00, 0x01, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x04, 0x06, 0x23, 0x31, 0xA1, 0xFF, 0xC4, 0x00, 0x15, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x05, 0xFF, 0xC4, 0x00, 0x19, 0x11, 0x00, 0x02, 0x03, 0x01, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x05, 0x06, 0x21, 0x51, 0xFF, 0xDA, 0x00,
        0x08, 0x01, 0x00, 0x00, 0x00, 0x3F, 0x00, 0x01, 0x03, 0x1A, 0xA2, 0xC2, 0x99, 0x03, 0x1A, 0xA2, 0xC3, 0xFF, 0xDA, 0x00,
        0x08, 0x01, 0x01, 0x11, 0x00, 0x3F, 0x00, 0x06, 0xE5, 0x58, 0xE9, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x02, 0x11, 0x00, 0x3F,
        0x00, 0x99, 0x5F, 0x9B, 0x6B, 0x34, 0xFF, 0xD9,
    ];

    /// An 8×8 grey ramp, one channel, quality 75, by the same encoder.
    const GAIN_MAP_JPEG: &[u8] = &[
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
        0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x08, 0x00, 0x08, 0x01, 0x00, 0x11, 0x00, 0xFF, 0xDB, 0x00, 0x43, 0x00, 0x08, 0x06,
        0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19,
        0x12, 0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20, 0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23,
        0x1C, 0x1C, 0x28, 0x37, 0x29, 0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32, 0x3C, 0x2E, 0x33,
        0x34, 0x32, 0xFF, 0xDB, 0x00, 0x43, 0x01, 0x09, 0x09, 0x09, 0x0C, 0x0B, 0x0C, 0x18, 0x0D, 0x0D, 0x18, 0x32, 0x21, 0x1C,
        0x21, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32,
        0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32,
        0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0xFF, 0xC4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0xFF, 0xC4, 0x00, 0x19, 0x10, 0x00, 0x01,
        0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x07, 0x24, 0x31, 0xA2,
        0xFF, 0xDA, 0x00, 0x08, 0x01, 0x00, 0x00, 0x00, 0x3F, 0x00, 0x28, 0xD9, 0xEA, 0x8D, 0x93, 0xFF, 0xD9,
    ];

    fn metadata() -> GainMapMetadata {
        GainMapMetadata {
            gain_map_min: -0.75,
            gain_map_max: 2.3125,
            gamma: 1.0,
            offset_sdr: 1.0 / 64.0,
            offset_hdr: 1.0 / 64.0,
            hdr_capacity_min: 0.0,
            hdr_capacity_max: 2.3125,
            base_rendition_is_hdr: false,
        }
    }

    /// Every marker segment before the first scan: (marker, payload).
    fn header_segments(bytes: &[u8]) -> Vec<(u8, Vec<u8>)> {
        let j = parse_jpeg(bytes).unwrap();
        j.header.iter().map(|s| (s.marker, s.payload(bytes).to_vec())).collect()
    }

    fn kinds(bytes: &[u8]) -> Vec<String> {
        header_segments(bytes)
            .iter()
            .map(|(m, p)| {
                let id = [JFIF_ID, EXIF_ID, XMP_ID, ICC_ID, MPF_ID, ISO_21496_ID].into_iter().find(|id| p.starts_with(id));
                match (m, id) {
                    (_, Some(id)) => format!("{:02X} {}", m, String::from_utf8_lossy(&id[..id.len().min(12)]).trim_end_matches('\0')),
                    _ => format!("{m:02X}"),
                }
            })
            .collect()
    }

    fn find<'a>(segs: &'a [(u8, Vec<u8>)], marker: u8, id: &[u8]) -> &'a [u8] {
        let (_, p) = segs.iter().find(|(m, p)| *m == marker && p.starts_with(id)).expect("segment");
        &p[id.len()..]
    }

    /// The value of `name="..."` in an XMP packet.
    fn attr(xmp: &str, name: &str) -> String {
        let key = format!(" {name}=\"");
        let at = xmp.find(&key).unwrap_or_else(|| panic!("{name} missing")) + key.len();
        xmp[at..at + xmp[at..].find('"').unwrap()].to_string()
    }

    /// A check that the XMP is well-formed: every element closes in order
    /// and attribute quotes balance. A full XML parser is not available.
    fn assert_well_formed(xml: &str) {
        let mut stack: Vec<String> = Vec::new();
        let mut rest = xml;
        while let Some(lt) = rest.find('<') {
            let gt = rest[lt..].find('>').expect("unclosed tag") + lt;
            let tag = &rest[lt + 1..gt];
            assert_eq!(tag.matches('"').count() % 2, 0, "quotes in <{tag}>");
            if let Some(name) = tag.strip_prefix('/') {
                assert_eq!(stack.pop().as_deref(), Some(name), "closing {name}");
            } else if !tag.ends_with('/') {
                stack.push(tag.split_whitespace().next().unwrap().to_string());
            }
            rest = &rest[gt + 1..];
        }
        assert!(stack.is_empty(), "unclosed {stack:?}");
    }

    /// Read back the ISO 21496-1 metadata as `iso_21496_metadata` lays it out.
    fn read_iso(d: &[u8]) -> (u8, [f64; 7]) {
        assert_eq!(d.len(), 5 + 16 + 40);
        assert_eq!(&d[..4], &[0, 0, 0, 0]);
        let u = |o: usize| u32::from_be_bytes(d[o..o + 4].try_into().unwrap());
        let signed = |o: usize| u(o) as i32 as f64 / u(o + 4) as f64;
        let unsigned = |o: usize| u(o) as f64 / u(o + 4) as f64;
        (d[4], [unsigned(5), unsigned(13), signed(21), signed(29), unsigned(37), signed(45), signed(53)])
    }

    /// The MP entries: (attribute, size, offset) each.
    fn read_mpf(body: &[u8]) -> Vec<(u32, u32, u32)> {
        assert_eq!(&body[..4], b"MM\0\x2A");
        let u32_at = |o: usize| u32::from_be_bytes(body[o..o + 4].try_into().unwrap());
        let u16_at = |o: usize| u16::from_be_bytes(body[o..o + 2].try_into().unwrap());
        let ifd = u32_at(4) as usize;
        let count = u16_at(ifd) as usize;
        let mut entries_at = None;
        let mut images = None;
        for i in 0..count {
            let e = ifd + 2 + i * 12;
            match u16_at(e) {
                0xB000 => assert_eq!(&body[e + 8..e + 12], b"0100"),
                0xB001 => images = Some(u32_at(e + 8)),
                0xB002 => entries_at = Some(u32_at(e + 8) as usize),
                t => panic!("unexpected MPF tag {t:04X}"),
            }
        }
        let images = images.expect("NumberOfImages") as usize;
        let at = entries_at.expect("MPEntry");
        (0..images).map(|i| (u32_at(at + i * 16), u32_at(at + i * 16 + 4), u32_at(at + i * 16 + 8))).collect()
    }

    fn assemble() -> Vec<u8> {
        assemble_gain_map_jpeg(BASE_JPEG, GAIN_MAP_JPEG, &metadata()).unwrap()
    }

    #[test]
    fn the_test_jpegs_decode() {
        for (bytes, w, h) in [(BASE_JPEG, 16, 8), (GAIN_MAP_JPEG, 8, 8)] {
            let mut d = jpeg_decoder::Decoder::new(bytes);
            d.decode().unwrap();
            let info = d.info().unwrap();
            assert_eq!((info.width, info.height), (w, h));
        }
    }

    #[test]
    fn segments_are_in_order() {
        let file = assemble();
        assert_eq!(kinds(&file)[..4], ["E0 JFIF", "E1 http://ns.ad", "E2 urn:iso:std:", "E2 MPF"]);
        let primary_end = parse_jpeg(&file).unwrap().end;
        let gm = &file[primary_end..];
        assert_eq!(kinds(gm)[..3], ["E0 JFIF", "E1 http://ns.ad", "E2 urn:iso:std:"]);
        // The rest of each image's header is the original's, in its order.
        let rest = |b: &[u8]| kinds(b).into_iter().filter(|k| !k.starts_with('E')).collect::<Vec<_>>();
        assert_eq!(rest(&file), rest(BASE_JPEG));
        assert_eq!(rest(gm), rest(GAIN_MAP_JPEG));
    }

    #[test]
    fn xmp_is_well_formed_and_holds_the_values() {
        let file = assemble();
        let primary_end = parse_jpeg(&file).unwrap().end;
        let gm = &file[primary_end..];

        let p = header_segments(&file);
        let xmp = std::str::from_utf8(find(&p, APP1, XMP_ID)).unwrap();
        assert_well_formed(xmp);
        assert_eq!(attr(xmp, "hdrgm:Version"), "1.0");
        assert!(xmp.contains(r#"Item:Semantic="Primary""#));
        assert_eq!(attr(xmp, "Item:Length"), gm.len().to_string());
        assert!(xmp.find("Primary").unwrap() < xmp.find("GainMap").unwrap(), "primary first");

        let g = header_segments(gm);
        let xmp = std::str::from_utf8(find(&g, APP1, XMP_ID)).unwrap();
        assert_well_formed(xmp);
        let m = metadata();
        for (name, want) in [
            ("hdrgm:GainMapMin", m.gain_map_min),
            ("hdrgm:GainMapMax", m.gain_map_max),
            ("hdrgm:Gamma", m.gamma),
            ("hdrgm:OffsetSDR", m.offset_sdr),
            ("hdrgm:OffsetHDR", m.offset_hdr),
            ("hdrgm:HDRCapacityMin", m.hdr_capacity_min),
            ("hdrgm:HDRCapacityMax", m.hdr_capacity_max),
        ] {
            assert_eq!(attr(xmp, name).parse::<f64>().unwrap(), want, "{name}");
        }
        assert_eq!(attr(xmp, "hdrgm:Version"), "1.0");
        assert_eq!(attr(xmp, "hdrgm:BaseRenditionIsHDR"), "False");
    }

    /// The MP entries point exactly at each image's SOI…EOI, the second
    /// counted from the MP header's byte-order mark.
    #[test]
    fn mpf_points_at_the_gain_map() {
        let file = assemble();
        let j = parse_jpeg(&file).unwrap();
        let mpf = j.header.iter().find(|s| s.is(&file, APP2, MPF_ID)).unwrap();
        let header_at = mpf.start + 4 + MPF_ID.len();
        let entries = read_mpf(&file[header_at..mpf.end]);
        assert_eq!(entries.len(), 2);
        let (attr0, len0, off0) = entries[0];
        assert_eq!((attr0, off0), (MP_PRIMARY, 0));
        assert_eq!(len0 as usize, j.end, "primary runs from byte 0 to its EOI");
        let (attr1, len1, off1) = entries[1];
        assert_eq!(attr1, MP_GAIN_MAP);
        let start = header_at + off1 as usize;
        let image = &file[start..start + len1 as usize];
        assert_eq!(&image[..2], &[0xFF, SOI]);
        assert_eq!(&image[image.len() - 2..], &[0xFF, EOI]);
        assert_eq!(start + len1 as usize, file.len());
        assert_eq!(parse_jpeg(image).unwrap().end, image.len());
        let mut d = jpeg_decoder::Decoder::new(image);
        assert_eq!(d.decode().unwrap(), {
            let mut o = jpeg_decoder::Decoder::new(GAIN_MAP_JPEG);
            o.decode().unwrap()
        });
    }

    #[test]
    fn iso_segments_round_trip() {
        let file = assemble();
        let primary_end = parse_jpeg(&file).unwrap().end;
        assert_eq!(find(&header_segments(&file), APP2, ISO_21496_ID), &ISO_21496_VERSION_ONLY);
        let (flags, v) = read_iso(find(&header_segments(&file[primary_end..]), APP2, ISO_21496_ID));
        assert_eq!(flags, 0x40);
        let m = metadata();
        let want = [m.hdr_capacity_min, m.hdr_capacity_max, m.gain_map_min, m.gain_map_max, m.gamma, m.offset_sdr, m.offset_hdr];
        assert_eq!(v, want, "dyadic values are exact");
        // Others come back within the denominator's precision.
        let odd = GainMapMetadata { gain_map_min: -0.1234567, gain_map_max: 3.3333333, hdr_capacity_max: 3.3333333, ..m };
        let (_, v) = read_iso(&iso_21496_metadata(&odd));
        assert!((v[2] - odd.gain_map_min).abs() < 1e-8 && (v[3] - odd.gain_map_max).abs() < 1e-8, "{v:?}");
    }

    /// Cutting the file at the first EOI leaves the SDR picture, a plain
    /// JPEG that decodes to the base's pixels.
    #[test]
    fn the_primary_alone_is_the_base_jpeg() {
        let file = assemble();
        let end = parse_jpeg(&file).unwrap().end;
        let primary = &file[..end];
        let decode = |b: &[u8]| {
            let mut d = jpeg_decoder::Decoder::new(b);
            d.decode().unwrap()
        };
        assert_eq!(decode(primary), decode(BASE_JPEG));
        // A decoder that reads the whole file sees the first image.
        assert_eq!(decode(&file), decode(BASE_JPEG));
    }

    /// Exif and ICC segments in the base stay, in the places the formats
    /// put them, and old XMP, MPF and ISO segments are replaced.
    #[test]
    fn base_metadata_is_kept_and_stale_metadata_replaced() {
        let icc = crate::export::build_icc_profile(crate::color::ColorSpace::DisplayP3);
        let icc_seg = segment(APP2, &[ICC_ID, &[1, 1], &icc]).unwrap();
        let exif_seg = segment(APP1, &[EXIF_ID, b"MM\0\x2A\0\0\0\x08\0\0"]).unwrap();
        let old_xmp = segment(APP1, &[XMP_ID, b"<x:xmpmeta/>"]).unwrap();
        let old_mpf = segment(APP2, &[MPF_ID, b"MM\0\x2A"]).unwrap();
        // JFIF (20 bytes after SOI) then the extra segments, then the rest.
        let mut base = BASE_JPEG[..20].to_vec();
        for s in [&exif_seg, &old_xmp, &icc_seg, &old_mpf] {
            base.extend_from_slice(s);
        }
        base.extend_from_slice(&BASE_JPEG[20..]);
        base.extend_from_slice(b"trailing bytes after EOI");
        let mut gm = GAIN_MAP_JPEG[..20].to_vec();
        gm.extend_from_slice(&icc_seg);
        gm.extend_from_slice(&GAIN_MAP_JPEG[20..]);

        let file = assemble_gain_map_jpeg(&base, &gm, &metadata()).unwrap();
        assert_eq!(kinds(&file)[..6], ["E0 JFIF", "E1 Exif", "E1 http://ns.ad", "E2 urn:iso:std:", "E2 ICC_PROFILE", "E2 MPF"]);
        let segs = header_segments(&file);
        assert_eq!(segs.iter().filter(|(m, p)| *m == APP1 && p.starts_with(XMP_ID)).count(), 1);
        assert_eq!(segs.iter().filter(|(m, p)| *m == APP2 && p.starts_with(MPF_ID)).count(), 1);
        assert_eq!(&find(&segs, APP2, ICC_ID)[2..], &icc[..]);
        let end = parse_jpeg(&file).unwrap().end;
        let gm_kinds = kinds(&file[end..]);
        assert!(!gm_kinds.iter().any(|k| k.contains("ICC")), "{gm_kinds:?}");
        let mpf = parse_jpeg(&file).unwrap().header.into_iter().find(|s| s.is(&file, APP2, MPF_ID)).unwrap();
        let header_at = mpf.start + 8;
        let e = read_mpf(&file[header_at..mpf.end]);
        assert_eq!(header_at + e[1].2 as usize, end);
        assert_eq!(end + e[1].1 as usize, file.len(), "the base's trailing bytes are gone");
    }

    /// Progressive JPEGs (several scans, tables between them) and restart
    /// markers parse too.
    #[test]
    fn progressive_and_restart_jpegs_parse() {
        use jpeg_encoder::{ColorType, Encoder};
        let rgb: Vec<u8> = (0..32 * 24 * 3).map(|i| (i * 7 % 251) as u8).collect();
        for progressive in [false, true] {
            let mut bytes = Vec::new();
            let mut e = Encoder::new(&mut bytes, 80);
            e.set_progressive(progressive);
            e.set_restart_interval(2);
            e.encode(&rgb, 32, 24, ColorType::Rgb).unwrap();
            let file = assemble_gain_map_jpeg(&bytes, GAIN_MAP_JPEG, &metadata()).unwrap();
            let end = parse_jpeg(&file).unwrap().end;
            let mut d = jpeg_decoder::Decoder::new(&file[..end]);
            let mut o = jpeg_decoder::Decoder::new(&bytes[..]);
            assert_eq!(d.decode().unwrap(), o.decode().unwrap());
        }
    }

    /// Every truncation and a sweep of corruptions of both inputs give an
    /// error or a file, never a panic or a hang.
    #[test]
    fn malformed_input_is_an_error_not_a_panic() {
        let m = metadata();
        for cut in 0..BASE_JPEG.len() {
            assert!(assemble_gain_map_jpeg(&BASE_JPEG[..cut], GAIN_MAP_JPEG, &m).is_err(), "base cut at {cut}");
        }
        for cut in 0..GAIN_MAP_JPEG.len() {
            assert!(assemble_gain_map_jpeg(BASE_JPEG, &GAIN_MAP_JPEG[..cut], &m).is_err(), "map cut at {cut}");
        }
        for i in 0..BASE_JPEG.len() {
            for v in [0x00, 0xFF, 0xD8, 0xD9, 0xDA, 0x7F] {
                let mut b = BASE_JPEG.to_vec();
                b[i] = v;
                let _ = assemble_gain_map_jpeg(&b, GAIN_MAP_JPEG, &m);
                let _ = assemble_gain_map_jpeg(GAIN_MAP_JPEG, &b, &m);
            }
        }
        assert!(assemble_gain_map_jpeg(b"", b"", &m).is_err());
        assert!(assemble_gain_map_jpeg(&[0xFF, 0xD8, 0xFF, 0xD9], GAIN_MAP_JPEG, &m).is_err());
        // A segment longer than its file.
        assert!(parse_jpeg(&[0xFF, 0xD8, 0xFF, 0xE0, 0xFF, 0xFF, 0, 0]).is_err());
        // A length below 2.
        assert!(parse_jpeg(&[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x01, 0xFF, 0xD9]).is_err());
    }

    #[test]
    fn invalid_metadata_is_an_error() {
        let m = metadata();
        for bad in [
            GainMapMetadata { gain_map_min: f64::NAN, ..m },
            GainMapMetadata { gain_map_min: 3.0, ..m },
            GainMapMetadata { gamma: 0.0, ..m },
            GainMapMetadata { offset_sdr: -1.0, ..m },
            GainMapMetadata { hdr_capacity_max: 0.0, ..m },
            GainMapMetadata { base_rendition_is_hdr: true, ..m },
        ] {
            assert!(assemble_gain_map_jpeg(BASE_JPEG, GAIN_MAP_JPEG, &bad).is_err(), "{bad:?}");
        }
    }
}
