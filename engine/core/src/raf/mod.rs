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
pub mod develop;
pub mod standard_curve;
pub mod highlights;
mod markesteijn;
pub mod wb_presets;
pub mod xtrans;

use serde::{Deserialize, Serialize};

use crate::black_level::BlackLevels;
use crate::dng::color;
use crate::dng::tiff::TiffReader;
use crate::dng::demosaic;

/// Which demosaic algorithm `read_raf_opts` uses for X-Trans sensors.
#[derive(Clone, Copy, PartialEq, Debug, Serialize, Deserialize)]
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
    /// Whether to apply the post-demosaic chroma denoise.
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

/// Every per-image decision the local render stage needs, settled once by
/// `prepare_raf` from the whole frame (CFA phase, white balance, camera
/// matrix, film simulation). Serializable so a worker rendering one band can
/// be handed exactly what the others use.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RafRenderParams {
    /// Mosaic dimensions — the cropped frame before EXIF orientation.
    pub width: u32,
    pub height: u32,
    /// 6×6 CFA (standard 0=R, 1=G, 2=B indices), phase-aligned to row 0.
    pub cfa: Vec<u8>,
    pub is_xtrans: bool,
    pub demosaic: DemosaicMode,
    pub denoise: bool,
    pub cam_to_srgb: [f32; 9],
    pub film_mode: Option<u16>,
    pub orientation: u16,
    /// The raw value at which the sensor clips, in raw units, which the
    /// mosaic's 1.0 stands for (before white balance). It is the bit
    /// depth's largest value: no RAF tag this decoder reads records a
    /// lower saturation. 0 in params written before it was recorded.
    #[serde(default)]
    pub white_level: u32,
    /// The level at which each channel (R, G, B) clips, in the units of the
    /// mosaic and of the linear renders (`develop::render_linear_band`,
    /// `develop::render_binned_linear`): linear camera RGB at the as-shot
    /// white balance, where the white level is 1.0 before that balance.
    /// A reconstructed value can lie above it. `None` in params written
    /// before it was recorded.
    #[serde(default)]
    pub clip_levels: Option<[f32; 3]>,
    /// What the linear renders need to reconstruct clipped channels
    /// (`highlights`), measured once over the whole frame so every band
    /// and the binned view use the same. `None` when nothing in the frame
    /// comes near its clip level, and in params written before it existed.
    #[serde(default)]
    pub highlight_chroma: Option<highlights::ChromaGrid>,
}

impl RafRenderParams {
    /// Final (displayed) dimensions after EXIF orientation.
    pub fn oriented_size(&self) -> (u32, u32) {
        match self.orientation {
            5..=8 => (self.height, self.width),
            _ => (self.width, self.height),
        }
    }
}

/// Output of `prepare_raf`: the white-balanced mosaic (`width`×`height`
/// f32, row-major) plus the parameters to render it.
pub struct RafMosaic {
    pub params: RafRenderParams,
    pub mosaic: Vec<f32>,
    pub exif_info: RafExifInfo,
    pub debug_log: Vec<String>,
}

/// How far (in rows) any `render_rgb` output pixel reaches into the mosaic:
/// the demosaic, the separable chroma median 1 and the unsharp mask 1.
pub const RENDER_REACH_ROWS: u32 = markesteijn::REACH as u32 + 1 + 1;

/// Rows of mosaic context rendered above and below each band and then
/// discarded. At least `RENDER_REACH_ROWS`, so a band's output matches the
/// whole-frame render exactly, and a multiple of the 6-row CFA period, so
/// every band's source starts at CFA phase 0.
pub const BAND_HALO_ROWS: u32 = RENDER_REACH_ROWS.div_ceil(6) * 6;

/// Bands never get shorter than this (except a frame shorter than it), so
/// the halo stays a modest fraction of the rendered rows.
const MIN_BAND_ROWS: u32 = 96;

/// A horizontal slice `[y0, y1)` of the (unoriented) frame, rendered from
/// mosaic rows `[src_y0, src_y1)`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RafBand {
    pub y0: u32,
    pub y1: u32,
    pub src_y0: u32,
    pub src_y1: u32,
}

/// Split a `height`-row frame into at most `max_bands` bands of near-equal
/// height whose boundaries fall on the 6-row CFA period.
pub fn plan_bands(height: u32, max_bands: u32) -> Vec<RafBand> {
    let periods = height.div_ceil(6).max(1);
    let max_by_size = (height / MIN_BAND_ROWS).max(1);
    let count = max_bands.clamp(1, max_by_size).min(periods);
    (0..count)
        .map(|i| {
            let y0 = (periods * i / count * 6).min(height);
            let y1 = (periods * (i + 1) / count * 6).min(height);
            RafBand {
                y0,
                y1,
                src_y0: y0.saturating_sub(BAND_HALO_ROWS),
                src_y1: (y1 + BAND_HALO_ROWS).min(height),
            }
        })
        .collect()
}

/// A band for frame rows `[y0, y1)` or a few more: it starts on the 6-row
/// CFA period (at 0 when it would start inside the first halo), so its
/// source starts at CFA phase 0, and it carries `plan_bands`' halo. For
/// renders that need particular rows (a reduced frame's bands, `raw::scaled`)
/// rather than an even split of the frame.
pub fn band_for_rows(height: u32, y0: u32, y1: u32) -> RafBand {
    let y1 = y1.min(height);
    let y0 = if y0 <= BAND_HALO_ROWS { 0 } else { y0 / 6 * 6 };
    RafBand { y0, y1, src_y0: y0.saturating_sub(BAND_HALO_ROWS), src_y1: (y1 + BAND_HALO_ROWS).min(height) }
}

/// One rendered band, already EXIF-oriented, with its rectangle in the
/// final (oriented) image.
pub struct RafBandPixels {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    /// RGBA f32, `width`×`height`.
    pub pixels: Vec<f32>,
}

/// Render one band. `src` holds mosaic rows `[band.src_y0, band.src_y1)` of
/// the frame `prepare_raf` produced. The result is bit-identical to the
/// same rows of a whole-frame render.
pub fn render_band(src: &[f32], params: &RafRenderParams, band: RafBand) -> Result<RafBandPixels, String> {
    let w = params.width as usize;
    let src_h = check_band(src, params, band)?;
    let clamped = baked_mosaic(src.to_vec());
    let rgb = render_rgb(&clamped, w, src_h, params);
    drop(clamped);
    Ok(orient_band(rgb, params, band, true))
}

/// The mosaic as the baked decode has always seen it: below black clamped
/// to 0. `prepare_raf` keeps what the file holds for the linear path, and
/// no sample there exceeds its channel's white-balance gain (samples are
/// capped at the white level), so this alone reproduces the old clamp of
/// every sample to 0..1 before white balance, bit for bit.
fn baked_mosaic(mut mosaic: Vec<f32>) -> Vec<f32> {
    for v in mosaic.iter_mut() {
        *v = v.max(0.0);
    }
    mosaic
}

/// Check that `src` holds exactly mosaic rows `[band.src_y0, band.src_y1)`
/// of a frame described by `params`, with the band inside it at CFA phase 0.
/// Returns the number of source rows.
fn check_band(src: &[f32], params: &RafRenderParams, band: RafBand) -> Result<usize, String> {
    let w = params.width as usize;
    let valid = band.src_y0.is_multiple_of(6)
        && band.src_y0 <= band.y0
        && band.y0 < band.y1
        && band.y1 <= band.src_y1
        && band.src_y1 <= params.height;
    if !valid {
        return Err(format!("Invalid RAF band {band:?} for a {}-row frame", params.height));
    }
    let src_h = (band.src_y1 - band.src_y0) as usize;
    if src.len() != w * src_h {
        return Err(format!("RAF band source has {} values, expected {}", src.len(), w * src_h));
    }
    Ok(src_h)
}

/// Cut the band's own rows out of `rgb` (rendered from the band's source
/// rows), convert to RGBA (clamped to 0..1 when `clamp`) and apply the EXIF
/// orientation, placing the result in the oriented image. Takes `rgb` by
/// value and frees it before orienting, to keep peak memory at one band.
fn orient_band(rgb: Vec<f32>, params: &RafRenderParams, band: RafBand, clamp: bool) -> RafBandPixels {
    let w = params.width as usize;
    let skip = (band.y0 - band.src_y0) as usize * w * 3;
    let take = (band.y1 - band.y0) as usize * w * 3;
    let rows = &rgb[skip..skip + take];
    let rgba = if clamp { rgb_to_rgba(rows) } else { rgb_to_rgba_unclamped(rows) };
    drop(rgb);

    let band_h = band.y1 - band.y0;
    let (ow, oh, pixels) =
        crate::orientation::apply_exif_orientation_owned(params.width, band_h, rgba, params.orientation);
    let (x, y) = match params.orientation {
        3 | 4 => (0, params.height - band.y1),
        5 | 8 => (band.y0, 0),
        6 | 7 => (params.height - band.y1, 0),
        _ => (0, band.y0),
    };
    RafBandPixels { x, y, width: ow, height: oh, pixels }
}

/// The camera model and the as-shot white balance multipliers (`[R, 1, B]`,
/// tag 0xF00D) of a RAF, read from its headers without decoding pixels.
/// `None` for the multipliers when the file has no as-shot tag (the decode
/// then uses grey world).
pub fn read_wb_info(data: &[u8]) -> Result<(String, Option<[f32; 3]>), String> {
    if data.len() < 120 || &data[0..16] != b"FUJIFILMCCD-RAW " {
        return Err("Not a Fujifilm RAF file".to_string());
    }
    let model = parse_camera_model(&data[28..60]);
    let offset = read_be_u32(data, 100) as usize;
    let length = read_be_u32(data, 104) as usize;
    let end = offset.checked_add(length).filter(|&e| e <= data.len()).ok_or("CFA data extends past end of file")?;
    let meta = parse_cfa_tiff(&data[offset..end])?;
    Ok((model, meta.as_shot_wb))
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
/// post-demosaic pass.
pub fn read_raf_opts(data: &[u8], opts: RafDecodeOpts) -> Result<RafImage, String> {
    let RafMosaic { params, mosaic, exif_info, debug_log } = prepare_raf(data, opts)?;
    let mosaic = baked_mosaic(mosaic);
    let rgb = render_rgb(&mosaic, params.width as usize, params.height as usize, &params);
    drop(mosaic);
    let rgba = rgb_to_rgba(&rgb);
    drop(rgb);

    // ── Apply EXIF orientation ─────────────────────────────────
    // Most commonly: 1 (no rotation), 6 (rotate 90° CW), 8 (rotate
    // 90° CCW), 3 (rotate 180°). For 5/6/7/8 the output dimensions
    // are swapped.
    let (final_w, final_h, final_pixels) =
        crate::orientation::apply_exif_orientation_owned(params.width, params.height, rgba, params.orientation);

    Ok(RafImage { width: final_w, height: final_h, pixels: final_pixels, exif_info, debug_log })
}

/// The decoder's whole-frame stage: parse the container, decompress, crop,
/// normalize, detect the CFA phase and white-balance the mosaic, and settle
/// every per-image rendering decision into `RafRenderParams`.
///
/// Everything after this (`render_rgb`) only looks at a bounded
/// neighbourhood of each pixel, so it can run on row bands independently —
/// see `plan_bands` / `render_band`.
pub fn prepare_raf(data: &[u8], opts: RafDecodeOpts) -> Result<RafMosaic, String> {
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
    // The CFA dimensions are untrusted: check them before planes are
    // allocated from them (u16 raw plane plus f32 mosaic).
    crate::decode::check_image_size(cfa_meta.width, cfa_meta.height, 6)?;

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
    let structured_compressed = compression::is_compressed_strip(pixel_data, raw_w as u32, raw_h as u32);
    let is_compressed = strip_is_compressed(&cfa_meta, pixel_data, raw_w, raw_h);

    raf_log!("[RAF] compression: tiff_says={}, header_says={}, deciding={}",
        cfa_meta.is_compressed, structured_compressed, is_compressed);

    // ── Read full-frame raw u16 plane (compressed or uncompressed) ──

    let base_pat_for_decompress = cfa_pattern.as_ref().copied().unwrap_or(DEFAULT_XTRANS_CFA);

    // An uncompressed strip is read in place (little-endian u16 samples),
    // never copied into a full-frame plane first: that copy and the crop
    // copy after it were 160 MB of the first view on a 40 MP frame.
    let decompressed: Option<Vec<u16>> = if is_compressed {
        raf_log!("[RAF] decompressing Fujifilm compressed strip");
        Some(compression::decompress_fuji_strip(pixel_data, raw_w as u32, raw_h as u32, &base_pat_for_decompress)
            .map_err(|e| format!("This camera's compressed RAW format isn't supported yet ({e}). \
                Set the camera to \"Uncompressed\" RAW, or convert it to DNG."))?)
    } else {
        let expected_bytes = raw_w * raw_h * 2;
        if pixel_bytes < expected_bytes {
            return Err(format!("Pixel data too small: expected {expected_bytes}, got {pixel_bytes}"));
        }
        None
    };
    let plane_len = decompressed.as_ref().map_or(raw_w * raw_h, Vec::len);
    let raw_at = |i: usize| -> u16 {
        match &decompressed {
            Some(plane) => plane[i],
            None => {
                let off = i * 2;
                if off + 1 < pixel_data.len() { u16::from_le_bytes([pixel_data[off], pixel_data[off + 1]]) } else { 0 }
            }
        }
    };

    // Sample-based sanity check: if the decoded plane still looks like
    // garbage (median near black), bail with a clear error. This catches
    // both undetected compressed variants and decompression failures
    // that produced bogus output. An uncompressed strip of exactly
    // width × height × 2 bytes is read as it is: a night shot's median can
    // sit at black (DSCF8169, an X-E5 frame under tungsten, has its median
    // 0.1 % above black), and that is a real picture, not a failed decode.
    let sample_stride = (raw_w * raw_h).max(1) / 1000;
    let mut sample_vals: Vec<u16> = Vec::with_capacity(1000);
    for i in (raw_w * 100..raw_w * raw_h).step_by(sample_stride.max(1)) {
        if i < plane_len {
            sample_vals.push(raw_at(i));
        }
    }
    sample_vals.sort();
    let sample_median = sample_vals.get(sample_vals.len() / 2).copied().unwrap_or(0);
    let black_u16 = cfa_meta.black_level.as_ref().map_or(1024.0, BlackLevels::mean) as u16;

    let is_plain_strip = !is_compressed && pixel_bytes == raw_w * raw_h * 2;
    if !is_plain_strip && !sample_vals.is_empty() && sample_median < black_u16 + 50 {
        return Err(
            "This camera's compressed RAW format isn't supported yet (the decoded \
             data has no signal). Set the camera to \"Uncompressed\" RAW, or convert \
             it to DNG.".into()
        );
    }

    // ── Crop to output area ─────────────────────────────────────

    // ── Crop to output area and normalize, in one pass ──────────

    raf_log!("[RAF] white_level={}, black={:?}", white_level, cfa_meta.black_level);

    // Every sample value of a site maps the same way, so the f64 maths runs
    // once per value (at most 65536) and level instead of once per sample
    // (40 million). Each sample has its own site's black level subtracted.
    // Not clamped: a sample below black stays negative, so noise in the
    // shadows averages to black instead of being rectified above it.
    let unit = UnitTables::new(cfa_meta.black_level.as_ref(), white_level, f64::NEG_INFINITY, false);
    let pixel_count = w * h;
    let mut normalized: Vec<f32> = Vec::with_capacity(pixel_count);
    for row in 0..h {
        let src_row = row + crop_top as usize;
        for col in 0..w {
            let src_col = col + crop_left as usize;
            let idx = src_row * raw_w + src_col;
            let v = if idx < plane_len { raw_at(idx).min(white_level) } else { 0 };
            normalized.push(unit.at(src_row, src_col)[v as usize]);
        }
    }
    drop(decompressed);

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
        bayer_cfa(crop_top, crop_left)
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
    // Each row's multipliers repeat with the CFA period: look them up per
    // column instead of computing two remainders per sample.
    let row_gains: Vec<Vec<f32>> = (0..cfa_period)
        .map(|py| (0..w).map(|col| wb[cfa[py * cfa_period + col % cfa_period] as usize]).collect())
        .collect();
    for (row, line) in normalized.chunks_exact_mut(w).enumerate() {
        for (v, g) in line.iter_mut().zip(&row_gains[row % cfa_period]) {
            *v *= g;
        }
    }

    // The camera → sRGB matrix of `color_matrix_for_model`: the sensor's
    // own from `camera_colour`, or one derived from an XYZ → camera
    // matrix. Column-scaled (neutralized) so
    // that a neutral input (R=G=B, as produced by the as-shot WB) maps to
    // a neutral output — this preserves off-diagonal saturation structure
    // unlike per-row normalization, which scales each row independently and
    // crushes saturation by up to ~5%.
    let cam_to_srgb = color::neutralize_matrix(&color_matrix_for_model(&camera_model));

    let params = RafRenderParams {
        width,
        height,
        cfa: cfa.to_vec(),
        is_xtrans,
        demosaic: opts.demosaic,
        denoise: opts.denoise,
        cam_to_srgb,
        film_mode: exif_info.film_mode,
        orientation: exif_orientation,
        white_level: u32::from(white_level),
        // A sample is capped at the white level, which is 1.0 before white
        // balance, so each channel clips at exactly its gain.
        clip_levels: Some(wb),
        highlight_chroma: highlights::ChromaGrid::measure(&normalized, w, h, &cfa[..cfa_period * cfa_period], cfa_period, wb),
    };
    raf_log!("[RAF] clip levels: [{:.4}, {:.4}, {:.4}], highlight reconstruction: {}",
        wb[0], wb[1], wb[2], if params.highlight_chroma.is_some() { "on" } else { "nothing clipped" });

    raf_log!("[RAF] demosaic: {}", match (is_xtrans, opts.demosaic) {
        (false, _) => "Bayer bilinear",
        (true, DemosaicMode::Markesteijn) => "X-Trans Markesteijn",
        (true, DemosaicMode::Nearest) => "X-Trans nearest-neighbour (diagnostic)",
    });
    raf_log!(
        "[RAF] cam→sRGB (neutralized): [{:.3} {:.3} {:.3}; {:.3} {:.3} {:.3}; {:.3} {:.3} {:.3}]",
        cam_to_srgb[0], cam_to_srgb[1], cam_to_srgb[2],
        cam_to_srgb[3], cam_to_srgb[4], cam_to_srgb[5],
        cam_to_srgb[6], cam_to_srgb[7], cam_to_srgb[8]
    );
    raf_log!("[RAF] denoise: {}", if opts.denoise {
        "chroma separable median r=1"
    } else {
        "skipped"
    });
    raf_log!("[RAF] film-sim saturation (linear): {}",
        base_curves::saturation_for_film_mode(exif_info.film_mode));
    raf_log!("[RAF] film_mode={:?} → base curve: {} (luminance-preserving)",
        exif_info.film_mode, base_curves::curve_for_film_mode(exif_info.film_mode).name);

    Ok(RafMosaic { params, mosaic: normalized, exif_info, debug_log })
}

/// The decoder's local stage: demosaic → color matrix → denoise → tone →
/// gamma → sharpen, from a white-balanced mosaic of `w`×`h` to interleaved
/// RGB. The mosaic's first row must sit at CFA phase 0 (a multiple of 6 rows
/// into the frame) so `params.cfa` applies unshifted.
///
/// Each output pixel depends only on mosaic pixels within
/// `RENDER_REACH_ROWS` of it, which is what makes banded rendering exact.
pub fn render_rgb(mosaic: &[f32], w: usize, h: usize, params: &RafRenderParams) -> Vec<f32> {
    let mut rgb_f32 = render_rgb_unsharpened(mosaic, w, h, params);

    // ── Capture sharpening ──────────────────────────────────────
    // A mild luma unsharp mask in display (gamma-encoded) space, to match
    // the crispness of the camera-rendered JPEG / Preview. Kept modest
    // (small radius, low amount) so it sharpens real edges without ringing
    // and is off the demosaic critical path.
    unsharp_mask_luma(&mut rgb_f32, w, h, CAPTURE_SHARPEN_AMOUNT);

    rgb_f32
}

/// Demosaic a white-balanced mosaic (first row at CFA phase 0) to
/// interleaved camera RGB, unclamped.
fn demosaic_rgb(mosaic: &[f32], w: usize, h: usize, params: &RafRenderParams) -> Vec<f32> {
    let cfa: [u8; 36] = params.cfa.as_slice().try_into().unwrap_or(DEFAULT_XTRANS_CFA);
    if params.is_xtrans {
        match params.demosaic {
            DemosaicMode::Markesteijn => xtrans::demosaic_xtrans(mosaic, w as u32, h as u32, &cfa),
            DemosaicMode::Nearest => xtrans::demosaic_nearest(mosaic, w as u32, h as u32, &cfa),
        }
    } else {
        demosaic::bilinear(mosaic, w as u32, h as u32, &cfa[..4])
    }
}

/// `render_rgb` without its last step, capture sharpening: gamma-encoded
/// sRGB, not yet clamped. Public so the develop tests can compare the GPU
/// develop maths against today's look; not part of the import path.
#[doc(hidden)]
pub fn render_rgb_unsharpened(mosaic: &[f32], w: usize, h: usize, params: &RafRenderParams) -> Vec<f32> {
    let mut rgb_f32 = demosaic_rgb(mosaic, w, h, params);

    color::apply_matrix(&mut rgb_f32, &params.cam_to_srgb);

    // ── Chroma denoise ─────────────────────────────────────────
    // Remove the magenta/green speckle that X-Trans demosaicing leaves on
    // real sensor data by median-filtering the color-difference planes.
    // A median erases isolated false-color pixels while preserving edges
    // and real color regions — unlike a box blur it cannot desaturate.
    if params.denoise {
        // The green-sublattice phase misalignment is now fixed at the source,
        // so this is a mild residual chroma noise pass — not a grid-eraser.
        // Radius 1 (3-wide separable median) removes isolated false-color speckle
        // while leaving real color edges and fine detail intact.
        denoise_chroma(&mut rgb_f32, w, h);
    }

    // ── Film-sim saturation (linear space) ─────────────────────
    // Fuji film sims are much more saturated than a plain colorimetric
    // matrix render. Applied here in linear light — before the tone curve
    // and gamma — where the luma-preserving boost is strongest. Linear
    // saturation can push the minimum channel slightly negative; that is
    // intentional (later RGBA conversion clamps to [0,1]).
    apply_saturation(&mut rgb_f32, base_curves::saturation_for_film_mode(params.film_mode));

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
    let curve_lut = base_curves::curve_lut(base_curves::curve_for_film_mode(params.film_mode));
    color::apply_lut(&mut rgb_f32, &curve_lut);

    // ── sRGB gamma ──────────────────────────────────────────────

    color::apply_srgb_gamma(&mut rgb_f32);

    rgb_f32
}

fn rgb_to_rgba_unclamped(rgb: &[f32]) -> Vec<f32> {
    let mut rgba = Vec::with_capacity(rgb.len() / 3 * 4);
    for px in rgb.chunks_exact(3) {
        rgba.extend_from_slice(&[px[0], px[1], px[2], 1.0]);
    }
    rgba
}

fn rgb_to_rgba(rgb: &[f32]) -> Vec<f32> {
    let mut rgba = Vec::with_capacity(rgb.len() / 3 * 4);
    for px in rgb.chunks_exact(3) {
        rgba.push(px[0].clamp(0.0, 1.0));
        rgba.push(px[1].clamp(0.0, 1.0));
        rgba.push(px[2].clamp(0.0, 1.0));
        rgba.push(1.0);
    }
    rgba
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
    let is_compressed = strip_is_compressed(&cfa_meta, pixel_data, raw_w, raw_h);

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

    let unit = UnitTables::new(cfa_meta.black_level.as_ref(), white_level, f64::NEG_INFINITY, true);
    let mut normalized: Vec<f32> = Vec::with_capacity(w * h);
    for row in 0..h {
        let src_row = row + crop_top as usize;
        for col in 0..w {
            let src_col = col + crop_left as usize;
            let idx = src_row * raw_w + src_col;
            let v = raw_plane.get(idx).copied().unwrap_or(0).min(white_level);
            normalized.push(unit.at(src_row, src_col)[v as usize]);
        }
    }

    let is_xtrans = camera_model_is_xtrans(&camera_model);
    let base_pat = cfa_pattern.as_ref().copied().unwrap_or(DEFAULT_XTRANS_CFA);
    let cfa = if is_xtrans {
        let (rs, cs) = detect_cfa_shift(&normalized, w, h, &base_pat, crop_top as usize, crop_left as usize);
        shift_cfa(&base_pat, rs, cs)
    } else {
        bayer_cfa(crop_top, crop_left)
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

    let is_compressed = strip_is_compressed(&cfa_meta, pixel_data, raw_w, raw_h);

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

    let unit = UnitTables::new(cfa_meta.black_level.as_ref(), white_level, 1.0, true);
    let mut normalized = Vec::with_capacity(w * h);
    for row in 0..h {
        let src_row = row + crop_top as usize;
        for col in 0..w {
            let src_col = col + crop_left as usize;
            let idx = src_row * raw_w + src_col;
            let v = raw_plane.get(idx).copied().unwrap_or(0).min(white_level);
            normalized.push(unit.at(src_row, src_col)[v as usize]);
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
    for row in 0..h {
        let up = row.saturating_sub(1) * w;
        let mid = row * w;
        let dn = (row + 1).min(h - 1) * w;
        for col in 0..w {
            blur[mid + col] = (tmp[up + col] + 2.0 * tmp[mid + col] + tmp[dn + col]) * 0.25;
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
            if radius == 1 && col >= 1 && col + 1 < w {
                tmp[base + col] = median3(plane[base + col - 1], plane[base + col], plane[base + col + 1]);
                continue;
            }
            for k in -radius..=radius {
                let c = (col as i32 + k).clamp(0, w as i32 - 1) as usize;
                buf[(k + radius) as usize] = plane[base + c];
            }
            tmp[base + col] = median_window(&buf);
        }
    }

    // Row-major so each output row reads whole source rows; walking columns
    // strides the full row width per sample and thrashes the cache.
    let mut out = vec![0.0f32; w * h];
    for row in 0..h {
        let base = row * w;
        if radius == 1 {
            let up = row.saturating_sub(1) * w;
            let dn = (row + 1).min(h - 1) * w;
            for col in 0..w {
                out[base + col] = median3(tmp[up + col], tmp[base + col], tmp[dn + col]);
            }
            continue;
        }
        for col in 0..w {
            for k in -radius..=radius {
                let r = (row as i32 + k).clamp(0, h as i32 - 1) as usize;
                buf[(k + radius) as usize] = tmp[r * w + col];
            }
            out[base + col] = median_window(&buf);
        }
    }
    out
}

/// Middle of three values; returns the same element `median_window` would.
#[inline(always)]
fn median3(a: f32, b: f32, c: f32) -> f32 {
    let (lo, hi) = if b < a { (b, a) } else { (a, b) };
    if c < lo {
        lo
    } else if c < hi {
        c
    } else {
        hi
    }
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
    black_level: Option<BlackLevels>,
    as_shot_wb: Option<[f32; 3]>,
}

/// For each position of the black-level tile, a table from raw sample
/// (0..=white level) to 0..1 with that position's level subtracted
/// (clamped to 0..1 when asked; otherwise below black is negative). Sites
/// with the same level share a table, so a file with one level has the one
/// table the decoder has always built.
struct UnitTables {
    rows: usize,
    cols: usize,
    site: Vec<usize>,
    tables: Vec<Vec<f32>>,
}

impl UnitTables {
    /// `min_range` floors white minus black (`f64::NEG_INFINITY` for none).
    fn new(black: Option<&BlackLevels>, white_level: u16, min_range: f64, clamp: bool) -> Self {
        let uniform = BlackLevels::uniform(0.0);
        let black = black.unwrap_or(&uniform);
        let (rows, cols) = black.period();
        let max_val = white_level as f64;
        let mut levels: Vec<f64> = Vec::new();
        let mut tables: Vec<Vec<f32>> = Vec::new();
        let mut site = Vec::with_capacity(rows * cols);
        for r in 0..rows {
            for c in 0..cols {
                let b = black.at(r, c, 0);
                let i = match levels.iter().position(|&l| l == b) {
                    Some(i) => i,
                    None => {
                        let range = (max_val - b).max(min_range);
                        levels.push(b);
                        tables.push(
                            (0..=white_level as u32)
                                .map(|v| {
                                    let u = (v as f64 - b) / range;
                                    (if clamp { u.clamp(0.0, 1.0) } else { u }) as f32
                                })
                                .collect(),
                        );
                        levels.len() - 1
                    }
                };
                site.push(i);
            }
        }
        Self { rows, cols, site, tables }
    }

    /// The table for the sample at (`raw_row`, `raw_col`) of the uncropped
    /// raw frame, where the black-level tile starts.
    #[inline]
    fn at(&self, raw_row: usize, raw_col: usize) -> &[f32] {
        if self.tables.len() == 1 {
            return &self.tables[0];
        }
        &self.tables[self.site[(raw_row % self.rows) * self.cols + raw_col % self.cols]]
    }
}

/// A Bayer RAF's pattern over the cropped picture, as the 36 entries
/// `RafRenderParams::cfa` holds (Bayer uses the first four), 0 R, 1 G, 2 B.
/// The sensor is RGGB from its own top-left corner, so the picture's
/// pattern depends on whether the crop starts on an odd row or column: a
/// GFX 100's starts on row 7 and its pattern is GBRG, a GFX 50S II's on
/// row 8 and column 12 and its is RGGB. A Bayer RAF's CFA header has no
/// pattern record of its own (X-Trans files have one, tag 0x0131).
fn bayer_cfa(crop_top: u32, crop_left: u32) -> [u8; 36] {
    const SENSOR: [[u8; 2]; 2] = [[0, 1], [1, 2]];
    let at = |row: u32, col: u32| SENSOR[((row + crop_top) % 2) as usize][((col + crop_left) % 2) as usize];
    let cell = [at(0, 0), at(0, 1), at(1, 0), at(1, 1)];
    std::array::from_fn(|i| cell[i % 4])
}

/// Whether the strip holds Fujifilm-compressed data. A strip of exactly
/// two bytes a sample is plain 16-bit data whatever it begins with: the
/// guess from its first bytes (`compression::is_compressed_strip`, which
/// expects an uncompressed strip to open on zeroes) took a GFX 50S II's
/// and a GFX100RF's plain strips, which open on picture data, for
/// compressed ones. The guess is kept for a strip of any other size.
fn strip_is_compressed(cfa_meta: &CfaMeta, pixel_data: &[u8], raw_w: usize, raw_h: usize) -> bool {
    if pixel_data.len() == raw_w * raw_h * 2 {
        return false;
    }
    cfa_meta.is_compressed || compression::is_compressed_strip(pixel_data, raw_w as u32, raw_h as u32)
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

    // Tag 0xF00A: one black level per CFA site (36 for X-Trans).
    let black_level = sub_ifd.iter()
        .find(|e| e.tag == 0xF00A)
        .and_then(|e| BlackLevels::from_raf(&e.as_u32_vec()?));

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
            // A channel of 0 is no white balance (it would make the
            // multipliers 0 and every temperature fitted from them NaN):
            // the frame is then read as having none.
            if g < 1.0 || r < 1.0 || b < 1.0 { return None; }
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
    // A sensor with a matrix in `camera_colour` takes it. Its rows sum to
    // 1, so the neutralizing and row-normalizing callers leave it as it is.
    if let Some(matrix) = crate::camera_colour::fujifilm(model) {
        return matrix;
    }
    // The other bodies: an XYZ → camera matrix each, inverted below.
    let m = model.to_uppercase();

    let cm: [f64; 9] = if m.contains("X-H2S") {
        [12662.0, -5961.0, -1025.0, -4129.0, 12025.0, 2399.0, -752.0, 1455.0, 6531.0]
    } else if m.contains("X-T2") || m.contains("X-T1") || m.contains("X-T10")
        || m.contains("X-E2") || m.contains("X-PRO1") || m.contains("X100S")
        || m.contains("X100T")
    {
        [10413.0, -3996.0, -993.0, -3721.0, 11640.0, 2361.0, -733.0, 1540.0, 6011.0]
    } else if m.contains("GFX") {
        [11771.0, -4689.0, -1322.0, -3625.0, 11999.0, 1830.0, -612.0, 1412.0, 6466.0]
    } else {
        // X-Trans 3 (X-T20, X-E3, X-H1, X-Pro2, X100F) and anything unknown.
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

    /// One level: one table, the formula the decoder always used.
    #[test]
    fn one_black_level_builds_the_old_table() {
        let black = BlackLevels::from_raf(&[1020; 36]).unwrap();
        let unit = UnitTables::new(Some(&black), 16383, f64::NEG_INFINITY, true);
        assert_eq!(unit.tables.len(), 1);
        for v in [0u32, 1020, 1021, 5000, 16383] {
            let old = ((v as f64 - 1020.0) / (16383.0 - 1020.0)).clamp(0.0, 1.0) as f32;
            assert_eq!(unit.at(3, 5)[v as usize], old);
        }
        assert_eq!(UnitTables::new(None, 255, f64::NEG_INFINITY, true).at(0, 0)[255], 1.0);
    }

    /// Each site subtracts its own level, the tile starting at the raw
    /// frame's corner.
    #[test]
    fn black_levels_are_subtracted_per_site() {
        let black = BlackLevels::from_raf(&[100, 200, 300, 400]).unwrap();
        let unit = UnitTables::new(Some(&black), 1000, f64::NEG_INFINITY, true);
        assert_eq!(unit.tables.len(), 4);
        assert_eq!(unit.at(0, 0)[100], 0.0);
        assert_eq!(unit.at(0, 1)[200], 0.0);
        assert_eq!(unit.at(1, 0)[300], 0.0);
        assert_eq!(unit.at(3, 3)[400], 0.0);
        assert_eq!(unit.at(2, 1)[600], 0.5, "(600 - 200) / (1000 - 200)");
    }

    /// A Bayer RAF's pattern is the sensor's RGGB as the crop finds it.
    #[test]
    fn a_bayer_rafs_pattern_follows_its_crop() {
        let cell = |top, left| bayer_cfa(top, left)[..4].to_vec();
        assert_eq!(cell(0, 0), [0, 1, 1, 2], "RGGB");
        assert_eq!(cell(8, 12), [0, 1, 1, 2], "a GFX 50S II: RGGB");
        assert_eq!(cell(7, 8), [1, 2, 0, 1], "a GFX 100: GBRG");
        assert_eq!(cell(0, 1), [1, 0, 2, 1], "GRBG");
        assert_eq!(cell(1, 1), [2, 1, 1, 0], "BGGR");
        let whole = bayer_cfa(7, 8);
        assert!((0..36).all(|i| whole[i] == whole[i % 4]));
    }

    /// A strip of exactly two bytes a sample is plain, whatever it opens
    /// with; the guess from the first bytes is for other sizes.
    #[test]
    fn a_strip_of_two_bytes_a_sample_is_not_compressed() {
        let meta = |count: u32| CfaMeta { width: 16, height: 8, bits_per_sample: 14, strip_offset: 0, strip_byte_count: count, is_compressed: count < 16 * 8 * 2, black_level: None, as_shot_wb: None };
        let busy = vec![0x7eu8; 16 * 8 * 2];
        assert!(compression::is_compressed_strip(&busy, 16, 8), "the guess alone calls it compressed");
        assert!(!strip_is_compressed(&meta(256), &busy, 16, 8));
        assert!(strip_is_compressed(&meta(100), &busy[..100], 16, 8));
    }

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
    fn median3_matches_median_window() {
        let vals = [-1.0f32, 0.0, 0.5, 0.5, 2.0];
        for &a in &vals {
            for &b in &vals {
                for &c in &vals {
                    assert_eq!(median3(a, b, c), median_window(&[a, b, c]), "{a} {b} {c}");
                }
            }
        }
    }

    #[test]
    fn render_params_survive_json_exactly_for_every_camera_matrix() {
        // Workers receive the params as JSON; a float that came back one ulp
        // off would make their bands differ from the whole-frame render.
        for model in ["X100VI", "X-T5", "X-T4", "X-T3", "X-T2", "GFX 100S", "X-UNKNOWN"] {
            let params = RafRenderParams {
                width: 10,
                height: 10,
                cfa: DEFAULT_XTRANS_CFA.to_vec(),
                is_xtrans: true,
                demosaic: DemosaicMode::Markesteijn,
                denoise: true,
                cam_to_srgb: color::neutralize_matrix(&color_matrix_for_model(model)),
                film_mode: Some(0x200),
                orientation: 6,
                white_level: 16383,
                clip_levels: Some([1.7, 1.0, 1.8]),
                highlight_chroma: None,
            };
            let json = serde_json::to_string(&params).unwrap();
            let back: RafRenderParams = serde_json::from_str(&json).unwrap();
            let bits = |m: &[f32; 9]| m.map(f32::to_bits);
            assert_eq!(bits(&back.cam_to_srgb), bits(&params.cam_to_srgb), "{model}");
            assert_eq!(back.cfa, params.cfa);
            assert_eq!(back.film_mode, params.film_mode);
            assert_eq!(back.orientation, params.orientation);
        }
    }

    #[test]
    fn color_matrix_is_finite_and_sane() {
        // Diagonal-dominant, finite coefficients — a real cam→sRGB matrix,
        // not the degenerate identity returned on inversion failure.
        for model in ["X-T5", "X-T2"] {
        let m = color_matrix_for_model(model);
        for v in m {
            assert!(v.is_finite());
        }
        assert!(m[0] > 0.0 && m[4] > 0.0 && m[8] > 0.0, "diagonal must be positive: {m:?}");
        assert_ne!(m, [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0], "matrix inversion failed");
        }
    }
}
