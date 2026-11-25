use png::Transformations;

/// What a decoder accepts from a file's header before allocating from it.
/// The point is to stop header-claimed absurdities (a 63-byte PNG claiming
/// 20000×20000 at 16 bits) and u32 wraps, not to refuse big real images:
/// the limits follow what the engine can hold, and allocations past them
/// are made with `try_reserve`, so a frame that cannot fit in wasm32's
/// address space fails cleanly instead of aborting the module.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DecodeLimits {
    /// Longest side.
    pub max_side: u32,
    /// Most pixels.
    pub max_pixels: u64,
    /// Most bytes of the decoded frame, at the call's bytes per pixel.
    pub max_bytes: u64,
}

/// The GPU texture limit the engine plans for (WebGL2 and WebGPU devices
/// commonly allow 16384; some allow 32768).
pub const TEXTURE_SIDE: u64 = 16_384;

/// PNG frames: either side up to 32768 (a strip still fits a large texture
/// limit), up to 16384² ≈ 268 MP, and the RGBA16 frame of that, 2 GiB.
pub const PNG_LIMITS: DecodeLimits = DecodeLimits {
    max_side: 32_768,
    max_pixels: TEXTURE_SIDE * TEXTURE_SIDE,
    max_bytes: TEXTURE_SIDE * TEXTURE_SIDE * 8,
};

/// RAW sensor planes (RAF CFA, DNG): the same pixel budget, which takes the
/// 102 MP GFX100 family (an 11808 × 8754 CFA) with room to spare, and the
/// u16 plane plus f32 mosaic of that (6 bytes a pixel).
pub const RAW_LIMITS: DecodeLimits = DecodeLimits {
    max_side: 32_768,
    max_pixels: TEXTURE_SIDE * TEXTURE_SIDE,
    max_bytes: TEXTURE_SIDE * TEXTURE_SIDE * 6,
};

/// `check_image_size_with` at `RAW_LIMITS`.
pub fn check_image_size(width: u32, height: u32, bytes_per_pixel: u64) -> Result<usize, String> {
    check_image_size_with(width, height, bytes_per_pixel, &RAW_LIMITS)
}

/// Check header dimensions against `limits` in 64-bit arithmetic before
/// anything is allocated from them. Returns the pixel count.
pub fn check_image_size_with(width: u32, height: u32, bytes_per_pixel: u64, limits: &DecodeLimits) -> Result<usize, String> {
    if width == 0 || height == 0 {
        return Err("image has no pixels".to_string());
    }
    if width > limits.max_side || height > limits.max_side {
        return Err(format!("{width}x{height} exceeds the {}px limit", limits.max_side));
    }
    let pixels = width as u64 * height as u64;
    if pixels > limits.max_pixels {
        return Err(format!("{width}x{height} exceeds {} pixels", limits.max_pixels));
    }
    let bytes = pixels.checked_mul(bytes_per_pixel).ok_or("image size overflows")?;
    if bytes > limits.max_bytes {
        return Err(format!("{width}x{height} needs {bytes} bytes, more than {}", limits.max_bytes));
    }
    usize::try_from(pixels).map_err(|_| "image size overflows".to_string())
}

/// A vector of `len` copies of `value`, or `None` when it cannot be
/// allocated (including a length past what the address space holds).
fn try_filled<T: Clone>(len: usize, value: T) -> Option<Vec<T>> {
    let mut v = Vec::new();
    v.try_reserve_exact(len).ok()?;
    v.resize(len, value);
    Some(v)
}

/// An empty vector with room for `len`, or `None` when it cannot be allocated.
fn try_with_capacity<T>(len: usize) -> Option<Vec<T>> {
    let mut v = Vec::new();
    v.try_reserve_exact(len).ok()?;
    Some(v)
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
    let pixel_count = check_image_size_with(width, height, 8, &PNG_LIMITS).ok()?;
    let mut buf = try_filled(reader.output_buffer_size(), 0u8)?;
    let frame = reader.next_frame(&mut buf).ok()?;
    let raw = &buf[..frame.buffer_size()];

    let is_16bit = bit_depth == png::BitDepth::Sixteen;

    // Convert to RGBA based on color type and bit depth
    match (color_type, is_16bit) {
        (png::ColorType::Rgba, true) => {
            // 16-bit RGBA → f32 RGBA
            let mut f32_data = try_with_capacity(pixel_count.checked_mul(4)?)?;
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
            let mut f32_data = try_with_capacity(pixel_count.checked_mul(4)?)?;
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
            let mut rgba = try_with_capacity(pixel_count.checked_mul(4)?)?;
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
            let mut f32_data = try_with_capacity(pixel_count.checked_mul(4)?)?;
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
            let mut rgba = try_with_capacity(pixel_count.checked_mul(4)?)?;
            for i in 0..pixel_count {
                let g = raw[i * 2];
                let a = raw[i * 2 + 1];
                rgba.extend_from_slice(&[g, g, g, a]);
            }
            Some(DecodedImage { width, height, pixels: DecodedPixels::Rgba8(rgba) })
        }
        (png::ColorType::Grayscale, true) => {
            let mut f32_data = try_with_capacity(pixel_count.checked_mul(4)?)?;
            for i in 0..pixel_count {
                let hi = raw[i * 2] as u16;
                let lo = raw[i * 2 + 1] as u16;
                let g = ((hi << 8) | lo) as f32 / 65535.0;
                f32_data.extend_from_slice(&[g, g, g, 1.0]);
            }
            Some(DecodedImage { width, height, pixels: DecodedPixels::RgbaF32(f32_data) })
        }
        (png::ColorType::Grayscale, false) => {
            let mut rgba = try_with_capacity(pixel_count.checked_mul(4)?)?;
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
            let mut buf = try_filled(reader.output_buffer_size(), 0u8)?;
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
                    let mut rgba = try_with_capacity(pixel_count.checked_mul(4)?)?;
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

    #[test]
    fn big_real_images_pass_the_header_checks() {
        // A GFX100 CFA (102 MP effective, a slightly larger plane) at the
        // u16 plane plus f32 mosaic prepare_raf allocates.
        assert!(check_image_size(11_808, 8_754, 6).is_ok());
        // A 16384 × 16384 RGBA16 PNG frame; not allocated here.
        assert!(check_image_size_with(16_384, 16_384, 8, &PNG_LIMITS).is_ok());
        // And 13000 × 9000 at 16 bits, which the first guard refused.
        assert!(check_image_size_with(13_000, 9_000, 8, &PNG_LIMITS).is_ok());
        // The 63-byte bomb's 20000 × 20000 is still past the pixel budget.
        assert!(check_image_size_with(20_000, 20_000, 8, &PNG_LIMITS).is_err());
    }
}
