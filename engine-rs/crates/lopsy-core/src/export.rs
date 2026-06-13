use crate::color::ColorSpace;

/// Build an ICC v2 profile for the given color space.
/// Returns a valid ICC profile binary that image viewers will recognize.
///
/// The sRGB profile keeps its historical byte layout because it is embedded
/// in sRGB PSD exports, which must stay byte-identical. The Display P3
/// profile is built with colorimetrically correct, Bradford-adapted
/// colorants and the true sRGB transfer curve so that readers can convert
/// wide-gamut exports accurately.
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

// ============================================================
// Display P3 profile — colorimetrically correct ICC v2
// ============================================================

/// CIE chromaticities for the D65 white point (x, y).
const D65_XY: (f64, f64) = (0.3127, 0.3290);

/// Display P3 primaries as CIE chromaticities (x, y): red, green, blue.
const P3_PRIMARIES_XY: [(f64, f64); 3] = [(0.680, 0.320), (0.265, 0.690), (0.150, 0.060)];

/// ICC PCS illuminant (D50) — exact values from the s15.16 encoding the
/// spec mandates in the profile header (0xF6D6, 0x10000, 0xD32D).
const PCS_D50: [f64; 3] = [
    63190.0 / 65536.0, // 0.964202880859375
    1.0,
    54061.0 / 65536.0, // 0.824905395507813
];

/// Bradford cone response matrix used for chromatic adaptation.
const BRADFORD: [[f64; 3]; 3] = [
    [0.8951, 0.2664, -0.1614],
    [-0.7502, 1.7135, 0.0367],
    [0.0389, -0.0685, 1.0296],
];

fn xy_to_xyz(x: f64, y: f64) -> [f64; 3] {
    [x / y, 1.0, (1.0 - x - y) / y]
}

fn mat_mul(a: &[[f64; 3]; 3], b: &[[f64; 3]; 3]) -> [[f64; 3]; 3] {
    let mut out = [[0.0; 3]; 3];
    for (i, row) in out.iter_mut().enumerate() {
        for (j, cell) in row.iter_mut().enumerate() {
            *cell = (0..3).map(|k| a[i][k] * b[k][j]).sum();
        }
    }
    out
}

fn mat_vec(m: &[[f64; 3]; 3], v: &[f64; 3]) -> [f64; 3] {
    [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ]
}

fn mat_inverse(m: &[[f64; 3]; 3]) -> [[f64; 3]; 3] {
    let det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    let inv_det = 1.0 / det;
    [
        [
            (m[1][1] * m[2][2] - m[1][2] * m[2][1]) * inv_det,
            (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * inv_det,
            (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * inv_det,
        ],
        [
            (m[1][2] * m[2][0] - m[1][0] * m[2][2]) * inv_det,
            (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * inv_det,
            (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * inv_det,
        ],
        [
            (m[1][0] * m[2][1] - m[1][1] * m[2][0]) * inv_det,
            (m[0][1] * m[2][0] - m[0][0] * m[2][1]) * inv_det,
            (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * inv_det,
        ],
    ]
}

/// Bradford chromatic adaptation matrix taking colors from `src_white`
/// to `dst_white` (both as XYZ with Y = 1).
fn bradford_adaptation(src_white: &[f64; 3], dst_white: &[f64; 3]) -> [[f64; 3]; 3] {
    let cone_src = mat_vec(&BRADFORD, src_white);
    let cone_dst = mat_vec(&BRADFORD, dst_white);
    let scale = [
        [cone_dst[0] / cone_src[0], 0.0, 0.0],
        [0.0, cone_dst[1] / cone_src[1], 0.0],
        [0.0, 0.0, cone_dst[2] / cone_src[2]],
    ];
    mat_mul(&mat_inverse(&BRADFORD), &mat_mul(&scale, &BRADFORD))
}

/// RGB → XYZ matrix (columns are the colorant vectors) for the given
/// primaries and white point, all relative to that white point.
fn rgb_to_xyz_matrix(primaries_xy: &[(f64, f64); 3], white_xyz: &[f64; 3]) -> [[f64; 3]; 3] {
    let p: Vec<[f64; 3]> = primaries_xy.iter().map(|&(x, y)| xy_to_xyz(x, y)).collect();
    let m = [
        [p[0][0], p[1][0], p[2][0]],
        [p[0][1], p[1][1], p[2][1]],
        [p[0][2], p[1][2], p[2][2]],
    ];
    let s = mat_vec(&mat_inverse(&m), white_xyz);
    [
        [m[0][0] * s[0], m[0][1] * s[1], m[0][2] * s[2]],
        [m[1][0] * s[0], m[1][1] * s[1], m[1][2] * s[2]],
        [m[2][0] * s[0], m[2][1] * s[1], m[2][2] * s[2]],
    ]
}

/// Display P3 colorant columns, Bradford-adapted from D65 to the D50 PCS,
/// plus the adaptation matrix itself (for the `chad` tag).
fn p3_pcs_colorants() -> ([[f64; 3]; 3], [[f64; 3]; 3]) {
    let d65 = xy_to_xyz(D65_XY.0, D65_XY.1);
    let chad = bradford_adaptation(&d65, &PCS_D50);
    let m_d65 = rgb_to_xyz_matrix(&P3_PRIMARIES_XY, &d65);
    (mat_mul(&chad, &m_d65), chad)
}

/// Number of samples in the TRC curve table. 1024 points keeps the
/// piecewise sRGB curve accurate to well under 1/65535 between samples.
const TRC_SAMPLES: usize = 1024;

/// sRGB EOTF (Display P3 uses the same transfer function).
fn srgb_eotf(v: f64) -> f64 {
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

fn build_srgb_trc_curv_tag() -> Vec<u8> {
    let mut data = Vec::with_capacity(12 + TRC_SAMPLES * 2);
    data.extend_from_slice(b"curv");
    data.extend_from_slice(&[0u8; 4]);
    data.extend_from_slice(&(TRC_SAMPLES as u32).to_be_bytes());
    for i in 0..TRC_SAMPLES {
        let device = i as f64 / (TRC_SAMPLES - 1) as f64;
        let linear = srgb_eotf(device);
        data.extend_from_slice(&((linear * 65535.0).round() as u16).to_be_bytes());
    }
    data
}

/// Full ICC v2 textDescriptionType ('desc') tag.
fn build_text_description_tag(name: &str) -> Vec<u8> {
    let ascii = name.as_bytes();
    let mut data = Vec::with_capacity(12 + ascii.len() + 1 + 78);
    data.extend_from_slice(b"desc");
    data.extend_from_slice(&[0u8; 4]);
    data.extend_from_slice(&((ascii.len() + 1) as u32).to_be_bytes());
    data.extend_from_slice(ascii);
    data.push(0);
    data.extend_from_slice(&0u32.to_be_bytes()); // Unicode language code
    data.extend_from_slice(&0u32.to_be_bytes()); // Unicode count
    data.extend_from_slice(&0u16.to_be_bytes()); // ScriptCode code
    data.push(0); // Macintosh description count
    data.extend_from_slice(&[0u8; 67]); // Macintosh description
    data
}

fn build_text_tag(text: &str) -> Vec<u8> {
    let mut data = Vec::with_capacity(8 + text.len() + 1);
    data.extend_from_slice(b"text");
    data.extend_from_slice(&[0u8; 4]);
    data.extend_from_slice(text.as_bytes());
    data.push(0);
    data
}

fn build_chad_tag(chad: &[[f64; 3]; 3]) -> Vec<u8> {
    let mut data = Vec::with_capacity(8 + 36);
    data.extend_from_slice(b"sf32");
    data.extend_from_slice(&[0u8; 4]);
    for row in chad {
        for &v in row {
            data.extend_from_slice(&to_s15f16(v));
        }
    }
    data
}

fn build_display_p3_icc() -> Vec<u8> {
    let (colorants, chad) = p3_pcs_colorants();

    let desc_data = build_text_description_tag("Display P3");
    let cprt_data = build_text_tag("CC0 - no copyright, use freely");
    let wtpt_data = build_xyz_tag(PCS_D50[0], PCS_D50[1], PCS_D50[2]);
    let chad_data = build_chad_tag(&chad);
    let rxyz_data = build_xyz_tag(colorants[0][0], colorants[1][0], colorants[2][0]);
    let gxyz_data = build_xyz_tag(colorants[0][1], colorants[1][1], colorants[2][1]);
    let bxyz_data = build_xyz_tag(colorants[0][2], colorants[1][2], colorants[2][2]);
    let trc_data = build_srgb_trc_curv_tag();

    // rTRC/gTRC/bTRC share one curve; the table has 10 entries.
    let tag_count = 10u32;
    let header_size = 128u32;
    let tag_table_size = 4 + tag_count * 12;
    let align = |n: u32| -> u32 { (n + 3) & !3 };

    let mut offset = header_size + tag_table_size;
    let mut place = |data: &[u8]| -> (u32, u32) {
        let entry = (offset, data.len() as u32);
        offset += align(data.len() as u32);
        entry
    };
    let desc_entry = place(&desc_data);
    let cprt_entry = place(&cprt_data);
    let wtpt_entry = place(&wtpt_data);
    let chad_entry = place(&chad_data);
    let rxyz_entry = place(&rxyz_data);
    let gxyz_entry = place(&gxyz_data);
    let bxyz_entry = place(&bxyz_data);
    let trc_entry = place(&trc_data);
    let profile_size = offset;

    let mut profile = Vec::with_capacity(profile_size as usize);

    // --- Header (128 bytes) ---
    profile.extend_from_slice(&profile_size.to_be_bytes());
    profile.extend_from_slice(b"lcms"); // preferred CMM
    profile.extend_from_slice(&0x02400000u32.to_be_bytes()); // version 2.4.0
    profile.extend_from_slice(b"mntr"); // device class: display
    profile.extend_from_slice(b"RGB "); // data color space
    profile.extend_from_slice(b"XYZ "); // PCS
    let date_2024_01_01 = [
        0x07, 0xE8, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ];
    profile.extend_from_slice(&date_2024_01_01);
    profile.extend_from_slice(b"acsp"); // magic
    profile.extend_from_slice(b"APPL"); // platform
    profile.extend_from_slice(&[0u8; 4]); // flags
    profile.extend_from_slice(&[0u8; 4]); // device manufacturer
    profile.extend_from_slice(&[0u8; 4]); // device model
    profile.extend_from_slice(&[0u8; 8]); // device attributes
    profile.extend_from_slice(&0u32.to_be_bytes()); // rendering intent: perceptual
    profile.extend_from_slice(&to_s15f16(PCS_D50[0]));
    profile.extend_from_slice(&to_s15f16(PCS_D50[1]));
    profile.extend_from_slice(&to_s15f16(PCS_D50[2]));
    profile.extend_from_slice(b"lcms"); // creator
    profile.resize(header_size as usize, 0);

    // --- Tag table ---
    profile.extend_from_slice(&tag_count.to_be_bytes());
    write_tag_entry(&mut profile, b"desc", desc_entry.0, desc_entry.1);
    write_tag_entry(&mut profile, b"cprt", cprt_entry.0, cprt_entry.1);
    write_tag_entry(&mut profile, b"wtpt", wtpt_entry.0, wtpt_entry.1);
    write_tag_entry(&mut profile, b"chad", chad_entry.0, chad_entry.1);
    write_tag_entry(&mut profile, b"rXYZ", rxyz_entry.0, rxyz_entry.1);
    write_tag_entry(&mut profile, b"gXYZ", gxyz_entry.0, gxyz_entry.1);
    write_tag_entry(&mut profile, b"bXYZ", bxyz_entry.0, bxyz_entry.1);
    write_tag_entry(&mut profile, b"rTRC", trc_entry.0, trc_entry.1);
    write_tag_entry(&mut profile, b"gTRC", trc_entry.0, trc_entry.1);
    write_tag_entry(&mut profile, b"bTRC", trc_entry.0, trc_entry.1);

    // --- Tag data ---
    write_padded(&mut profile, &desc_data);
    write_padded(&mut profile, &cprt_data);
    write_padded(&mut profile, &wtpt_data);
    write_padded(&mut profile, &chad_data);
    write_padded(&mut profile, &rxyz_data);
    write_padded(&mut profile, &gxyz_data);
    write_padded(&mut profile, &bxyz_data);
    write_padded(&mut profile, &trc_data);
    profile.resize(profile_size as usize, 0);

    profile
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

    fn read_u32(data: &[u8], off: usize) -> u32 {
        u32::from_be_bytes([data[off], data[off + 1], data[off + 2], data[off + 3]])
    }

    fn from_s15f16(data: &[u8], off: usize) -> f64 {
        read_u32(data, off) as i32 as f64 / 65536.0
    }

    /// Find a tag in the profile's tag table; returns (offset, size).
    fn find_tag(profile: &[u8], sig: &[u8; 4]) -> Option<(usize, usize)> {
        let count = read_u32(profile, 128) as usize;
        for i in 0..count {
            let entry = 132 + i * 12;
            if &profile[entry..entry + 4] == sig {
                return Some((
                    read_u32(profile, entry + 4) as usize,
                    read_u32(profile, entry + 8) as usize,
                ));
            }
        }
        None
    }

    fn read_xyz_tag(profile: &[u8], sig: &[u8; 4]) -> [f64; 3] {
        let (off, _) = find_tag(profile, sig).unwrap_or_else(|| panic!("missing tag"));
        assert_eq!(&profile[off..off + 4], b"XYZ ");
        [
            from_s15f16(profile, off + 8),
            from_s15f16(profile, off + 12),
            from_s15f16(profile, off + 16),
        ]
    }

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
        assert_eq!(&profile[12..16], b"mntr");
        assert_eq!(&profile[16..20], b"RGB ");
        assert_eq!(&profile[20..24], b"XYZ ");
    }

    #[test]
    fn test_profile_size_matches() {
        for cs in [ColorSpace::Srgb, ColorSpace::DisplayP3] {
            let profile = build_icc_profile(cs);
            let declared_size = read_u32(&profile, 0);
            assert_eq!(declared_size as usize, profile.len());
        }
    }

    /// The P3 colorants must be Bradford-adapted to the D50 PCS. Reference
    /// values are the colorants in Apple's canonical "Display P3" profile.
    #[test]
    fn test_p3_colorants_match_apple_reference() {
        let profile = build_icc_profile(ColorSpace::DisplayP3);
        let r = read_xyz_tag(&profile, b"rXYZ");
        let g = read_xyz_tag(&profile, b"gXYZ");
        let b = read_xyz_tag(&profile, b"bXYZ");

        let reference = [
            ([0.51512, 0.24120, -0.00105], r),
            ([0.29198, 0.69225, 0.04189], g),
            ([0.15710, 0.06657, 0.78407], b),
        ];
        for (expected, actual) in reference {
            for i in 0..3 {
                assert!(
                    (expected[i] - actual[i]).abs() < 0.002,
                    "colorant mismatch: expected {expected:?}, got {actual:?}"
                );
            }
        }
    }

    /// Colorant columns must sum to the PCS illuminant (white maps to D50).
    #[test]
    fn test_p3_colorants_sum_to_d50() {
        let profile = build_icc_profile(ColorSpace::DisplayP3);
        let r = read_xyz_tag(&profile, b"rXYZ");
        let g = read_xyz_tag(&profile, b"gXYZ");
        let b = read_xyz_tag(&profile, b"bXYZ");
        for i in 0..3 {
            let sum = r[i] + g[i] + b[i];
            assert!(
                (sum - PCS_D50[i]).abs() < 0.001,
                "white point mismatch at {i}: {sum} vs {}",
                PCS_D50[i]
            );
        }
    }

    /// The chad tag must hold the Bradford D65→D50 matrix (Lindbloom).
    #[test]
    fn test_p3_chad_is_bradford_d65_to_d50() {
        let profile = build_icc_profile(ColorSpace::DisplayP3);
        let (off, size) = find_tag(&profile, b"chad").expect("missing chad tag");
        assert_eq!(&profile[off..off + 4], b"sf32");
        assert_eq!(size, 8 + 36);
        let expected = [
            1.0478112, 0.0228866, -0.0501270, //
            0.0295424, 0.9904844, -0.0170491, //
            -0.0092345, 0.0150436, 0.7521316,
        ];
        for (i, &e) in expected.iter().enumerate() {
            let actual = from_s15f16(&profile, off + 8 + i * 4);
            assert!(
                (actual - e).abs() < 0.002,
                "chad[{i}]: expected {e}, got {actual}"
            );
        }
    }

    #[test]
    fn test_p3_wtpt_is_d50() {
        let profile = build_icc_profile(ColorSpace::DisplayP3);
        let wtpt = read_xyz_tag(&profile, b"wtpt");
        for i in 0..3 {
            assert!((wtpt[i] - PCS_D50[i]).abs() < 0.0001);
        }
    }

    /// The shared TRC curve must be the sRGB EOTF: monotonic, correct
    /// endpoints, and matching the piecewise definition at spot values.
    #[test]
    fn test_p3_trc_is_srgb_curve() {
        let profile = build_icc_profile(ColorSpace::DisplayP3);
        let (r_off, r_size) = find_tag(&profile, b"rTRC").expect("missing rTRC");
        let (g_off, _) = find_tag(&profile, b"gTRC").expect("missing gTRC");
        let (b_off, _) = find_tag(&profile, b"bTRC").expect("missing bTRC");
        assert_eq!(r_off, g_off, "TRC tags should share data");
        assert_eq!(r_off, b_off, "TRC tags should share data");
        assert_eq!(&profile[r_off..r_off + 4], b"curv");

        let count = read_u32(&profile, r_off + 8) as usize;
        assert_eq!(count, TRC_SAMPLES);
        assert_eq!(r_size, 12 + count * 2);

        let entry = |i: usize| -> u16 {
            u16::from_be_bytes([profile[r_off + 12 + i * 2], profile[r_off + 13 + i * 2]])
        };
        assert_eq!(entry(0), 0);
        assert_eq!(entry(count - 1), 65535);
        let mut prev = 0u16;
        for i in 0..count {
            assert!(entry(i) >= prev, "TRC must be monotonic");
            prev = entry(i);
        }
        // Spot-check the sRGB piecewise curve at mid-gray.
        let mid = count / 2;
        let device = mid as f64 / (count - 1) as f64;
        let expected = (srgb_eotf(device) * 65535.0).round() as u16;
        assert_eq!(entry(mid), expected);
    }

    /// sRGB exports must stay byte-identical: the legacy sRGB profile
    /// (embedded in sRGB PSD exports) must not change shape.
    #[test]
    fn test_srgb_profile_layout_unchanged() {
        let profile = build_icc_profile(ColorSpace::Srgb);
        assert_eq!(read_u32(&profile, 128), 9, "legacy sRGB profile has 9 tags");
        assert_eq!(read_u32(&profile, 8), 0x02100000, "legacy version 2.1.0");
    }
}
