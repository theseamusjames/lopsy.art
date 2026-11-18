use png::Transformations;

/// Longest side a decoder accepts from a file's header.
pub const MAX_DECODE_SIDE: u32 = 32_768;
/// Most pixels a decoder accepts: enough for a 100 MP photo. A 16-bit
/// RGBA PNG of this size needs 0.8 GB raw plus 1.6 GB as f32, so anything
/// larger would abort a wasm32 module instead of failing cleanly.
pub const MAX_DECODE_PIXELS: u64 = 100_000_000;
/// Most bytes a decoder allocates for one decoded frame.
pub const MAX_DECODE_BYTES: u64 = 1 << 30;

/// Check header dimensions before anything is allocated from them. Files
/// are untrusted: a 100-byte PNG can claim 20000×20000 at 16 bits.
pub fn check_image_size(width: u32, height: u32, bytes_per_pixel: u64) -> Result<usize, String> {
    if width == 0 || height == 0 {
        return Err("image has no pixels".to_string());
    }
    if width > MAX_DECODE_SIDE || height > MAX_DECODE_SIDE {
        return Err(format!("{width}x{height} exceeds the {MAX_DECODE_SIDE}px limit"));
    }
    let pixels = width as u64 * height as u64;
    if pixels > MAX_DECODE_PIXELS {
        return Err(format!("{width}x{height} exceeds {MAX_DECODE_PIXELS} pixels"));
    }
    let bytes = pixels.checked_mul(bytes_per_pixel).ok_or("image size overflows")?;
    if bytes > MAX_DECODE_BYTES {
        return Err(format!("{width}x{height} needs {bytes} bytes, more than {MAX_DECODE_BYTES}"));
    }
    usize::try_from(pixels).map_err(|_| "image size overflows".to_string())
}

/// Decoded image with pixel data at the source bit depth.
pub struct DecodedImage {
    pub width: u32,
    pub height: u32,
    pub pixels: DecodedPixels,
}

/// Pixel data preserving the original precision.
pub enum DecodedPixels {
    /// 8-bit RGBA (0–255)
    Rgba8(Vec<u8>),
    /// High-bit-depth converted to f32 RGBA (0.0–1.0)
    RgbaF32(Vec<f32>),
}

/// Try to decode a PNG from raw bytes, preserving 16-bit precision when present.
/// Returns `None` if the data is not a valid PNG.
pub fn decode_png(data: &[u8]) -> Option<DecodedImage> {
    let decoder = png::Decoder::new(data);
    let mut reader = decoder.read_info().ok()?;
    let info = reader.info();

    let width = info.width;
    let height = info.height;
    let bit_depth = info.bit_depth;
    let color_type = info.color_type;

    // The header is untrusted: check it before allocating from it. The
    // output is at most 4 channels of 2 bytes per pixel.
    let pixel_count = check_image_size(width, height, 8).ok()?;
    let mut buf = vec![0u8; reader.output_buffer_size()];
    let frame = reader.next_frame(&mut buf).ok()?;
    let raw = &buf[..frame.buffer_size()];

    let is_16bit = bit_depth == png::BitDepth::Sixteen;

    // Convert to RGBA based on color type and bit depth
    match (color_type, is_16bit) {
        (png::ColorType::Rgba, true) => {
            // 16-bit RGBA → f32 RGBA
            let mut f32_data = Vec::with_capacity(pixel_count * 4);
            for i in 0..pixel_count * 4 {
                let hi = raw[i * 2] as u16;
                let lo = raw[i * 2 + 1] as u16;
                let val = (hi << 8) | lo;
                f32_data.push(val as f32 / 65535.0);
            }
            Some(DecodedImage { width, height, pixels: DecodedPixels::RgbaF32(f32_data) })
        }
        (png::ColorType::Rgba, false) => {
            // 8-bit RGBA → pass through
            Some(DecodedImage { width, height, pixels: DecodedPixels::Rgba8(raw.to_vec()) })
        }
        (png::ColorType::Rgb, true) => {
            // 16-bit RGB → f32 RGBA (add alpha = 1.0)
            let mut f32_data = Vec::with_capacity(pixel_count * 4);
            for i in 0..pixel_count {
                for c in 0..3 {
                    let offset = (i * 3 + c) * 2;
                    let hi = raw[offset] as u16;
                    let lo = raw[offset + 1] as u16;
                    let val = (hi << 8) | lo;
                    f32_data.push(val as f32 / 65535.0);
                }
                f32_data.push(1.0);
            }
            Some(DecodedImage { width, height, pixels: DecodedPixels::RgbaF32(f32_data) })
        }
        (png::ColorType::Rgb, false) => {
            // 8-bit RGB → 8-bit RGBA (add alpha = 255)
            let mut rgba = Vec::with_capacity(pixel_count * 4);
            for i in 0..pixel_count {
                rgba.push(raw[i * 3]);
                rgba.push(raw[i * 3 + 1]);
                rgba.push(raw[i * 3 + 2]);
                rgba.push(255);
            }
            Some(DecodedImage { width, height, pixels: DecodedPixels::Rgba8(rgba) })
        }
        (png::ColorType::GrayscaleAlpha, true) => {
            // 16-bit GA → f32 RGBA
            let mut f32_data = Vec::with_capacity(pixel_count * 4);
            for i in 0..pixel_count {
                let g_hi = raw[i * 4] as u16;
                let g_lo = raw[i * 4 + 1] as u16;
                let g = ((g_hi << 8) | g_lo) as f32 / 65535.0;
                let a_hi = raw[i * 4 + 2] as u16;
                let a_lo = raw[i * 4 + 3] as u16;
                let a = ((a_hi << 8) | a_lo) as f32 / 65535.0;
                f32_data.extend_from_slice(&[g, g, g, a]);
            }
            Some(DecodedImage { width, height, pixels: DecodedPixels::RgbaF32(f32_data) })
        }
        (png::ColorType::GrayscaleAlpha, false) => {
            let mut rgba = Vec::with_capacity(pixel_count * 4);
            for i in 0..pixel_count {
                let g = raw[i * 2];
                let a = raw[i * 2 + 1];
                rgba.extend_from_slice(&[g, g, g, a]);
            }
            Some(DecodedImage { width, height, pixels: DecodedPixels::Rgba8(rgba) })
        }
        (png::ColorType::Grayscale, true) => {
            let mut f32_data = Vec::with_capacity(pixel_count * 4);
            for i in 0..pixel_count {
                let hi = raw[i * 2] as u16;
                let lo = raw[i * 2 + 1] as u16;
                let g = ((hi << 8) | lo) as f32 / 65535.0;
                f32_data.extend_from_slice(&[g, g, g, 1.0]);
            }
            Some(DecodedImage { width, height, pixels: DecodedPixels::RgbaF32(f32_data) })
        }
        (png::ColorType::Grayscale, false) => {
            let mut rgba = Vec::with_capacity(pixel_count * 4);
            for pixel in raw.iter().take(pixel_count) {
                let g = *pixel;
                rgba.extend_from_slice(&[g, g, g, 255]);
            }
            Some(DecodedImage { width, height, pixels: DecodedPixels::Rgba8(rgba) })
        }
        (png::ColorType::Indexed, _) => {
            // Indexed PNG: re-decode with expansion to RGBA
            let mut decoder = png::Decoder::new(data);
            decoder.set_transformations(Transformations::EXPAND);
            let mut reader = decoder.read_info().ok()?;
            let mut buf = vec![0u8; reader.output_buffer_size()];
            let frame = reader.next_frame(&mut buf).ok()?;
            let expanded = &buf[..frame.buffer_size()];
            let info = reader.info();
            // After EXPAND, color type becomes Rgb or Rgba
            let pixel_count = (info.width * info.height) as usize;
            match info.color_type {
                png::ColorType::Rgba => {
                    Some(DecodedImage { width, height, pixels: DecodedPixels::Rgba8(expanded.to_vec()) })
                }
                png::ColorType::Rgb => {
                    let mut rgba = Vec::with_capacity(pixel_count * 4);
                    for i in 0..pixel_count {
                        rgba.push(expanded[i * 3]);
                        rgba.push(expanded[i * 3 + 1]);
                        rgba.push(expanded[i * 3 + 2]);
                        rgba.push(255);
                    }
                    Some(DecodedImage { width, height, pixels: DecodedPixels::Rgba8(rgba) })
                }
                _ => None,
            }
        }
    }
}

#[cfg(test)]
mod size_tests {
    use super::*;

    /// A PNG of just a signature, an IHDR claiming `w`×`h` RGBA16 and an
    /// empty IEND: about 50 bytes.
    fn lying_png(w: u32, h: u32) -> Vec<u8> {
        let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
        let mut chunk = |kind: &[u8], data: &[u8]| {
            out.extend_from_slice(&(data.len() as u32).to_be_bytes());
            let mut crc = flate2::Crc::new();
            crc.update(kind);
            crc.update(data);
            out.extend_from_slice(kind);
            out.extend_from_slice(data);
            out.extend_from_slice(&crc.sum().to_be_bytes());
        };
        let mut ihdr = Vec::new();
        ihdr.extend_from_slice(&w.to_be_bytes());
        ihdr.extend_from_slice(&h.to_be_bytes());
        ihdr.extend_from_slice(&[16, 6, 0, 0, 0]);
        chunk(b"IHDR", &ihdr);
        chunk(b"IDAT", &[0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01]);
        chunk(b"IEND", &[]);
        out
    }

    #[test]
    fn a_png_whose_header_lies_is_rejected_before_allocating() {
        let png = lying_png(20_000, 20_000);
        assert!(png.len() < 100);
        assert!(decode_png(&png).is_none());
        assert!(decode_png(&lying_png(40_000, 1)).is_none());
        assert!(decode_png(&lying_png(u32::MAX, u32::MAX)).is_none());
    }

    #[test]
    fn size_checks_use_64_bit_arithmetic() {
        assert!(check_image_size(65_536, 65_536, 8).is_err(), "would wrap a u32");
        assert!(check_image_size(30_000, 30_000, 4).is_err());
        assert!(check_image_size(0, 10, 4).is_err());
        assert_eq!(check_image_size(7728, 5152, 8).unwrap(), 7728 * 5152);
    }
}
