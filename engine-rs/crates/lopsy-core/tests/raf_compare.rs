//! RAF pipeline comparison test.
//!
//! For each sample RAF file: extracts the embedded JPEG preview, renders the
//! full decoded image to JPG, and prints EXIF / makernote metadata so the
//! caller can compare camera-rendered previews against our decoded output.
//! Also writes native-resolution crop pairs so colour/noise differences are
//! visible at 100% without the hiding effect of downscaling.
//!
//! Run with:
//!   cargo test -p lopsy-core --test raf_compare -- --nocapture

use std::fs;
use std::path::PathBuf;

fn samples_dir() -> PathBuf {
    // CARGO_MANIFEST_DIR = engine-rs/crates/lopsy-core
    // three parents up → repo root
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("samples")
}

fn save_jpg(path: &std::path::Path, data: &[u8], width: u32, height: u32) {
    use jpeg_encoder::{ColorType, Encoder};
    let encoder = Encoder::new_file(path, 92).unwrap();
    encoder.encode(data, width as u16, height as u16, ColorType::Rgba).unwrap();
}

fn save_png_rgb(path: &std::path::Path, data: &[u8], width: u32, height: u32) {
    use png::{BitDepth, ColorType, Encoder};
    let f = fs::File::create(path).unwrap();
    let mut enc = Encoder::new(f, width, height);
    enc.set_color(ColorType::Rgb);
    enc.set_depth(BitDepth::Eight);
    let mut writer = enc.write_header().unwrap();
    writer.write_image_data(data).unwrap();
}

/// Apply the same orientation logic used in the RAF decoder to an RGB8 buffer.
/// Returns (new_w, new_h, rotated_pixels).
fn rotate_rgb8_by_orientation(src: &[u8], w: usize, h: usize, orientation: u16) -> (usize, usize, Vec<u8>) {
    if orientation <= 1 {
        return (w, h, src.to_vec());
    }
    let (out_w, out_h) = match orientation {
        5 | 6 | 7 | 8 => (h, w),
        _ => (w, h),
    };
    let mut dst = vec![0u8; out_w * out_h * 3];
    for y in 0..h {
        for x in 0..w {
            let s = (y * w + x) * 3;
            let (ox, oy) = match orientation {
                2 => (w - 1 - x, y),
                3 => (w - 1 - x, h - 1 - y),
                4 => (x, h - 1 - y),
                5 => (y, x),
                6 => (h - 1 - y, x),
                7 => (h - 1 - y, w - 1 - x),
                8 => (y, w - 1 - x),
                _ => (x, y),
            };
            let d = (oy * out_w + ox) * 3;
            dst[d]     = src[s];
            dst[d + 1] = src[s + 1];
            dst[d + 2] = src[s + 2];
        }
    }
    (out_w, out_h, dst)
}

/// Extract a box crop of `side`×`side` centred at `(cx_frac, cy_frac)` from
/// an RGB8 buffer. Returns (pixel data, actual_x, actual_y, actual_side).
/// The box is clamped to image bounds, so corner fractions may produce a
/// slightly smaller crop.
fn crop_rgb8_centered(
    src: &[u8],
    img_w: usize,
    img_h: usize,
    cx_frac: f64,
    cy_frac: f64,
    side: usize,
) -> (Vec<u8>, usize, usize, usize, usize) {
    let cx = (cx_frac * img_w as f64).round() as isize;
    let cy = (cy_frac * img_h as f64).round() as isize;
    let half = side as isize / 2;
    let x0 = (cx - half).max(0) as usize;
    let y0 = (cy - half).max(0) as usize;
    let x1 = (cx + half).min(img_w as isize) as usize;
    let y1 = (cy + half).min(img_h as isize) as usize;
    let cw = x1 - x0;
    let ch = y1 - y0;
    let mut out = Vec::with_capacity(cw * ch * 3);
    for row in y0..y1 {
        let row_start = (row * img_w + x0) * 3;
        out.extend_from_slice(&src[row_start..row_start + cw * 3]);
    }
    (out, x0, y0, cw, ch)
}

/// Same crop but from an RGBA f32 buffer, returning an RGB8 Vec.
fn crop_rgba_f32_to_rgb8(
    src: &[f32],
    img_w: usize,
    img_h: usize,
    cx_frac: f64,
    cy_frac: f64,
    side: usize,
) -> (Vec<u8>, usize, usize, usize, usize) {
    let cx = (cx_frac * img_w as f64).round() as isize;
    let cy = (cy_frac * img_h as f64).round() as isize;
    let half = side as isize / 2;
    let x0 = (cx - half).max(0) as usize;
    let y0 = (cy - half).max(0) as usize;
    let x1 = (cx + half).min(img_w as isize) as usize;
    let y1 = (cy + half).min(img_h as isize) as usize;
    let cw = x1 - x0;
    let ch = y1 - y0;
    let mut out = Vec::with_capacity(cw * ch * 3);
    for row in y0..y1 {
        for col in x0..x1 {
            let o = (row * img_w + col) * 4;
            out.push((src[o].clamp(0.0, 1.0) * 255.0 + 0.5) as u8);
            out.push((src[o + 1].clamp(0.0, 1.0) * 255.0 + 0.5) as u8);
            out.push((src[o + 2].clamp(0.0, 1.0) * 255.0 + 0.5) as u8);
        }
    }
    (out, x0, y0, cw, ch)
}

#[test]
fn extract_render_and_report() {
    let samples = samples_dir();
    if !samples.exists() {
        println!("samples/ directory not found at {} — skipping", samples.display());
        return;
    }

    let sample_names = ["sample_00.raf", "sample_01.raf"];

    // Fractional (x, y) centres for the native-res comparison crops.
    let crop_centres: &[(f64, f64)] = &[(0.50, 0.045), (0.45, 0.66), (0.62, 0.22)];
    const EXPORT_CROP_SIDE: usize = 420;

    for (sample_idx, name) in sample_names.iter().enumerate() {
        let raf_path = samples.join(name);
        if !raf_path.exists() {
            println!("{name}: not found at {} — skipping", raf_path.display());
            continue;
        }

        let stem = name.strip_suffix(".raf").unwrap_or(name);
        let s_prefix = format!("s{:02}", sample_idx);
        println!("\n=== {name} ===");

        let data = match fs::read(&raf_path) {
            Ok(d) => d,
            Err(e) => { println!("  read error: {e}"); continue; }
        };
        println!("  file size: {} bytes", data.len());

        // Extract JPEG preview bytes (stored orientation, landscape).
        let jpeg_bytes = match lopsy_core::raf::extract_jpeg_preview(&data) {
            Ok(b) => {
                let preview_path = samples.join(format!("{stem}_preview.jpg"));
                match fs::write(&preview_path, &b) {
                    Ok(()) => println!("  preview.jpg: {} bytes → {}", b.len(), preview_path.display()),
                    Err(e) => println!("  preview.jpg write error: {e}"),
                }
                b
            }
            Err(e) => {
                println!("  extract_jpeg_preview error: {e}");
                vec![]
            }
        };

        // Decode the RAF.
        let img = match lopsy_core::raf::read_raf(&data) {
            Ok(i) => i,
            Err(e) => { println!("  read_raf error: {e}"); continue; }
        };

        println!("  output dimensions: {}x{}", img.width, img.height);
        println!("  exif_info: {:?}", img.exif_info);
        println!("  film_mode: {:?}", img.exif_info.film_mode);
        println!("  white_balance: {:?}", img.exif_info.white_balance);
        println!("  dynamic_range: {:?}", img.exif_info.dynamic_range);
        println!("  debug_log:");
        for line in &img.debug_log {
            println!("    {line}");
        }

        // Convert f32 RGBA [0,1] → u8 RGBA for the export JPG.
        let pixel_count = (img.width * img.height) as usize;
        let mut u8_pixels = Vec::with_capacity(pixel_count * 4);
        for &v in &img.pixels {
            u8_pixels.push((v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8);
        }

        let export_path = samples.join(format!("{stem}_export.jpg"));
        save_jpg(&export_path, &u8_pixels, img.width, img.height);
        let export_size = fs::metadata(&export_path).map(|m| m.len()).unwrap_or(0);
        println!("  export.jpg: {export_size} bytes → {}", export_path.display());

        // ── Native-resolution comparison crops ─────────────────────────────

        let orientation = if img.exif_info.orientation == 0 { 1 } else { img.exif_info.orientation };
        let export_w = img.width as usize;
        let export_h = img.height as usize;

        // Decode the embedded preview JPEG to RGB8 (stored orientation).
        let (preview_rgb8_display, prev_disp_w, prev_disp_h) = if !jpeg_bytes.is_empty() {
            let mut decoder = jpeg_decoder::Decoder::new(jpeg_bytes.as_slice());
            match decoder.decode() {
                Ok(pixels) => {
                    let meta = decoder.info().unwrap();
                    let pw = meta.width as usize;
                    let ph = meta.height as usize;
                    // Convert to RGB8 (input may be RGB or YCbCr — jpeg_decoder
                    // always gives us RGB when asked for a pixel-format decode).
                    let rgb8 = match meta.pixel_format {
                        jpeg_decoder::PixelFormat::RGB24 => pixels,
                        jpeg_decoder::PixelFormat::L8 => {
                            pixels.iter().flat_map(|&v| [v, v, v]).collect()
                        }
                        jpeg_decoder::PixelFormat::CMYK32 => {
                            // Rare; convert naively.
                            pixels.chunks(4).flat_map(|c| {
                                let k = c[3] as f32 / 255.0;
                                [(c[0] as f32 * k) as u8,
                                 (c[1] as f32 * k) as u8,
                                 (c[2] as f32 * k) as u8]
                            }).collect()
                        }
                        _ => pixels,
                    };
                    // Apply EXIF orientation so preview is in display orientation.
                    let (dw, dh, rotated) = rotate_rgb8_by_orientation(&rgb8, pw, ph, orientation);
                    println!("  preview decoded: stored {}x{} → display {}x{} (orientation {})",
                        pw, ph, dw, dh, orientation);
                    (rotated, dw, dh)
                }
                Err(e) => {
                    println!("  jpeg_decoder error: {e}");
                    (vec![], 0, 0)
                }
            }
        } else {
            (vec![], 0, 0)
        };

        // Write native-res crops for each region centre.
        for (region_idx, &(cx_frac, cy_frac)) in crop_centres.iter().enumerate() {
            let region_n = region_idx + 1;

            // Export crop: 560×560 at native resolution.
            let (exp_crop, ex0, ey0, ecw, ech) = crop_rgba_f32_to_rgb8(
                &img.pixels, export_w, export_h, cx_frac, cy_frac, EXPORT_CROP_SIDE,
            );
            let exp_crop_path = samples.join(format!("crop_{s_prefix}_r{region_n}_export.png"));
            save_png_rgb(&exp_crop_path, &exp_crop, ecw as u32, ech as u32);
            println!("  crop r{region_n} export: box ({ex0},{ey0}) size {ecw}×{ech} → {}",
                exp_crop_path.file_name().unwrap().to_string_lossy());

            // Preview crop: proportionally sized so it covers the same fractional area.
            if prev_disp_w > 0 && prev_disp_h > 0 && !preview_rgb8_display.is_empty() {
                let prev_side = ((EXPORT_CROP_SIDE as f64 * prev_disp_w as f64
                    / export_w as f64).round() as usize).max(1);
                let (prev_crop, px0, py0, pcw, pch) = crop_rgb8_centered(
                    &preview_rgb8_display, prev_disp_w, prev_disp_h,
                    cx_frac, cy_frac, prev_side,
                );
                let prev_crop_path = samples.join(format!("crop_{s_prefix}_r{region_n}_preview.png"));
                save_png_rgb(&prev_crop_path, &prev_crop, pcw as u32, pch as u32);
                println!("  crop r{region_n} preview: box ({px0},{py0}) size {pcw}×{pch} → {}",
                    prev_crop_path.file_name().unwrap().to_string_lossy());
            }
        }
    }
}
