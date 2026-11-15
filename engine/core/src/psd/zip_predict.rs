use flate2::read::ZlibDecoder;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use std::io::{Read, Write};

/// Encode a 16-bit channel plane using ZIP with prediction (PSD compression type 3).
///
/// Process per scanline:
/// 1. Apply horizontal differencing on the 16-bit values (wrapping u16):
///    first value unchanged, subsequent values = current - previous.
/// 2. Convert each delta to two big-endian bytes.
/// 3. Deflate the entire delta buffer.
///
/// Note the delta operates on 16-bit values, NOT on the byte stream —
/// byte-level differencing round-trips against itself but produces noise
/// in spec-conforming readers (Photoshop, GIMP, psd-tools).
pub fn zip_predict_encode_16(channel: &[u16], width: u32, height: u32) -> Vec<u8> {
    let w = width as usize;
    let h = height as usize;
    assert_eq!(channel.len(), w * h, "channel size mismatch");

    let row_bytes = w * 2;
    let mut delta_buf = Vec::with_capacity(row_bytes * h);

    for y in 0..h {
        let row = &channel[y * w..(y + 1) * w];

        let mut prev = 0u16;
        for (x, &val) in row.iter().enumerate() {
            let delta = if x == 0 { val } else { val.wrapping_sub(prev) };
            prev = val;
            delta_buf.extend_from_slice(&delta.to_be_bytes());
        }
    }

    // Deflate
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(&delta_buf).expect("zlib encode failed");
    encoder.finish().expect("zlib finish failed")
}

/// Decode a 16-bit channel plane from ZIP with prediction data.
pub fn zip_predict_decode_16(data: &[u8], width: u32, height: u32) -> Result<Vec<u16>, String> {
    let w = width as usize;
    let h = height as usize;
    let row_bytes = w * 2;
    let expected = row_bytes * h;

    // Inflate
    let mut decoder = ZlibDecoder::new(data);
    let mut delta_buf = Vec::with_capacity(expected);
    decoder.read_to_end(&mut delta_buf).map_err(|e| format!("zlib decode: {e}"))?;

    if delta_buf.len() != expected {
        return Err(format!(
            "decompressed size mismatch: got {} expected {expected}",
            delta_buf.len()
        ));
    }

    // Undo the 16-bit value-level delta per row.
    let mut result = Vec::with_capacity(w * h);

    for y in 0..h {
        let row_start = y * row_bytes;
        let row = &delta_buf[row_start..row_start + row_bytes];

        let mut acc = 0u16;
        for x in 0..w {
            let delta = u16::from_be_bytes([row[x * 2], row[x * 2 + 1]]);
            acc = if x == 0 { delta } else { acc.wrapping_add(delta) };
            result.push(acc);
        }
    }

    Ok(result)
}

/// Decode an 8-bit plane from ZIP with prediction data (byte-level delta
/// per row). `row_size` is bytes per row, `rows` the number of rows —
/// callers stacking multiple channels in one stream pass `h * channels`.
///
/// Validates the inflated length before un-delta'ing, mirroring the 16-bit
/// path — without the check a truncated/corrupt stream inflates short and
/// the row indexing panics, which under panic=abort kills the whole WASM
/// instance from user-supplied file data.
pub fn zip_predict_decode_8(data: &[u8], row_size: usize, rows: usize) -> Result<Vec<u8>, String> {
    let expected = row_size * rows;

    let mut decoder = ZlibDecoder::new(data);
    let mut delta_buf = Vec::with_capacity(expected);
    decoder.read_to_end(&mut delta_buf).map_err(|e| format!("zlib decode: {e}"))?;

    if delta_buf.len() != expected {
        return Err(format!(
            "decompressed size mismatch: got {} expected {expected}",
            delta_buf.len()
        ));
    }

    for y in 0..rows {
        let start = y * row_size;
        for x in 1..row_size {
            delta_buf[start + x] = delta_buf[start + x].wrapping_add(delta_buf[start + x - 1]);
        }
    }

    Ok(delta_buf)
}

/// Plain ZIP encode (compression type 2) for 8-bit mask data or other buffers.
pub fn zip_encode(data: &[u8]) -> Vec<u8> {
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(data).expect("zlib encode failed");
    encoder.finish().expect("zlib finish failed")
}

/// Plain ZIP decode.
pub fn zip_decode(data: &[u8], expected_len: usize) -> Result<Vec<u8>, String> {
    let mut decoder = ZlibDecoder::new(data);
    let mut out = Vec::with_capacity(expected_len);
    decoder.read_to_end(&mut out).map_err(|e| format!("zlib decode: {e}"))?;
    if out.len() != expected_len {
        return Err(format!("decompressed size mismatch: got {} expected {expected_len}", out.len()));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_constant() {
        let width = 10;
        let height = 5;
        let channel = vec![32768u16; (width * height) as usize];
        let encoded = zip_predict_encode_16(&channel, width, height);
        let decoded = zip_predict_decode_16(&encoded, width, height).unwrap();
        assert_eq!(decoded, channel);
    }

    #[test]
    fn roundtrip_gradient() {
        let width = 100;
        let height = 50;
        let channel: Vec<u16> = (0..(width * height) as u16).collect();
        let encoded = zip_predict_encode_16(&channel, width, height);
        let decoded = zip_predict_decode_16(&encoded, width, height).unwrap();
        assert_eq!(decoded, channel);
    }

    #[test]
    fn roundtrip_full_range() {
        let width = 256;
        let height = 1;
        let channel: Vec<u16> = (0..256).map(|i| (i * 257) as u16).collect();
        let encoded = zip_predict_encode_16(&channel, width, height);
        let decoded = zip_predict_decode_16(&encoded, width, height).unwrap();
        assert_eq!(decoded, channel);
    }

    #[test]
    fn roundtrip_multi_row() {
        let width = 4;
        let height = 3;
        let channel = vec![
            0, 100, 200, 65535,
            1000, 2000, 3000, 4000,
            65535, 0, 32768, 16384,
        ];
        let encoded = zip_predict_encode_16(&channel, width, height);
        let decoded = zip_predict_decode_16(&encoded, width, height).unwrap();
        assert_eq!(decoded, channel);
    }

    /// Pins the wire format against the spec (validated with psd-tools):
    /// deltas are 16-bit value-level per row, stored big-endian. A
    /// round-trip test alone cannot catch a symmetric encode/decode bug —
    /// this one decodes the actual inflated bytes.
    #[test]
    fn wire_format_matches_spec() {
        use flate2::read::ZlibDecoder;
        use std::io::Read;

        let channel: Vec<u16> = vec![0, 100, 65535, 32768, 500, 400, 300, 200];
        let encoded = zip_predict_encode_16(&channel, 4, 2);

        let mut inflated = Vec::new();
        ZlibDecoder::new(&encoded[..]).read_to_end(&mut inflated).unwrap();
        assert_eq!(inflated, vec![
            0, 0, 0, 100, 255, 155, 128, 1,
            1, 244, 255, 156, 255, 156, 255, 156,
        ]);
    }

    #[test]
    fn plain_zip_roundtrip() {
        let data: Vec<u8> = (0..1000).map(|i| (i % 256) as u8).collect();
        let encoded = zip_encode(&data);
        let decoded = zip_decode(&encoded, data.len()).unwrap();
        assert_eq!(decoded, data);
    }

    /// Byte-level delta encode matching the 8-bit ZIP-with-prediction wire
    /// format: first byte per row unchanged, rest = current - previous.
    fn delta_encode_8(plane: &[u8], row_size: usize) -> Vec<u8> {
        let mut out = Vec::with_capacity(plane.len());
        for row in plane.chunks(row_size) {
            let mut prev = 0u8;
            for (x, &b) in row.iter().enumerate() {
                out.push(if x == 0 { b } else { b.wrapping_sub(prev) });
                prev = b;
            }
        }
        out
    }

    #[test]
    fn decode_8_roundtrip() {
        let row_size = 7;
        let rows = 5;
        let plane: Vec<u8> = (0..row_size * rows).map(|i| (i * 13 % 256) as u8).collect();
        let encoded = zip_encode(&delta_encode_8(&plane, row_size));
        let decoded = zip_predict_decode_8(&encoded, row_size, rows).unwrap();
        assert_eq!(decoded, plane);
    }

    #[test]
    fn decode_8_rejects_short_inflated_data() {
        // Deflated stream inflates to fewer bytes than row_size * rows —
        // before the length check this panicked in the un-delta loop.
        let short = zip_encode(&[1u8, 2, 3, 4]);
        let err = zip_predict_decode_8(&short, 4, 4).unwrap_err();
        assert!(err.contains("size mismatch"), "unexpected error: {err}");
    }

    #[test]
    fn decode_8_rejects_oversized_inflated_data() {
        let long = zip_encode(&[0u8; 100]);
        let err = zip_predict_decode_8(&long, 4, 4).unwrap_err();
        assert!(err.contains("size mismatch"), "unexpected error: {err}");
    }

    #[test]
    fn decode_8_rejects_corrupt_zlib_stream() {
        let err = zip_predict_decode_8(&[0xDE, 0xAD, 0xBE, 0xEF], 4, 4).unwrap_err();
        assert!(err.contains("zlib decode"), "unexpected error: {err}");
    }
}
