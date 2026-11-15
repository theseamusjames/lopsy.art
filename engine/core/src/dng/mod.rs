//! DNG raw image decoder with Apple ProRAW support.
//!
//! ## Architecture
//!
//! - `tiff.rs`    — TIFF IFD parser (both LE and BE), extracts all DNG-specific
//!                  tags from IFD0 and SubIFDs.
//! - `ljpeg.rs`   — Lossless JPEG decoder (SOF3, all 7 predictor modes). Apple
//!                  ProRAW uses this for pixel data compression. Not the same as
//!                  regular lossy JPEG.
//! - `demosaic.rs` — Bilinear Bayer CFA demosaicing for standard raw DNG files.
//!                  Not used for Linear DNG (Apple ProRAW) which is pre-demosaiced.
//! - `color.rs`   — White balance, color matrix (camera RGB → XYZ → sRGB),
//!                  sRGB gamma, and LUT application.
//!
//! ## Processing pipeline
//!
//! For both Linear DNG (Apple ProRAW) and standard CFA DNG:
//!   LinearizationTable → normalize → WB(AsShotNeutral) → neutralized cam→sRGB
//!   matrix → BaselineExposure → ProfileToneCurve → sRGB gamma → auto-levels →
//!   EXIF orientation
//!
//! (The gain map is disabled by default — see ProfileGainTableMap note below.)
//!
//! The TIFF Orientation tag (0x0112) is applied last so portrait shots
//! (orientation 6/8) load upright; see `crate::orientation`.
//!
//! ## Key discoveries
//!
//! - Apple ProRAW stores 10-bit sensor data with a non-linear LinearizationTable
//!   (tag 50712) that maps raw ADC codes to linearized 16-bit values. The table
//!   is roughly cubic — raw code 100 maps to ~160 (out of 65535), not ~6400.
//!   Without applying the table, shadow values are ~40x too bright and the tonal
//!   response is completely wrong, producing blown-out images with extreme
//!   contrast scenes (e.g., concert with stage lighting). Always apply the table
//!   before normalization when present.
//!
//! - Apple ProRAW (Linear DNG) carries camera-native linear data that DOES need
//!   the color matrix. Despite AsShotNeutral≈[1,1,1], the pixels are NOT in sRGB
//!   — they are in camera native space and require the WB + matrix pass for
//!   correct color (green foliage, neutral whites). Skipping the matrix leaves
//!   a desaturated gray-green cast.
//!
//! - The raw inverse-ColorMatrix (camera→XYZ→sRGB) does not preserve neutral:
//!   its row sums are far from 1 (~3 / 0.6 / 1.9 for Apple), so a neutral gray
//!   maps to magenta. `color::neutralize_matrix` column-scales the matrix to
//!   force neutral→neutral while keeping the off-diagonal saturation structure.
//!   Always applied to the ColorMatrix path; the ForwardMatrix path is already
//!   neutral-preserving by construction and is NOT neutralized.
//!
//! - After LinearizationTable is applied, WhiteLevel (65535) is authoritative for
//!   normalization. The measured-max heuristic (for detecting Apple's wrong
//!   WhiteLevel on un-linearized data) is skipped when a table is present.
//!
//! - ProfileGainTableMap (tag 52525, DNG 1.6) is Apple's proprietary
//!   local-tone map. Correct application requires an underdocumented
//!   overrange/diffuse-white normalization; without it the image washes out.
//!   Disabled by default (set `DNG_ENABLE_GAINMAP=1` to opt in). The parse and
//!   apply code is kept intact so it can be enabled for experimentation.
//!
//! - ProfileGainTableMap data is stored in big-endian byte order regardless of
//!   the TIFF file's byte order (DNG SDK stream serialization always uses BE).
//!
//! - The ProfileToneCurve in Apple ProRAW is intentionally near-linear (barely
//!   an S-curve). Apple wants maximum editing latitude. The "look" that camera
//!   apps show comes from additional rendering, not the DNG metadata.
//!
//! - ColorMatrix1 is calibrated for illuminant A (tungsten), ColorMatrix2 for
//!   D65 (daylight). Since our XYZ→sRGB matrix assumes D65, we prefer CM2.
//!
//! ## Future work
//!
//! - ProfileHueSatMapData (tags 50937/50938): per-hue color adjustments.
//! - ProfileLookTable (tag 50981): 3D LUT for profile "look".
//! - Move gain table map processing to a background thread/worker — it's
//!   O(width × height) with 8 gain lookups per pixel, ~2-3s for 24MP.
//! - Support additional compression formats (lossy JPEG, JPEG XL).
//! - Test with non-Apple DNG files (Adobe DNG Converter output, other cameras).

pub mod tiff;
mod ljpeg;
pub mod demosaic;
pub mod color;

use tiff::{TiffReader, IfdEntry, TagId};

/// Luminance-percentile clip fractions for the default ProRAW auto-levels
/// stretch. Conservative values keep shadow and highlight detail while still
/// pulling the histogram out to true black/white. White is clipped less than
/// black to protect bright highlight detail (e.g. petal texture).
const AUTO_LEVELS_BLACK_CLIP: f64 = 0.002;
const AUTO_LEVELS_WHITE_CLIP: f64 = 0.001;

pub struct DngImage {
    pub width: u32,
    pub height: u32,
    /// f32 RGBA in [0, 1] sRGB, ready for GPU upload.
    pub pixels: Vec<f32>,
    /// BaselineExposure EV value from DNG metadata (0.0 if absent).
    pub baseline_exposure: f64,
    /// ProfileToneCurve control points as (input, output) pairs in [0, 1].
    /// Empty if the DNG has no tone curve.
    pub tone_curve: Vec<(f64, f64)>,
    /// Debug log lines from the processing pipeline.
    pub debug_log: Vec<String>,
}

pub fn read_dng(data: &[u8]) -> Result<DngImage, String> {
    let mut debug_log: Vec<String> = Vec::new();
    macro_rules! dng_log {
        ($($arg:tt)*) => { debug_log.push(format!($($arg)*)); };
    }
    let reader = TiffReader::new(data)?;

    let ifd0 = reader.read_ifd(0)?;

    // Dump all IFD0 tags for diagnostics
    let mut ifd0_tags: Vec<String> = Vec::new();
    for entry in &ifd0 {
        let val_preview = if entry.raw_bytes.len() <= 16 {
            format!("{:?}", &entry.raw_bytes)
        } else {
            format!("[{} bytes]", entry.raw_bytes.len())
        };
        ifd0_tags.push(format!("{}(type={},n={},{})", entry.tag, entry.typ, entry.count, val_preview));
    }
    dng_log!("[DNG tags] IFD0 ({} entries): {}", ifd0.len(), ifd0_tags.join(", "));

    let main_ifd = find_main_image_ifd(&reader)?;

    // Dump SubIFD tags too
    let mut sub_tags: Vec<String> = Vec::new();
    for entry in &main_ifd {
        sub_tags.push(format!("{}(type={},n={})", entry.tag, entry.typ, entry.count));
    }
    dng_log!("[DNG tags] SubIFD ({} entries): {}", main_ifd.len(), sub_tags.join(", "));

    let width = get_tag_u32(&main_ifd, TagId::ImageWidth)?;
    let height = get_tag_u32(&main_ifd, TagId::ImageLength)?;
    let bps = get_tag_u16_vec(&main_ifd, TagId::BitsPerSample).unwrap_or_else(|_| vec![16]);
    let bits = bps[0] as u32;
    let compression = get_tag_u16(&main_ifd, TagId::Compression).unwrap_or(1);
    let photo_interp = get_tag_u16(&main_ifd, TagId::PhotometricInterpretation).unwrap_or(32803);
    let samples = get_tag_u16(&main_ifd, TagId::SamplesPerPixel).unwrap_or(1) as u32;

    let is_linear = photo_interp == 34892;
    let is_cfa = photo_interp == 32803;

    let strip_offsets = get_tag_u32_vec(&main_ifd, TagId::StripOffsets)
        .or_else(|_| get_tag_u32_vec(&main_ifd, TagId::TileOffsets))?;
    let strip_counts = get_tag_u32_vec(&main_ifd, TagId::StripByteCounts)
        .or_else(|_| get_tag_u32_vec(&main_ifd, TagId::TileByteCounts))?;

    let tile_width = get_tag_u32(&main_ifd, TagId::TileWidth).ok();
    let tile_height = get_tag_u32(&main_ifd, TagId::TileLength).ok();

    let mut raw_bytes = Vec::new();
    for (off, count) in strip_offsets.iter().zip(strip_counts.iter()) {
        let start = *off as usize;
        let end = start + *count as usize;
        if end > data.len() {
            return Err("Strip/tile data out of bounds".into());
        }
        raw_bytes.extend_from_slice(&data[start..end]);
    }

    let mut pixel_data: Vec<u16> = match compression {
        1 => decode_uncompressed(&raw_bytes, bits)?,
        7 => {
            if let (Some(tw), Some(th)) = (tile_width, tile_height) {
                decode_ljpeg_tiled(data, &strip_offsets, &strip_counts, width, height, tw, th, samples)?
            } else {
                ljpeg::decode_lossless_jpeg(&raw_bytes)?
            }
        }
        8 | 32946 => decode_deflate(&raw_bytes, bits)?,
        _ => return Err(format!("Unsupported DNG compression: {compression}")),
    };

    let expected_pixels = if is_linear {
        (width * height * samples) as usize
    } else {
        (width * height) as usize
    };

    if pixel_data.len() < expected_pixels {
        return Err(format!(
            "Decoded pixel count mismatch: got {} values, expected {} ({}x{}x{})",
            pixel_data.len(), expected_pixels, width, height, samples
        ));
    }

    // DNG stores document-level color metadata in IFD0, image data tags in SubIFDs.
    // Prefer ColorMatrix2/ForwardMatrix2 (D65 illuminant) over CM1/FM1 (illuminant A)
    // since our XYZ→sRGB matrix assumes D65.
    let color_matrix2 = get_rational_array_either(&ifd0, &main_ifd, TagId::ColorMatrix2);
    let color_matrix1 = get_rational_array_either(&ifd0, &main_ifd, TagId::ColorMatrix1);
    let color_matrix = if color_matrix2.len() >= 9 { color_matrix2 } else { color_matrix1 };
    let forward_matrix2 = get_rational_array_either(&ifd0, &main_ifd, TagId::ForwardMatrix2);
    let forward_matrix1 = get_rational_array_either(&ifd0, &main_ifd, TagId::ForwardMatrix1);
    let forward_matrix = if forward_matrix2.len() >= 9 { forward_matrix2 } else { forward_matrix1 };
    let as_shot_neutral = get_rational_array_either(&ifd0, &main_ifd, TagId::AsShotNeutral);
    let baseline_exposure = get_rational(&ifd0, TagId::BaselineExposure)
        .or_else(|| get_rational(&main_ifd, TagId::BaselineExposure));

    // LinearizationTable (tag 50712): maps raw ADC codes to linearized values.
    // Apple ProRAW uses a non-linear 10-bit→16-bit table (roughly cubic) so the
    // 10-bit codes encode a compressed dynamic range. Without applying this table,
    // shadow values end up dramatically too bright and the tonal response is wrong.
    let linearization_table = get_tag_u16_vec(&main_ifd, TagId::LinearizationTable)
        .or_else(|_| get_tag_u16_vec(&ifd0, TagId::LinearizationTable))
        .ok();

    if let Some(ref lut) = linearization_table {
        dng_log!("[DNG meta] linearizationTable: {} entries, range [{}, {}]",
            lut.len(), lut.first().copied().unwrap_or(0), lut.last().copied().unwrap_or(0));
        let max_idx = lut.len() - 1;
        for v in pixel_data[..expected_pixels].iter_mut() {
            *v = lut[(*v as usize).min(max_idx)];
        }
    }

    // WhiteLevel: check SubIFD first (per-image), then IFD0, then compute from data.
    let white_level = get_tag_u32(&main_ifd, TagId::WhiteLevel)
        .or_else(|_| get_tag_u32(&ifd0, TagId::WhiteLevel))
        .ok();

    // BlackLevel: may be RATIONAL (type 5) or SHORT (type 3). Handle both.
    let black_level_rational = get_rational_array_either(&ifd0, &main_ifd, TagId::BlackLevel);
    let black = if !black_level_rational.is_empty() {
        black_level_rational[0]
    } else {
        let bl_short = get_tag_u16_vec(&main_ifd, TagId::BlackLevel)
            .or_else(|_| get_tag_u16_vec(&ifd0, TagId::BlackLevel))
            .ok();
        bl_short.and_then(|v| v.first().map(|&x| x as f64)).unwrap_or(0.0)
    };

    // Determine normalization range. After the LinearizationTable (if present),
    // pixel values are in the table's output range and WhiteLevel is authoritative.
    // Without a table, WhiteLevel may be 65535 even for 10/12/14-bit data (Apple
    // ProRAW does this), so fall back to measured max when WhiteLevel is clearly wrong.
    let measured_max = pixel_data[..expected_pixels].iter().copied().max().unwrap_or(1) as f64;
    let max_val = if linearization_table.is_some() {
        // Table was applied; WhiteLevel matches the table's output range.
        white_level.map(|wl| wl as f64).unwrap_or(measured_max.max(1.0))
    } else if let Some(wl) = white_level {
        let wl_f = wl as f64;
        if measured_max > 0.0 && measured_max < wl_f * 0.25 {
            measured_max
        } else {
            wl_f
        }
    } else {
        measured_max.max(1.0)
    };
    dng_log!("[DNG meta] measured data max={:.0}, using maxVal={:.0}", measured_max, max_val);

    let mut rgb_f32: Vec<f32>;

    if is_linear && samples >= 3 {
        rgb_f32 = Vec::with_capacity((width * height * 3) as usize);
        for i in 0..(width * height) as usize {
            let r = ((pixel_data[i * samples as usize] as f64 - black) / (max_val - black)).max(0.0) as f32;
            let g = ((pixel_data[i * samples as usize + 1] as f64 - black) / (max_val - black)).max(0.0) as f32;
            let b = ((pixel_data[i * samples as usize + 2] as f64 - black) / (max_val - black)).max(0.0) as f32;
            rgb_f32.push(r);
            rgb_f32.push(g);
            rgb_f32.push(b);
        }
    } else if is_cfa {
        let cfa_pattern = get_tag_u8_vec(&main_ifd, TagId::CfaPattern)
            .unwrap_or_else(|_| vec![0, 1, 1, 2]);

        let normalized: Vec<f32> = pixel_data[..expected_pixels]
            .iter()
            .map(|&v| ((v as f64 - black) / (max_val - black)).max(0.0) as f32)
            .collect();

        rgb_f32 = demosaic::bilinear(&normalized, width, height, &cfa_pattern);
    } else {
        return Err(format!("Unsupported PhotometricInterpretation: {photo_interp}"));
    }

    let ci = ((height / 2) as usize * width as usize + (width / 2) as usize) * 3;
    macro_rules! dbg_center {
        ($label:expr, $data:expr) => {
            if ci + 2 < $data.len() {
                debug_log.push(format!("[DNG step] {}: r={:.5} g={:.5} b={:.5}", $label, $data[ci], $data[ci+1], $data[ci+2]));
            }
        };
    }

    dbg_center!("after normalize", rgb_f32);

    dng_log!("[DNG meta] whiteLevel={:?} black={:.1} maxVal={:.1} bits={} samples={} linear={} cfa={}",
        white_level, black, max_val, bits, samples, is_linear, is_cfa);
    dng_log!("[DNG meta] asShotNeutral={:?}", &as_shot_neutral);
    dng_log!("[DNG meta] forwardMatrix len={} colorMatrix len={}", forward_matrix.len(), color_matrix.len());
    if forward_matrix.len() >= 9 {
        dng_log!("[DNG meta] forwardMatrix: [{:.4},{:.4},{:.4}; {:.4},{:.4},{:.4}; {:.4},{:.4},{:.4}]",
            forward_matrix[0],forward_matrix[1],forward_matrix[2],
            forward_matrix[3],forward_matrix[4],forward_matrix[5],
            forward_matrix[6],forward_matrix[7],forward_matrix[8]);
    }
    if color_matrix.len() >= 9 {
        dng_log!("[DNG meta] colorMatrix: [{:.4},{:.4},{:.4}; {:.4},{:.4},{:.4}; {:.4},{:.4},{:.4}]",
            color_matrix[0],color_matrix[1],color_matrix[2],
            color_matrix[3],color_matrix[4],color_matrix[5],
            color_matrix[6],color_matrix[7],color_matrix[8]);
    }

    // Apply white balance and color matrix unconditionally.
    //
    // Linear DNG (Apple ProRAW) carries camera-native linear data even when
    // AsShotNeutral≈[1,1,1]. The WB + matrix pass is required for correct
    // color — omitting it leaves the image in camera native space (gray-green
    // cast). See module-level docs for the full rationale.
    {
        // Apply white balance
        if as_shot_neutral.len() >= 3 {
            let wb = color::white_balance_multipliers(&as_shot_neutral);
            dng_log!("[DNG step] WB multipliers: [{:.4}, {:.4}, {:.4}]", wb[0], wb[1], wb[2]);
            color::apply_white_balance(&mut rgb_f32, &wb);
            dbg_center!("after WB", rgb_f32);
        }

        // Apply color matrix (camera RGB → XYZ → sRGB)
        if !forward_matrix.is_empty() && forward_matrix.len() >= 9 {
            // ForwardMatrix maps AsShotNeutral→D50 white by construction;
            // it is neutral-preserving and must NOT be column-scaled.
            let mat = color::forward_matrix_to_srgb(&forward_matrix);
            dng_log!("[DNG step] fwd→sRGB matrix: [{:.4},{:.4},{:.4}; {:.4},{:.4},{:.4}; {:.4},{:.4},{:.4}]",
                mat[0],mat[1],mat[2],mat[3],mat[4],mat[5],mat[6],mat[7],mat[8]);
            color::apply_matrix(&mut rgb_f32, &mat);
            dbg_center!("after matrix", rgb_f32);
        } else if !color_matrix.is_empty() && color_matrix.len() >= 9 {
            let mut mat = color::color_matrix_to_srgb(&color_matrix);
            // The inverse-ColorMatrix camera→sRGB does not preserve neutral
            // (its row sums are far from 1), so a neutral gray maps to magenta.
            // Column-scaling (neutralize) forces neutral→neutral while keeping
            // the off-diagonal saturation structure — same fix as the RAF path.
            mat = color::neutralize_matrix(&mat);
            dng_log!("[DNG step] cm→sRGB matrix (neutralized): [{:.4},{:.4},{:.4}; {:.4},{:.4},{:.4}; {:.4},{:.4},{:.4}]",
                mat[0],mat[1],mat[2],mat[3],mat[4],mat[5],mat[6],mat[7],mat[8]);
            color::apply_matrix(&mut rgb_f32, &mat);
            dbg_center!("after matrix", rgb_f32);
        } else {
            dng_log!("[DNG step] WARNING: no color matrix found");
        }
    }

    // ProfileGainTableMap — DNG 1.6 per-pixel local tone mapping.
    //
    // Disabled by default. Apple's gain map is proprietary local-tone mapping
    // that requires an underdocumented overrange/diffuse-white normalization;
    // without it the image washes out. Set DNG_ENABLE_GAINMAP=1 to opt in.
    // BaselineExposure always runs unconditionally, whether or not the gain
    // map is active, so that the downstream tone curve sees correctly-exposed
    // linear values in both cases.
    //
    // When the gain map IS enabled, pipeline order is:
    //   1. BaselineExposure (lifts exposure into linear space)
    //   2. Optional DNG_GAINMAP_SCALE multiplier (tunable overrange lift for highlight crush)
    //   3. Gain map LUT (maps weight → gain scalar)
    //   4. ProfileToneCurve → sRGB gamma (downstream, unchanged)
    //
    // BaselineExposure is NOT used in the gain-map weight formula (DNG spec).

    // Apply BaselineExposure unconditionally so it runs exactly once regardless
    // of whether the gain map is active.
    if let Some(ev) = baseline_exposure {
        if ev.abs() > 0.001 {
            let scale = (2.0f64).powf(ev) as f32;
            for v in &mut rgb_f32 {
                *v *= scale;
            }
            dbg_center!("after baselineExposure", rgb_f32);
        }
    }

    let gain_map_entry = main_ifd.iter().find(|e| e.tag == TagId::ProfileGainTableMap as u16);
    let has_gain_map = gain_map_entry.is_some()
        || ifd0.iter().any(|e| e.tag == TagId::ProfileGainTableMap as u16);

    // Gain map is opt-in: only apply when DNG_ENABLE_GAINMAP is set.
    let gainmap_enabled = std::env::var("DNG_ENABLE_GAINMAP").is_ok();

    if has_gain_map {
        if !gainmap_enabled {
            dng_log!("[DNG step] ProfileGainTableMap found but SKIPPED by default — set DNG_ENABLE_GAINMAP=1 to enable");
        } else {
            // Tunable diffuse-white input scale: multiply pixels before the gain map
            // so bright regions exceed 1.0 and reach the highlight-crush region of the LUT.
            let gainmap_scale: f32 = std::env::var("DNG_GAINMAP_SCALE")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(1.0);
            if gainmap_scale != 1.0 {
                dng_log!("[DNG step] DNG_GAINMAP_SCALE={:.3} — scaling pixels before gain map", gainmap_scale);
                for v in &mut rgb_f32 {
                    *v *= gainmap_scale;
                }
            }
            dbg_center!("after gainmap-scale", rgb_f32);

            let apply_gtm = |rgb: &mut Vec<f32>, gtm: &GainTableMap, label: &str, debug_log: &mut Vec<String>| {
                debug_log.push(format!("[DNG step] ProfileGainTableMap ({}): {}x{} grid, {} table pts, weights=[{:.2},{:.2},{:.2},{:.2},{:.2}]",
                    label, gtm.points_v, gtm.points_h, gtm.num_table_points,
                    gtm.weights[0], gtm.weights[1], gtm.weights[2], gtm.weights[3], gtm.weights[4]));
                // Log LUT at center grid point to see contrast range
                let center_row = gtm.points_v as usize / 2;
                let center_col = gtm.points_h as usize / 2;
                let tp = gtm.num_table_points as usize;
                let rs = gtm.points_h as usize * tp;
                let base = center_row * rs + center_col * tp;
                if base + tp <= gtm.data.len() {
                    let g0 = gtm.data[base];
                    let g64 = gtm.data[base + tp / 4];
                    let g128 = gtm.data[base + tp / 2];
                    let g192 = gtm.data[base + 3 * tp / 4];
                    let g256 = gtm.data[base + tp - 1];
                    debug_log.push(format!("[DNG step] center grid LUT: [0]={:.3} [1/4]={:.3} [1/2]={:.3} [3/4]={:.3} [end]={:.3}",
                        g0, g64, g128, g192, g256));
                }
                apply_gain_table_map(rgb, width, height, gtm);
            };

            if let Some(entry) = gain_map_entry {
                dng_log!("[DNG step] found ProfileGainTableMap tag: {} raw bytes", entry.raw_bytes.len());
                match parse_gain_table_map(&entry.raw_bytes) {
                    Ok(gtm) => {
                        apply_gtm(&mut rgb_f32, &gtm, "SubIFD", &mut debug_log);
                        dbg_center!("after gainmap", rgb_f32);
                    }
                    Err(e) => {
                        dng_log!("[DNG step] ProfileGainTableMap parse FAILED: {}", e);
                    }
                }
            } else {
                // Fall back: check IFD0
                let gain_map_entry_ifd0 = ifd0.iter().find(|e| e.tag == TagId::ProfileGainTableMap as u16);
                if let Some(entry) = gain_map_entry_ifd0 {
                    match parse_gain_table_map(&entry.raw_bytes) {
                        Ok(gtm) => {
                            apply_gtm(&mut rgb_f32, &gtm, "IFD0", &mut debug_log);
                            dbg_center!("after gainmap", rgb_f32);
                        }
                        Err(e) => {
                            dng_log!("[DNG step] ProfileGainTableMap (IFD0) parse FAILED: {}", e);
                        }
                    }
                }
            }
        }
    }

    // ProfileToneCurve
    let tone_curve_raw = get_rational_array_either(&ifd0, &main_ifd, TagId::ProfileToneCurve);
    let tone_curve: Vec<(f64, f64)> = tone_curve_raw
        .chunks_exact(2)
        .map(|pair| (pair[0], pair[1]))
        .collect();

    if tone_curve.len() >= 2 {
        dng_log!("[DNG step] applying toneCurve ({} pts), first=({:.4},{:.4}) last=({:.4},{:.4})",
            tone_curve.len(),
            tone_curve[0].0, tone_curve[0].1,
            tone_curve.last().unwrap().0, tone_curve.last().unwrap().1);
        let lut = build_tone_lut(&tone_curve);
        dng_log!("[DNG step] LUT samples: [0]={:.4} [1024]={:.4} [2048]={:.4} [3072]={:.4} [4095]={:.4}",
            lut[0], lut[1024], lut[2048], lut[3072], lut[4095]);
        color::apply_lut(&mut rgb_f32, &lut);
        dbg_center!("after toneCurve", rgb_f32);
    }

    color::apply_srgb_gamma(&mut rgb_f32);
    dbg_center!("after sRGB gamma (final)", rgb_f32);

    // Spread the tonal range to fill [0,1]. Apple ships a near-linear
    // ProfileToneCurve, expecting its own gain-map/HDR pass (which we disable —
    // it mis-applies) to add contrast. Without it the render is flat: the
    // histogram bunches in the middle with no true black/white. Derive a
    // black/white point from luminance percentiles and stretch all channels by
    // the same amount (preserving white balance, like a composite-RGB Levels
    // move). This is adaptive normalization, not a fixed creative curve.
    let (bp, wp) = auto_levels_points(&rgb_f32, AUTO_LEVELS_BLACK_CLIP, AUTO_LEVELS_WHITE_CLIP);
    dng_log!("[DNG step] auto-levels: black={:.4} white={:.4} (clip {:.2}%/{:.2}%)",
        bp, wp, AUTO_LEVELS_BLACK_CLIP * 100.0, AUTO_LEVELS_WHITE_CLIP * 100.0);
    if wp - bp > 0.05 {
        let scale = 1.0 / (wp - bp);
        for v in &mut rgb_f32 {
            *v = (((*v as f64 - bp) * scale).clamp(0.0, 1.0)) as f32;
        }
        dbg_center!("after auto-levels", rgb_f32);
    }

    // Convert RGB → RGBA f32
    let pixel_count = (width * height) as usize;
    let mut rgba = Vec::with_capacity(pixel_count * 4);
    for i in 0..pixel_count {
        rgba.push(rgb_f32[i * 3]);
        rgba.push(rgb_f32[i * 3 + 1]);
        rgba.push(rgb_f32[i * 3 + 2]);
        rgba.push(1.0);
    }

    // Apply the TIFF Orientation tag (0x0112) so the image loads upright.
    // The sensor scans landscape; the camera records the intended rotation
    // here (commonly 6 = 90° CW or 8 = 90° CCW for portrait shots). For
    // orientations 5..=8 the width and height swap. Orientation lives in IFD0.
    let orientation = get_tag_u16(&ifd0, TagId::Orientation)
        .or_else(|_| get_tag_u16(&main_ifd, TagId::Orientation))
        .unwrap_or(1);
    let (out_w, out_h, rgba) =
        crate::orientation::apply_exif_orientation(width, height, &rgba, orientation);
    dng_log!("[DNG step] EXIF orientation: {} → output {}x{}", orientation, out_w, out_h);

    Ok(DngImage {
        width: out_w,
        height: out_h,
        pixels: rgba,
        baseline_exposure: baseline_exposure.unwrap_or(0.0),
        tone_curve,
        debug_log,
    })
}

/// Find black and white points for an auto-levels stretch from a luminance
/// histogram of display-referred RGB (interleaved, 3 channels, in [0,1]).
///
/// Returns `(black, white)` as the luminance values where the cumulative
/// histogram crosses `black_clip` from the bottom and `white_clip` from the
/// top. Using luminance (not per-channel) keeps the stretch neutral so it
/// expands contrast without shifting color balance.
fn auto_levels_points(rgb: &[f32], black_clip: f64, white_clip: f64) -> (f64, f64) {
    const BINS: usize = 1024;
    let n = rgb.len() / 3;
    if n == 0 {
        return (0.0, 1.0);
    }
    let mut hist = [0u64; BINS];
    for px in rgb.chunks_exact(3) {
        let l = 0.2126 * px[0] as f64 + 0.7152 * px[1] as f64 + 0.0722 * px[2] as f64;
        let bin = ((l.clamp(0.0, 1.0) * (BINS as f64 - 1.0)).round() as usize).min(BINS - 1);
        hist[bin] += 1;
    }

    let total = n as f64;
    let black_target = total * black_clip;
    let white_target = total * white_clip;

    let bin_to_val = |bin: usize| bin as f64 / (BINS as f64 - 1.0);

    // Black point: first bin where the cumulative count from the bottom
    // exceeds the clip fraction.
    let mut cum = 0.0;
    let mut black = 0.0;
    for (i, &c) in hist.iter().enumerate() {
        cum += c as f64;
        if cum >= black_target {
            black = bin_to_val(i);
            break;
        }
    }

    // White point: first bin (scanning from the top) where the cumulative
    // count from the top exceeds the clip fraction.
    cum = 0.0;
    let mut white = 1.0;
    for i in (0..BINS).rev() {
        cum += hist[i] as f64;
        if cum >= white_target {
            white = bin_to_val(i);
            break;
        }
    }

    (black, white)
}

struct GainTableMap {
    points_v: u32,
    points_h: u32,
    spacing_v: f64,
    spacing_h: f64,
    origin_v: f64,
    origin_h: f64,
    num_table_points: u32,
    weights: [f32; 5],
    data: Vec<f32>,
}

fn parse_gain_table_map(raw: &[u8]) -> Result<GainTableMap, String> {
    // Header: 4+4+8+8+8+8+4+20 = 64 bytes
    if raw.len() < 64 { return Err(format!("header too short: {} bytes", raw.len())); }

    // ProfileGainTableMap data uses big-endian byte order (DNG SDK stream format)
    // regardless of the TIFF file's byte order.
    let u32_at = |off: usize| u32::from_be_bytes([raw[off], raw[off+1], raw[off+2], raw[off+3]]);
    let f64_at = |off: usize| f64::from_be_bytes([
        raw[off], raw[off+1], raw[off+2], raw[off+3],
        raw[off+4], raw[off+5], raw[off+6], raw[off+7],
    ]);
    let f32_at = |off: usize| f32::from_be_bytes([raw[off], raw[off+1], raw[off+2], raw[off+3]]);

    let points_v = u32_at(0);
    let points_h = u32_at(4);
    let spacing_v = f64_at(8);
    let spacing_h = f64_at(16);
    let origin_v = f64_at(24);
    let origin_h = f64_at(32);
    let num_table_points = u32_at(40);

    if points_v == 0 || points_h == 0 || num_table_points == 0 {
        return Err(format!("zero dimension: {}x{}x{}", points_v, points_h, num_table_points));
    }
    if points_v > 10000 || points_h > 10000 || num_table_points > 10000 {
        return Err(format!("dimension too large: {}x{}x{}", points_v, points_h, num_table_points));
    }

    let weights = [
        f32_at(44), f32_at(48), f32_at(52), f32_at(56), f32_at(60),
    ];

    let total = (points_v as u64 * points_h as u64 * num_table_points as u64) as usize;
    let data_start = 64;
    let data_end = data_start + total * 4;

    if raw.len() < data_end {
        return Err(format!(
            "data too short: need {} bytes ({}x{}x{}x4 + 64), have {} bytes",
            data_end, points_v, points_h, num_table_points, raw.len()
        ));
    }

    let data: Vec<f32> = raw[data_start..data_end]
        .chunks_exact(4)
        .map(|c| f32::from_be_bytes([c[0], c[1], c[2], c[3]]))
        .collect();

    Ok(GainTableMap { points_v, points_h, spacing_v, spacing_h, origin_v, origin_h, num_table_points, weights, data })
}

fn apply_gain_table_map(rgb: &mut [f32], width: u32, height: u32, gtm: &GainTableMap) {
    let w = width as usize;
    let h = height as usize;
    let points_h = gtm.points_h as usize;
    let points_v = gtm.points_v as usize;
    let origin_v = gtm.origin_v as f32;
    let origin_h = gtm.origin_h as f32;
    let spacing_v = (gtm.spacing_v as f32).max(1e-10);
    let spacing_h = (gtm.spacing_h as f32).max(1e-10);
    let table_pts = gtm.num_table_points as usize;
    let col_step = table_pts;
    let row_step = points_h * table_pts;

    let [miw0, miw1, miw2, miw3, miw4] = gtm.weights;

    for row in 0..h {
        // Spatial grid coord: half-pixel image coordinate normalised to [0,1],
        // then mapped into grid space using raw spacing (not spacing*(points-1)).
        let v_image = (row as f32 + 0.5) / h as f32;
        let gv = ((v_image - origin_v) / spacing_v).clamp(0.0, (points_v - 1) as f32);
        let y0 = (gv.floor() as usize).min(points_v - 1);
        let y1 = (y0 + 1).min(points_v - 1);
        let yf = gv - y0 as f32;

        for col in 0..w {
            let idx = (row * w + col) * 3;
            let r = rgb[idx];
            let g = rgb[idx + 1];
            let b = rgb[idx + 2];

            let min_v = r.min(g.min(b));
            let max_v = r.max(g.max(b));
            // DNG spec: weight = clamp(R*w0 + G*w1 + B*w2 + min*w3 + max*w4, 0, 1)
            // No BaselineExposure factor in the weight computation.
            let weight = (miw0 * r + miw1 * g + miw2 * b + miw3 * min_v + miw4 * max_v).clamp(0.0, 1.0);

            let u_image = (col as f32 + 0.5) / w as f32;
            let gx = ((u_image - origin_h) / spacing_h).clamp(0.0, (points_h - 1) as f32);
            let x0 = (gx.floor() as usize).min(points_h - 1);
            let x1 = (x0 + 1).min(points_h - 1);
            let xf = gx - x0 as f32;

            // Index into LUT: weight * num_table_points (×257 for a 257-entry table),
            // clamped to [0, table_pts-1] for safe interpolation.
            let fi = weight * (table_pts as f32);
            let w0 = (fi.floor() as usize).min(table_pts - 1);
            let w1 = (w0 + 1).min(table_pts - 1);
            let wf = (fi - w0 as f32).clamp(0.0, 1.0);

            let entry = |rv: usize, c: usize, t: usize| -> f32 {
                let idx = rv * row_step + c * col_step + t;
                if idx < gtm.data.len() { gtm.data[idx] } else { 1.0 }
            };

            let g000 = entry(y0, x0, w0); let g001 = entry(y0, x0, w1);
            let g010 = entry(y0, x1, w0); let g011 = entry(y0, x1, w1);
            let g100 = entry(y1, x0, w0); let g101 = entry(y1, x0, w1);
            let g110 = entry(y1, x1, w0); let g111 = entry(y1, x1, w1);

            let g00 = g000 + (g001 - g000) * wf;
            let g01 = g010 + (g011 - g010) * wf;
            let g10 = g100 + (g101 - g100) * wf;
            let g11 = g110 + (g111 - g110) * wf;

            let g0 = g00 + (g01 - g00) * xf;
            let g1 = g10 + (g11 - g10) * xf;

            let gain = g0 + (g1 - g0) * yf;

            // Do NOT clamp here — preserve overrange so the downstream tone curve
            // can crush highlights. The final RGBA conversion clamps to [0,1].
            rgb[idx]     = r * gain;
            rgb[idx + 1] = g * gain;
            rgb[idx + 2] = b * gain;
        }
    }
}

/// Build a 4096-entry LUT from ProfileToneCurve control points via linear interpolation.
fn build_tone_lut(curve: &[(f64, f64)]) -> Vec<f32> {
    let size = 4096usize;
    let mut lut = vec![0.0f32; size];
    for i in 0..size {
        let x = i as f64 / (size - 1) as f64;
        // Find the segment containing x
        let mut y = curve.last().map(|&(_, v)| v).unwrap_or(x);
        for w in curve.windows(2) {
            let (x0, y0) = w[0];
            let (x1, y1) = w[1];
            if x <= x1 {
                let t = if (x1 - x0).abs() < 1e-10 { 0.0 } else { (x - x0) / (x1 - x0) };
                y = y0 + t * (y1 - y0);
                break;
            }
        }
        lut[i] = y.clamp(0.0, 1.0) as f32;
    }
    lut
}

fn find_main_image_ifd(reader: &TiffReader) -> Result<Vec<IfdEntry>, String> {
    let ifd0 = reader.read_ifd(0)?;

    if let Ok(sub_offsets) = get_tag_u32_vec(&ifd0, TagId::SubIFDs) {
        let mut best_ifd = None;
        let mut best_pixels = 0u64;

        for &offset in &sub_offsets {
            if let Ok(sub_ifd) = reader.read_ifd_at(offset) {
                let w = get_tag_u32(&sub_ifd, TagId::ImageWidth).unwrap_or(0) as u64;
                let h = get_tag_u32(&sub_ifd, TagId::ImageLength).unwrap_or(0) as u64;
                if w * h > best_pixels {
                    best_pixels = w * h;
                    best_ifd = Some(sub_ifd);
                }
            }
        }

        if let Some(ifd) = best_ifd {
            return Ok(ifd);
        }
    }

    Ok(ifd0)
}

fn decode_uncompressed(data: &[u8], bits: u32) -> Result<Vec<u16>, String> {
    match bits {
        8 => Ok(data.iter().map(|&b| (b as u16) << 8).collect()),
        16 => {
            if data.len() % 2 != 0 {
                return Err("Odd byte count for 16-bit data".into());
            }
            Ok(data.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect())
        }
        _ => Err(format!("Unsupported bit depth for uncompressed: {bits}")),
    }
}

fn decode_deflate(data: &[u8], bits: u32) -> Result<Vec<u16>, String> {
    use flate2::read::ZlibDecoder;
    use std::io::Read;

    let mut decoder = ZlibDecoder::new(data);
    let mut decompressed = Vec::new();
    decoder.read_to_end(&mut decompressed)
        .map_err(|e| format!("Deflate decompression failed: {e}"))?;

    decode_uncompressed(&decompressed, bits)
}

fn decode_ljpeg_tiled(
    file_data: &[u8],
    offsets: &[u32],
    byte_counts: &[u32],
    image_w: u32,
    image_h: u32,
    tile_w: u32,
    tile_h: u32,
    samples: u32,
) -> Result<Vec<u16>, String> {
    let tiles_across = (image_w + tile_w - 1) / tile_w;
    let tiles_down = (image_h + tile_h - 1) / tile_h;
    let total_tiles = (tiles_across * tiles_down) as usize;

    if offsets.len() < total_tiles {
        return Err(format!("Not enough tile offsets: {} < {}", offsets.len(), total_tiles));
    }

    let mut image = vec![0u16; (image_w * image_h * samples) as usize];

    for tile_idx in 0..total_tiles {
        let tx = (tile_idx as u32) % tiles_across;
        let ty = (tile_idx as u32) / tiles_across;
        let start = offsets[tile_idx] as usize;
        let count = byte_counts[tile_idx] as usize;

        if start + count > file_data.len() {
            return Err("Tile data out of bounds".into());
        }

        let tile_data = &file_data[start..start + count];
        let decoded = ljpeg::decode_lossless_jpeg(tile_data)?;

        let actual_tw = tile_w.min(image_w - tx * tile_w);
        let actual_th = tile_h.min(image_h - ty * tile_h);

        for row in 0..actual_th {
            let dst_y = ty * tile_h + row;
            if dst_y >= image_h { break; }

            for col in 0..actual_tw {
                let dst_x = tx * tile_w + col;
                if dst_x >= image_w { continue; }

                for s in 0..samples {
                    let src_idx = ((row * tile_w + col) * samples + s) as usize;
                    let dst_idx = ((dst_y * image_w + dst_x) * samples + s) as usize;
                    if src_idx < decoded.len() {
                        image[dst_idx] = decoded[src_idx];
                    }
                }
            }
        }
    }

    Ok(image)
}

// Tag value extraction helpers

fn get_tag_u16(entries: &[IfdEntry], tag: TagId) -> Result<u16, String> {
    entries.iter()
        .find(|e| e.tag == tag as u16)
        .and_then(|e| e.as_u16())
        .ok_or_else(|| format!("Tag {:?} not found", tag))
}

fn get_tag_u32(entries: &[IfdEntry], tag: TagId) -> Result<u32, String> {
    entries.iter()
        .find(|e| e.tag == tag as u16)
        .and_then(|e| e.as_u32())
        .ok_or_else(|| format!("Tag {:?} not found", tag))
}

fn get_tag_u16_vec(entries: &[IfdEntry], tag: TagId) -> Result<Vec<u16>, String> {
    entries.iter()
        .find(|e| e.tag == tag as u16)
        .and_then(|e| e.as_u16_vec())
        .ok_or_else(|| format!("Tag {:?} not found", tag))
}

fn get_tag_u32_vec(entries: &[IfdEntry], tag: TagId) -> Result<Vec<u32>, String> {
    entries.iter()
        .find(|e| e.tag == tag as u16)
        .and_then(|e| e.as_u32_vec())
        .ok_or_else(|| format!("Tag {:?} not found", tag))
}

fn get_tag_u8_vec(entries: &[IfdEntry], tag: TagId) -> Result<Vec<u8>, String> {
    entries.iter()
        .find(|e| e.tag == tag as u16)
        .map(|e| e.raw_bytes.clone())
        .ok_or_else(|| format!("Tag {:?} not found", tag))
}

fn get_rational_array_either(primary: &[IfdEntry], fallback: &[IfdEntry], tag: TagId) -> Vec<f64> {
    let v = get_rational_array(primary, tag);
    if !v.is_empty() { v } else { get_rational_array(fallback, tag) }
}

fn get_rational_array(entries: &[IfdEntry], tag: TagId) -> Vec<f64> {
    entries.iter()
        .find(|e| e.tag == tag as u16)
        .map(|e| e.as_rational_vec())
        .unwrap_or_default()
}

fn get_rational(entries: &[IfdEntry], tag: TagId) -> Option<f64> {
    entries.iter()
        .find(|e| e.tag == tag as u16)
        .and_then(|e| {
            let v = e.as_rational_vec();
            if v.is_empty() { None } else { Some(v[0]) }
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a gray ramp of `n` pixels with luminance i/(n-1) (R=G=B).
    fn gray_ramp(n: usize) -> Vec<f32> {
        let mut v = Vec::with_capacity(n * 3);
        for i in 0..n {
            let l = i as f32 / (n - 1) as f32;
            v.extend_from_slice(&[l, l, l]);
        }
        v
    }

    #[test]
    fn auto_levels_finds_clip_percentiles() {
        // Uniform ramp: a 10% clip from each end lands near 0.1 / 0.9.
        let ramp = gray_ramp(1000);
        let (black, white) = auto_levels_points(&ramp, 0.10, 0.10);
        assert!((black - 0.10).abs() < 0.02, "black={black}");
        assert!((white - 0.90).abs() < 0.02, "white={white}");
        assert!(black < white);
    }

    #[test]
    fn auto_levels_tiny_clip_spans_full_range() {
        // With a negligible clip the points sit at the data extremes.
        let ramp = gray_ramp(1000);
        let (black, white) = auto_levels_points(&ramp, 0.0001, 0.0001);
        assert!(black < 0.01, "black={black}");
        assert!(white > 0.99, "white={white}");
    }

    #[test]
    fn auto_levels_empty_is_identity_range() {
        let (black, white) = auto_levels_points(&[], 0.01, 0.01);
        assert_eq!((black, white), (0.0, 1.0));
    }

    #[test]
    fn auto_levels_uses_luminance_not_max_channel() {
        // A blue-only image: luminance is low (0.0722) even though B=1.0.
        // The black/white points must reflect luminance, not the blue channel.
        let pixels = vec![0.0f32, 0.0, 1.0]; // single pixel, R=0 G=0 B=1
        let (black, white) = auto_levels_points(&pixels, 0.0001, 0.0001);
        // Luminance ≈ 0.0722 → both points collapse near that value.
        assert!(black < 0.1 && white < 0.1, "black={black} white={white}");
    }
}
