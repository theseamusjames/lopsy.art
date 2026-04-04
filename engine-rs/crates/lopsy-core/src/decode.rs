use png::Transformations;

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

    // Allocate output buffer
    let mut buf = vec![0u8; reader.output_buffer_size()];
    let frame = reader.next_frame(&mut buf).ok()?;
    let raw = &buf[..frame.buffer_size()];

    let is_16bit = bit_depth == png::BitDepth::Sixteen;

    // Convert to RGBA based on color type and bit depth
    match (color_type, is_16bit) {
        (png::ColorType::Rgba, true) => {
            // 16-bit RGBA → f32 RGBA
            let pixel_count = (width * height) as usize;
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
            let pixel_count = (width * height) as usize;
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
            let pixel_count = (width * height) as usize;
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
            let pixel_count = (width * height) as usize;
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
            let pixel_count = (width * height) as usize;
            let mut rgba = Vec::with_capacity(pixel_count * 4);
            for i in 0..pixel_count {
                let g = raw[i * 2];
                let a = raw[i * 2 + 1];
                rgba.extend_from_slice(&[g, g, g, a]);
            }
            Some(DecodedImage { width, height, pixels: DecodedPixels::Rgba8(rgba) })
        }
        (png::ColorType::Grayscale, true) => {
            let pixel_count = (width * height) as usize;
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
            let pixel_count = (width * height) as usize;
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
