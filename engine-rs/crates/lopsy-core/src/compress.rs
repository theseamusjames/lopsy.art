/// RLE compression for RGBA pixel data.
///
/// Encoding format (operates on RGBA quads):
/// - Run of N identical quads (N >= 1): [count_high, count_low, R, G, B, A]
///   where count = (count_high << 8) | count_low, max 65535
/// - Sequence of N non-repeating quads (N >= 1): [0, 0, count_high, count_low, R,G,B,A, R,G,B,A, ...]
///   Literal run marker is [0, 0] followed by 2-byte count then raw RGBA bytes.
///
/// The key insight: runs of [0,0,R,G,B,A] would be ambiguous with the literal
/// marker, so we use a different scheme:
///
/// Actually, simpler approach:
/// - Tag byte: if high bit is set, it's a run: length = (tag & 0x7F) + 1 (1..128),
///   followed by 4 bytes [R,G,B,A].
/// - Tag byte: if high bit is clear, it's a literal sequence: length = tag + 1 (1..128),
///   followed by length * 4 bytes of raw RGBA data.

const MAX_RUN: usize = 128;

pub fn rle_compress(data: &[u8]) -> Vec<u8> {
    assert!(data.len() % 4 == 0, "Data length must be a multiple of 4 (RGBA)");
    let pixel_count = data.len() / 4;
    if pixel_count == 0 {
        return Vec::new();
    }

    // Worst case: every pixel is a literal → 1 tag byte per 128 pixels + all data
    let mut out = Vec::with_capacity(data.len() + data.len() / 128 + 16);
    let mut i = 0;

    while i < pixel_count {
        // Count how many identical pixels follow
        let pixel = &data[i * 4..(i + 1) * 4];
        let mut run_len = 1;
        while i + run_len < pixel_count
            && run_len < MAX_RUN
            && data[(i + run_len) * 4..(i + run_len + 1) * 4] == *pixel
        {
            run_len += 1;
        }

        if run_len >= 2 {
            // Emit a run
            out.push(0x80 | (run_len as u8 - 1));
            out.extend_from_slice(pixel);
            i += run_len;
        } else {
            // Collect literals: pixels that don't form runs of 2+
            let start = i;
            let mut lit_len = 0;
            while i + lit_len < pixel_count && lit_len < MAX_RUN {
                // Check if starting a run of 2+ here
                let p = &data[(i + lit_len) * 4..(i + lit_len + 1) * 4];
                let mut ahead = 1;
                while i + lit_len + ahead < pixel_count
                    && ahead < 2
                    && data[(i + lit_len + ahead) * 4..(i + lit_len + ahead + 1) * 4] == *p
                {
                    ahead += 1;
                }
                if ahead >= 2 && lit_len > 0 {
                    // A run starts here — stop collecting literals
                    break;
                }
                lit_len += 1;
            }
            out.push(lit_len as u8 - 1); // high bit clear
            out.extend_from_slice(&data[start * 4..(start + lit_len) * 4]);
            i += lit_len;
        }
    }

    out
}

pub fn rle_decompress(data: &[u8], expected_len: usize) -> Vec<u8> {
    assert!(expected_len % 4 == 0, "Expected length must be a multiple of 4 (RGBA)");
    let mut out = Vec::with_capacity(expected_len);
    let mut pos = 0;

    while pos < data.len() {
        let tag = data[pos];
        pos += 1;

        if tag & 0x80 != 0 {
            // Run
            let count = (tag & 0x7F) as usize + 1;
            let pixel = &data[pos..pos + 4];
            pos += 4;
            for _ in 0..count {
                out.extend_from_slice(pixel);
            }
        } else {
            // Literal
            let count = tag as usize + 1;
            let bytes = count * 4;
            out.extend_from_slice(&data[pos..pos + bytes]);
            pos += bytes;
        }
    }

    assert_eq!(out.len(), expected_len, "Decompressed size mismatch");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_empty() {
        let data: Vec<u8> = Vec::new();
        let compressed = rle_compress(&data);
        assert!(compressed.is_empty());
        let decompressed = rle_decompress(&compressed, 0);
        assert!(decompressed.is_empty());
    }

    #[test]
    fn roundtrip_all_zeros() {
        // 1000 transparent pixels
        let data = vec![0u8; 4000];
        let compressed = rle_compress(&data);
        // Should compress very well — 1000 identical pixels
        assert!(compressed.len() < data.len() / 5, "Expected good compression, got {} -> {}", data.len(), compressed.len());
        let decompressed = rle_decompress(&compressed, data.len());
        assert_eq!(decompressed, data);
    }

    #[test]
    fn roundtrip_all_same_color() {
        // 500 red pixels
        let pixel = [255, 0, 0, 255];
        let data: Vec<u8> = pixel.iter().copied().cycle().take(2000).collect();
        let compressed = rle_compress(&data);
        assert!(compressed.len() < 100);
        let decompressed = rle_decompress(&compressed, data.len());
        assert_eq!(decompressed, data);
    }

    #[test]
    fn roundtrip_alternating() {
        // Alternating red and blue — worst case for RLE
        let mut data = Vec::with_capacity(800);
        for i in 0..200 {
            if i % 2 == 0 {
                data.extend_from_slice(&[255, 0, 0, 255]);
            } else {
                data.extend_from_slice(&[0, 0, 255, 255]);
            }
        }
        let compressed = rle_compress(&data);
        let decompressed = rle_decompress(&compressed, data.len());
        assert_eq!(decompressed, data);
    }

    #[test]
    fn roundtrip_mixed() {
        // Mix of runs and literals
        let mut data = Vec::new();
        // 50 transparent pixels (run)
        data.extend_from_slice(&vec![0u8; 200]);
        // 10 unique pixels (literals)
        for i in 0..10u8 {
            data.extend_from_slice(&[i * 25, 100, 200, 255]);
        }
        // 100 white pixels (run)
        for _ in 0..100 {
            data.extend_from_slice(&[255, 255, 255, 255]);
        }
        // 5 more unique
        for i in 0..5u8 {
            data.extend_from_slice(&[i * 50, i * 30, 128, 200]);
        }

        let compressed = rle_compress(&data);
        let decompressed = rle_decompress(&compressed, data.len());
        assert_eq!(decompressed, data);
    }

    #[test]
    fn roundtrip_single_pixel() {
        let data = vec![42, 128, 0, 255];
        let compressed = rle_compress(&data);
        let decompressed = rle_decompress(&compressed, data.len());
        assert_eq!(decompressed, data);
    }

    #[test]
    fn roundtrip_two_identical_pixels() {
        let data = vec![10, 20, 30, 40, 10, 20, 30, 40];
        let compressed = rle_compress(&data);
        // Should be a run of 2: [0x81, 10, 20, 30, 40]
        assert_eq!(compressed.len(), 5);
        let decompressed = rle_decompress(&compressed, data.len());
        assert_eq!(decompressed, data);
    }

    #[test]
    fn roundtrip_large_run() {
        // 128 identical pixels (max single run)
        let data: Vec<u8> = [100, 150, 200, 255].iter().copied().cycle().take(128 * 4).collect();
        let compressed = rle_compress(&data);
        assert_eq!(compressed.len(), 5); // one tag + 4 bytes
        let decompressed = rle_decompress(&compressed, data.len());
        assert_eq!(decompressed, data);
    }

    #[test]
    fn roundtrip_over_max_run() {
        // 200 identical pixels — should produce 2 runs (128 + 72)
        let data: Vec<u8> = [50, 60, 70, 80].iter().copied().cycle().take(200 * 4).collect();
        let compressed = rle_compress(&data);
        assert_eq!(compressed.len(), 10); // two runs of tag+4
        let decompressed = rle_decompress(&compressed, data.len());
        assert_eq!(decompressed, data);
    }

    #[test]
    fn compression_ratio_typical_layer() {
        // Simulate a typical layer: mostly transparent with some content in the middle
        let width = 200;
        let height = 200;
        let mut data = vec![0u8; width * height * 4];

        // Paint a 40x40 block of varied colors in the center
        for y in 80..120 {
            for x in 80..120 {
                let idx = (y * width + x) * 4;
                data[idx] = (x * 3) as u8;
                data[idx + 1] = (y * 2) as u8;
                data[idx + 2] = 128;
                data[idx + 3] = 255;
            }
        }

        let compressed = rle_compress(&data);
        let ratio = data.len() as f64 / compressed.len() as f64;
        assert!(ratio > 5.0, "Expected 5x+ compression on typical layer, got {ratio:.1}x");
        let decompressed = rle_decompress(&compressed, data.len());
        assert_eq!(decompressed, data);
    }
}
