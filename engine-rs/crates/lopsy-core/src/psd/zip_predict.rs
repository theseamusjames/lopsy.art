use flate2::read::ZlibDecoder;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use std::io::{Read, Write};

/// Encode a 16-bit channel plane using ZIP with prediction (PSD compression type 3).
///
/// Process per scanline:
/// 1. Convert each u16 to two big-endian bytes.
/// 2. Apply byte-level horizontal differencing (delta): first byte unchanged,
///    subsequent bytes = current - previous (wrapping).
/// 3. Deflate the entire delta buffer.
pub fn zip_predict_encode_16(channel: &[u16], width: u32, height: u32) -> Vec<u8> {
    let w = width as usize;
    let h = height as usize;
    assert_eq!(channel.len(), w * h, "channel size mismatch");

    // Each row: w pixels * 2 bytes per pixel
    let row_bytes = w * 2;
    let mut delta_buf = Vec::with_capacity(row_bytes * h);

    for y in 0..h {
        let row = &channel[y * w..(y + 1) * w];

        // Convert to big-endian bytes
        let mut be_bytes = Vec::with_capacity(row_bytes);
        for &val in row {
            be_bytes.extend_from_slice(&val.to_be_bytes());
        }

        // Apply delta encoding
        delta_buf.push(be_bytes[0]);
        for i in 1..be_bytes.len() {
            delta_buf.push(be_bytes[i].wrapping_sub(be_bytes[i - 1]));
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

    // Undo delta and reconstruct u16 values
    let mut result = Vec::with_capacity(w * h);

    for y in 0..h {
        let row_start = y * row_bytes;
        let row = &mut delta_buf[row_start..row_start + row_bytes];

        // Undo delta: accumulate
        for i in 1..row.len() {
            row[i] = row[i].wrapping_add(row[i - 1]);
        }

        // Reconstruct u16 from big-endian pairs
        for x in 0..w {
            let hi = row[x * 2] as u16;
            let lo = row[x * 2 + 1] as u16;
            result.push((hi << 8) | lo);
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

    #[test]
    fn plain_zip_roundtrip() {
        let data: Vec<u8> = (0..1000).map(|i| (i % 256) as u8).collect();
        let encoded = zip_encode(&data);
        let decoded = zip_decode(&encoded, data.len()).unwrap();
        assert_eq!(decoded, data);
    }
}
