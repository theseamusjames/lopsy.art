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

/// Which demosaic algorithm `read_raf_opts` uses for X-Trans sensors.
#[derive(Clone, Copy, PartialEq)]
pub enum DemosaicMode {
    /// Full Markesteijn multi-pass (production quality).
    Markesteijn,
    /// Nearest-same-colour lookup, phase-faithful but deliberately dumb.
    /// Used only for the demosaic-localisation experiment.
    Nearest,
}

/// Decode options for `read_raf_opts`.
#[derive(Clone, Copy)]
pub struct RafDecodeOpts {
    pub demosaic: DemosaicMode,
    /// Whether to apply post-demosaic chroma + luma denoise.
    pub denoise: bool,
}

impl Default for RafDecodeOpts {
    fn default() -> Self {
        Self { demosaic: DemosaicMode::Markesteijn, denoise: true }
    }
}

/// EXIF and Fujifilm makernote metadata extracted from the embedded JPEG preview.
#[derive(Debug, Clone, Default)]
pub struct RafExifInfo {
    /// EXIF orientation tag (0x0112). Defaults to 1 (no rotation) when absent.
    pub orientation: u16,
    /// Fujifilm FilmMode makernote tag (0x1401). None when absent or unreadable.
    pub film_mode: Option<u16>,
    /// Fujifilm WhiteBalance makernote tag (0x1002). None when absent or unreadable.
    pub white_balance: Option<u16>,
    /// Fujifilm DynamicRange makernote tag (0x1400). None when absent or unreadable.
    pub dynamic_range: Option<u16>,
}

pub struct RafImage {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<f32>,
    pub exif_info: RafExifInfo,
    pub debug_log: Vec<String>,
}

/// Decode a Fujifilm RAF file with production defaults (Markesteijn demosaic,
/// denoise on). This is the stable public interface called by the WASM bridge;
/// its behaviour is identical to the pre-opts code.
pub fn read_raf(data: &[u8]) -> Result<RafImage, String> {
    read_raf_opts(data, RafDecodeOpts::default())
}

/// Decode a Fujifilm RAF file with caller-supplied options.
///
/// `opts.demosaic` selects the X-Trans demosaic algorithm (Bayer path is
/// always bilinear regardless). `opts.denoise` gates the chroma-median
/// and luma-bilateral post-demosaic passes.
pub fn read_raf_opts(data: &[u8], opts: RafDecodeOpts) -> Result<RafImage, String> {
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

    // EXIF orientation and Fujifilm makernote tags live in the JPEG preview
    // block. Parse them together so we avoid walking the APP1 structure twice.
    let jpeg_offset = read_be_u32(data, 84) as usize;
    let jpeg_length = read_be_u32(data, 88) as usize;
    let exif_info = if jpeg_offset > 0 && jpeg_offset + jpeg_length <= data.len() {
        parse_raf_exif(&data[jpeg_offset..jpeg_offset + jpeg_length])
    } else {
        RafExifInfo { orientation: 1, ..Default::default() }
    };
    let exif_orientation = if exif_info.orientation == 0 { 1 } else { exif_info.orientation };
    raf_log!("[RAF] EXIF orientation: {}", exif_orientation);
    raf_log!("[RAF] film_mode: {:?}, white_balance: {:?}, dynamic_range: {:?}",
        exif_info.film_mode, exif_info.white_balance, exif_info.dynamic_range);

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
    // These sensors' raw R≈G≈B for provably-neutral subjects (measured
    // R/G≈0.95, B/G≈0.94), so the as-shot levels from tag 0xF00D
    // (~[1.745, 1, 1.805]) are wrong as direct multipliers — they
    // over-boost R and B and produce a magenta cast. Gray-world
    // auto-WB approximates the correct near-unity multipliers well.
    //
    // The as-shot value is preserved in CfaMeta.as_shot_wb for reference.

    let is_xtrans = camera_model_is_xtrans(&camera_model);
    let base_pat = cfa_pattern.as_ref().copied().unwrap_or(DEFAULT_XTRANS_CFA);
    let cfa = if is_xtrans {
        let (rs, cs) = detect_cfa_shift(&normalized, w, h, &base_pat, crop_top as usize, crop_left as usize);
        raf_log!("[RAF] CFA phase auto-detected: row_shift={}, col_shift={}", rs, cs);
        shift_cfa(&base_pat, rs, cs)
    } else {
        [0u8, 1, 1, 2, 0, 1, 1, 2, 0, 1, 1, 2, 0, 1, 1, 2,
         0, 1, 1, 2, 0, 1, 1, 2, 0, 1, 1, 2, 0, 1, 1, 2,
         0, 1, 1, 2]
    };
    let cfa_period = if is_xtrans { 6 } else { 2 };

    // Use the camera's as-shot WB from tag 0xF00D when present; it is expressed
    // as [r/g, 1, b/g] multipliers. Fall back to gray-world only when absent
    // (e.g. some third-party RAF writers omit the tag). The as-shot values can
    // clip R/B highlights before G, but desaturate_highlights (applied later)
    // handles that by blending towards neutral luma.
    let wb = if let Some(as_shot) = cfa_meta.as_shot_wb {
        raf_log!("[RAF] WB source: as-shot (tag 0xF00D): [{:.4}, {:.4}, {:.4}]",
            as_shot[0], as_shot[1], as_shot[2]);
        as_shot
    } else {
        let gw = auto_wb_gray_world(&normalized, w, h, &cfa, cfa_period);
        raf_log!("[RAF] WB source: gray-world fallback: [{:.4}, {:.4}, {:.4}]",
            gw[0], gw[1], gw[2]);
        gw
    };
    for row in 0..h {
        for col in 0..w {
            let cfa_idx = (row % cfa_period) * cfa_period + (col % cfa_period);
            let color = cfa[cfa_idx] as usize;
            normalized[row * w + col] *= wb[color];
        }
    }

    // ── Demosaic ────────────────────────────────────────────────

    let mut rgb_f32 = if is_xtrans {
        match opts.demosaic {
            DemosaicMode::Markesteijn => {
                raf_log!("[RAF] X-Trans demosaic Markesteijn");
                xtrans::demosaic_xtrans(&normalized, width, height, &cfa)
            }
            DemosaicMode::Nearest => {
                raf_log!("[RAF] X-Trans demosaic nearest-neighbour (diagnostic)");
                xtrans::demosaic_nearest(&normalized, width, height, &cfa)
            }
        }
    } else {
        raf_log!("[RAF] Bayer demosaic");
        demosaic::bilinear(&normalized, width, height, &cfa[..4])
    };

    // ── Color matrix ────────────────────────────────────────────
    // Real per-camera camera→sRGB matrix derived from the DNG ColorMatrix1
    // values in `color_matrix_for_model`. Column-scaled (neutralized) so
    // that a neutral input (R=G=B, as produced by the as-shot WB) maps to
    // a neutral output — this preserves off-diagonal saturation structure
    // unlike per-row normalization, which scales each row independently and
    // crushes saturation by up to ~5%.

    let cam_to_srgb = color::neutralize_matrix(&color_matrix_for_model(&camera_model));
    raf_log!(
        "[RAF] cam→sRGB (neutralized): [{:.3} {:.3} {:.3}; {:.3} {:.3} {:.3}; {:.3} {:.3} {:.3}]",
        cam_to_srgb[0], cam_to_srgb[1], cam_to_srgb[2],
        cam_to_srgb[3], cam_to_srgb[4], cam_to_srgb[5],
        cam_to_srgb[6], cam_to_srgb[7], cam_to_srgb[8]
    );

    color::apply_matrix(&mut rgb_f32, &cam_to_srgb);

    // ── Chroma denoise ─────────────────────────────────────────
    // Remove the magenta/green speckle that X-Trans demosaicing leaves on
    // real sensor data by median-filtering the color-difference planes.
    // A median erases isolated false-color pixels while preserving edges
    // and real color regions — unlike a box blur it cannot desaturate.
    if opts.denoise {
        // The green-sublattice phase misalignment is now fixed at the source,
        // so this is a mild residual chroma noise pass — not a grid-eraser.
        // Radius 1 (3-wide separable median) removes isolated false-color speckle
        // while leaving real color edges and fine detail intact.
        raf_log!("[RAF] chroma denoise (separable median, radius 1)");
        denoise_chroma(&mut rgb_f32, w, h);

        // ── Luma denoise (bilateral, linear space) ──────────────────
        // Mild grain reduction on real sensor noise. The green-sublattice weave
        // that previously required a radius-3 bilateral to span the full 6×6 CFA
        // period is now eliminated at the demosaic phase, so a lighter pass
        // suffices. range_sigma ~0.03 bridges only same-level sensor grain;
        // real edges (much larger step) are unaffected.
        raf_log!("[RAF] luma denoise bilateral (radius=2, range_sigma=0.03)");
        denoise_luma_bilateral(&mut rgb_f32, w, h, 2, 0.03);
    } else {
        raf_log!("[RAF] denoise skipped (opts.denoise=false)");
    }

    // ── Film-sim saturation (linear space) ─────────────────────
    // Fuji film sims are much more saturated than a plain colorimetric
    // matrix render. Applied here in linear light — before the tone curve
    // and gamma — where the luma-preserving boost is strongest. Linear
    // saturation can push the minimum channel slightly negative; that is
    // intentional (later RGBA conversion clamps to [0,1]).
    let sat = base_curves::saturation_for_film_mode(exif_info.film_mode);
    raf_log!("[RAF] film-sim saturation (linear): {sat}");
    apply_saturation(&mut rgb_f32, sat);

    // ── Exposure boost ─────────────────────────────────────────
    // Raw sensor data uses ~30% of the 14-bit range (cameras expose for
    // highlights to preserve headroom). The as-shot WB already boosts R/B
    // ~1.8×, so a smaller scale is needed than with gray-world. Done in
    // linear space.
    const EXPOSURE_SCALE: f32 = 1.3;
    for v in rgb_f32.iter_mut() {
        *v *= EXPOSURE_SCALE;
    }

    // ── Highlight desaturation ──────────────────────────────────
    // Bright areas can clip unevenly across R/G/B channels, which renders
    // blown highlights as a colour cast rather than white. Blend pixels
    // smoothly toward a neutral luminance-gray as they exceed 1.0 so that
    // clipped regions go white instead of tinted.
    desaturate_highlights(&mut rgb_f32);

    // ── Base curve (per-camera tone mapping) ───────────────────
    // Approximates the camera JPEG's tone rendering. The curve provides
    // its own highlight rolloff, replacing the previous Reinhard-style
    // compression, and shapes shadows/midtones to match the in-camera
    // look. Applied in linear light, before sRGB gamma.
    //
    // Prefer the film simulation recorded in the makernote when available;
    // fall back to the generic Provia default.
    let curve = base_curves::curve_for_film_mode(exif_info.film_mode);
    raf_log!("[RAF] film_mode={:?} → base curve: {} (luminance-preserving)", exif_info.film_mode, curve.name);
    let curve_lut = base_curves::curve_lut(curve);
    color::apply_lut(&mut rgb_f32, &curve_lut);

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
        crate::orientation::apply_exif_orientation(width, height, &rgba, exif_orientation);

    Ok(RafImage { width: final_w, height: final_h, pixels: final_pixels, exif_info, debug_log })
}

/// Diagnostic accessor: run the decode up to and including per-CFA-channel
/// white balance, returning the cropped WB-applied mosaic plane plus dims and
/// the shifted CFA pattern. Used only by the demosaic-localisation experiment.
pub fn debug_wb_mosaic(data: &[u8]) -> Result<(Vec<f32>, usize, usize, [u8; 36]), String> {
    if data.len() < 120 {
        return Err("File too small for RAF header".into());
    }
    if &data[0..16] != b"FUJIFILMCCD-RAW " {
        return Err("Not a Fujifilm RAF file (bad magic)".into());
    }

    let camera_model = parse_camera_model(&data[28..60]);

    let cfa_header_offset = read_be_u32(data, 92) as usize;
    let cfa_header_length = read_be_u32(data, 96) as usize;
    let cfa_data_offset   = read_be_u32(data, 100) as usize;
    let cfa_data_length   = read_be_u32(data, 104) as usize;

    if cfa_data_offset + cfa_data_length > data.len() {
        return Err("CFA data extends past end of file".into());
    }

    let cfa_header_info = if cfa_header_offset > 0
        && cfa_header_offset + cfa_header_length <= data.len()
        && cfa_header_length >= 4
    {
        parse_cfa_header(&data[cfa_header_offset..cfa_header_offset + cfa_header_length])
    } else {
        None
    };

    let cfa_pattern  = cfa_header_info.as_ref().and_then(|h| h.cfa_pattern);
    let crop_top     = cfa_header_info.as_ref().map(|h| h.crop_top).unwrap_or(0);
    let crop_left    = cfa_header_info.as_ref().map(|h| h.crop_left).unwrap_or(0);
    let out_w        = cfa_header_info.as_ref().and_then(|h| h.output_width);
    let out_h        = cfa_header_info.as_ref().and_then(|h| h.output_height);

    let cfa_section = &data[cfa_data_offset..cfa_data_offset + cfa_data_length];
    let cfa_meta    = parse_cfa_tiff(cfa_section)?;

    let raw_w  = cfa_meta.width as usize;
    let raw_h  = cfa_meta.height as usize;
    let bits   = cfa_meta.bits_per_sample;
    let pixel_offset = cfa_meta.strip_offset as usize;
    let pixel_bytes  = cfa_meta.strip_byte_count as usize;

    if pixel_offset + pixel_bytes > cfa_section.len() {
        return Err("Pixel data extends past CFA section".into());
    }
    let pixel_data = &cfa_section[pixel_offset..pixel_offset + pixel_bytes];

    let white_level: u16 = if bits > 0 && bits <= 16 {
        ((1u32 << bits) - 1) as u16
    } else {
        u16::MAX
    };

    let base_pat_for_decompress = cfa_pattern.as_ref().copied().unwrap_or(DEFAULT_XTRANS_CFA);
    let structured_compressed = compression::is_compressed_strip(pixel_data, raw_w as u32, raw_h as u32);
    let is_compressed = cfa_meta.is_compressed || structured_compressed;

    let raw_plane: Vec<u16> = if is_compressed {
        compression::decompress_fuji_strip(pixel_data, raw_w as u32, raw_h as u32, &base_pat_for_decompress)
            .map_err(|e| format!("Compressed RAF decode failed: {e}"))?
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

    let width  = out_w.unwrap_or(raw_w as u32).min(raw_w as u32 - crop_left as u32);
    let height = out_h.unwrap_or(raw_h as u32).min(raw_h as u32 - crop_top as u32);
    let w = width as usize;
    let h = height as usize;

    let black   = cfa_meta.black_level.unwrap_or(0.0);
    let max_val = white_level as f64;
    let range   = max_val - black;

    let mut normalized: Vec<f32> = Vec::with_capacity(w * h);
    for row in 0..h {
        let src_row = row + crop_top as usize;
        for col in 0..w {
            let src_col = col + crop_left as usize;
            let idx = src_row * raw_w + src_col;
            let v = raw_plane.get(idx).copied().unwrap_or(0).min(white_level);
            normalized.push(((v as f64 - black) / range).clamp(0.0, 1.0) as f32);
        }
    }

    let is_xtrans = camera_model_is_xtrans(&camera_model);
    let base_pat = cfa_pattern.as_ref().copied().unwrap_or(DEFAULT_XTRANS_CFA);
    let cfa = if is_xtrans {
        let (rs, cs) = detect_cfa_shift(&normalized, w, h, &base_pat, crop_top as usize, crop_left as usize);
        shift_cfa(&base_pat, rs, cs)
    } else {
        [0u8, 1, 1, 2, 0, 1, 1, 2, 0, 1, 1, 2, 0, 1, 1, 2,
         0, 1, 1, 2, 0, 1, 1, 2, 0, 1, 1, 2, 0, 1, 1, 2,
         0, 1, 1, 2]
    };
    let cfa_period = if is_xtrans { 6 } else { 2 };

    let wb = if let Some(as_shot) = cfa_meta.as_shot_wb {
        as_shot
    } else {
        auto_wb_gray_world(&normalized, w, h, &cfa, cfa_period)
    };
    for row in 0..h {
        for col in 0..w {
            let cfa_idx = (row % cfa_period) * cfa_period + (col % cfa_period);
            let color = cfa[cfa_idx] as usize;
            normalized[row * w + col] *= wb[color];
        }
    }

    Ok((normalized, w, h, cfa))
}

/// Diagnostic accessor: decode up to the cropped, normalised raw mosaic
/// (black-subtracted, [0,1]) BEFORE white balance, returning it with dims, the
/// raw 6×6 CFA pattern as read from the file (tag 0x0131, Fuji indices, NOT
/// shifted/remapped), and the crop offsets. Used by the CFA phase-alignment sweep.
///
/// Returns `(normalized, w, h, base_pattern_from_file, crop_top, crop_left)`.
/// For compressed RAF files this returns an error — convert to uncompressed first.
pub fn debug_raw_mosaic(data: &[u8]) -> Result<(Vec<f32>, usize, usize, [u8; 36], u32, u32), String> {
    if data.len() < 120 {
        return Err("File too small for RAF header".into());
    }
    if &data[0..16] != b"FUJIFILMCCD-RAW " {
        return Err("Not a Fujifilm RAF file (bad magic)".into());
    }

    let cfa_header_offset = read_be_u32(data, 92) as usize;
    let cfa_header_length = read_be_u32(data, 96) as usize;
    let cfa_data_offset   = read_be_u32(data, 100) as usize;
    let cfa_data_length   = read_be_u32(data, 104) as usize;

    if cfa_data_offset + cfa_data_length > data.len() {
        return Err("CFA data extends past end of file".into());
    }

    let cfa_header_info = if cfa_header_offset > 0
        && cfa_header_offset + cfa_header_length <= data.len()
        && cfa_header_length >= 4
    {
        parse_cfa_header(&data[cfa_header_offset..cfa_header_offset + cfa_header_length])
    } else {
        None
    };

    let cfa_pattern  = cfa_header_info.as_ref().and_then(|h| h.cfa_pattern);
    let crop_top     = cfa_header_info.as_ref().map(|h| h.crop_top).unwrap_or(0);
    let crop_left    = cfa_header_info.as_ref().map(|h| h.crop_left).unwrap_or(0);
    let out_w        = cfa_header_info.as_ref().and_then(|h| h.output_width);
    let out_h        = cfa_header_info.as_ref().and_then(|h| h.output_height);

    // The base pattern from file (Fuji indices: 0=B, 1=G, 2=R) — NOT shifted/remapped.
    let base_pat = cfa_pattern.unwrap_or(DEFAULT_XTRANS_CFA);

    let cfa_section = &data[cfa_data_offset..cfa_data_offset + cfa_data_length];
    let cfa_meta    = parse_cfa_tiff(cfa_section)?;

    let raw_w  = cfa_meta.width as usize;
    let raw_h  = cfa_meta.height as usize;
    let bits   = cfa_meta.bits_per_sample;
    let pixel_offset = cfa_meta.strip_offset as usize;
    let pixel_bytes  = cfa_meta.strip_byte_count as usize;

    if pixel_offset + pixel_bytes > cfa_section.len() {
        return Err("Pixel data extends past CFA section".into());
    }
    let pixel_data = &cfa_section[pixel_offset..pixel_offset + pixel_bytes];

    let white_level: u16 = if bits > 0 && bits <= 16 {
        ((1u32 << bits) - 1) as u16
    } else {
        u16::MAX
    };

    let structured_compressed = compression::is_compressed_strip(pixel_data, raw_w as u32, raw_h as u32);
    let is_compressed = cfa_meta.is_compressed || structured_compressed;

    if is_compressed {
        return Err("debug_raw_mosaic: compressed RAF not supported — convert to uncompressed first".into());
    }

    let expected_bytes = raw_w * raw_h * 2;
    if pixel_bytes < expected_bytes {
        return Err(format!("Pixel data too small: expected {expected_bytes}, got {pixel_bytes}"));
    }
    let mut raw_plane = Vec::with_capacity(raw_w * raw_h);
    for i in 0..(raw_w * raw_h) {
        let off = i * 2;
        if off + 1 < pixel_data.len() {
            raw_plane.push(u16::from_le_bytes([pixel_data[off], pixel_data[off + 1]]));
        } else {
            raw_plane.push(0);
        }
    }

    let width  = out_w.unwrap_or(raw_w as u32).min(raw_w as u32 - crop_left as u32);
    let height = out_h.unwrap_or(raw_h as u32).min(raw_h as u32 - crop_top as u32);
    let w = width as usize;
    let h = height as usize;

    let black   = cfa_meta.black_level.unwrap_or(0.0);
    let max_val = white_level as f64;
    let range   = (max_val - black).max(1.0);

    let mut normalized = Vec::with_capacity(w * h);
    for row in 0..h {
        let src_row = row + crop_top as usize;
        for col in 0..w {
            let src_col = col + crop_left as usize;
            let idx = src_row * raw_w + src_col;
            let v = raw_plane.get(idx).copied().unwrap_or(0).min(white_level);
            normalized.push(((v as f64 - black) / range).clamp(0.0, 1.0) as f32);
        }
    }

    // Return the base pattern as read from file (Fuji indices, NOT shifted/remapped).
    Ok((normalized, w, h, base_pat, crop_top, crop_left))
}

/// Extract the embedded JPEG preview from a RAF file.
///
/// The preview offset (big-endian u32 at byte 84) and length (byte 88) are
/// the same fields used by `read_raf` when parsing EXIF orientation.
pub fn extract_jpeg_preview(data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 92 {
        return Err("File too small for RAF header".into());
    }
    if &data[0..16] != b"FUJIFILMCCD-RAW " {
        return Err("Not a Fujifilm RAF file (bad magic)".into());
    }
    let offset = read_be_u32(data, 84) as usize;
    let length = read_be_u32(data, 88) as usize;
    if offset == 0 || length == 0 {
        return Err("RAF has no JPEG preview (offset/length are zero)".into());
    }
    if offset + length > data.len() {
        return Err(format!(
            "JPEG preview extends past end of file (offset={offset}, length={length}, file_len={})",
            data.len()
        ));
    }
    Ok(data[offset..offset + length].to_vec())
}

/// Parse orientation and Fujifilm makernote tags from the JPEG preview bytes.
///
/// Walks APP1 → TIFF IFD0 → EXIF sub-IFD → Fujifilm makernote IFD.
/// Every step is defensive: on any bounds error or missing tag, the function
/// returns what it has so far rather than panicking.
pub fn parse_raf_exif(jpeg: &[u8]) -> RafExifInfo {
    let mut result = RafExifInfo { orientation: 1, ..Default::default() };

    let Some(tiff) = find_exif_tiff(jpeg) else { return result; };
    if tiff.len() < 8 { return result; }

    let le = tiff[0] == b'I' && tiff[1] == b'I';

    let ru16 = |data: &[u8], o: usize| -> Option<u16> {
        let b = data.get(o..o + 2)?;
        Some(if le { u16::from_le_bytes([b[0], b[1]]) } else { u16::from_be_bytes([b[0], b[1]]) })
    };
    let ru32 = |data: &[u8], o: usize| -> Option<u32> {
        let b = data.get(o..o + 4)?;
        Some(if le { u32::from_le_bytes([b[0], b[1], b[2], b[3]]) } else { u32::from_be_bytes([b[0], b[1], b[2], b[3]]) })
    };

    let ifd0_off = match ru32(tiff, 4) {
        Some(v) => v as usize,
        None => return result,
    };

    // Walk IFD0: collect orientation and the EXIF sub-IFD pointer.
    let Some(ifd0_count) = ru16(tiff, ifd0_off) else { return result; };
    let mut exif_ifd_off: Option<usize> = None;

    for j in 0..ifd0_count as usize {
        let e = ifd0_off + 2 + j * 12;
        let Some(tag) = ru16(tiff, e) else { break; };
        match tag {
            0x0112 => {
                if let Some(v) = ru16(tiff, e + 8) {
                    result.orientation = v;
                }
            }
            0x8769 => {
                if let Some(v) = ru32(tiff, e + 8) {
                    exif_ifd_off = Some(v as usize);
                }
            }
            _ => {}
        }
    }

    let exif_off = match exif_ifd_off {
        Some(o) => o,
        None => return result,
    };

    // Walk the EXIF sub-IFD to find the MakerNote (tag 0x927C).
    let Some(exif_count) = ru16(tiff, exif_off) else { return result; };
    let mut makernote_off: Option<usize> = None;

    for j in 0..exif_count as usize {
        let e = exif_off + 2 + j * 12;
        let Some(tag) = ru16(tiff, e) else { break; };
        if tag == 0x927C {
            // UNDEFINED type: value offset points into tiff data.
            if let Some(off) = ru32(tiff, e + 8) {
                makernote_off = Some(off as usize);
            }
            break;
        }
    }

    let mn_start = match makernote_off {
        Some(o) => o,
        None => return result,
    };

    // Fujifilm makernote: "FUJIFILM" (8 bytes) + u32 LE IFD offset relative
    // to the start of the makernote blob. The internal IFD is always LE.
    let Some(mn_blob) = tiff.get(mn_start..) else { return result; };
    if mn_blob.len() < 12 { return result; }
    if &mn_blob[..8] != b"FUJIFILM" { return result; }

    let mn_ifd_rel = u32::from_le_bytes([mn_blob[8], mn_blob[9], mn_blob[10], mn_blob[11]]) as usize;
    let Some(mn_ifd_blob) = mn_blob.get(mn_ifd_rel..) else { return result; };
    if mn_ifd_blob.len() < 2 { return result; }

    // Makernote IFD is always little-endian regardless of outer TIFF endianness.
    let mn_u16 = |data: &[u8], o: usize| -> Option<u16> {
        let b = data.get(o..o + 2)?;
        Some(u16::from_le_bytes([b[0], b[1]]))
    };

    let mn_count = u16::from_le_bytes([mn_ifd_blob[0], mn_ifd_blob[1]]) as usize;
    for j in 0..mn_count {
        let e = 2 + j * 12;
        let Some(tag) = mn_u16(mn_ifd_blob, e) else { break; };
        match tag {
            0x1002 => { result.white_balance = mn_u16(mn_ifd_blob, e + 8); }
            0x1400 => { result.dynamic_range = mn_u16(mn_ifd_blob, e + 8); }
            0x1401 => { result.film_mode = mn_u16(mn_ifd_blob, e + 8); }
            _ => {}
        }
    }

    result
}

/// Find the TIFF block inside a JPEG's APP1 "Exif\0\0" segment.
/// Returns a slice starting at the TIFF header ("II" or "MM").
fn find_exif_tiff(jpeg: &[u8]) -> Option<&[u8]> {
    let mut i = 2usize;
    while i + 4 < jpeg.len() {
        if jpeg[i] == 0xFF && jpeg[i + 1] == 0xE1 {
            let payload = jpeg.get(i + 4..)?;
            if payload.len() < 6 { return None; }
            if &payload[..4] != b"Exif" { return None; }
            return payload.get(6..);
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

/// Auto-detect the X-Trans CFA phase shift (row_shift, col_shift) to apply to
/// the file's base pattern. The green sublattice is physically ~1.8× brighter
/// than R/B sites, so the correct alignment is the (row_shift, col_shift) whose
/// green-labelled positions cluster tightest in per-position raw brightness.
/// Among the (R/B-ambiguous) best-scoring ties, prefer the shift implied by the
/// crop offset (sensor readout constant +4,+1 from crop%6) to resolve R vs B.
fn detect_cfa_shift(
    normalized: &[f32],
    w: usize,
    h: usize,
    base_pat: &[u8; 36],
    crop_top: usize,
    crop_left: usize,
) -> (usize, usize) {
    // Accumulate per-6×6-position mean brightness over the interior of the image.
    // Exclude the outer 1/8 border (overscan / sensor edge effects) and very dark
    // values (< 0.01) that are black pixels or below the black level.
    let row_start = h / 8;
    let row_end   = (7 * h) / 8;
    let col_start = w / 8;
    let col_end   = (7 * w) / 8;

    let mut pos_sum   = [0.0f64; 36];
    let mut pos_count = [0u64; 36];

    for row in row_start..row_end {
        for col in col_start..col_end {
            let v = normalized[row * w + col];
            if v < 0.01 {
                continue;
            }
            let pos = (row % 6) * 6 + (col % 6);
            pos_sum[pos]   += v as f64;
            pos_count[pos] += 1;
        }
    }

    let pos_mean: [f64; 36] = std::array::from_fn(|i| {
        if pos_count[i] > 0 { pos_sum[i] / pos_count[i] as f64 } else { 0.0 }
    });

    // Score each shift by how tightly its green positions cluster in brightness.
    // Lower spread (max−min for green + max−min for non-green) = better alignment.
    let mut best_score = f64::MAX;
    let mut best_shifts: Vec<(usize, usize)> = Vec::new();

    for rs in 0..6 {
        for cs in 0..6 {
            let mut g_min = f64::MAX;
            let mut g_max = f64::MIN;
            let mut non_g_min = f64::MAX;
            let mut non_g_max = f64::MIN;

            for r in 0..6 {
                for c in 0..6 {
                    let pat_idx = ((r + rs) % 6) * 6 + ((c + cs) % 6);
                    let mean = pos_mean[r * 6 + c];
                    if base_pat[pat_idx] == 1 {
                        // Fujifilm index 1 = green
                        if mean < g_min { g_min = mean; }
                        if mean > g_max { g_max = mean; }
                    } else {
                        if mean < non_g_min { non_g_min = mean; }
                        if mean > non_g_max { non_g_max = mean; }
                    }
                }
            }

            let g_spread    = if g_max > g_min { g_max - g_min } else { 0.0 };
            let non_g_spread = if non_g_max > non_g_min { non_g_max - non_g_min } else { 0.0 };
            let score = g_spread + non_g_spread;

            if score < best_score - 1e-6 {
                best_score = score;
                best_shifts.clear();
                best_shifts.push((rs, cs));
            } else if score < best_score + 1e-6 {
                best_shifts.push((rs, cs));
            }
        }
    }

    // Tie-break: the sensor readout places crop%6 at a constant (+4,+1) offset
    // from the physically-correct phase. Use that formula to resolve R/B when
    // multiple shifts score equally well.
    let formula = ((crop_top % 6 + 4) % 6, (crop_left % 6 + 1) % 6);
    if best_shifts.contains(&formula) {
        return formula;
    }

    best_shifts.into_iter().next().unwrap_or((1, 1))
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
/// back). Kept mild so it does not amplify chroma speckle from demosaicing.
const CAPTURE_SHARPEN_AMOUNT: f32 = 0.10;

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
#[allow(dead_code)]
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

/// Boost chroma to approximate the Fujifilm film-simulation look, which is
/// more saturated than a plain colorimetric matrix render. Luma-preserving
/// (Rec.709): each channel is pushed away from the pixel's luma by `factor`,
/// so grays stay neutral and only colored pixels gain saturation.
fn apply_saturation(rgb: &mut [f32], factor: f32) {
    if (factor - 1.0).abs() < 1e-4 { return; }
    let n = rgb.len() / 3;
    for i in 0..n {
        let o = i * 3;
        let luma = 0.2126 * rgb[o] + 0.7152 * rgb[o + 1] + 0.0722 * rgb[o + 2];
        rgb[o]     = luma + factor * (rgb[o]     - luma);
        rgb[o + 1] = luma + factor * (rgb[o + 1] - luma);
        rgb[o + 2] = luma + factor * (rgb[o + 2] - luma);
    }
    // (final RGBA conversion already clamps to [0,1])
}

/// Suppress chroma noise (the colored speckle X-Trans demosaicing leaves on
/// real, noisy sensor data) by median-filtering the color-difference planes.
/// Luma carries the detail and is left untouched. A 3×3 median removes
/// isolated false-color speckle while preserving edges and the chroma of
/// uniform colored regions — it does not average neighbors, so it cannot
/// desaturate a real color region the way a box blur would.
fn denoise_chroma(rgb: &mut [f32], w: usize, h: usize) {
    if w == 0 || h == 0 {
        return;
    }
    let n = w * h;

    // Extract per-pixel luma and three chroma-difference planes (R−luma, G−luma, B−luma).
    let mut luma = vec![0.0f32; n];
    let mut cr = vec![0.0f32; n];
    let mut cg = vec![0.0f32; n];
    let mut cb = vec![0.0f32; n];
    for i in 0..n {
        let o = i * 3;
        let l = 0.2126 * rgb[o] + 0.7152 * rgb[o + 1] + 0.0722 * rgb[o + 2];
        luma[i] = l;
        cr[i] = rgb[o]     - l;
        cg[i] = rgb[o + 1] - l;
        cb[i] = rgb[o + 2] - l;
    }

    // Residual chroma speckle from demosaicing (isolated false-color pixels).
    // The CFA phase is now correctly aligned at the source, so there is no
    // period-6 false-colour lattice to erase — a 3-wide median (radius 1)
    // is sufficient to clean up isolated outlier pixels without over-smoothing.
    const CHROMA_MEDIAN_RADIUS: i32 = 1;
    cr = median_filter_separable(&cr, w, h, CHROMA_MEDIAN_RADIUS);
    cg = median_filter_separable(&cg, w, h, CHROMA_MEDIAN_RADIUS);
    cb = median_filter_separable(&cb, w, h, CHROMA_MEDIAN_RADIUS);

    // Recombine: exact luma plus median-filtered chroma.
    for i in 0..n {
        let o = i * 3;
        rgb[o]     = luma[i] + cr[i];
        rgb[o + 1] = luma[i] + cg[i];
        rgb[o + 2] = luma[i] + cb[i];
    }
}

/// Edge-preserving luma noise reduction. Smooths luminance in flat regions
/// (sensor grain, residual demosaic texture) while leaving edges and fine
/// detail intact, by bilaterally weighting neighbours by both spatial distance
/// and luma similarity. Chroma is preserved exactly: only the luma is filtered
/// and RGB is rescaled by the luma ratio.
fn denoise_luma_bilateral(rgb: &mut [f32], w: usize, h: usize, radius: i32, range_sigma: f32) {
    if w == 0 || h == 0 || radius <= 0 {
        return;
    }
    let n = w * h;

    // Luma plane (Rec.709) for every pixel in the current linear-light RGB.
    let mut luma = vec![0.0f32; n];
    for i in 0..n {
        let o = i * 3;
        luma[i] = 0.2126 * rgb[o] + 0.7152 * rgb[o + 1] + 0.0722 * rgb[o + 2];
    }

    // Precompute spatial Gaussian weights for the (2r+1)×(2r+1) window.
    // Spatial sigma ≈ radius/2 keeps most weight near the centre, so real
    // detail is only marginally affected even when range_sigma is generous.
    let r = radius as usize;
    let side = 2 * r + 1;
    let spatial_sigma = radius as f32 * 0.5;
    let two_ss = 2.0 * spatial_sigma * spatial_sigma;
    let mut spatial_w = vec![0.0f32; side * side];
    for dy in 0..side {
        for dx in 0..side {
            let ddx = dx as f32 - r as f32;
            let ddy = dy as f32 - r as f32;
            spatial_w[dy * side + dx] = (-(ddx * ddx + ddy * ddy) / two_ss).exp();
        }
    }

    let two_rs = 2.0 * range_sigma * range_sigma;

    // Precompute the range weight exp(-dl²/2σ²) into a LUT keyed by |dl|. The
    // weight is negligible beyond ~4σ, so tabulating |dl| over [0, 4σ] and
    // treating anything past it as zero replaces a per-sample exp() (the hot-
    // path cost across a 40 MP image) with an index + load.
    const RANGE_LUT_N: usize = 1024;
    let range_max = (4.0 * range_sigma).max(1e-6);
    let inv_step = (RANGE_LUT_N as f32 - 1.0) / range_max;
    let mut range_lut = vec![0.0f32; RANGE_LUT_N];
    for k in 0..RANGE_LUT_N {
        let d = k as f32 / inv_step;
        range_lut[k] = (-(d * d) / two_rs).exp();
    }

    let mut luma_smooth = vec![0.0f32; n];

    for row in 0..h {
        for col in 0..w {
            let l_center = luma[row * w + col];
            let mut sum_w = 0.0f32;
            let mut sum_wl = 0.0f32;

            for dy in 0..side {
                let nr = (row as i32 + dy as i32 - r as i32).clamp(0, h as i32 - 1) as usize;
                let row_off = nr * w;
                let sw_off = dy * side;
                for dx in 0..side {
                    let nc = (col as i32 + dx as i32 - r as i32).clamp(0, w as i32 - 1) as usize;
                    let l_nb = luma[row_off + nc];
                    // Range weight via LUT: only same-level (noisy) neighbours
                    // contribute; across a real edge the weight collapses to 0.
                    let idx = ((l_center - l_nb).abs() * inv_step) as usize;
                    let range_w = if idx < RANGE_LUT_N { range_lut[idx] } else { 0.0 };
                    let w_ij = spatial_w[sw_off + dx] * range_w;
                    sum_w += w_ij;
                    sum_wl += w_ij * l_nb;
                }
            }

            luma_smooth[row * w + col] = if sum_w > 1e-8 { sum_wl / sum_w } else { l_center };
        }
    }

    // Rescale RGB by the smoothed/original luma ratio to update only luminance;
    // chroma ratios are kept exactly — same pattern as unsharp_mask_luma.
    for i in 0..n {
        let l_orig = luma[i];
        if l_orig > 1e-4 {
            let scale = luma_smooth[i] / l_orig;
            let o = i * 3;
            rgb[o]     *= scale;
            rgb[o + 1] *= scale;
            rgb[o + 2] *= scale;
        }
    }
}

/// 3×3 median filter on a single-channel plane, edge-clamped. Returns a new
/// buffer. Preserves edges far better than a box blur; removes isolated
/// false-color speckle without desaturating adjacent real-color pixels.
#[allow(dead_code)]
fn median_filter_3x3_plane(plane: &[f32], w: usize, h: usize) -> Vec<f32> {
    let mut out = vec![0.0f32; w * h];
    for row in 0..h {
        for col in 0..w {
            let mut win = [0.0f32; 9];
            let mut k = 0;
            for dy in -1i32..=1 {
                let r = (row as i32 + dy).clamp(0, h as i32 - 1) as usize;
                for dx in -1i32..=1 {
                    let c = (col as i32 + dx).clamp(0, w as i32 - 1) as usize;
                    win[k] = plane[r * w + c];
                    k += 1;
                }
            }
            out[row * w + col] = median9(win);
        }
    }
    out
}

/// Median of 9 values via partial selection (find the 5th-smallest).
#[inline]
#[allow(dead_code)]
fn median9(mut v: [f32; 9]) -> f32 {
    for i in 0..5 {
        let mut m = i;
        for j in (i + 1)..9 {
            if v[j] < v[m] {
                m = j;
            }
        }
        v.swap(i, m);
    }
    v[4]
}

/// Median of an odd-length window (`len` ≤ 33) via partial selection up to the
/// middle index. Allocation-free.
#[inline]
fn median_window(vals: &[f32]) -> f32 {
    let n = vals.len();
    let mid = n / 2;
    let mut v = [0.0f32; 33];
    v[..n].copy_from_slice(vals);
    for i in 0..=mid {
        let mut m = i;
        for j in (i + 1)..n {
            if v[j] < v[m] {
                m = j;
            }
        }
        v.swap(i, m);
    }
    v[mid]
}

/// Separable median filter (horizontal pass then vertical pass) of half-width
/// `radius`, edge-clamped. A separable approximation to a full (2r+1)² median:
/// far cheaper, while still erasing periodic structure up to the window width.
/// Used on the chroma planes to remove the CFA-period (6 px) false-colour
/// lattice, which a 3×3 median's reach cannot cover.
fn median_filter_separable(plane: &[f32], w: usize, h: usize, radius: i32) -> Vec<f32> {
    let width = (2 * radius + 1) as usize;
    let mut buf = vec![0.0f32; width];

    let mut tmp = vec![0.0f32; w * h];
    for row in 0..h {
        let base = row * w;
        for col in 0..w {
            for k in -radius..=radius {
                let c = (col as i32 + k).clamp(0, w as i32 - 1) as usize;
                buf[(k + radius) as usize] = plane[base + c];
            }
            tmp[base + col] = median_window(&buf);
        }
    }

    let mut out = vec![0.0f32; w * h];
    for col in 0..w {
        for row in 0..h {
            for k in -radius..=radius {
                let r = (row as i32 + k).clamp(0, h as i32 - 1) as usize;
                buf[(k + radius) as usize] = tmp[r * w + col];
            }
            out[row * w + col] = median_window(&buf);
        }
    }
    out
}


/// Blend over-exposed pixels toward neutral gray so that blown highlights
/// render white instead of pink. The as-shot WB boost makes R and B clip
/// before G; without this step, areas just above 1.0 show a pink fringe
/// because R/B are at 1.0 while G still has headroom. Values remain
/// unclamped here — the final RGBA conversion clamps to [0,1].
fn desaturate_highlights(rgb: &mut [f32]) {
    let n = rgb.len() / 3;
    for i in 0..n {
        let r = rgb[i * 3];
        let g = rgb[i * 3 + 1];
        let b = rgb[i * 3 + 2];
        let m = r.max(g).max(b);
        if m > 1.0 {
            let t = ((m - 1.0) / 0.5).min(1.0);
            rgb[i * 3]     = r + t * (m - r);
            rgb[i * 3 + 1] = g + t * (m - g);
            rgb[i * 3 + 2] = b + t * (m - b);
        }
    }
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
    as_shot_wb: Option<[f32; 3]>,
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

    // Tag 0xF00D: Fujifilm as-shot white balance, LONG[3] in [G, R, B] order.
    // Green is the reference channel (typically 302); R and B are larger when
    // the scene is warm/cool. Normalising to G gives the per-channel multipliers
    // the demosaicker needs to make a neutral gray render as neutral.
    let as_shot_wb = sub_ifd.iter()
        .find(|e| e.tag == 0xF00D)
        .and_then(|e| {
            let vals = e.as_u32_vec()?;
            if vals.len() < 3 { return None; }
            let g = vals[0] as f32;
            let r = vals[1] as f32;
            let b = vals[2] as f32;
            if g < 1.0 { return None; }
            Some([r / g, 1.0f32, b / g])
        });

    Ok(CfaMeta { width, height, bits_per_sample: bits, strip_offset, strip_byte_count, is_compressed, black_level, as_shot_wb })
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
    fn detect_cfa_shift_finds_correct_phase() {
        // Build a synthetic mosaic where green positions (per a (1,1)-shifted pattern)
        // are 1.8× brighter than R/B sites. Use crop_top=3, crop_left=0 so that the
        // formula tie-breaker resolves to exactly (1,1):
        //   formula_rs = (3 % 6 + 4) % 6 = 1
        //   formula_cs = (0 % 6 + 1) % 6 = 1
        let target_rs = 1usize;
        let target_cs = 1usize;

        // Build the "true" CFA for the output crop: base_pat shifted by (1,1).
        let base_pat = DEFAULT_XTRANS_CFA;
        let true_cfa = shift_cfa(&base_pat, target_rs, target_cs);

        let w = 48usize;
        let h = 48usize;
        let mut mosaic = vec![0.0f32; w * h];
        for row in 0..h {
            for col in 0..w {
                let cfa_idx = (row % 6) * 6 + (col % 6);
                // Fuji green (index 1 in base_pat) is ~1.8× brighter than R/B.
                // After shift_cfa remapping, green = standard index 1.
                mosaic[row * w + col] = if true_cfa[cfa_idx] == 1 { 0.18 } else { 0.10 };
            }
        }

        // crop_top=3, crop_left=0 → formula=(1,1); it is among the best-scoring
        // ties, so the detector returns it.
        let (rs, cs) = detect_cfa_shift(&mosaic, w, h, &base_pat, 3, 0);
        assert_eq!((rs, cs), (target_rs, target_cs),
            "detector returned ({rs},{cs}), expected ({target_rs},{target_cs})");
    }

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
    fn apply_saturation_neutral_gray_unchanged() {
        // A neutral gray pixel (R==G==B) has zero chroma, so boosting
        // saturation must leave it unchanged.
        let mut rgb = vec![0.5f32, 0.5, 0.5];
        apply_saturation(&mut rgb, 1.35);
        assert!((rgb[0] - 0.5).abs() < 1e-5 && (rgb[1] - 0.5).abs() < 1e-5 && (rgb[2] - 0.5).abs() < 1e-5,
            "gray should be unchanged: {:?}", rgb);
    }

    #[test]
    fn apply_saturation_colored_pixel_gains_chroma() {
        // A colored pixel should have a wider channel spread after saturation boost.
        let mut rgb = vec![0.8f32, 0.4, 0.3];
        let before_spread = rgb[0] - rgb[2];
        apply_saturation(&mut rgb, 1.35);
        let after_spread = rgb[0] - rgb[2];
        assert!(after_spread > before_spread,
            "channel spread should increase: before={before_spread} after={after_spread}");
    }

    #[test]
    fn denoise_chroma_leaves_neutral_gray_unchanged() {
        // A uniform gray image has zero chroma on every pixel; median-filtering
        // zero planes and adding them back must yield exactly the original values.
        let w = 8;
        let h = 8;
        let gray = 0.4f32;
        let mut rgb: Vec<f32> = (0..w * h).flat_map(|_| [gray, gray, gray]).collect();
        denoise_chroma(&mut rgb, w, h);
        for (i, &v) in rgb.iter().enumerate() {
            assert!(
                (v - gray).abs() < 1e-5,
                "neutral gray changed at index {i}: expected {gray}, got {v}"
            );
        }
    }

    #[test]
    fn denoise_chroma_reduces_single_off_color_pixel() {
        // A single magenta-ish pixel on an otherwise neutral gray field.
        // A 3×3 median on the chroma planes replaces the isolated outlier
        // with the surrounding gray's zero-chroma, so the center pixel
        // becomes neutral. Mean luma is unaffected.
        let w = 9;
        let h = 9;
        let gray = 0.5f32;
        let mut rgb: Vec<f32> = (0..w * h).flat_map(|_| [gray, gray, gray]).collect();

        // Place a single noisy (magenta-ish) pixel at the center.
        let cx = 4;
        let cy = 4;
        let o = (cy * w + cx) * 3;
        rgb[o]     = 0.8;   // R high
        rgb[o + 1] = 0.3;   // G low
        rgb[o + 2] = 0.8;   // B high

        // Record mean luma before.
        let mean_luma_before: f32 = (0..w * h)
            .map(|i| 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2])
            .sum::<f32>() / (w * h) as f32;

        denoise_chroma(&mut rgb, w, h);

        let mean_luma_after: f32 = (0..w * h)
            .map(|i| 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2])
            .sum::<f32>() / (w * h) as f32;

        // Luma is preserved globally (median on zero-sum chroma planes is a no-op for luma).
        assert!(
            (mean_luma_before - mean_luma_after).abs() < 1e-4,
            "mean luma shifted: before={mean_luma_before} after={mean_luma_after}"
        );

        // The center pixel's chroma spread is eliminated: median picks the
        // surrounding gray's zero chroma, so the pixel becomes neutral.
        let center_r = rgb[o];
        let center_g = rgb[o + 1];
        let center_b = rgb[o + 2];
        let spread_after = (center_r - center_g).abs().max((center_b - center_g).abs());
        let spread_before = (0.8f32 - 0.3f32).abs().max((0.8f32 - 0.3f32).abs());
        assert!(
            spread_after < spread_before * 0.5,
            "off-color pixel chroma not sufficiently reduced: before={spread_before:.3} after={spread_after:.3}"
        );
    }

    #[test]
    fn denoise_luma_bilateral_smooths_flat_noise() {
        // A flat gray field with alternating ±0.02 luma jitter (fixed, deterministic)
        // should come out smoother (lower variance) while preserving the mean
        // and keeping the output exactly neutral (R==G==B).
        let w = 16;
        let h = 16;
        let base = 0.15f32; // in linear space, near the raw's ~30% range
        let mut rgb: Vec<f32> = (0..w * h)
            .flat_map(|i| {
                let v = base + if i % 2 == 0 { 0.02 } else { -0.02 };
                [v, v, v]
            })
            .collect();

        let variance_before = {
            let mean = rgb.iter().step_by(3).map(|&v| v as f64).sum::<f64>() / (w * h) as f64;
            rgb.iter().step_by(3).map(|&v| (v as f64 - mean).powi(2)).sum::<f64>() / (w * h) as f64
        };
        let mean_before = rgb.iter().step_by(3).map(|&v| v as f64).sum::<f64>() / (w * h) as f64;

        denoise_luma_bilateral(&mut rgb, w, h, 2, 0.04);

        let variance_after = {
            let mean = rgb.iter().step_by(3).map(|&v| v as f64).sum::<f64>() / (w * h) as f64;
            rgb.iter().step_by(3).map(|&v| (v as f64 - mean).powi(2)).sum::<f64>() / (w * h) as f64
        };
        let mean_after = rgb.iter().step_by(3).map(|&v| v as f64).sum::<f64>() / (w * h) as f64;

        assert!(
            variance_after < variance_before,
            "bilateral filter did not reduce variance: before={variance_before:.6} after={variance_after:.6}"
        );
        assert!(
            (mean_after - mean_before).abs() < 1e-3,
            "mean luma shifted: before={mean_before:.5} after={mean_after:.5}"
        );
        // Chroma must stay neutral (R==G==B) throughout.
        for i in 0..w * h {
            let o = i * 3;
            assert!(
                (rgb[o] - rgb[o + 1]).abs() < 1e-5 && (rgb[o + 1] - rgb[o + 2]).abs() < 1e-5,
                "chroma shifted at pixel {i}: R={} G={} B={}", rgb[o], rgb[o+1], rgb[o+2]
            );
        }
    }

    #[test]
    fn denoise_luma_bilateral_preserves_edge() {
        // A sharp luma step edge (left half 0.2, right half 0.6) should be
        // preserved: range_sigma=0.04 << 0.4 step so bilateral weights across
        // the edge collapse to near zero.
        let w = 20;
        let h = 5;
        let dark = 0.2f32;
        let bright = 0.6f32;
        let mut rgb: Vec<f32> = (0..w * h)
            .flat_map(|i| {
                let col = i % w;
                let v = if col < w / 2 { dark } else { bright };
                [v, v, v]
            })
            .collect();

        denoise_luma_bilateral(&mut rgb, w, h, 2, 0.04);

        // Pixels well away from the border (≥radius pixels) must keep their values.
        let r = 2usize;
        for row in 0..h {
            // Dark side, columns far from edge
            for col in 0..w / 2 - r {
                let v = rgb[(row * w + col) * 3];
                assert!(
                    (v - dark).abs() < 0.01,
                    "dark side blurred at ({row},{col}): got {v:.4} expected ≈{dark}"
                );
            }
            // Bright side, columns far from edge
            for col in w / 2 + r..w {
                let v = rgb[(row * w + col) * 3];
                assert!(
                    (v - bright).abs() < 0.01,
                    "bright side blurred at ({row},{col}): got {v:.4} expected ≈{bright}"
                );
            }
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
