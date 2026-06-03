//! RAF (Fujifilm RAW) image decoder.
//!
//! ## File structure
//!
//! 1. 108-byte container header (magic, camera model, offsets)
//! 2. JPEG preview with EXIF
//! 3. CFA header (Fujifilm TLV: raw/output dims, crop offsets, CFA pattern)
//! 4. CFA data section — a TIFF with Fujifilm tags (0xF001–0xF014)
//!    pointing to the pixel strip
//!
//! ## Processing pipeline
//!
//! 1. Parse RAF container → offsets to sections
//! 2. Parse CFA header (TLV) → 6×6 CFA pattern, crop offsets
//! 3. Parse CFA data TIFF → raw dims, strip offset/length
//! 4. Read pixel data (big-endian u16), crop to output area
//! 5. Normalize, demosaic (X-Trans or Bayer), auto WB, gamma

pub mod base_curves;
pub mod compression;
pub mod dcp;
pub mod wb_presets;
pub mod xtrans;

use crate::dng::color;
use crate::dng::tiff::TiffReader;
use crate::dng::demosaic;

pub struct RafImage {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<f32>,
    pub debug_log: Vec<String>,
}

pub fn read_raf(data: &[u8]) -> Result<RafImage, String> {
    let mut debug_log: Vec<String> = Vec::new();
    macro_rules! raf_log {
        ($($arg:tt)*) => { debug_log.push(format!($($arg)*)); };
    }

    if data.len() < 120 {
        return Err("File too small for RAF header".into());
    }
    if &data[0..16] != b"FUJIFILMCCD-RAW " {
        return Err("Not a Fujifilm RAF file (bad magic)".into());
    }

    let camera_model = parse_camera_model(&data[28..60]);
    raf_log!("[RAF] camera model: {}", camera_model);

    // EXIF orientation lives in the JPEG preview block. Read it so we
    // can rotate the decoded image to the camera-intended orientation
    // (portrait shots are stored landscape in the sensor's native frame).
    let jpeg_offset = read_be_u32(data, 84) as usize;
    let jpeg_length = read_be_u32(data, 88) as usize;
    let exif_orientation = if jpeg_offset > 0 && jpeg_offset + jpeg_length <= data.len() {
        parse_exif_orientation(&data[jpeg_offset..jpeg_offset + jpeg_length]).unwrap_or(1)
    } else {
        1
    };
    raf_log!("[RAF] EXIF orientation: {}", exif_orientation);

    let cfa_header_offset = read_be_u32(data, 92) as usize;
    let cfa_header_length = read_be_u32(data, 96) as usize;
    let cfa_data_offset = read_be_u32(data, 100) as usize;
    let cfa_data_length = read_be_u32(data, 104) as usize;

    if cfa_data_offset + cfa_data_length > data.len() {
        return Err("CFA data extends past end of file".into());
    }

    // ── Parse CFA header (TLV) ──────────────────────────────────

    let cfa_header_info = if cfa_header_offset > 0
        && cfa_header_offset + cfa_header_length <= data.len()
        && cfa_header_length >= 4
    {
        parse_cfa_header(&data[cfa_header_offset..cfa_header_offset + cfa_header_length])
    } else {
        None
    };

    let cfa_pattern = cfa_header_info.as_ref().and_then(|h| h.cfa_pattern);
    let crop_top = cfa_header_info.as_ref().map(|h| h.crop_top).unwrap_or(0);
    let crop_left = cfa_header_info.as_ref().map(|h| h.crop_left).unwrap_or(0);
    let out_w = cfa_header_info.as_ref().and_then(|h| h.output_width);
    let out_h = cfa_header_info.as_ref().and_then(|h| h.output_height);

    if let Some(ref pat) = cfa_pattern {
        raf_log!("[RAF] CFA pattern from file: [{},{},{},{},{},{}; {},{},{},{},{},{}; ...]",
            pat[0],pat[1],pat[2],pat[3],pat[4],pat[5],
            pat[6],pat[7],pat[8],pat[9],pat[10],pat[11]);
    }
    raf_log!("[RAF] crop: top={}, left={}, output={}x{}",
        crop_top, crop_left, out_w.unwrap_or(0), out_h.unwrap_or(0));

    // ── Parse CFA data TIFF ─────────────────────────────────────

    let cfa_section = &data[cfa_data_offset..cfa_data_offset + cfa_data_length];
    let cfa_meta = parse_cfa_tiff(cfa_section)?;

    let raw_w = cfa_meta.width as usize;
    let raw_h = cfa_meta.height as usize;
    let bits = cfa_meta.bits_per_sample;
    let pixel_offset = cfa_meta.strip_offset as usize;
    let pixel_bytes = cfa_meta.strip_byte_count as usize;

    raf_log!("[RAF] raw {}x{}, {}bit, strip @{} len={}", raw_w, raw_h, bits, pixel_offset, pixel_bytes);

    if pixel_offset + pixel_bytes > cfa_section.len() {
        return Err("Pixel data extends past CFA section".into());
    }

    let pixel_data = &cfa_section[pixel_offset..pixel_offset + pixel_bytes];

    // ── Determine output dimensions and crop ────────────────────

    let width = out_w.unwrap_or(raw_w as u32).min(raw_w as u32 - crop_left as u32);
    let height = out_h.unwrap_or(raw_h as u32).min(raw_h as u32 - crop_top as u32);
    let w = width as usize;
    let h = height as usize;

    raf_log!("[RAF] output {}x{} (cropped from {}x{}, offset {},{})", w, h, raw_w, raw_h, crop_left, crop_top);

    let white_level: u16 = if bits > 0 && bits <= 16 {
        ((1u32 << bits) - 1) as u16
    } else {
        u16::MAX
    };

    // ── Compression detection ───────────────────────────────────
    //
    // Use both the TIFF-reported strip size and a structured-header
    // check on the strip bytes themselves. Some compressed files have
    // a strip_byte_count that matches the uncompressed size, so the
    // TIFF check alone isn't reliable.
    let structured_compressed = compression::is_compressed_strip(pixel_data, raw_w as u32, raw_h as u32);
    let is_compressed = cfa_meta.is_compressed || structured_compressed;

    raf_log!("[RAF] compression: tiff_says={}, header_says={}, deciding={}",
        cfa_meta.is_compressed, structured_compressed, is_compressed);

    // ── Read full-frame raw u16 plane (compressed or uncompressed) ──

    let base_pat_for_decompress = cfa_pattern.as_ref().copied().unwrap_or(DEFAULT_XTRANS_CFA);

    let raw_plane: Vec<u16> = if is_compressed {
        raf_log!("[RAF] decompressing Fujifilm compressed strip");
        compression::decompress_fuji_strip(pixel_data, raw_w as u32, raw_h as u32, &base_pat_for_decompress)
            .map_err(|e| format!("Compressed RAF decode failed: {e}. \
                Try setting your camera to \"Uncompressed\" RAW, or convert to DNG \
                with Adobe DNG Converter."))?
    } else {
        let expected_bytes = raw_w * raw_h * 2;
        if pixel_bytes < expected_bytes {
            return Err(format!("Pixel data too small: expected {expected_bytes}, got {pixel_bytes}"));
        }
        let mut buf = Vec::with_capacity(raw_w * raw_h);
        for i in 0..(raw_w * raw_h) {
            let off = i * 2;
            if off + 1 < pixel_data.len() {
                buf.push(u16::from_le_bytes([pixel_data[off], pixel_data[off + 1]]));
            } else {
                buf.push(0);
            }
        }
        buf
    };

    // Sample-based sanity check: if the decoded plane still looks like
    // garbage (median near black), bail with a clear error. This catches
    // both undetected compressed variants and decompression failures
    // that produced bogus output.
    let sample_stride = (raw_w * raw_h).max(1) / 1000;
    let mut sample_vals: Vec<u16> = Vec::with_capacity(1000);
    for i in (raw_w * 100..raw_w * raw_h).step_by(sample_stride.max(1)) {
        if i < raw_plane.len() {
            sample_vals.push(raw_plane[i]);
        }
    }
    sample_vals.sort();
    let sample_median = sample_vals.get(sample_vals.len() / 2).copied().unwrap_or(0);
    let black_u16 = cfa_meta.black_level.unwrap_or(1024.0) as u16;

    if !sample_vals.is_empty() && sample_median < black_u16 + 50 {
        return Err(
            "RAF pixel data has no signal after decode (median near black). \
             This may be an unsupported compression variant. Try setting your camera \
             to \"Uncompressed\" RAW, or convert to DNG with Adobe DNG Converter.".into()
        );
    }

    // ── Crop to output area ─────────────────────────────────────

    let pixel_count = w * h;
    let mut raw_u16 = Vec::with_capacity(pixel_count);

    for row in 0..h {
        let src_row = row + crop_top as usize;
        for col in 0..w {
            let src_col = col + crop_left as usize;
            let idx = src_row * raw_w + src_col;
            if idx < raw_plane.len() {
                raw_u16.push(raw_plane[idx].min(white_level));
            } else {
                raw_u16.push(0);
            }
        }
    }

    // ── Normalize ───────────────────────────────────────────────

    let black = cfa_meta.black_level.unwrap_or(0.0);
    let max_val = white_level as f64;
    let range = max_val - black;

    raf_log!("[RAF] white_level={}, black={:.1}", white_level, black);

    let mut normalized: Vec<f32> = raw_u16.iter()
        .map(|&v| ((v as f64 - black) / range).clamp(0.0, 1.0) as f32)
        .collect();

    // ── Per-pixel white balance (raw CFA-aware) ─────────────────
    // For X-Trans cameras, raw R and B channels need a significant boost
    // (~1.9×) so a gray scene produces neutral camera RGB. After this,
    // the camera→sRGB matrix maps gray to gray. Without this step, gray
    // areas become magenta because the matrix expects WB-corrected input.

    let is_xtrans = camera_model_is_xtrans(&camera_model);
    let base_pat = cfa_pattern.as_ref().copied().unwrap_or(DEFAULT_XTRANS_CFA);
    let cfa = if is_xtrans {
        shift_cfa(&base_pat, crop_top as usize, crop_left as usize)
    } else {
        [0u8, 1, 1, 2, 0, 1, 1, 2, 0, 1, 1, 2, 0, 1, 1, 2,
         0, 1, 1, 2, 0, 1, 1, 2, 0, 1, 1, 2, 0, 1, 1, 2,
         0, 1, 1, 2]
    };
    let cfa_period = if is_xtrans { 6 } else { 2 };

    let wb = auto_wb_gray_world(&normalized, w, h, &cfa, cfa_period);
    raf_log!("[RAF] WB multipliers (R,G,B) [gray-world]: [{:.4}, {:.4}, {:.4}]", wb[0], wb[1], wb[2]);
    for row in 0..h {
        for col in 0..w {
            let cfa_idx = (row % cfa_period) * cfa_period + (col % cfa_period);
            let color = cfa[cfa_idx] as usize;
            normalized[row * w + col] *= wb[color];
        }
    }
    let _ = wb_presets::default_daylight_wb(&camera_model);
    let _ = matrix_compatible_wb(&camera_model);

    // ── Demosaic ────────────────────────────────────────────────

    let mut rgb_f32 = if is_xtrans {
        raf_log!("[RAF] X-Trans demosaic (CFA shifted by row={}, col={})",
            crop_top % 6, crop_left % 6);
        xtrans::demosaic_xtrans(&normalized, width, height, &cfa)
    } else {
        raf_log!("[RAF] Bayer demosaic");
        demosaic::bilinear(&normalized, width, height, &cfa[..4])
    };

    // ── Color matrix ────────────────────────────────────────────
    // Real per-camera camera→sRGB matrix derived from the DNG ColorMatrix1
    // values in `color_matrix_for_model`. Row-normalized so that a neutral
    // input (R=G=B, as produced by the gray-world WB above) maps to a
    // neutral output — this is what keeps grays neutral instead of the
    // magenta cast the old hand-tuned saturation matrix was working around.
    let cam_to_srgb = normalize_matrix_rows(color_matrix_for_model(&camera_model));
    raf_log!(
        "[RAF] cam→sRGB (row-normalized): [{:.3} {:.3} {:.3}; {:.3} {:.3} {:.3}; {:.3} {:.3} {:.3}]",
        cam_to_srgb[0], cam_to_srgb[1], cam_to_srgb[2],
        cam_to_srgb[3], cam_to_srgb[4], cam_to_srgb[5],
        cam_to_srgb[6], cam_to_srgb[7], cam_to_srgb[8]
    );
    color::apply_matrix(&mut rgb_f32, &cam_to_srgb);

    // ── Exposure boost ─────────────────────────────────────────
    // Raw sensor data uses ~30% of the 14-bit range (cameras expose for
    // highlights to preserve headroom). With the base curve also lifting
    // midtones, ~1.5× (≈ +0.6 EV) is enough to land daylight scenes at
    // natural brightness without clipping. Done in linear space so the
    // boost is multiplicative on light intensity.
    const EXPOSURE_SCALE: f32 = 1.8;
    for v in rgb_f32.iter_mut() {
        *v *= EXPOSURE_SCALE;
    }

    // ── Base curve (per-camera tone mapping) ───────────────────
    // Approximates the camera JPEG's tone rendering. The curve provides
    // its own highlight rolloff, replacing the previous Reinhard-style
    // compression, and shapes shadows/midtones to match the in-camera
    // look. Applied in linear light, before sRGB gamma.
    let curve = base_curves::default_curve_for_model(&camera_model);
    raf_log!("[RAF] applying base curve: {}", curve.name);
    base_curves::apply_base_curve(&mut rgb_f32, curve);

    // ── sRGB gamma ──────────────────────────────────────────────

    color::apply_srgb_gamma(&mut rgb_f32);

    // ── Capture sharpening ──────────────────────────────────────
    // A mild luma unsharp mask in display (gamma-encoded) space, to match
    // the crispness of the camera-rendered JPEG / Preview. Kept modest
    // (small radius, low amount) so it sharpens real edges without ringing
    // and is off the demosaic critical path.
    unsharp_mask_luma(&mut rgb_f32, w, h, CAPTURE_SHARPEN_AMOUNT);

    // ── Convert RGB → RGBA ──────────────────────────────────────

    let mut rgba = Vec::with_capacity(pixel_count * 4);
    for i in 0..pixel_count {
        rgba.push(rgb_f32[i * 3].clamp(0.0, 1.0));
        rgba.push(rgb_f32[i * 3 + 1].clamp(0.0, 1.0));
        rgba.push(rgb_f32[i * 3 + 2].clamp(0.0, 1.0));
        rgba.push(1.0);
    }

    // ── Apply EXIF orientation ─────────────────────────────────
    // Most commonly: 1 (no rotation), 6 (rotate 90° CW), 8 (rotate
    // 90° CCW), 3 (rotate 180°). For 5/6/7/8 the output dimensions
    // are swapped.
    let (final_w, final_h, final_pixels) =
        apply_exif_orientation(width, height, &rgba, exif_orientation);

    Ok(RafImage { width: final_w, height: final_h, pixels: final_pixels, debug_log })
}

/// Apply EXIF orientation tag to a RGBA f32 buffer. Returns new (w, h, pixels).
fn apply_exif_orientation(w: u32, h: u32, src: &[f32], orientation: u16) -> (u32, u32, Vec<f32>) {
    let wu = w as usize;
    let hu = h as usize;
    if orientation == 1 || orientation == 0 {
        return (w, h, src.to_vec());
    }

    // For 5..=8 the dimensions swap.
    let (out_w, out_h) = match orientation {
        5 | 6 | 7 | 8 => (h, w),
        _ => (w, h),
    };
    let owu = out_w as usize;
    let ohu = out_h as usize;
    let mut dst = vec![0.0f32; owu * ohu * 4];

    for y in 0..hu {
        for x in 0..wu {
            let s = (y * wu + x) * 4;
            // (out_x, out_y) given (x, y) for each orientation
            let (ox, oy) = match orientation {
                2 => (wu - 1 - x, y),              // flip horizontal
                3 => (wu - 1 - x, hu - 1 - y),     // rotate 180
                4 => (x, hu - 1 - y),              // flip vertical
                5 => (y, x),                        // transpose
                6 => (hu - 1 - y, x),              // rotate 90 CW
                7 => (hu - 1 - y, wu - 1 - x),     // transverse
                8 => (y, wu - 1 - x),              // rotate 90 CCW
                _ => (x, y),
            };
            let d = (oy * owu + ox) * 4;
            dst[d] = src[s];
            dst[d + 1] = src[s + 1];
            dst[d + 2] = src[s + 2];
            dst[d + 3] = src[s + 3];
        }
    }
    (out_w, out_h, dst)
}

/// Parse the EXIF Orientation tag (0x0112) from a JPEG block.
/// Returns the value (1..=8) or `None` if not found.
fn parse_exif_orientation(jpeg: &[u8]) -> Option<u16> {
    // Find APP1 with "Exif\0\0" payload
    let mut i = 2usize;
    while i + 4 < jpeg.len() {
        if jpeg[i] == 0xFF && jpeg[i + 1] == 0xE1 {
            let payload = &jpeg[i + 4..];
            if payload.len() < 6 || &payload[..4] != b"Exif" { return None; }
            let tiff = &payload[6..];
            if tiff.len() < 8 { return None; }
            let le = tiff[0] == b'I' && tiff[1] == b'I';
            let read_u16 = |o: usize| -> u16 {
                if le { u16::from_le_bytes([tiff[o], tiff[o+1]]) }
                else { u16::from_be_bytes([tiff[o], tiff[o+1]]) }
            };
            let read_u32 = |o: usize| -> u32 {
                if le { u32::from_le_bytes([tiff[o], tiff[o+1], tiff[o+2], tiff[o+3]]) }
                else { u32::from_be_bytes([tiff[o], tiff[o+1], tiff[o+2], tiff[o+3]]) }
            };
            let ifd0 = read_u32(4) as usize;
            if ifd0 + 2 > tiff.len() { return None; }
            let count = read_u16(ifd0) as usize;
            for j in 0..count {
                let off = ifd0 + 2 + j * 12;
                if off + 12 > tiff.len() { break; }
                let tag = read_u16(off);
                if tag == 0x0112 {
                    return Some(read_u16(off + 8));
                }
            }
            return None;
        }
        i += 1;
    }
    None
}

// ── Helpers ─────────────────────────────────────────────────────

fn read_be_u32(data: &[u8], offset: usize) -> u32 {
    u32::from_be_bytes([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]])
}

fn read_be_u16(data: &[u8], offset: usize) -> u16 {
    u16::from_be_bytes([data[offset], data[offset + 1]])
}

fn parse_camera_model(bytes: &[u8]) -> String {
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).trim().to_string()
}

/// Shift the CFA pattern by the crop offset so it aligns with the
/// cropped output pixels, and remap Fujifilm's color indices
/// (0=B, 1=G, 2=R in RAF files) to the standard convention
/// (0=R, 1=G, 2=B) used by the demosaicer.
fn shift_cfa(pat: &[u8; 36], row_offset: usize, col_offset: usize) -> [u8; 36] {
    let mut out = [0u8; 36];
    for r in 0..6 {
        for c in 0..6 {
            let v = pat[((r + row_offset) % 6) * 6 + ((c + col_offset) % 6)];
            out[r * 6 + c] = match v {
                0 => 2, // Fuji 0 = Blue → standard 2
                2 => 0, // Fuji 2 = Red  → standard 0
                _ => v, // 1 = Green
            };
        }
    }
    out
}

/// Legacy hand-tuned saturation matrix. Superseded by the real per-camera
/// matrix (`color_matrix_for_model` + `normalize_matrix_rows`); retained
/// behind `#[allow(dead_code)]` as a one-line revert in case the per-camera
/// matrix regresses on some model.
///
/// The big +/- coefficients made warm tones pop but amplified any per-pixel
/// mosaic residual into a visible grid, which the post-demosaic blur then had
/// to hide. Rows sum to 1.0 so gray stayed neutral.
#[allow(dead_code)]
const SIMPLE_CAM_TO_SRGB: [f32; 9] = [
     3.0, -1.0, -1.0,
    -1.0,  3.0, -1.0,
    -2.0, -1.5,  4.5,
];

/// Capture-sharpening strength (fraction of the high-pass detail added
/// back). Modest by design — enough to match the camera JPEG's crispness
/// without visible ringing.
const CAPTURE_SHARPEN_AMOUNT: f32 = 0.45;

/// Mild luma unsharp mask on interleaved RGB. Sharpens the luminance high-
/// frequency detail only (chroma is left untouched), which avoids the color
/// fringing a per-channel unsharp mask produces at edges.
///
/// The low-pass is a separable 3×3 tent kernel (`[1,2,1]/4` each axis), so
/// this is O(N) and cheap. `amount` scales the recovered high-pass detail.
fn unsharp_mask_luma(rgb: &mut [f32], w: usize, h: usize, amount: f32) {
    if amount <= 0.0 || w < 3 || h < 3 {
        return;
    }
    let n = w * h;

    // Luma plane (Rec.709) of the current (gamma-encoded) RGB.
    let mut luma = vec![0.0f32; n];
    for i in 0..n {
        let o = i * 3;
        luma[i] = 0.2126 * rgb[o] + 0.7152 * rgb[o + 1] + 0.0722 * rgb[o + 2];
    }

    // Separable [1,2,1]/4 blur of the luma plane (reflect at edges).
    let mut tmp = vec![0.0f32; n];
    for row in 0..h {
        for col in 0..w {
            let l = luma[row * w + col.saturating_sub(1)];
            let c = luma[row * w + col];
            let r = luma[row * w + (col + 1).min(w - 1)];
            tmp[row * w + col] = (l + 2.0 * c + r) * 0.25;
        }
    }
    let mut blur = vec![0.0f32; n];
    for col in 0..w {
        for row in 0..h {
            let u = tmp[row.saturating_sub(1) * w + col];
            let c = tmp[row * w + col];
            let d = tmp[(row + 1).min(h - 1) * w + col];
            blur[row * w + col] = (u + 2.0 * c + d) * 0.25;
        }
    }

    // Add the high-pass detail back, scaling RGB by the luma ratio so hue
    // and saturation are preserved.
    for i in 0..n {
        let detail = luma[i] - blur[i];
        let target = luma[i] + amount * detail;
        if luma[i] > 1e-4 {
            let scale = (target / luma[i]).max(0.0);
            let o = i * 3;
            rgb[o] *= scale;
            rgb[o + 1] *= scale;
            rgb[o + 2] *= scale;
        }
    }
}

/// Normalize each row of a 3×3 cam→sRGB matrix to sum to 1.0.
///
/// A neutral input (R=G=B, as produced by the gray-world WB) is then mapped
/// to a neutral output, because each output channel becomes a convex-ish
/// combination of equal inputs. This is dcraw's gray-preservation step and
/// is what lets us use a real per-camera color matrix without the magenta
/// cast that comes from composing an un-normalized matrix with our WB.
fn normalize_matrix_rows(m: [f32; 9]) -> [f32; 9] {
    let mut out = m;
    for r in 0..3 {
        let sum = m[r * 3] + m[r * 3 + 1] + m[r * 3 + 2];
        if sum.abs() > 1e-6 {
            out[r * 3] /= sum;
            out[r * 3 + 1] /= sum;
            out[r * 3 + 2] /= sum;
        }
    }
    out
}

/// Stub — kept for future use when WB-compatible per-camera matrices
/// are wired up. Currently unused (we use `auto_wb_gray_world`).
fn matrix_compatible_wb(_model: &str) -> [f32; 3] {
    [2.163, 1.0, 1.364]
}

/// Gray-world auto white balance: scale each CFA channel so all three
/// average values match. Works well for scenes with mixed colors that
/// average to neutral. Robust against scenes with strong color casts
/// up to a point.
fn auto_wb_gray_world(normalized: &[f32], w: usize, h: usize, cfa: &[u8], cfa_period: usize) -> [f32; 3] {
    let mut sums = [0.0f64; 3];
    let mut counts = [0u64; 3];
    // Skip the outer 5% margin (overscan or sensor edge effects).
    let m_y = h / 20;
    let m_x = w / 20;
    for row in m_y..(h - m_y) {
        for col in m_x..(w - m_x) {
            let v = normalized[row * w + col];
            if v < 0.001 { continue; } // skip black/overscan
            let cfa_idx = (row % cfa_period) * cfa_period + (col % cfa_period);
            let color = cfa[cfa_idx] as usize;
            sums[color] += v as f64;
            counts[color] += 1;
        }
    }
    let avg = [
        if counts[0] > 0 { sums[0] / counts[0] as f64 } else { 1.0 },
        if counts[1] > 0 { sums[1] / counts[1] as f64 } else { 1.0 },
        if counts[2] > 0 { sums[2] / counts[2] as f64 } else { 1.0 },
    ];
    let g = avg[1].max(1e-6);
    [
        (g / avg[0].max(1e-6)) as f32,
        1.0,
        (g / avg[2].max(1e-6)) as f32,
    ]
}

const DEFAULT_XTRANS_CFA: [u8; 36] = [
    1, 0, 2, 1, 2, 0,
    2, 1, 1, 0, 1, 1,
    0, 1, 1, 2, 1, 1,
    1, 2, 0, 1, 0, 2,
    0, 1, 1, 2, 1, 1,
    2, 1, 1, 0, 1, 1,
];

// ── CFA header parser (TLV) ────────────────────────────────────

struct CfaHeaderInfo {
    cfa_pattern: Option<[u8; 36]>,
    crop_top: u32,
    crop_left: u32,
    output_width: Option<u32>,
    output_height: Option<u32>,
}

fn parse_cfa_header(header: &[u8]) -> Option<CfaHeaderInfo> {
    if header.len() < 4 { return None; }

    let entry_count = read_be_u32(header, 0) as usize;
    let mut pos = 4;

    let mut cfa_pattern: Option<[u8; 36]> = None;
    let mut crop_top: u32 = 0;
    let mut crop_left: u32 = 0;
    let mut output_width: Option<u32> = None;
    let mut output_height: Option<u32> = None;

    for _ in 0..entry_count {
        if pos + 4 > header.len() { break; }
        let tag = read_be_u16(header, pos);
        let val_len = read_be_u16(header, pos + 2) as usize;
        pos += 4;
        if pos + val_len > header.len() { break; }

        match tag {
            0x0110 if val_len == 4 => {
                // Crop offsets: top (u16 BE), left (u16 BE)
                crop_top = read_be_u16(header, pos) as u32;
                crop_left = read_be_u16(header, pos + 2) as u32;
            }
            0x0111 if val_len == 4 => {
                // Output dimensions: height (u16 BE), width (u16 BE)
                let h = read_be_u16(header, pos) as u32;
                let w = read_be_u16(header, pos + 2) as u32;
                output_height = Some(h);
                output_width = Some(w);
            }
            0x0131 if val_len == 36 => {
                let mut pat = [0u8; 36];
                pat.copy_from_slice(&header[pos..pos + 36]);
                cfa_pattern = Some(pat);
            }
            _ => {}
        }

        pos += val_len;
    }

    Some(CfaHeaderInfo { cfa_pattern, crop_top, crop_left, output_width, output_height })
}

// ── CFA data TIFF parser ────────────────────────────────────────

struct CfaMeta {
    width: u32,
    height: u32,
    bits_per_sample: u32,
    strip_offset: u32,
    strip_byte_count: u32,
    is_compressed: bool,
    black_level: Option<f64>,
}

fn parse_cfa_tiff(cfa_section: &[u8]) -> Result<CfaMeta, String> {
    let reader = TiffReader::new(cfa_section)
        .map_err(|e| format!("CFA data is not a valid TIFF: {e}"))?;

    let ifd0 = reader.read_ifd(0)
        .map_err(|e| format!("Cannot read CFA TIFF IFD0: {e}"))?;

    let sub_ifd_offset = ifd0.iter()
        .find(|e| e.tag == 0xF000)
        .and_then(|e| e.as_u32())
        .ok_or("CFA TIFF missing tag 0xF000 (Fujifilm sub-IFD)")?;

    let sub_ifd = reader.read_ifd_at(sub_ifd_offset)
        .map_err(|e| format!("Cannot read Fujifilm sub-IFD: {e}"))?;

    let get_u32 = |tag: u16| -> Option<u32> {
        sub_ifd.iter().find(|e| e.tag == tag).and_then(|e| e.as_u32())
    };

    let width = get_u32(0xF001).ok_or("Missing 0xF001 (width)")?;
    let height = get_u32(0xF002).ok_or("Missing 0xF002 (height)")?;
    let bits = get_u32(0xF003).unwrap_or(14);
    let strip_offset = get_u32(0xF007).ok_or("Missing 0xF007 (strip offset)")?;
    let strip_byte_count = get_u32(0xF008).ok_or("Missing 0xF008 (strip byte count)")?;

    let is_compressed = (strip_byte_count as u64) < (width as u64 * height as u64 * 2);

    let black_level = sub_ifd.iter()
        .find(|e| e.tag == 0xF00A)
        .and_then(|e| {
            let vals = e.as_u32_vec()?;
            if vals.is_empty() { return None; }
            Some(vals.iter().map(|&v| v as f64).sum::<f64>() / vals.len() as f64)
        });

    Ok(CfaMeta { width, height, bits_per_sample: bits, strip_offset, strip_byte_count, is_compressed, black_level })
}

// ── X-Trans detection ───────────────────────────────────────────

fn camera_model_is_xtrans(model: &str) -> bool {
    let m = model.to_uppercase();
    if m.contains("X-A") || m.contains("GFX") || m.contains("XF") {
        return false;
    }
    m.contains("X-T") || m.contains("X-H") || m.contains("X-PRO") || m.contains("X-E")
        || m.contains("X-S") || m.contains("X100") || m.contains("X70")
        || m.contains("X-M")
}

// ── Color matrices ──────────────────────────────────────────────

fn color_matrix_for_model(model: &str) -> [f32; 9] {
    let m = model.to_uppercase();

    let cm: [f64; 9] = if m.contains("X100VI") {
        [12662.0, -5961.0, -1025.0, -4129.0, 12025.0, 2399.0, -752.0, 1455.0, 6531.0]
    } else if m.contains("X-T5") || m.contains("X-H2") || m.contains("X-S20") {
        [12662.0, -5961.0, -1025.0, -4129.0, 12025.0, 2399.0, -752.0, 1455.0, 6531.0]
    } else if m.contains("X-T4") || m.contains("X-T30") || m.contains("X-S10")
        || m.contains("X-E4") || m.contains("X-PRO3") || m.contains("X100V")
    {
        [11434.0, -4948.0, -1210.0, -3746.0, 12042.0, 1903.0, -666.0, 1479.0, 6365.0]
    } else if m.contains("X-T3") || m.contains("X-T20") || m.contains("X-E3")
        || m.contains("X-H1") || m.contains("X-PRO2") || m.contains("X100F")
    {
        [11434.0, -4948.0, -1210.0, -3746.0, 12042.0, 1903.0, -666.0, 1479.0, 6365.0]
    } else if m.contains("X-T2") || m.contains("X-T1") || m.contains("X-T10")
        || m.contains("X-E2") || m.contains("X-PRO1") || m.contains("X100S")
        || m.contains("X100T")
    {
        [10413.0, -3996.0, -993.0, -3721.0, 11640.0, 2361.0, -733.0, 1540.0, 6011.0]
    } else if m.contains("GFX") {
        [11771.0, -4689.0, -1322.0, -3625.0, 11999.0, 1830.0, -612.0, 1412.0, 6466.0]
    } else {
        [11434.0, -4948.0, -1210.0, -3746.0, 12042.0, 1903.0, -666.0, 1479.0, 6365.0]
    };

    let cm_normalized: [f64; 9] = [
        cm[0] / 10000.0, cm[1] / 10000.0, cm[2] / 10000.0,
        cm[3] / 10000.0, cm[4] / 10000.0, cm[5] / 10000.0,
        cm[6] / 10000.0, cm[7] / 10000.0, cm[8] / 10000.0,
    ];

    color::color_matrix_to_srgb(&cm_normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_normalized_matrix_keeps_gray_neutral() {
        // The row-normalized per-camera matrix must map a neutral input
        // (R=G=B) to a neutral output — no magenta/green cast.
        for model in ["X-T5", "X-T4", "X-T3", "X-T2", "GFX100", "X100VI", "unknown"] {
            let m = normalize_matrix_rows(color_matrix_for_model(model));
            for r in 0..3 {
                let sum = m[r * 3] + m[r * 3 + 1] + m[r * 3 + 2];
                assert!((sum - 1.0).abs() < 1e-5, "{model} row {r} sums to {sum}");
            }
            let mut rgb = [0.5f32, 0.5, 0.5];
            color::apply_matrix(&mut rgb, &m);
            assert!(
                (rgb[0] - 0.5).abs() < 1e-5
                    && (rgb[1] - 0.5).abs() < 1e-5
                    && (rgb[2] - 0.5).abs() < 1e-5,
                "{model} gray → {:?}",
                rgb
            );
        }
    }

    #[test]
    fn unsharp_mask_leaves_flat_field_untouched() {
        // A flat field has no high-frequency detail, so sharpening is a no-op.
        let w = 8;
        let h = 8;
        let mut rgb = vec![0.5f32; w * h * 3];
        unsharp_mask_luma(&mut rgb, w, h, CAPTURE_SHARPEN_AMOUNT);
        for v in &rgb {
            assert!((v - 0.5).abs() < 1e-5, "flat field changed: {v}");
        }
    }

    #[test]
    fn unsharp_mask_increases_edge_contrast_without_color_shift() {
        // A vertical gray step edge should get crisper (the dark side darker,
        // the light side lighter near the edge) while staying neutral gray.
        let w = 9;
        let h = 3;
        let mut rgb = vec![0.0f32; w * h * 3];
        for row in 0..h {
            for col in 0..w {
                let v = if col < w / 2 { 0.3 } else { 0.7 };
                let o = (row * w + col) * 3;
                rgb[o] = v;
                rgb[o + 1] = v;
                rgb[o + 2] = v;
            }
        }
        let before = rgb.clone();
        unsharp_mask_luma(&mut rgb, w, h, CAPTURE_SHARPEN_AMOUNT);

        // Pixel just left of the edge gets darker; just right gets lighter.
        let mid = h / 2;
        let left = (mid * w + (w / 2 - 1)) * 3;
        let right = (mid * w + (w / 2)) * 3;
        assert!(rgb[left] < before[left], "left of edge should darken");
        assert!(rgb[right] > before[right], "right of edge should brighten");
        // Output stays neutral gray (R==G==B) everywhere.
        for i in 0..w * h {
            let o = i * 3;
            assert!((rgb[o] - rgb[o + 1]).abs() < 1e-5 && (rgb[o + 1] - rgb[o + 2]).abs() < 1e-5);
        }
    }

    #[test]
    fn color_matrix_is_finite_and_sane() {
        // Diagonal-dominant, finite coefficients — a real cam→sRGB matrix,
        // not the degenerate identity returned on inversion failure.
        let m = color_matrix_for_model("X-T5");
        for v in m {
            assert!(v.is_finite());
        }
        assert!(m[0] > 0.0 && m[4] > 0.0 && m[8] > 0.0, "diagonal must be positive: {m:?}");
        assert_ne!(m, [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0], "matrix inversion failed");
    }
}
