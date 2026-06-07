//! Quantitative color measurement: export (read_raf) vs embedded JPEG preview.
//!
//! Run with:
//!   cargo test -p lopsy-core --test raf_color_measure -- --nocapture

use std::fs;
use std::path::PathBuf;

fn samples_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap()
        .parent().unwrap()
        .parent().unwrap()
        .join("samples")
}

/// Apply EXIF orientation to an RGB8 buffer.
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

/// Compute mean RGB [0,1] over a fractional region of an RGBA f32 buffer.
fn mean_rgba_f32_region(pixels: &[f32], img_w: usize, img_h: usize,
                         x0f: f64, y0f: f64, x1f: f64, y1f: f64) -> [f64; 3] {
    let x0 = ((x0f * img_w as f64).floor() as usize).min(img_w);
    let y0 = ((y0f * img_h as f64).floor() as usize).min(img_h);
    let x1 = ((x1f * img_w as f64).ceil() as usize).min(img_w);
    let y1 = ((y1f * img_h as f64).ceil() as usize).min(img_h);
    if x1 <= x0 || y1 <= y0 { return [0.0; 3]; }
    let mut sum = [0.0f64; 3];
    let mut count = 0u64;
    for row in y0..y1 {
        for col in x0..x1 {
            let o = (row * img_w + col) * 4;
            sum[0] += pixels[o] as f64;
            sum[1] += pixels[o + 1] as f64;
            sum[2] += pixels[o + 2] as f64;
            count += 1;
        }
    }
    if count == 0 { return [0.0; 3]; }
    [sum[0] / count as f64, sum[1] / count as f64, sum[2] / count as f64]
}

/// Compute mean RGB [0,1] over a fractional region of an RGB8 buffer.
fn mean_rgb8_region(pixels: &[u8], img_w: usize, img_h: usize,
                    x0f: f64, y0f: f64, x1f: f64, y1f: f64) -> [f64; 3] {
    let x0 = ((x0f * img_w as f64).floor() as usize).min(img_w);
    let y0 = ((y0f * img_h as f64).floor() as usize).min(img_h);
    let x1 = ((x1f * img_w as f64).ceil() as usize).min(img_w);
    let y1 = ((y1f * img_h as f64).ceil() as usize).min(img_h);
    if x1 <= x0 || y1 <= y0 { return [0.0; 3]; }
    let mut sum = [0.0f64; 3];
    let mut count = 0u64;
    for row in y0..y1 {
        for col in x0..x1 {
            let o = (row * img_w + col) * 3;
            sum[0] += pixels[o] as f64 / 255.0;
            sum[1] += pixels[o + 1] as f64 / 255.0;
            sum[2] += pixels[o + 2] as f64 / 255.0;
            count += 1;
        }
    }
    if count == 0 { return [0.0; 3]; }
    [sum[0] / count as f64, sum[1] / count as f64, sum[2] / count as f64]
}

fn saturation(rgb: [f64; 3]) -> f64 {
    let mx = rgb[0].max(rgb[1]).max(rgb[2]);
    let mn = rgb[0].min(rgb[1]).min(rgb[2]);
    if mx < 1e-6 { 0.0 } else { (mx - mn) / mx }
}

/// Solve diagonal least-squares: for each channel c, find g_c minimising
/// Σ(g_c * exp_c - prev_c)².  Closed-form: g_c = Σ(exp_c * prev_c) / Σ(exp_c²).
fn fit_diagonal(pairs: &[([f64; 3], [f64; 3])]) -> [f64; 3] {
    let mut num = [0.0f64; 3];
    let mut den = [0.0f64; 3];
    for (e, p) in pairs {
        for c in 0..3 {
            num[c] += e[c] * p[c];
            den[c] += e[c] * e[c];
        }
    }
    [
        if den[0] > 1e-12 { num[0] / den[0] } else { 1.0 },
        if den[1] > 1e-12 { num[1] / den[1] } else { 1.0 },
        if den[2] > 1e-12 { num[2] / den[2] } else { 1.0 },
    ]
}

/// RMS residual for the diagonal model.
fn diagonal_rms(pairs: &[([f64; 3], [f64; 3])], g: [f64; 3]) -> f64 {
    let mut sse = 0.0f64;
    let mut n = 0usize;
    for (e, p) in pairs {
        for c in 0..3 {
            let diff = g[c] * e[c] - p[c];
            sse += diff * diff;
            n += 1;
        }
    }
    if n == 0 { 0.0 } else { (sse / n as f64).sqrt() }
}

/// Solve full 3×3 least-squares M·exp ≈ prev via three independent
/// normal-equation solves (one per output channel).
/// Returns M as row-major [f64; 9]: prev_c = M[c*3..c*3+3] · exp.
fn fit_3x3(pairs: &[([f64; 3], [f64; 3])]) -> [f64; 9] {
    // For each output channel c: solve (E^T E) x = E^T p_c
    // E is N×3 design matrix, each row is one export RGB triple.
    // AtA[i][j] = Σ e_i * e_j, AtB[c][i] = Σ e_i * p_c
    let mut ata = [[0.0f64; 3]; 3];
    let mut atb = [[0.0f64; 3]; 3]; // atb[out_c][in_c]
    for (e, p) in pairs {
        for i in 0..3 {
            for j in 0..3 {
                ata[i][j] += e[i] * e[j];
            }
            for c in 0..3 {
                atb[c][i] += e[i] * p[c];
            }
        }
    }
    // Solve 3×3 symmetric system via Cramer's rule / direct inverse.
    // Using Gauss-Jordan on the 3×3 ATA for each channel.
    let solve3 = |b: [f64; 3]| -> [f64; 3] {
        // Augmented matrix [ATA | b]
        let mut m: [[f64; 4]; 3] = [
            [ata[0][0], ata[0][1], ata[0][2], b[0]],
            [ata[1][0], ata[1][1], ata[1][2], b[1]],
            [ata[2][0], ata[2][1], ata[2][2], b[2]],
        ];
        for col in 0..3 {
            // Pivot
            let mut max_row = col;
            for row in (col + 1)..3 {
                if m[row][col].abs() > m[max_row][col].abs() { max_row = row; }
            }
            m.swap(col, max_row);
            let piv = m[col][col];
            if piv.abs() < 1e-14 { continue; }
            for j in col..4 { m[col][j] /= piv; }
            for row in 0..3 {
                if row == col { continue; }
                let f = m[row][col];
                for j in col..4 { m[row][j] -= f * m[col][j]; }
            }
        }
        [m[0][3], m[1][3], m[2][3]]
    };

    let mut out = [0.0f64; 9];
    for c in 0..3 {
        let x = solve3(atb[c]);
        out[c * 3]     = x[0];
        out[c * 3 + 1] = x[1];
        out[c * 3 + 2] = x[2];
    }
    out
}

/// RMS residual for the 3×3 model.
fn matrix_rms(pairs: &[([f64; 3], [f64; 3])], m: &[f64; 9]) -> f64 {
    let mut sse = 0.0f64;
    let mut n = 0usize;
    for (e, p) in pairs {
        for c in 0..3 {
            let pred = m[c*3]*e[0] + m[c*3+1]*e[1] + m[c*3+2]*e[2];
            let diff = pred - p[c];
            sse += diff * diff;
            n += 1;
        }
    }
    if n == 0 { 0.0 } else { (sse / n as f64).sqrt() }
}

#[test]
fn measure_color_delta() {
    let samples = samples_dir();
    if !samples.exists() {
        println!("samples/ not found at {} — skipping", samples.display());
        return;
    }

    const ROWS: usize = 8;
    const COLS: usize = 6;
    const DARK_THRESH: f64 = 0.04;

    let sample_names = ["sample_00.raf", "sample_01.raf"];

    for name in &sample_names {
        let raf_path = samples.join(name);
        if !raf_path.exists() {
            println!("{name}: not found — skipping");
            continue;
        }

        println!("\n╔══════════════════════════════════════════════════════════════╗");
        println!("║  {name:<62}║");
        println!("╚══════════════════════════════════════════════════════════════╝");

        let data = match fs::read(&raf_path) {
            Ok(d) => d,
            Err(e) => { println!("  read error: {e}"); continue; }
        };

        // ── Render via read_raf (display orientation) ───────────────────────
        let img = match lopsy_core::raf::read_raf(&data) {
            Ok(i) => i,
            Err(e) => { println!("  read_raf error: {e}"); continue; }
        };
        let exp_w = img.width as usize;
        let exp_h = img.height as usize;
        println!("  export: {}x{}", exp_w, exp_h);

        // ── Decode embedded JPEG preview and orient to display orientation ──
        let jpeg_bytes = match lopsy_core::raf::extract_jpeg_preview(&data) {
            Ok(b) => b,
            Err(e) => { println!("  extract_jpeg_preview error: {e}"); continue; }
        };

        let orientation = if img.exif_info.orientation == 0 { 1 } else { img.exif_info.orientation };

        let (prev_rgb8, prev_w, prev_h) = {
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
                        jpeg_decoder::PixelFormat::CMYK32 => {
                            pixels.chunks(4).flat_map(|c| {
                                let k = c[3] as f32 / 255.0;
                                [(c[0] as f32 * k) as u8,
                                 (c[1] as f32 * k) as u8,
                                 (c[2] as f32 * k) as u8]
                            }).collect()
                        }
                        _ => pixels,
                    };
                    let (dw, dh, rotated) = rotate_rgb8_by_orientation(&rgb8, pw, ph, orientation);
                    println!("  preview: stored {}x{} → display {}x{} (orientation {})",
                        pw, ph, dw, dh, orientation);
                    (rotated, dw, dh)
                }
                Err(e) => {
                    println!("  jpeg_decoder error: {e}");
                    continue;
                }
            }
        };

        // ── Build 8×6 grid, compute cell means ─────────────────────────────
        let mut export_cells: Vec<[f64; 3]> = Vec::with_capacity(ROWS * COLS);
        let mut preview_cells: Vec<[f64; 3]> = Vec::with_capacity(ROWS * COLS);

        println!("\n  Grid cell means (8 rows × 6 cols, export vs preview):");
        println!("  {:>7} {:>5}  {:>20}   {:>20}", "cell", "r,c",
                 "--- export ---", "--- preview ---");
        println!("  {:>7} {:>5}  {:>6} {:>6} {:>6}   {:>6} {:>6} {:>6}",
                 "", "", "R", "G", "B", "R", "G", "B");

        for row in 0..ROWS {
            for col in 0..COLS {
                let x0f = col as f64 / COLS as f64;
                let x1f = (col + 1) as f64 / COLS as f64;
                let y0f = row as f64 / ROWS as f64;
                let y1f = (row + 1) as f64 / ROWS as f64;

                let e = mean_rgba_f32_region(&img.pixels, exp_w, exp_h, x0f, y0f, x1f, y1f);
                let p = mean_rgb8_region(&prev_rgb8, prev_w, prev_h, x0f, y0f, x1f, y1f);

                println!("  cell {:>3}  {:>1},{:>1}  {:>6.3} {:>6.3} {:>6.3}   {:>6.3} {:>6.3} {:>6.3}",
                    row * COLS + col, row, col,
                    e[0], e[1], e[2], p[0], p[1], p[2]);

                export_cells.push(e);
                preview_cells.push(p);
            }
        }

        // ── Build fitting pairs (exclude near-black cells) ──────────────────
        let mut pairs: Vec<([f64; 3], [f64; 3])> = Vec::new();
        for i in 0..(ROWS * COLS) {
            let e = export_cells[i];
            let p = preview_cells[i];
            let max_e = e[0].max(e[1]).max(e[2]);
            if max_e >= DARK_THRESH {
                pairs.push((e, p));
            }
        }
        println!("\n  Non-dark cells (max export channel >= {DARK_THRESH}): {}", pairs.len());

        // ── Diagonal fit ────────────────────────────────────────────────────
        let g = fit_diagonal(&pairs);
        let diag_rms = diagonal_rms(&pairs, g);

        println!("\n  ── (A) Diagonal (per-channel gain) ──");
        println!("    g_r={:.4}  g_g={:.4}  g_b={:.4}", g[0], g[1], g[2]);
        println!("    RMS residual: {:.4}", diag_rms);

        // ── Full 3×3 fit ────────────────────────────────────────────────────
        let m = fit_3x3(&pairs);
        let mat_rms = matrix_rms(&pairs, &m);

        println!("\n  ── (B) Full 3×3 (M·export ≈ preview) ──");
        println!("    [{:.4}  {:.4}  {:.4}]", m[0], m[1], m[2]);
        println!("    [{:.4}  {:.4}  {:.4}]", m[3], m[4], m[5]);
        println!("    [{:.4}  {:.4}  {:.4}]", m[6], m[7], m[8]);
        println!("    RMS residual: {:.4}", mat_rms);

        let ratio = if mat_rms > 1e-9 { diag_rms / mat_rms } else { 1.0 };
        println!("\n  diagonalRMS / matrixRMS = {:.3}", ratio);

        // ── Saturation comparison ───────────────────────────────────────────
        let mut export_sat_sum = 0.0f64;
        let mut preview_sat_sum = 0.0f64;
        let mut ratio_sum = 0.0f64;
        let mut sat_count = 0usize;
        for &(e, p) in &pairs {
            let es = saturation(e);
            let ps = saturation(p);
            export_sat_sum += es;
            preview_sat_sum += ps;
            if es > 1e-6 {
                ratio_sum += ps / es;
                sat_count += 1;
            }
        }
        let n_pairs = pairs.len().max(1) as f64;
        let mean_exp_sat = export_sat_sum / n_pairs;
        let mean_prev_sat = preview_sat_sum / n_pairs;
        let mean_ratio = if sat_count > 0 { ratio_sum / sat_count as f64 } else { 0.0 };

        println!("\n  ── Saturation comparison ──");
        println!("    mean export  saturation: {:.4}", mean_exp_sat);
        println!("    mean preview saturation: {:.4}", mean_prev_sat);
        println!("    mean preview_sat/export_sat ratio: {:.4}", mean_ratio);

        // ── Hue-category example cells ──────────────────────────────────────
        // Find the cell most matching each hue category by preview color.
        println!("\n  ── Per-hue example cells (by preview color) ──");

        let n = ROWS * COLS;

        // YELLOW: preview R and G both high, B low; R≈G
        let best_yellow = (0..n).filter(|&i| {
            let p = preview_cells[i];
            p[0] > 0.3 && p[1] > 0.3 && p[2] < p[0] * 0.7 && p[0] > 0.15 && p[1] > 0.15
        }).max_by(|&a, &b| {
            let pa = preview_cells[a]; let pb = preview_cells[b];
            let sa = pa[0].min(pa[1]) - pa[2];
            let sb = pb[0].min(pb[1]) - pb[2];
            sa.partial_cmp(&sb).unwrap()
        });

        // RED: preview R clearly highest
        let best_red = (0..n).filter(|&i| {
            let p = preview_cells[i];
            p[0] > 0.15 && p[0] > p[1] * 1.3 && p[0] > p[2] * 1.3
        }).max_by(|&a, &b| {
            let pa = preview_cells[a]; let pb = preview_cells[b];
            let sa = pa[0] - pa[1].max(pa[2]);
            let sb = pb[0] - pb[1].max(pb[2]);
            sa.partial_cmp(&sb).unwrap()
        });

        // GREEN: preview G clearly highest
        let best_green = (0..n).filter(|&i| {
            let p = preview_cells[i];
            p[1] > 0.15 && p[1] > p[0] * 1.15 && p[1] > p[2] * 1.15
        }).max_by(|&a, &b| {
            let pa = preview_cells[a]; let pb = preview_cells[b];
            let sa = pa[1] - pa[0].max(pa[2]);
            let sb = pb[1] - pb[0].max(pb[2]);
            sa.partial_cmp(&sb).unwrap()
        });

        // BLUE/sky: preview B clearly highest
        let best_blue = (0..n).filter(|&i| {
            let p = preview_cells[i];
            p[2] > 0.15 && p[2] > p[0] * 1.1 && p[2] > p[1] * 1.1
        }).max_by(|&a, &b| {
            let pa = preview_cells[a]; let pb = preview_cells[b];
            let sa = pa[2] - pa[0].max(pa[1]);
            let sb = pb[2] - pb[0].max(pb[1]);
            sa.partial_cmp(&sb).unwrap()
        });

        let hues = [
            ("YELLOW", best_yellow),
            ("RED",    best_red),
            ("GREEN",  best_green),
            ("BLUE",   best_blue),
        ];

        for (hue_name, best) in &hues {
            match best {
                Some(idx) => {
                    let e = export_cells[*idx];
                    let p = preview_cells[*idx];
                    let row = idx / COLS;
                    let col = idx % COLS;
                    println!("    {:6}: cell {:>2} (r{},c{})  export [{:.3},{:.3},{:.3}]  preview [{:.3},{:.3},{:.3}]",
                        hue_name, idx, row, col, e[0], e[1], e[2], p[0], p[1], p[2]);
                }
                None => println!("    {:6}: no qualifying cell found", hue_name),
            }
        }

        // ── Overall mean ────────────────────────────────────────────────────
        let mut exp_mean = [0.0f64; 3];
        let mut prev_mean = [0.0f64; 3];
        for i in 0..n {
            for c in 0..3 {
                exp_mean[c] += export_cells[i][c];
                prev_mean[c] += preview_cells[i][c];
            }
        }
        for c in 0..3 { exp_mean[c] /= n as f64; prev_mean[c] /= n as f64; }
        println!("\n  ── Overall mean (all 48 cells) ──");
        println!("    export  mean RGB: [{:.4}, {:.4}, {:.4}]", exp_mean[0], exp_mean[1], exp_mean[2]);
        println!("    preview mean RGB: [{:.4}, {:.4}, {:.4}]", prev_mean[0], prev_mean[1], prev_mean[2]);
    }
}
