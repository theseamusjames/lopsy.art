//! A 16-bit TIFF writer (spec E10): baseline TIFF 6.0, little-endian, one
//! image of 16-bit RGBA (unassociated alpha, as `encode_png_16` writes),
//! Deflate compression (8, zlib streams) with the horizontal differencing
//! predictor (2), strips of about 1 MB of raw pixels, and the export's ICC
//! profile embedded in tag 34675, as TIFF readers expect.

use crate::color::ColorSpace;
use crate::export::build_icc_profile;

/// Raw (uncompressed) bytes a strip aims for. A strip of 1 MB is small
/// enough for any reader to hold and large enough that the per-strip cost of
/// starting a zlib stream stays negligible: at 64 KB a 40-megapixel photo
/// has one row a strip, and the export takes over half as long again.
pub const STRIP_TARGET_BYTES: usize = 1024 * 1024;

const SAMPLES: usize = 4;

/// Encode `pixels` (RGBA u16, `width`×`height`, row-major) as a TIFF tagged
/// with `color_space`'s ICC profile.
pub fn encode_tiff_16(pixels: &[u16], width: u32, height: u32, color_space: ColorSpace) -> Result<Vec<u8>, String> {
    let (w, h) = (width as usize, height as usize);
    if w == 0 || h == 0 {
        return Err("TIFF: empty image".to_string());
    }
    let expected = w
        .checked_mul(h)
        .and_then(|n| n.checked_mul(SAMPLES))
        .ok_or("TIFF: image size overflows")?;
    if pixels.len() < expected {
        return Err(format!("TIFF: pixel data too short: expected {expected} u16 values, got {}", pixels.len()));
    }
    let row_bytes = w.checked_mul(SAMPLES * 2).ok_or("TIFF: image size overflows")?;
    let rows_per_strip = (STRIP_TARGET_BYTES / row_bytes).clamp(1, h);
    let strip_count = h.div_ceil(rows_per_strip);

    let mut out: Vec<u8> = Vec::new();
    out.extend_from_slice(b"II");
    out.extend_from_slice(&42u16.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes()); // IFD offset, patched below

    let mut strip_offsets = Vec::with_capacity(strip_count);
    let mut strip_counts = Vec::with_capacity(strip_count);
    let mut raw = vec![0u8; rows_per_strip * row_bytes];
    // Level 1 is miniz_oxide's single-probe greedy matcher. The default
    // level 6 searches long hash chains, which on a 40-megapixel photo takes
    // eight to nine times as long, blocking the page for the whole export,
    // for a file 4% to 21% smaller (more on smooth pictures, less on noisy
    // ones). The 16-bit PNG export uses a fast single-pass Deflate for the
    // same reason.
    let mut z = flate2::Compress::new(flate2::Compression::fast(), true);
    for s in 0..strip_count {
        let y0 = s * rows_per_strip;
        let y1 = (y0 + rows_per_strip).min(h);
        let raw = &mut raw[..(y1 - y0) * row_bytes];
        for (y, dst) in (y0..y1).zip(raw.chunks_exact_mut(row_bytes)) {
            predict_row(&pixels[y * w * SAMPLES..(y + 1) * w * SAMPLES], dst);
        }
        pad_even(&mut out);
        let at = out.len();
        deflate_into(&mut z, raw, &mut out)?;
        strip_offsets.push(at as u32);
        strip_counts.push((out.len() - at) as u32);
    }

    // Values too large for an IFD entry go before the IFD.
    let icc = build_icc_profile(color_space);
    let put = |out: &mut Vec<u8>, bytes: &[u8]| -> u32 {
        pad_even(out);
        let at = out.len() as u32;
        out.extend_from_slice(bytes);
        at
    };
    let bits_at = put(&mut out, &[16u16; 4].iter().flat_map(|v| v.to_le_bytes()).collect::<Vec<_>>());
    let res_at = put(&mut out, &[72u32, 1].iter().flat_map(|v| v.to_le_bytes()).collect::<Vec<_>>());
    let offsets_at = (strip_count > 1)
        .then(|| put(&mut out, &strip_offsets.iter().flat_map(|v| v.to_le_bytes()).collect::<Vec<_>>()));
    let counts_at = (strip_count > 1)
        .then(|| put(&mut out, &strip_counts.iter().flat_map(|v| v.to_le_bytes()).collect::<Vec<_>>()));
    let icc_at = put(&mut out, &icc);

    const SHORT: u16 = 3;
    const LONG: u16 = 4;
    const RATIONAL: u16 = 5;
    const UNDEFINED: u16 = 7;
    // (tag, type, count, value or offset), in ascending tag order.
    let entries: Vec<(u16, u16, u32, u32)> = vec![
        (256, LONG, 1, width),
        (257, LONG, 1, height),
        (258, SHORT, 4, bits_at),
        (259, SHORT, 1, 8),
        (262, SHORT, 1, 2),
        (273, LONG, strip_count as u32, offsets_at.unwrap_or(strip_offsets[0])),
        (277, SHORT, 1, SAMPLES as u32),
        (278, LONG, 1, rows_per_strip as u32),
        (279, LONG, strip_count as u32, counts_at.unwrap_or(strip_counts[0])),
        (282, RATIONAL, 1, res_at),
        (283, RATIONAL, 1, res_at),
        (284, SHORT, 1, 1),
        (296, SHORT, 1, 2),
        (317, SHORT, 1, 2),
        (338, SHORT, 1, 2),
        (34675, UNDEFINED, icc.len() as u32, icc_at),
    ];
    pad_even(&mut out);
    let ifd_at = out.len() as u32;
    out[4..8].copy_from_slice(&ifd_at.to_le_bytes());
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    for (tag, kind, count, value) in entries {
        out.extend_from_slice(&tag.to_le_bytes());
        out.extend_from_slice(&kind.to_le_bytes());
        out.extend_from_slice(&count.to_le_bytes());
        if kind == SHORT && count == 1 {
            // A single SHORT sits in the first two bytes of the value field.
            out.extend_from_slice(&(value as u16).to_le_bytes());
            out.extend_from_slice(&[0, 0]);
        } else {
            out.extend_from_slice(&value.to_le_bytes());
        }
    }
    out.extend_from_slice(&0u32.to_le_bytes()); // no next IFD
    // Offsets are 32-bit. Every one written above is below the final length,
    // so if that fits, none of the `as u32` conversions truncated.
    if u32::try_from(out.len()).is_err() {
        return Err("TIFF: the file would exceed 4 GB, past what 32-bit offsets address".to_string());
    }
    Ok(out)
}

/// Write one row with predictor 2 applied: each sample minus the same
/// channel one pixel to its left, as 16-bit differences (wrapping), in the
/// file's little-endian byte order. The first pixel is stored as is.
fn predict_row(row: &[u16], dst: &mut [u8]) {
    let mut left = [0u16; SAMPLES];
    for (px, out) in row.chunks_exact(SAMPLES).zip(dst.chunks_exact_mut(SAMPLES * 2)) {
        for c in 0..SAMPLES {
            out[c * 2..c * 2 + 2].copy_from_slice(&px[c].wrapping_sub(left[c]).to_le_bytes());
            left[c] = px[c];
        }
    }
}

/// Append `raw` to `out` as one complete zlib stream, header included, as
/// each strip of a Deflate TIFF must be. The stream is compressed straight
/// into the file buffer, so no strip is copied after it is compressed.
fn deflate_into(z: &mut flate2::Compress, raw: &[u8], out: &mut Vec<u8>) -> Result<(), String> {
    z.reset();
    out.reserve(raw.len() / 2 + 64);
    loop {
        let read = z.total_in() as usize;
        let status = z
            .compress_vec(&raw[read..], out, flate2::FlushCompress::Finish)
            .map_err(|e| format!("TIFF deflate: {e}"))?;
        if status == flate2::Status::StreamEnd {
            return Ok(());
        }
        // `compress_vec` only fills spare capacity, so make room and go on.
        out.reserve(out.capacity().max(64 * 1024));
    }
}

fn pad_even(out: &mut Vec<u8>) {
    if out.len() % 2 == 1 {
        out.push(0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::io::Read;

    fn u16_at(b: &[u8], at: usize) -> u16 {
        u16::from_le_bytes([b[at], b[at + 1]])
    }
    fn u32_at(b: &[u8], at: usize) -> u32 {
        u32::from_le_bytes(b[at..at + 4].try_into().unwrap())
    }

    /// Tag → (type, count, raw value field).
    fn read_ifd(tiff: &[u8]) -> HashMap<u16, (u16, u32, u32)> {
        assert_eq!(&tiff[0..4], b"II*\0");
        let ifd = u32_at(tiff, 4) as usize;
        assert_eq!(ifd % 2, 0);
        let n = u16_at(tiff, ifd) as usize;
        let mut tags = HashMap::new();
        let mut last = 0u16;
        for i in 0..n {
            let e = ifd + 2 + i * 12;
            let tag = u16_at(tiff, e);
            assert!(tag > last, "tags must ascend");
            last = tag;
            tags.insert(tag, (u16_at(tiff, e + 2), u32_at(tiff, e + 4), u32_at(tiff, e + 8)));
        }
        assert_eq!(u32_at(tiff, ifd + 2 + n * 12), 0);
        tags
    }

    fn longs(tiff: &[u8], (_, count, value): (u16, u32, u32)) -> Vec<u32> {
        if count == 1 {
            return vec![value];
        }
        (0..count as usize).map(|i| u32_at(tiff, value as usize + i * 4)).collect()
    }

    /// Decode the whole image back to RGBA u16.
    fn decode(tiff: &[u8]) -> (u32, u32, Vec<u16>) {
        let t = read_ifd(tiff);
        let (w, h) = (t[&256].2, t[&257].2);
        let rows_per_strip = t[&278].2 as usize;
        let offsets = longs(tiff, t[&273]);
        let counts = longs(tiff, t[&279]);
        let mut px = Vec::new();
        for (s, (&off, &len)) in offsets.iter().zip(&counts).enumerate() {
            let mut raw = Vec::new();
            flate2::read::ZlibDecoder::new(&tiff[off as usize..(off + len) as usize]).read_to_end(&mut raw).unwrap();
            let rows = rows_per_strip.min(h as usize - s * rows_per_strip);
            assert_eq!(raw.len(), rows * w as usize * 8);
            for row in raw.chunks_exact(w as usize * 8) {
                let mut prev = [0u16; 4];
                for (i, c) in row.chunks_exact(2).enumerate() {
                    let v = u16::from_le_bytes([c[0], c[1]]).wrapping_add(prev[i % 4]);
                    prev[i % 4] = v;
                    px.push(v);
                }
            }
        }
        (w, h, px)
    }

    fn image(w: u32, h: u32) -> Vec<u16> {
        (0..w * h * 4).map(|i| (i.wrapping_mul(2_654_435_761) >> 7) as u16 ^ (i as u16).wrapping_mul(97)).collect()
    }

    /// A photo-like picture: smooth gradients per channel, noise in the low
    /// bits, and bands of the extreme values 0 and 65535, which make the
    /// predictor's differences wrap both ways.
    fn photo(w: u32, h: u32) -> Vec<u16> {
        let mut state = 0x9E37_79B9u32;
        let mut px = Vec::with_capacity((w * h * 4) as usize);
        for y in 0..h {
            for x in 0..w {
                for c in 0..4u32 {
                    state ^= state << 13;
                    state ^= state >> 17;
                    state ^= state << 5;
                    let v = if (x / 7 + c) % 5 == 0 {
                        if (x + y) % 2 == 0 { 0 } else { 65535 }
                    } else {
                        let ramp = (x * 50_000 / w + y * 15_000 / h.max(1) + c * 400) as i32;
                        (ramp + (state % 513) as i32 - 256).clamp(0, 65535)
                    };
                    px.push(v as u16);
                }
            }
        }
        px
    }

    /// Decode through the DNG reader's IFD parser, a second implementation
    /// of the tag layout, to check the file does not only agree with the
    /// reader written next to the writer.
    fn decode_with_dng_reader(tiff: &[u8]) -> (u32, u32, Vec<u16>) {
        let reader = crate::dng::tiff::TiffReader::new(tiff).unwrap();
        assert!(reader.is_little_endian());
        let ifd = reader.read_ifd(0).unwrap();
        let tag = |id: u16| ifd.iter().find(|e| e.tag == id).unwrap_or_else(|| panic!("tag {id}"));
        let (w, h) = (tag(256).as_u32().unwrap(), tag(257).as_u32().unwrap());
        assert_eq!(tag(258).as_u16_vec().unwrap(), vec![16; 4]);
        assert_eq!(tag(259).as_u16(), Some(8));
        assert_eq!(tag(317).as_u16(), Some(2));
        let rows_per_strip = tag(278).as_u32().unwrap() as usize;
        let offsets = tag(273).as_u32_vec().unwrap();
        let counts = tag(279).as_u32_vec().unwrap();
        assert_eq!(offsets.len(), (h as usize).div_ceil(rows_per_strip));
        let row_bytes = w as usize * 8;
        let mut px = Vec::with_capacity(w as usize * h as usize * 4);
        for (s, (&off, &len)) in offsets.iter().zip(&counts).enumerate() {
            let mut raw = Vec::new();
            flate2::read::ZlibDecoder::new(&tiff[off as usize..(off + len) as usize]).read_to_end(&mut raw).unwrap();
            let rows = rows_per_strip.min(h as usize - s * rows_per_strip);
            assert_eq!(raw.len(), rows * row_bytes, "strip {s}");
            for row in raw.chunks_exact(row_bytes) {
                let mut acc = [0u16; 4];
                for (p, d) in row.chunks_exact(8).enumerate() {
                    for c in 0..4 {
                        let diff = u16::from_le_bytes([d[c * 2], d[c * 2 + 1]]);
                        acc[c] = if p == 0 { diff } else { acc[c].wrapping_add(diff) };
                        px.push(acc[c]);
                    }
                }
            }
        }
        (w, h, px)
    }

    #[test]
    fn a_photo_round_trips_exactly_across_full_and_partial_strips() {
        // 1000 px is 8000 B a row: 131 rows a strip, so 300 rows are two full
        // strips and a last one of 38 rows; 100 rows fit in a single strip.
        for (w, h, strips) in [(1000u32, 300u32, 3usize), (1000, 100, 1), (1000, 262, 2)] {
            let px = photo(w, h);
            let tiff = encode_tiff_16(&px, w, h, ColorSpace::Rec2020).unwrap();
            let t = read_ifd(&tiff);
            assert_eq!(t[&278].2, 131.min(h));
            assert_eq!(t[&273].1 as usize, strips, "{w}x{h}");
            assert_eq!(decode_with_dng_reader(&tiff), (w, h, px.clone()), "{w}x{h}");
            assert_eq!(decode(&tiff), (w, h, px), "{w}x{h}");
        }
    }

    #[test]
    fn rows_wider_than_a_strip_get_a_strip_each() {
        // 140 000 px is 1.12 MB a row, past the strip target. The noise
        // barely compresses, so each strip's zlib stream outgrows the room
        // first reserved for it.
        let (w, h) = (140_000u32, 3u32);
        let px = image(w, h);
        let tiff = encode_tiff_16(&px, w, h, ColorSpace::Srgb).unwrap();
        let t = read_ifd(&tiff);
        assert_eq!((t[&278].2, t[&273].1), (1, 3));
        assert_eq!(decode_with_dng_reader(&tiff), (w, h, px));
    }

    #[test]
    fn tags_describe_a_deflated_16_bit_rgba_image_with_its_icc() {
        let (w, h) = (300u32, 1000u32);
        let px = image(w, h);
        let tiff = encode_tiff_16(&px, w, h, ColorSpace::DisplayP3).unwrap();
        let t = read_ifd(&tiff);
        assert_eq!((t[&256].2, t[&257].2), (300, 1000));
        let bits = t[&258];
        assert_eq!((bits.0, bits.1), (3, 4));
        assert!((0..4).all(|i| u16_at(&tiff, bits.2 as usize + i * 2) == 16));
        assert_eq!(t[&259].2 & 0xFFFF, 8, "Deflate");
        assert_eq!(t[&262].2 & 0xFFFF, 2, "RGB");
        assert_eq!(t[&277].2 & 0xFFFF, 4);
        assert_eq!(t[&317].2 & 0xFFFF, 2, "horizontal predictor");
        assert_eq!(t[&338].2 & 0xFFFF, 2, "unassociated alpha");
        assert_eq!(t[&284].2 & 0xFFFF, 1);
        // Strips of about 1 MB of raw rows: 300 px × 8 B = 2400 B a row.
        assert_eq!(t[&278].2, 436);
        assert_eq!(t[&273].1, 1000u32.div_ceil(436));
        let icc = t[&34675];
        assert_eq!(icc.0, 7);
        let profile = build_icc_profile(ColorSpace::DisplayP3);
        assert_eq!(&tiff[icc.2 as usize..icc.2 as usize + icc.1 as usize], &profile[..]);
    }

    #[test]
    fn strips_inflate_back_to_the_pixels() {
        for (w, h) in [(300u32, 200u32), (1, 1), (5000, 3), (17, 1000)] {
            let px = image(w, h);
            let tiff = encode_tiff_16(&px, w, h, ColorSpace::Srgb).unwrap();
            let (dw, dh, back) = decode(&tiff);
            assert_eq!((dw, dh), (w, h));
            assert_eq!(back, px, "{w}x{h}");
        }
    }

    #[test]
    fn sizes_that_overflow_are_errors() {
        assert!(encode_tiff_16(&[], u32::MAX, u32::MAX, ColorSpace::Srgb).is_err());
    }

    #[test]
    fn short_or_empty_input_is_an_error() {
        assert!(encode_tiff_16(&[0; 7], 1, 2, ColorSpace::Srgb).is_err());
        assert!(encode_tiff_16(&[], 0, 0, ColorSpace::Srgb).is_err());
    }
}
