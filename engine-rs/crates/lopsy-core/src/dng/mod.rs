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
}

pub fn read_dng(data: &[u8]) -> Result<DngImage, String> {
    let reader = TiffReader::new(data)?;

    let ifd0 = reader.read_ifd(0)?;
    let main_ifd = find_main_image_ifd(&reader)?;

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
    let color_matrix = get_rational_array_either(&ifd0, &main_ifd, TagId::ColorMatrix1);
    let forward_matrix = get_rational_array_either(&ifd0, &main_ifd, TagId::ForwardMatrix1);
    let as_shot_neutral = get_rational_array_either(&ifd0, &main_ifd, TagId::AsShotNeutral);
    let baseline_exposure = get_rational(&ifd0, TagId::BaselineExposure)
        .or_else(|| get_rational(&main_ifd, TagId::BaselineExposure));

    // WhiteLevel: check SubIFD first (per-image), then IFD0, then compute from data.
    let white_level = get_tag_u32(&main_ifd, TagId::WhiteLevel)
        .or_else(|_| get_tag_u32(&ifd0, TagId::WhiteLevel))
        .ok();

    let black_level = get_rational_array_either(&ifd0, &main_ifd, TagId::BlackLevel);
    let black = if !black_level.is_empty() { black_level[0] } else { 0.0 };

    // Determine actual max value: use WhiteLevel if found, otherwise scan data.
    let max_val = if let Some(wl) = white_level {
        wl as f64
    } else {
        let measured = pixel_data[..expected_pixels].iter().copied().max().unwrap_or(1) as f64;
        measured.max(1.0)
    };

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

    // Apply white balance
    if as_shot_neutral.len() >= 3 {
        let wb = color::white_balance_multipliers(&as_shot_neutral);
        color::apply_white_balance(&mut rgb_f32, &wb);
    }

    // Apply color matrix (camera RGB → XYZ → sRGB)
    if !forward_matrix.is_empty() && forward_matrix.len() >= 9 {
        let mat = color::forward_matrix_to_srgb(&forward_matrix);
        color::apply_matrix(&mut rgb_f32, &mat);
    } else if !color_matrix.is_empty() && color_matrix.len() >= 9 {
        let mat = color::color_matrix_to_srgb(&color_matrix);
        color::apply_matrix(&mut rgb_f32, &mat);
    }

    // Apply BaselineExposure — camera calibration, not a creative adjustment.
    if let Some(ev) = baseline_exposure {
        if ev.abs() > 0.001 {
            let scale = (2.0f64).powf(ev) as f32;
            for v in &mut rgb_f32 {
                *v *= scale;
            }
        }
    }

    // Parse ProfileToneCurve (tag 50940): maps linear scene values to
    // perceptual output. When present it replaces sRGB gamma — applying
    // both would double-encode.
    let tone_curve_raw = get_rational_array_either(&ifd0, &main_ifd, TagId::ProfileToneCurve);
    let tone_curve: Vec<(f64, f64)> = tone_curve_raw
        .chunks_exact(2)
        .map(|pair| (pair[0], pair[1]))
        .collect();

    if tone_curve.len() >= 2 {
        let lut = build_tone_lut(&tone_curve);
        color::apply_lut(&mut rgb_f32, &lut);
    } else {
        color::apply_srgb_gamma(&mut rgb_f32);
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

    Ok(DngImage {
        width,
        height,
        pixels: rgba,
        baseline_exposure: baseline_exposure.unwrap_or(0.0),
        tone_curve,
    })
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
