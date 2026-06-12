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
}
