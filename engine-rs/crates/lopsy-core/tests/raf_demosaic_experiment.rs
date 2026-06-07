//! Demosaic localisation experiment.
//!
//! Renders three decode variants for sample_00.raf (Markesteijn+denoise,
//! Markesteijn+no-denoise, Nearest+no-denoise) and crops a flat sky region
//! so the CFA-period grid artefact is visible without downscaling.
//!
//! Also runs a flat-gray phase test: finds neutral pixels in the embedded
//! JPEG preview, maps them into the WB'd mosaic, and reports the per-6×6-cell
//! spread for each CFA colour channel. A large spread indicates a tiling /
//! phase error in the channel levels coming out of WB.
//!
//! Run with:
//!   cargo test -p lopsy-core --test raf_demosaic_experiment -- --nocapture

use std::fs;
use std::path::PathBuf;

fn samples_dir() -> PathBuf {
    // CARGO_MANIFEST_DIR = engine-rs/crates/lopsy-core; three levels up → repo root.
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap()
        .parent().unwrap()
        .parent().unwrap()
        .join("samples")
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

/// Crop a box of `side`×`side` pixels centred at `(cx_frac, cy_frac)` from
/// an RGBA f32 buffer, returning an RGB8 Vec and the actual crop dimensions.
fn crop_rgba_f32_to_rgb8(
    src: &[f32],
    img_w: usize,
    img_h: usize,
    cx_frac: f64,
    cy_frac: f64,
    side: usize,
) -> (Vec<u8>, usize, usize) {
    let cx   = (cx_frac * img_w as f64).round() as isize;
    let cy   = (cy_frac * img_h as f64).round() as isize;
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
            out.push((src[o    ].clamp(0.0, 1.0) * 255.0 + 0.5) as u8);
            out.push((src[o + 1].clamp(0.0, 1.0) * 255.0 + 0.5) as u8);
            out.push((src[o + 2].clamp(0.0, 1.0) * 255.0 + 0.5) as u8);
        }
    }
    (out, cw, ch)
}

/// Apply the same orientation transform used in the RAF decoder to an RGB8 buffer.
/// Available for future variant-A preview crops; the phase test works in stored
/// orientation so this is not called in the current experiment.
#[allow(dead_code)]
fn rotate_rgb8(src: &[u8], w: usize, h: usize, orientation: u16) -> (usize, usize, Vec<u8>) {
    if orientation <= 1 {
        return (w, h, src.to_vec());
    }
    let (out_w, out_h) = match orientation { 5 | 6 | 7 | 8 => (h, w), _ => (w, h) };
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

#[test]
fn raf_demosaic_experiment() {
    use lopsy_core::raf::{
        DemosaicMode, RafDecodeOpts,
        debug_wb_mosaic, extract_jpeg_preview, read_raf_opts,
    };

    let samples = samples_dir();
    let raf_path = samples.join("sample_00.raf");
    if !raf_path.exists() {
        println!("samples/sample_00.raf not found at {} — skipping", raf_path.display());
        return;
    }

    let data = fs::read(&raf_path).expect("read sample_00.raf");
    println!("\n=== raf_demosaic_experiment ===");
    println!("file: {} ({} bytes)", raf_path.display(), data.len());

    // ── Part A: Three render variants ────────────────────────────────────────
    //
    // All three use the production pipeline up to and including EXIF orientation,
    // so the output is in display orientation (sky at the top after orientation).

    let variants: &[(&str, RafDecodeOpts)] = &[
        ("exp_markesteijn_denoise_on.png",  RafDecodeOpts::default()),
        ("exp_markesteijn_denoise_off.png", RafDecodeOpts { demosaic: DemosaicMode::Markesteijn, denoise: false }),
        ("exp_nearest_denoise_off.png",     RafDecodeOpts { demosaic: DemosaicMode::Nearest,     denoise: false }),
    ];

    // Sky centre: fractional position (0.50, 0.045) in display orientation.
    // The display image has sky at the top after EXIF orientation is applied.
    const SKY_CX: f64 = 0.50;
    const SKY_CY: f64 = 0.045;
    const CROP_SIDE: usize = 420;

    for (filename, opts) in variants {
        let img = match read_raf_opts(&data, *opts) {
            Ok(i) => i,
            Err(e) => { println!("  {filename}: read_raf_opts error: {e}"); continue; }
        };
        let (crop_rgb8, cw, ch) = crop_rgba_f32_to_rgb8(
            &img.pixels, img.width as usize, img.height as usize,
            SKY_CX, SKY_CY, CROP_SIDE,
        );
        let out_path = samples.join(filename);
        save_png_rgb(&out_path, &crop_rgb8, cw as u32, ch as u32);
        println!("  wrote {} ({}×{} crop at ({SKY_CX},{SKY_CY}) of display {}×{})",
            filename, cw, ch, img.width, img.height);
    }

    // ── Part B: Flat-gray phase test ─────────────────────────────────────────
    //
    // Strategy: work entirely in stored (pre-orientation) coordinates to avoid
    // the complexity of inverting the orientation mapping.
    //
    // 1. Decode the JPEG preview in stored orientation (no rotation).
    // 2. Find neutral pixels (low chroma, mid luma) in stored preview space.
    // 3. Scale stored-preview coords to mosaic coords using the width ratio
    //    (mosaic_w / preview_stored_w).  Both are landscape stored images, so
    //    the same scale applies in both axes.
    // 4. For each mosaic pixel (rx, ry), accumulate the WB'd mosaic value into
    //    bin (ry%6)*6 + (rx%6).

    println!("\n--- Phase test (stored-orientation coords) ---");

    let jpeg_bytes = match extract_jpeg_preview(&data) {
        Ok(b) => b,
        Err(e) => { println!("  extract_jpeg_preview: {e}"); return; }
    };

    // Decode preview in stored orientation (skip EXIF rotation here).
    let (prev_stored_rgb8, prev_stored_w, prev_stored_h) = {
        let mut decoder = jpeg_decoder::Decoder::new(jpeg_bytes.as_slice());
        match decoder.decode() {
            Ok(pixels) => {
                let meta = decoder.info().unwrap();
                let pw = meta.width as usize;
                let ph = meta.height as usize;
                let rgb8 = match meta.pixel_format {
                    jpeg_decoder::PixelFormat::RGB24 => pixels,
                    jpeg_decoder::PixelFormat::L8 => {
                        pixels.iter().flat_map(|&v| [v, v, v]).collect()
                    }
                    _ => pixels,
                };
                println!("  preview stored: {}×{}", pw, ph);
                (rgb8, pw, ph)
            }
            Err(e) => {
                println!("  jpeg_decoder error: {e}");
                return;
            }
        }
    };

    // WB'd mosaic in stored orientation (w×h before EXIF rotation).
    let (mosaic, mosaic_w, mosaic_h, cfa) = match debug_wb_mosaic(&data) {
        Ok(r) => r,
        Err(e) => { println!("  debug_wb_mosaic: {e}"); return; }
    };
    println!("  mosaic: {}×{}", mosaic_w, mosaic_h);

    // Scale factor: same-axis ratio (both stored in landscape).
    let scale_x = mosaic_w as f64 / prev_stored_w as f64;
    let scale_y = mosaic_h as f64 / prev_stored_h as f64;
    println!("  scale (mosaic/preview): x={scale_x:.3} y={scale_y:.3}");

    // Neutral pixel selection in stored-preview space:
    // luma in [60,220] on 0..255 and max(R,G,B)-min(R,G,B) < 12.
    let mut bin_sums  = [0.0f64; 36];
    let mut bin_counts = [0u64; 36];
    let mut neutral_count = 0u64;

    for py in 0..prev_stored_h {
        for px in 0..prev_stored_w {
            let o = (py * prev_stored_w + px) * 3;
            let pr = prev_stored_rgb8[o    ] as i32;
            let pg = prev_stored_rgb8[o + 1] as i32;
            let pb = prev_stored_rgb8[o + 2] as i32;
            let luma = (pr * 2126 + pg * 7152 + pb * 722) / 10000;
            let chroma_spread = (pr.max(pg).max(pb) - pr.min(pg).min(pb)) as u8;
            if luma < 60 || luma > 220 || chroma_spread >= 12 {
                continue;
            }
            // Map to mosaic coords (edge-clamp).
            let rx = ((px as f64 * scale_x).round() as usize).min(mosaic_w - 1);
            let ry = ((py as f64 * scale_y).round() as usize).min(mosaic_h - 1);
            let bin = (ry % 6) * 6 + (rx % 6);
            bin_sums[bin]   += mosaic[ry * mosaic_w + rx] as f64;
            bin_counts[bin] += 1;
            neutral_count   += 1;
        }
    }

    println!("  neutral pixels used: {neutral_count}");
    println!();
    println!("  Per-bin means (bin 0..35), colour labels: 0=R 1=G 2=B");
    println!("  {:>4}  {:>5}  {:>9}  {:>6}", "bin", "color", "mean", "count");

    let color_name = |c: u8| match c { 0 => 'R', 2 => 'B', _ => 'G' };

    let mut bin_means = [0.0f64; 36];
    for b in 0..36usize {
        bin_means[b] = if bin_counts[b] > 0 {
            bin_sums[b] / bin_counts[b] as f64
        } else {
            0.0
        };
        println!("  {:>4}  {:>5}  {:>9.6}  {:>6}",
            b, color_name(cfa[b]), bin_means[b], bin_counts[b]);
    }

    // Per-channel spread (max−min of per-bin means for that channel's positions).
    println!();
    println!("  Per-channel spread (max−min of bin means) and cast check:");
    for ch in 0u8..3 {
        let positions: Vec<usize> = (0..36).filter(|&b| cfa[b] == ch).collect();
        if positions.is_empty() { continue; }
        let means_ch: Vec<f64> = positions.iter().map(|&b| bin_means[b]).collect();
        let ch_mean  = means_ch.iter().sum::<f64>() / means_ch.len() as f64;
        let ch_min   = means_ch.iter().cloned().fold(f64::MAX, f64::min);
        let ch_max   = means_ch.iter().cloned().fold(f64::MIN, f64::max);
        let spread   = ch_max - ch_min;
        let spread_frac = if ch_mean > 1e-9 { spread / ch_mean } else { 0.0 };
        println!("  {} → mean={:.6}  spread={:.6}  spread/mean={:.4}",
            color_name(ch), ch_mean, spread, spread_frac);
    }

    println!();
    println!("  Interpretation guide:");
    println!("    cast: a channel's mean deviates from ~equal means across channels");
    println!("    tiling: spread/mean > ~0.05 for a channel = same-colour positions disagree");
}
