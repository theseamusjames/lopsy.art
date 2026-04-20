use crate::color::ColorSpace;

/// Build a minimal ICC v2 profile for the given color space
/// Returns a valid ICC profile binary that image viewers will recognize
pub fn build_icc_profile(color_space: ColorSpace) -> Vec<u8> {
    match color_space {
        ColorSpace::Srgb | ColorSpace::LinearSrgb => build_srgb_icc(),
        ColorSpace::DisplayP3 => build_display_p3_icc(),
        ColorSpace::Rec2020 => build_srgb_icc(), // Fallback for now
    }
}

fn build_srgb_icc() -> Vec<u8> {
    // Minimal sRGB ICC v2 profile
    // This is a hand-crafted minimal profile with:
    // - Header (128 bytes)
    // - Tag table
    // - Required tags: profileDescriptionTag, mediaWhitePointTag, rXYZ/gXYZ/bXYZ, rTRC/gTRC/bTRC
    build_rgb_icc_profile(
        b"sRGB",
        // D65 white point
        [0.9505, 0.0, 1.0890],
        // sRGB primaries (XYZ)
        [0.4124, 0.2126, 0.0193],
        [0.3576, 0.7152, 0.1192],
        [0.1805, 0.0722, 0.9505],
        // sRGB gamma ~2.2 (simplified as 2.2 curve)
        2.2,
    )
}

fn build_display_p3_icc() -> Vec<u8> {
    build_rgb_icc_profile(
        b"P3\0\0",
        // D65 white point
        [0.9505, 0.0, 1.0890],
        // Display P3 primaries (XYZ)
        [0.4866, 0.2290, 0.0000],
        [0.2657, 0.6917, 0.0451],
        [0.1982, 0.0793, 0.9569],
        // Same sRGB-like gamma
        2.2,
    )
}

fn build_rgb_icc_profile(
    desc: &[u8; 4],
    _white_point: [f64; 3],
    r_xyz: [f64; 3],
    g_xyz: [f64; 3],
    b_xyz: [f64; 3],
    gamma: f64,
) -> Vec<u8> {
    // Build a simplified ICC v2 profile
    let mut profile = Vec::with_capacity(512);

    // We'll build tags first, then assemble
    let tag_count = 9u32;

    // Tag data payloads
    let desc_data = build_desc_tag(desc);
    let wtpt_data = build_xyz_tag(0.9505, 1.0, 1.0890);
    let rxyz_data = build_xyz_tag(r_xyz[0], r_xyz[1], r_xyz[2]);
    let gxyz_data = build_xyz_tag(g_xyz[0], g_xyz[1], g_xyz[2]);
    let bxyz_data = build_xyz_tag(b_xyz[0], b_xyz[1], b_xyz[2]);
    let trc_data = build_curv_tag(gamma);

    // Calculate offsets
    let header_size = 128;
    let tag_table_size = 4 + tag_count * 12; // count + entries
    let mut offset = header_size + tag_table_size;

    // Align to 4 bytes
    let align = |n: u32| -> u32 { (n + 3) & !3 };

    let desc_offset = offset;
    let desc_size = desc_data.len() as u32;
    offset += align(desc_size);

    let wtpt_offset = offset;
    let wtpt_size = wtpt_data.len() as u32;
    offset += align(wtpt_size);

    let rxyz_offset = offset;
    let xyz_size = rxyz_data.len() as u32;
    offset += align(xyz_size);

    let gxyz_offset = offset;
    offset += align(xyz_size);

    let bxyz_offset = offset;
    offset += align(xyz_size);

    let trc_offset = offset;
    let trc_size = trc_data.len() as u32;
    // rTRC, gTRC, bTRC all share the same data
    offset += align(trc_size);

    let profile_size = offset;

    // Write header (128 bytes)
    profile.extend_from_slice(&profile_size.to_be_bytes());
    profile.extend_from_slice(b"lcms"); // preferred CMM
    profile.extend_from_slice(&0x02100000u32.to_be_bytes()); // v2.1.0
    profile.extend_from_slice(b"mntr"); // device class: monitor
    profile.extend_from_slice(b"RGB "); // color space
    profile.extend_from_slice(b"XYZ "); // PCS
    // Date: 2024-01-01
    profile.extend_from_slice(&[0x07, 0xE8, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    profile.extend_from_slice(b"acsp"); // magic
    profile.extend_from_slice(b"APPL"); // platform
    profile.extend_from_slice(&[0u8; 4]); // flags
    profile.extend_from_slice(b"none"); // device manufacturer
    profile.extend_from_slice(b"none"); // device model
    profile.extend_from_slice(&[0u8; 8]); // device attributes
    profile.extend_from_slice(&1u32.to_be_bytes()); // rendering intent: relative colorimetric
    // PCS illuminant (D50): X=0.9642, Y=1.0, Z=0.8249 as s15Fixed16
    profile.extend_from_slice(&to_s15f16(0.9642));
    profile.extend_from_slice(&to_s15f16(1.0));
    profile.extend_from_slice(&to_s15f16(0.8249));
    profile.extend_from_slice(b"lcms"); // creator
    profile.extend_from_slice(&[0u8; 16]); // profile ID
    // Pad to 128
    while profile.len() < 128 {
        profile.push(0);
    }

    // Tag table
    profile.extend_from_slice(&tag_count.to_be_bytes());

    // Tags: sig(4) + offset(4) + size(4)
    write_tag_entry(&mut profile, b"desc", desc_offset, desc_size);
    write_tag_entry(&mut profile, b"wtpt", wtpt_offset, wtpt_size);
    write_tag_entry(&mut profile, b"rXYZ", rxyz_offset, xyz_size);
    write_tag_entry(&mut profile, b"gXYZ", gxyz_offset, xyz_size);
    write_tag_entry(&mut profile, b"bXYZ", bxyz_offset, xyz_size);
    write_tag_entry(&mut profile, b"rTRC", trc_offset, trc_size);
    write_tag_entry(&mut profile, b"gTRC", trc_offset, trc_size); // shared
    write_tag_entry(&mut profile, b"bTRC", trc_offset, trc_size); // shared
    write_tag_entry(&mut profile, b"cprt", desc_offset, desc_size); // reuse desc as copyright

    // Tag data
    write_padded(&mut profile, &desc_data);
    write_padded(&mut profile, &wtpt_data);
    write_padded(&mut profile, &rxyz_data);
    write_padded(&mut profile, &gxyz_data);
    write_padded(&mut profile, &bxyz_data);
    write_padded(&mut profile, &trc_data);

    // Pad to profile_size
    while profile.len() < profile_size as usize {
        profile.push(0);
    }

    profile
}

fn write_tag_entry(buf: &mut Vec<u8>, sig: &[u8; 4], offset: u32, size: u32) {
    buf.extend_from_slice(sig);
    buf.extend_from_slice(&offset.to_be_bytes());
    buf.extend_from_slice(&size.to_be_bytes());
}

fn write_padded(buf: &mut Vec<u8>, data: &[u8]) {
    buf.extend_from_slice(data);
    while buf.len() % 4 != 0 {
        buf.push(0);
    }
}

fn to_s15f16(v: f64) -> [u8; 4] {
    let fixed = (v * 65536.0).round() as i32;
    fixed.to_be_bytes()
}

fn build_xyz_tag(x: f64, y: f64, z: f64) -> Vec<u8> {
    let mut data = Vec::with_capacity(20);
    data.extend_from_slice(b"XYZ "); // type signature
    data.extend_from_slice(&[0u8; 4]); // reserved
    data.extend_from_slice(&to_s15f16(x));
    data.extend_from_slice(&to_s15f16(y));
    data.extend_from_slice(&to_s15f16(z));
    data
}

fn build_curv_tag(gamma: f64) -> Vec<u8> {
    let mut data = Vec::with_capacity(14);
    data.extend_from_slice(b"curv"); // type signature
    data.extend_from_slice(&[0u8; 4]); // reserved
    data.extend_from_slice(&1u32.to_be_bytes()); // count = 1 (gamma only)
    // u8Fixed8Number for gamma
    let g = (gamma * 256.0).round() as u16;
    data.extend_from_slice(&g.to_be_bytes());
    data
}

fn build_desc_tag(name: &[u8; 4]) -> Vec<u8> {
    let mut data = Vec::with_capacity(32);
    data.extend_from_slice(b"desc"); // type signature
    data.extend_from_slice(&[0u8; 4]); // reserved
    let name_str = std::str::from_utf8(name).unwrap_or("sRGB").trim_end_matches('\0');
    let name_bytes = name_str.as_bytes();
    let count = (name_bytes.len() + 1) as u32; // include null terminator
    data.extend_from_slice(&count.to_be_bytes());
    data.extend_from_slice(name_bytes);
    data.push(0); // null terminator
    // Pad remaining required fields
    data.extend_from_slice(&[0u8; 12]); // localizable strings (empty)
    data
}

/// Encode u16 RGBA pixel data as a 16-bit PNG with an embedded ICC profile.
pub fn encode_png_16(
    pixels: &[u16],
    width: u32,
    height: u32,
    color_space: ColorSpace,
) -> Result<Vec<u8>, String> {
    let expected = (width as usize) * (height as usize) * 4;
    if pixels.len() < expected {
        return Err(format!(
            "pixel data too short: expected {} u16 values, got {}",
            expected,
            pixels.len()
        ));
    }

    let mut buf = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut buf, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Sixteen);

        match color_space {
            ColorSpace::DisplayP3 => {
                // P3 needs an iCCP chunk — written manually after header
            }
            _ => {
                encoder.set_source_srgb(png::SrgbRenderingIntent::Perceptual);
            }
        }

        let mut writer = encoder
            .write_header()
            .map_err(|e| format!("PNG header: {e}"))?;

        // For Display P3, inject iCCP chunk before image data
        if matches!(color_space, ColorSpace::DisplayP3) {
            let icc_data = build_icc_profile(color_space);
            let iccp_payload = build_iccp_chunk_payload(b"Display P3", &icc_data);
            writer.write_chunk(png::chunk::iCCP, &iccp_payload)
                .map_err(|e| format!("PNG iCCP: {e}"))?;
        }

        let mut be_bytes = Vec::with_capacity(expected * 2);
        for &val in &pixels[..expected] {
            be_bytes.extend_from_slice(&val.to_be_bytes());
        }

        writer
            .write_image_data(&be_bytes)
            .map_err(|e| format!("PNG write: {e}"))?;
    }

    Ok(buf)
}

/// Build the raw payload for a PNG iCCP chunk: profile name + null + compression method + zlib(icc_data).
fn build_iccp_chunk_payload(name: &[u8], icc_data: &[u8]) -> Vec<u8> {
    use flate2::write::ZlibEncoder;
    use flate2::Compression;
    use std::io::Write;

    let mut payload = Vec::with_capacity(name.len() + 2 + icc_data.len());
    payload.extend_from_slice(name);
    payload.push(0); // null separator
    payload.push(0); // compression method (0 = zlib/deflate)

    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(icc_data).unwrap();
    let compressed = encoder.finish().unwrap();
    payload.extend_from_slice(&compressed);
    payload
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_srgb_profile() {
        let profile = build_icc_profile(ColorSpace::Srgb);
        assert!(!profile.is_empty());
        // Check magic number at offset 36
        assert_eq!(&profile[36..40], b"acsp");
        // Check color space
        assert_eq!(&profile[16..20], b"RGB ");
    }

    #[test]
    fn test_build_p3_profile() {
        let profile = build_icc_profile(ColorSpace::DisplayP3);
        assert!(!profile.is_empty());
        assert_eq!(&profile[36..40], b"acsp");
    }

    #[test]
    fn test_profile_size_matches() {
        let profile = build_icc_profile(ColorSpace::Srgb);
        let declared_size = u32::from_be_bytes([profile[0], profile[1], profile[2], profile[3]]);
        assert_eq!(declared_size as usize, profile.len());
    }
}
