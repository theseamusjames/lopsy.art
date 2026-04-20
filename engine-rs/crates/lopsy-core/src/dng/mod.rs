mod tiff;
mod ljpeg;
mod demosaic;
mod color;

use tiff::{TiffReader, IfdEntry, TagId};

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

    let pixel_data: Vec<u16> = match compression {
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

    // WhiteLevel: check SubIFD first (per-image), then IFD0, then compute from data.
    let white_level = get_tag_u32(&main_ifd, TagId::WhiteLevel)
        .or_else(|_| get_tag_u32(&ifd0, TagId::WhiteLevel))
        .ok();

    let black_level = get_rational_array_either(&ifd0, &main_ifd, TagId::BlackLevel);
    let black = if !black_level.is_empty() { black_level[0] } else { 0.0 };

    // Determine normalization range. WhiteLevel may be 65535 even for 10/12/14-bit
    // data (Apple ProRAW does this). If the actual data max is far below
    // WhiteLevel, use the measured max so values span full [0, 1].
    let measured_max = pixel_data[..expected_pixels].iter().copied().max().unwrap_or(1) as f64;
    let max_val = if let Some(wl) = white_level {
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

    // For Linear DNG with AsShotNeutral=[1,1,1], the data has WB and color
    // processing already applied by the camera's ISP (Apple ProRAW).
    // ColorMatrix describes the raw sensor→XYZ mapping, NOT the processing
    // space→XYZ mapping. Applying it to pre-processed data produces wrong colors.
    //
    // For standard CFA DNG, apply the full pipeline: WB → ColorMatrix → sRGB.
    let is_preprocessed = is_linear
        && as_shot_neutral.len() >= 3
        && (as_shot_neutral[0] - 1.0).abs() < 0.01
        && (as_shot_neutral[1] - 1.0).abs() < 0.01
        && (as_shot_neutral[2] - 1.0).abs() < 0.01;

    if is_preprocessed {
        dng_log!("[DNG step] Linear DNG with AsShotNeutral≈[1,1,1] — skipping WB and color matrix (data is pre-processed)");
    } else {
        // Apply white balance
        if as_shot_neutral.len() >= 3 {
            let wb = color::white_balance_multipliers(&as_shot_neutral);
            dng_log!("[DNG step] WB multipliers: [{:.4}, {:.4}, {:.4}]", wb[0], wb[1], wb[2]);
            color::apply_white_balance(&mut rgb_f32, &wb);
            dbg_center!("after WB", rgb_f32);
        }

        // Apply color matrix (camera RGB → XYZ → sRGB)
        if !forward_matrix.is_empty() && forward_matrix.len() >= 9 {
            let mat = color::forward_matrix_to_srgb(&forward_matrix);
            dng_log!("[DNG step] fwd→sRGB matrix: [{:.4},{:.4},{:.4}; {:.4},{:.4},{:.4}; {:.4},{:.4},{:.4}]",
                mat[0],mat[1],mat[2],mat[3],mat[4],mat[5],mat[6],mat[7],mat[8]);
            color::apply_matrix(&mut rgb_f32, &mat);
            dbg_center!("after matrix", rgb_f32);
        } else if !color_matrix.is_empty() && color_matrix.len() >= 9 {
            let mat = color::color_matrix_to_srgb(&color_matrix);
            dng_log!("[DNG step] cm→sRGB matrix: [{:.4},{:.4},{:.4}; {:.4},{:.4},{:.4}; {:.4},{:.4},{:.4}]",
                mat[0],mat[1],mat[2],mat[3],mat[4],mat[5],mat[6],mat[7],mat[8]);
            color::apply_matrix(&mut rgb_f32, &mat);
            dbg_center!("after matrix", rgb_f32);
        } else {
            dng_log!("[DNG step] WARNING: no color matrix found");
        }
    }

    // ProfileGainTableMap — DNG 1.6 per-pixel local tone mapping.
    // Applied before tone curve, with BaselineExposure as weight scale.
    let exposure_gain = baseline_exposure.map(|ev| 2.0f64.powf(ev) as f32).unwrap_or(1.0);

    let gain_map_entry = main_ifd.iter().find(|e| e.tag == TagId::ProfileGainTableMap as u16);
    if let Some(entry) = gain_map_entry {
        if let Some(gtm) = parse_gain_table_map(&entry.raw_bytes) {
            dng_log!("[DNG step] ProfileGainTableMap: {}x{} grid, {} table pts, weights=[{:.2},{:.2},{:.2},{:.2},{:.2}]",
                gtm.points_v, gtm.points_h, gtm.num_table_points,
                gtm.weights[0], gtm.weights[1], gtm.weights[2], gtm.weights[3], gtm.weights[4]);
            apply_gain_table_map(&mut rgb_f32, width, height, &gtm, exposure_gain);
            dbg_center!("after gainTableMap", rgb_f32);
        }
    } else {
        // Fall back: check IFD0
        let gain_map_entry_ifd0 = ifd0.iter().find(|e| e.tag == TagId::ProfileGainTableMap as u16);
        if let Some(entry) = gain_map_entry_ifd0 {
            if let Some(gtm) = parse_gain_table_map(&entry.raw_bytes) {
                dng_log!("[DNG step] ProfileGainTableMap (IFD0): {}x{} grid, {} table pts",
                    gtm.points_v, gtm.points_h, gtm.num_table_points);
                apply_gain_table_map(&mut rgb_f32, width, height, &gtm, exposure_gain);
                dbg_center!("after gainTableMap", rgb_f32);
            }
        }
    }

    // Apply BaselineExposure (only if no gain table map was applied — the gain
    // table map already incorporates exposure via the weight scaling)
    if gain_map_entry.is_none() {
        if let Some(ev) = baseline_exposure {
            if ev.abs() > 0.001 {
                let scale = (2.0f64).powf(ev) as f32;
                for v in &mut rgb_f32 {
                    *v *= scale;
                }
                dbg_center!("after baselineExposure", rgb_f32);
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

    // Convert RGB → RGBA f32
    let pixel_count = (width * height) as usize;
    let mut rgba = Vec::with_capacity(pixel_count * 4);
    for i in 0..pixel_count {
        rgba.push(rgb_f32[i * 3]);
        rgba.push(rgb_f32[i * 3 + 1]);
        rgba.push(rgb_f32[i * 3 + 2]);
        rgba.push(1.0);
    }

    Ok(DngImage {
        width,
        height,
        pixels: rgba,
        baseline_exposure: baseline_exposure.unwrap_or(0.0),
        tone_curve,
        debug_log,
    })
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

fn parse_gain_table_map(raw: &[u8]) -> Option<GainTableMap> {
    // Header: 4+4+8+8+8+8+4+20 = 64 bytes
    if raw.len() < 64 { return None; }

    let u32_at = |off: usize| u32::from_le_bytes([raw[off], raw[off+1], raw[off+2], raw[off+3]]);
    let f64_at = |off: usize| f64::from_le_bytes([
        raw[off], raw[off+1], raw[off+2], raw[off+3],
        raw[off+4], raw[off+5], raw[off+6], raw[off+7],
    ]);
    let f32_at = |off: usize| f32::from_le_bytes([raw[off], raw[off+1], raw[off+2], raw[off+3]]);

    let points_v = u32_at(0);
    let points_h = u32_at(4);
    let spacing_v = f64_at(8);
    let spacing_h = f64_at(16);
    let origin_v = f64_at(24);
    let origin_h = f64_at(32);
    let num_table_points = u32_at(40);

    let weights = [
        f32_at(44), f32_at(48), f32_at(52), f32_at(56), f32_at(60),
    ];

    let total = (points_v * points_h * num_table_points) as usize;
    let data_start = 64;
    let data_end = data_start + total * 4;
    if raw.len() < data_end { return None; }

    let data: Vec<f32> = raw[data_start..data_end]
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();

    Some(GainTableMap { points_v, points_h, spacing_v, spacing_h, origin_v, origin_h, num_table_points, weights, data })
}

fn apply_gain_table_map(rgb: &mut [f32], width: u32, height: u32, gtm: &GainTableMap, exposure_gain: f32) {
    let w = width as usize;
    let h = height as usize;
    let map_pv = gtm.points_v as f32;
    let map_ph = gtm.points_h as f32;
    let origin_v = gtm.origin_v as f32;
    let origin_h = gtm.origin_h as f32;
    let spacing_v = (gtm.spacing_v as f32).max(1e-10);
    let spacing_h = (gtm.spacing_h as f32).max(1e-10);
    let rel_size_v = spacing_v * (map_pv - 1.0);
    let rel_size_h = spacing_h * (map_ph - 1.0);
    let table_pts = gtm.num_table_points as usize;
    let table_size = (table_pts - 1) as f32;
    let col_step = table_pts;
    let row_step = gtm.points_h as usize * table_pts;
    let x_limit = (gtm.points_h as i32 - 2).max(0);
    let y_limit = (gtm.points_v as i32 - 2).max(0);

    let [miw0, miw1, miw2, miw3, miw4] = gtm.weights;

    for row in 0..h {
        let v_image = (row as f32 + 0.5) / h as f32;
        let v_map = (v_image - origin_v) / rel_size_v;
        let y_map = (v_map * (map_pv - 1.0) - 0.5).clamp(0.0, y_limit as f32);
        let y0 = (y_map as i32).min(y_limit) as usize;
        let y1 = (y0 + 1).min(gtm.points_v as usize - 1);
        let yf = y_map - y0 as f32;

        for col in 0..w {
            let idx = (row * w + col) * 3;
            let r = rgb[idx];
            let g = rgb[idx + 1];
            let b = rgb[idx + 2];

            let min_v = r.min(g.min(b));
            let max_v = r.max(g.max(b));
            let weight = (miw0 * r + miw1 * g + miw2 * b + miw3 * min_v + miw4 * max_v) * exposure_gain;
            let weight = weight.clamp(0.0, 1.0);

            let u_image = (col as f32 + 0.5) / w as f32;
            let u_map = (u_image - origin_h) / rel_size_h;
            let x_map = (u_map * (map_ph - 1.0) - 0.5).clamp(0.0, x_limit as f32);
            let x0 = (x_map as i32).min(x_limit) as usize;
            let x1 = (x0 + 1).min(gtm.points_h as usize - 1);
            let xf = x_map - x0 as f32;

            let ws = weight * table_size;
            let w0 = (ws as usize).min(table_pts - 1);
            let w1 = (w0 + 1).min(table_pts - 1);
            let wf = ws - w0 as f32;

            let entry = |r: usize, c: usize, t: usize| -> f32 {
                gtm.data[r * row_step + c * col_step + t]
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

            rgb[idx]     = (r * gain).clamp(0.0, 1.0);
            rgb[idx + 1] = (g * gain).clamp(0.0, 1.0);
            rgb[idx + 2] = (b * gain).clamp(0.0, 1.0);
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
