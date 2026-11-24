//! HDR PNG: 16-bit RGB(A) in BT.2100 PQ, Rec. 2020 primaries.
//!
//! The input is linear light in Rec. 2020 primaries where 1.0 is SDR
//! reference white and values above it are highlights. Reference white is
//! placed at `sdr_white_nits` (203 cd/m² by default, ITU-R BT.2408) and the
//! result is encoded with the PQ curve of SMPTE ST 2084 / ITU-R BT.2100.
//!
//! The file is tagged with the chunks of the PNG Third Edition (W3C, 2025):
//! `cICP` (9, 16, 0, 1: BT.2020 primaries, PQ, RGB, full range), `mDCV`
//! (mastering display colour volume) and `cLLI` (content light level), all
//! between `IHDR` and `IDAT` in that order.
//!
//! There is no `iCCP`. No small standard ICC profile describes PQ, and a
//! profile that only approximates it would make readers that ignore `cICP`
//! show a confidently wrong picture; without one they show an untagged
//! picture, which is no worse and is recognisably not the intended one.

use crate::colorimetry::{D65_XY, REC2020_PRIMARIES_XY};
use crate::export::PngChunk;

/// ITU-R BT.2408's reference white for HDR signals, in cd/m².
pub const DEFAULT_SDR_WHITE_NITS: f32 = 203.0;

/// The luminance PQ's code value 1.0 stands for, in cd/m².
pub const PQ_PEAK_NITS: f64 = 10000.0;

/// The mastering display's minimum luminance written in `mDCV`, in cd/m².
/// The writer cannot know the grading display's black, so it states the
/// lowest value the field can carry, 0.0001 cd/m² (one unit).
pub const MASTERING_MIN_NITS: f64 = 0.0001;

// SMPTE ST 2084 constants, as the exact rationals the standard gives.
const M1: f64 = 2610.0 / 16384.0;
const M2: f64 = 2523.0 / 4096.0 * 128.0;
const C1: f64 = 3424.0 / 4096.0;
const C2: f64 = 2413.0 / 4096.0 * 32.0;
const C3: f64 = 2392.0 / 4096.0 * 32.0;

/// The PQ inverse EOTF: luminance as a fraction of 10000 cd/m² (0..1) to
/// the non-linear signal (0..1). Values outside 0..1 are clamped.
pub fn pq_encode(y: f64) -> f64 {
    let y = if y.is_nan() { 0.0 } else { y.clamp(0.0, 1.0) };
    let p = y.powf(M1);
    ((C1 + C2 * p) / (1.0 + C3 * p)).powf(M2)
}

/// The PQ EOTF: signal (0..1) to luminance as a fraction of 10000 cd/m².
pub fn pq_decode(e: f64) -> f64 {
    let e = if e.is_nan() { 0.0 } else { e.clamp(0.0, 1.0) };
    let p = e.powf(1.0 / M2);
    ((p - C1).max(0.0) / (C2 - C3 * p)).powf(1.0 / M1)
}

/// Light levels of a picture in cd/m², as CTA-861.3 defines them for
/// `cLLI`: MaxCLL is the brightest component (the largest of R, G and B)
/// of any pixel; MaxFALL is the frame average of that per-pixel maximum.
/// A still image is one frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LightLevel {
    pub max_cll: f64,
    pub max_fall: f64,
}

/// Measure `pixels` (linear Rec. 2020 RGBA, 1.0 = SDR white) with white at
/// `sdr_white_nits`. Each component is clamped to 0..10000 cd/m² first,
/// the range PQ can carry, so the numbers describe the file.
pub fn light_level(pixels: &[f32], sdr_white_nits: f32) -> LightLevel {
    let scale = sdr_white_nits as f64;
    let (mut peak, mut sum, mut n) = (0.0f64, 0.0f64, 0usize);
    for px in pixels.chunks_exact(4) {
        let m = px[0].max(px[1]).max(px[2]).max(0.0) as f64 * scale;
        let m = m.min(PQ_PEAK_NITS);
        peak = peak.max(m);
        sum += m;
        n += 1;
    }
    LightLevel { max_cll: peak, max_fall: if n == 0 { 0.0 } else { sum / n as f64 } }
}

/// The PQ curve as a table over the bits of an f32, which makes encoding a
/// table read and one interpolation per channel. PQ rises like a small
/// power near black, so a table even in linear light would need millions
/// of entries there; one indexed by exponent and the top ten mantissa bits
/// spaces its entries evenly in log luminance instead, and within each
/// 1/1024 of an octave the curve is smooth enough that interpolation lands
/// within a hundredth of a 16-bit step.
struct PqTable {
    /// 16-bit code value (0..65535, unrounded) at 2^e · (1 + m / 1024) for
    /// e in TABLE_MIN_EXP..0 and m in 0..1024, then at 1.0.
    codes: Vec<f32>,
}

/// The table covers luminance from 2^-30 of 10000 cd/m² (about 1e-5
/// cd/m²) to 10000 cd/m²; below that the curve is computed directly.
const TABLE_MIN_EXP: i32 = -30;
const MANTISSA_BITS: u32 = 10;

impl PqTable {
    fn new() -> Self {
        let octaves = (-TABLE_MIN_EXP) as usize;
        let per = 1usize << MANTISSA_BITS;
        let codes = (0..=octaves * per)
            .map(|i| {
                let e = (i / per) as i32 + TABLE_MIN_EXP;
                let m = (i % per) as f64 / per as f64;
                let y = 2f64.powi(e) * (1.0 + m);
                (pq_encode(y) * 65535.0) as f32
            })
            .collect();
        Self { codes }
    }

    /// Luminance as a fraction of 10000 cd/m² to a 16-bit PQ code value.
    #[inline]
    fn code(&self, y: f32) -> u16 {
        // NaN and negatives fail this test and encode as black.
        if !(y > 0.0) {
            return PQ_BLACK_CODE;
        }
        if y >= 1.0 {
            return 65535;
        }
        let bits = y.to_bits();
        let e = ((bits >> 23) as i32) - 127;
        if e < TABLE_MIN_EXP {
            return (pq_encode(y as f64) * 65535.0 + 0.5) as u16;
        }
        let shift = 23 - MANTISSA_BITS;
        let i = (((e - TABLE_MIN_EXP) as usize) << MANTISSA_BITS) | ((bits >> shift) as usize & ((1 << MANTISSA_BITS) - 1));
        let frac = (bits & ((1 << shift) - 1)) as f32 / (1u32 << shift) as f32;
        let (a, b) = (self.codes[i], self.codes[i + 1]);
        (a + (b - a) * frac + 0.5) as u16
    }
}

/// PQ's value for zero luminance, (C1)^M2 ≈ 7e-7, rounds to code 0.
const PQ_BLACK_CODE: u16 = 0;

/// `mDCV` for a Rec. 2020, D65 mastering display. Chromaticities are in
/// units of 0.00002 (red, green, blue, then white), luminances in units of
/// 0.0001 cd/m² (maximum, then minimum), all big-endian, as the PNG Third
/// Edition defines the chunk.
pub fn mdcv_chunk(max_nits: f64, min_nits: f64) -> PngChunk {
    let mut data = Vec::with_capacity(24);
    let xy = |v: f64| ((v * 50000.0).round() as u16).to_be_bytes();
    for (x, y) in REC2020_PRIMARIES_XY.iter().copied().chain(std::iter::once(D65_XY)) {
        data.extend_from_slice(&xy(x));
        data.extend_from_slice(&xy(y));
    }
    data.extend_from_slice(&nits_units(max_nits).to_be_bytes());
    data.extend_from_slice(&nits_units(min_nits).to_be_bytes());
    PngChunk { kind: *b"mDCV", data }
}

/// `cLLI`: MaxCLL then MaxFALL, each in units of 0.0001 cd/m², big-endian.
pub fn clli_chunk(level: LightLevel) -> PngChunk {
    let mut data = Vec::with_capacity(8);
    data.extend_from_slice(&nits_units(level.max_cll).to_be_bytes());
    data.extend_from_slice(&nits_units(level.max_fall).to_be_bytes());
    PngChunk { kind: *b"cLLI", data }
}

fn nits_units(nits: f64) -> u32 {
    (nits.max(0.0) * 10000.0).round().min(u32::MAX as f64) as u32
}

/// The colour chunks of a PQ PNG for a picture with light levels `level`,
/// in the order they are written.
///
/// The mastering display's peak is the picture's own peak (MaxCLL), but
/// never below reference white and rounded up to a whole cd/m². The
/// grading display is not known; the picture's peak is what a reader that
/// tone maps from `mDCV` needs, because it says how far the content goes,
/// where a conventional fixed 1000 cd/m² would make a reader compress
/// highlights a picture with a lower peak does not have.
pub fn pq_png_chunks(level: LightLevel, sdr_white_nits: f32) -> Vec<PngChunk> {
    let peak = level.max_cll.max(sdr_white_nits as f64).ceil().min(PQ_PEAK_NITS);
    vec![
        PngChunk { kind: *b"cICP", data: vec![9, 16, 0, 1] },
        mdcv_chunk(peak, MASTERING_MIN_NITS),
        clli_chunk(level),
    ]
}

/// Encode a linear Rec. 2020 float image as a 16-bit BT.2100 PQ PNG.
///
/// `pixels` is RGBA, four f32 per pixel, row-major from the top-left,
/// `width * height * 4` values: linear light in Rec. 2020 primaries with
/// 1.0 at SDR reference white, which lands at `sdr_white_nits` cd/m²
/// (`DEFAULT_SDR_WHITE_NITS` is BT.2408's 203). Anything brighter than
/// 10000 cd/m² clips there; negative components (outside Rec. 2020's
/// gamut) and NaN clip to black. Alpha is straight (not premultiplied),
/// 0..1, and stored linearly; when every pixel is opaque the file is RGB.
pub fn encode_pq_png(pixels: &[f32], width: u32, height: u32, sdr_white_nits: f32) -> Result<Vec<u8>, String> {
    if width == 0 || height == 0 {
        return Err("image has no pixels".into());
    }
    let count = (width as usize)
        .checked_mul(height as usize)
        .and_then(|n| n.checked_mul(4))
        .ok_or("image is too large")?;
    if pixels.len() != count {
        return Err(format!("expected {count} floats for {width}×{height} RGBA, got {}", pixels.len()));
    }
    if !(sdr_white_nits.is_finite() && sdr_white_nits > 0.0 && sdr_white_nits as f64 <= PQ_PEAK_NITS) {
        return Err(format!("SDR white must be between 0 and 10000 cd/m², got {sdr_white_nits}"));
    }

    let level = light_level(pixels, sdr_white_nits);
    let opaque = pixels.chunks_exact(4).all(|p| p[3] >= 1.0);
    let channels = if opaque { 3 } else { 4 };
    let samples = encode_pq_samples(pixels, sdr_white_nits, opaque);

    let mut buf = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut buf, width, height);
        encoder.set_color(if channels == 3 { png::ColorType::Rgb } else { png::ColorType::Rgba });
        encoder.set_depth(png::BitDepth::Sixteen);
        let mut writer = encoder.write_header().map_err(|e| format!("PNG header: {e}"))?;
        for chunk in pq_png_chunks(level, sdr_white_nits) {
            writer
                .write_chunk(png::chunk::ChunkType(chunk.kind), &chunk.data)
                .map_err(|e| format!("PNG {}: {e}", String::from_utf8_lossy(&chunk.kind)))?;
        }
        writer.write_image_data(&samples).map_err(|e| format!("PNG write: {e}"))?;
    }
    Ok(buf)
}

/// The image's samples as big-endian 16-bit PNG bytes: RGB in PQ, and
/// alpha (unless `opaque`) scaled linearly to 0..65535.
fn encode_pq_samples(pixels: &[f32], sdr_white_nits: f32, opaque: bool) -> Vec<u8> {
    let table = PqTable::new();
    let scale = (sdr_white_nits as f64 / PQ_PEAK_NITS) as f32;
    let channels = if opaque { 3 } else { 4 };
    let mut out = vec![0u8; pixels.len() / 4 * channels * 2];
    for (px, dst) in pixels.chunks_exact(4).zip(out.chunks_exact_mut(channels * 2)) {
        for c in 0..3 {
            dst[c * 2..c * 2 + 2].copy_from_slice(&table.code(px[c] * scale).to_be_bytes());
        }
        if !opaque {
            let a = if px[3].is_nan() { 0.0 } else { px[3].clamp(0.0, 1.0) };
            dst[6..8].copy_from_slice(&((a * 65535.0 + 0.5) as u16).to_be_bytes());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read_u32(d: &[u8], o: usize) -> u32 {
        u32::from_be_bytes([d[o], d[o + 1], d[o + 2], d[o + 3]])
    }

    /// Every chunk of a PNG with its CRC checked.
    fn png_chunks(png: &[u8]) -> Vec<([u8; 4], Vec<u8>)> {
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        let mut out = Vec::new();
        let mut i = 8;
        while i < png.len() {
            let len = read_u32(png, i) as usize;
            let kind: [u8; 4] = png[i + 4..i + 8].try_into().unwrap();
            let mut crc = flate2::Crc::new();
            crc.update(&png[i + 4..i + 8 + len]);
            assert_eq!(crc.sum(), read_u32(png, i + 8 + len), "{} CRC", String::from_utf8_lossy(&kind));
            out.push((kind, png[i + 8..i + 8 + len].to_vec()));
            i += 12 + len;
        }
        assert_eq!(i, png.len());
        out
    }

    /// ST 2084's curve at the luminances BT.2100 and BT.2408 tabulate.
    #[test]
    fn pq_matches_published_values() {
        for (nits, code) in [(0.0, 0.0), (100.0, 0.5081), (203.0, 0.5807), (1000.0, 0.7518), (10000.0, 1.0)] {
            let e = pq_encode(nits / PQ_PEAK_NITS);
            assert!((e - code).abs() < 5e-5, "{nits} cd/m²: {e} vs {code}");
        }
        // 1000 cd/m² is code 769 of 1023 in full-range 10-bit.
        assert_eq!((pq_encode(0.1) * 1023.0).round(), 769.0);
    }

    #[test]
    fn pq_inverts() {
        // Zero luminance is signal (C1)^M2 ≈ 7e-7, not 0, so the signal
        // round trip starts above it.
        for i in 1..=2000 {
            let e = i as f64 / 2000.0;
            assert!((pq_encode(pq_decode(e)) - e).abs() < 1e-9, "{e}");
        }
        for nits in [1e-4, 0.01, 1.0, 50.0, 203.0, 812.0, 4000.0, 9999.0] {
            let y = nits / PQ_PEAK_NITS;
            assert!((pq_decode(pq_encode(y)) / y - 1.0).abs() < 1e-9, "{nits}");
        }
    }

    /// The table puts every value within rounding of the exact curve.
    #[test]
    fn table_is_within_rounding_of_the_curve() {
        let t = PqTable::new();
        let mut s: u32 = 0x1234_5678;
        let mut worst = 0.0f64;
        for i in 0..400_000 {
            s ^= s << 13;
            s ^= s >> 17;
            s ^= s << 5;
            // Spread over 40 octaves so the foot, below the table, is hit too.
            let y = if i % 2 == 0 { (s as f32 / u32::MAX as f32).powi(8) } else { s as f32 / u32::MAX as f32 };
            let got = t.code(y) as f64;
            let exact = pq_encode(y as f64) * 65535.0;
            worst = worst.max((got - exact).abs());
        }
        assert!(worst <= 0.51, "{worst} steps from the curve");
        assert_eq!(t.code(0.0), 0);
        assert_eq!(t.code(-1.0), 0);
        assert_eq!(t.code(f32::NAN), 0);
        assert_eq!(t.code(1.0), 65535);
        assert_eq!(t.code(7.0), 65535);
    }

    #[test]
    fn light_levels_of_a_known_image() {
        // Four pixels: white, a 4× red highlight, black, and one with a
        // negative component and a 2× blue.
        let px = [
            1.0, 1.0, 1.0, 1.0, //
            4.0, 0.5, 0.25, 1.0, //
            0.0, 0.0, 0.0, 1.0, //
            -0.5, 0.0, 2.0, 1.0,
        ];
        let l = light_level(&px, 203.0);
        assert!((l.max_cll - 812.0).abs() < 1e-9, "{l:?}");
        assert!((l.max_fall - (203.0 + 812.0 + 0.0 + 406.0) / 4.0).abs() < 1e-9, "{l:?}");
        // The ceiling is PQ's: 100× white at 203 cd/m² is 20300, clipped.
        assert_eq!(light_level(&[100.0, 0.0, 0.0, 1.0], 203.0).max_cll, 10000.0);
        let chunk = clli_chunk(l);
        assert_eq!(read_u32(&chunk.data, 0), 8_120_000);
        assert_eq!(read_u32(&chunk.data, 4), 3_552_500);
    }

    fn sample_image() -> (Vec<f32>, u32, u32) {
        let (w, h) = (5u32, 3u32);
        let mut px = Vec::new();
        for y in 0..h {
            for x in 0..w {
                let v = (x + y * w) as f32 / 4.0;
                px.extend_from_slice(&[v, v * 0.5, 0.1, 1.0]);
            }
        }
        (px, w, h)
    }

    #[test]
    fn chunks_are_in_order_with_correct_crcs_and_values() {
        let (px, w, h) = sample_image();
        let png = encode_pq_png(&px, w, h, DEFAULT_SDR_WHITE_NITS).unwrap();
        let chunks = png_chunks(&png);
        let kinds: Vec<String> = chunks.iter().map(|(k, _)| String::from_utf8_lossy(k).into_owned()).collect();
        assert_eq!(kinds, ["IHDR", "cICP", "mDCV", "cLLI", "IDAT", "IEND"]);
        assert_eq!(chunks[0].1[8], 16, "bit depth");
        assert_eq!(chunks[0].1[9], 2, "colour type RGB: every pixel is opaque");
        assert_eq!(chunks[1].1, [9, 16, 0, 1]);
        let m = &chunks[2].1;
        assert_eq!(m.len(), 24);
        let u16_at = |o: usize| u16::from_be_bytes([m[o], m[o + 1]]);
        assert_eq!([0, 2, 4, 6, 8, 10, 12, 14].map(u16_at), [35400, 14600, 8500, 39850, 6550, 2300, 15635, 16450]);
        // Peak: 14 / 4 = 3.5 × 203 = 710.5 cd/m², rounded up.
        assert_eq!(read_u32(m, 16), 7_110_000);
        assert_eq!(read_u32(m, 20), 1);
        assert_eq!(read_u32(&chunks[3].1, 0), 7_105_000);
    }

    /// The `png` crate reads the file back with the tags and the pixels.
    #[test]
    fn png_crate_reads_it_back() {
        let (mut px, w, h) = sample_image();
        px[3] = 0.5; // one translucent pixel: the file is RGBA
        let png = encode_pq_png(&px, w, h, DEFAULT_SDR_WHITE_NITS).unwrap();
        let mut reader = png::Decoder::new(std::io::Cursor::new(&png)).read_info().unwrap();
        let mut buf = vec![0; reader.output_buffer_size()];
        reader.next_frame(&mut buf).unwrap();
        let info = reader.info();
        assert_eq!(info.color_type, png::ColorType::Rgba);
        assert_eq!(info.bit_depth, png::BitDepth::Sixteen);
        let cicp = info.coding_independent_code_points.expect("cICP");
        assert_eq!((cicp.color_primaries, cicp.transfer_function, cicp.matrix_coefficients), (9, 16, 0));
        assert!(cicp.is_video_full_range_image);
        let mdcv = info.mastering_display_color_volume.expect("mDCV");
        assert!((mdcv.chromaticities.red.0.into_value() - 0.708).abs() < 1e-6);
        assert!((mdcv.chromaticities.white.1.into_value() - 0.329).abs() < 1e-6);
        assert_eq!(mdcv.min_luminance, 1);
        let clli = info.content_light_level.expect("cLLI");
        assert_eq!(clli.max_content_light_level, 7_105_000);
        assert!(info.icc_profile.is_none());
        for (i, src) in px.chunks_exact(4).enumerate() {
            let got = |c: usize| u16::from_be_bytes([buf[i * 8 + c * 2], buf[i * 8 + c * 2 + 1]]);
            for c in 0..3 {
                let want = (pq_encode(src[c] as f64 * 203.0 / PQ_PEAK_NITS) * 65535.0).round() as u16;
                assert_eq!(got(c), want, "pixel {i} channel {c}");
            }
            assert_eq!(got(3), (src[3] * 65535.0).round() as u16);
        }
        // SDR white is PQ 0.5807.
        assert!((pq_decode(u16::from_be_bytes([buf[32], buf[33]]) as f64 / 65535.0) * PQ_PEAK_NITS - 203.0).abs() < 0.1);
    }

    #[test]
    fn bad_input_is_an_error() {
        assert!(encode_pq_png(&[0.0; 4], 0, 1, 203.0).is_err());
        assert!(encode_pq_png(&[0.0; 4], 2, 1, 203.0).is_err());
        assert!(encode_pq_png(&[0.0; 8], 2, 1, 0.0).is_err());
        assert!(encode_pq_png(&[0.0; 8], 2, 1, f32::NAN).is_err());
        assert!(encode_pq_png(&[0.0; 8], u32::MAX, u32::MAX, 203.0).is_err());
        assert!(encode_pq_png(&[0.0; 8], 2, 1, 203.0).is_ok());
    }
}
