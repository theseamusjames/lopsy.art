//! CFA phase-alignment sweep diagnostic.
//!
//! Uses the raw (pre-WB) mosaic brightness fingerprint to find the correct
//! X-Trans 6×6 CFA phase offset for each sample.
//!
//! Background: at neutral patches, the raw mosaic has a fixed positional
//! brightness pattern — green sites (more photons per microlens) are
//! ~1.8× brighter than R/B sites. We enumerate all 72 candidate CFA maps
//! (2 transposes × 6 row-shifts × 6 col-shifts) and score each by how
//! tightly the per-position mean raw values cluster within each colour.
//! The correct alignment has the minimum within-colour spread and a
//! green/nongreen ratio near 1.8.
//!
//! Run with:
//!   cargo test -p lopsy-core --test raf_phase_sweep -- --nocapture

use std::path::PathBuf;

fn samples_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap()
        .parent().unwrap()
        .parent().unwrap()
        .join("samples")
}

#[test]
fn cfa_phase_alignment_sweep() {
    let samples = samples_dir();
    for name in ["sample_00.raf", "sample_01.raf"] {
        sweep_one(&samples, name);
    }
}

fn sweep_one(samples: &PathBuf, name: &str) {
    let raf_path = samples.join(name);
    if !raf_path.exists() {
        println!("{name} not found at {} — skipping", raf_path.display());
        return;
    }

    let data = std::fs::read(&raf_path).expect("read raf");

    let (mosaic, mosaic_w, mosaic_h, base_pat, crop_top, crop_left) =
        match lopsy_core::raf::debug_raw_mosaic(&data) {
            Ok(v) => v,
            Err(e) => {
                println!("{name}: debug_raw_mosaic error: {e}");
                return;
            }
        };

    println!("\n=== CFA phase alignment sweep: {name} ===");
    println!("  mosaic: {mosaic_w}×{mosaic_h}");
    println!("  crop_top={crop_top}  crop_left={crop_left}  (crop_top%6={}, crop_left%6={})",
        crop_top % 6, crop_left % 6);
    println!("  base pattern from file (Fuji indices 0=B,1=G,2=R):");
    for r in 0..6 {
        let row: Vec<u8> = (0..6).map(|c| base_pat[r * 6 + c]).collect();
        println!("    {:?}", row);
    }

    let jpeg_bytes = match lopsy_core::raf::extract_jpeg_preview(&data) {
        Ok(b) => b,
        Err(e) => {
            println!("{name}: extract_jpeg_preview error: {e} — skipping");
            return;
        }
    };

    let (prev_rgb8, prev_w, prev_h) = {
        let mut decoder = jpeg_decoder::Decoder::new(jpeg_bytes.as_slice());
        match decoder.decode() {
            Ok(pixels) => {
                let meta = decoder.info().unwrap();
                let pw = meta.width as usize;
                let ph = meta.height as usize;
                let rgb8 = match meta.pixel_format {
                    jpeg_decoder::PixelFormat::RGB24 => pixels,
                    jpeg_decoder::PixelFormat::L8 => pixels.iter().flat_map(|&v| [v, v, v]).collect(),
                    jpeg_decoder::PixelFormat::CMYK32 => pixels.chunks(4).flat_map(|c| {
                        let k = c[3] as f32 / 255.0;
                        [(c[0] as f32 * k) as u8, (c[1] as f32 * k) as u8, (c[2] as f32 * k) as u8]
                    }).collect(),
                    _ => pixels,
                };
                println!("  preview (stored): {pw}×{ph}");
                (rgb8, pw, ph)
            }
            Err(e) => {
                println!("{name}: jpeg_decoder error: {e} — skipping");
                return;
            }
        }
    };

    let mut neutral: Vec<(usize, usize)> = Vec::new();
    for py in 0..prev_h {
        for px in 0..prev_w {
            let o = (py * prev_w + px) * 3;
            let r = prev_rgb8[o] as i32;
            let g = prev_rgb8[o + 1] as i32;
            let b = prev_rgb8[o + 2] as i32;
            if r.max(g).max(b) - r.min(g).min(b) >= 12 { continue; }
            let luma = (299 * r + 587 * g + 114 * b) / 1000;
            if luma <= 60 || luma >= 220 { continue; }
            let rx = (((px as f64 + 0.5) * mosaic_w as f64 / prev_w as f64).round() as usize).min(mosaic_w - 1);
            let ry = (((py as f64 + 0.5) * mosaic_h as f64 / prev_h as f64).round() as usize).min(mosaic_h - 1);
            neutral.push((rx, ry));
        }
    }
    println!("  neutral preview pixels: {}", neutral.len());
    if neutral.is_empty() { println!("  No neutral pixels — skip."); return; }

    let mut pos_sum = [0.0f64; 36];
    let mut pos_cnt = [0u64; 36];
    for &(rx, ry) in &neutral {
        let p = (ry % 6) * 6 + (rx % 6);
        pos_sum[p] += mosaic[ry * mosaic_w + rx] as f64;
        pos_cnt[p] += 1;
    }
    let mut pos_mean = [0.0f64; 36];
    for p in 0..36 {
        pos_mean[p] = if pos_cnt[p] > 0 { pos_sum[p] / pos_cnt[p] as f64 } else { 0.0 };
    }

    println!("  6×6 positional mean raw value (bright=green sites, dark=R/B sites):");
    for r in 0..6 {
        let row_vals: Vec<String> = (0..6).map(|c| format!("{:.4}", pos_mean[r * 6 + c])).collect();
        println!("    [{}]", row_vals.join(", "));
    }

    struct Candidate { transpose: bool, row_shift: usize, col_shift: usize, score: f64, green_mean: f64, nongreen_mean: f64, ratio: f64, green_count: usize }
    let mut candidates: Vec<Candidate> = Vec::with_capacity(72);

    for &transpose in &[false, true] {
        for row_shift in 0..6 {
            for col_shift in 0..6 {
                let mut cand = [0u8; 36];
                for r in 0..6 {
                    for c in 0..6 {
                        let (br, bc) = if transpose { (c, r) } else { (r, c) };
                        let sr = (br + row_shift) % 6;
                        let sc = (bc + col_shift) % 6;
                        cand[r * 6 + c] = base_pat[sr * 6 + sc];
                    }
                }
                let green_count = cand.iter().filter(|&&v| v == 1).count();
                let mut green_vals = Vec::new();
                let mut nongreen_vals = Vec::new();
                for p in 0..36 {
                    if cand[p] == 1 { green_vals.push(pos_mean[p]); } else { nongreen_vals.push(pos_mean[p]); }
                }
                let spread = |v: &[f64]| if v.is_empty() { 0.0 } else {
                    v.iter().cloned().fold(f64::NEG_INFINITY, f64::max) - v.iter().cloned().fold(f64::INFINITY, f64::min)
                };
                let mean = |v: &[f64]| if v.is_empty() { 0.0 } else { v.iter().sum::<f64>() / v.len() as f64 };
                let green_mean = mean(&green_vals);
                let nongreen_mean = mean(&nongreen_vals);
                candidates.push(Candidate {
                    transpose, row_shift, col_shift,
                    score: spread(&green_vals) + spread(&nongreen_vals),
                    green_mean, nongreen_mean,
                    ratio: if nongreen_mean > 1e-9 { green_mean / nongreen_mean } else { 0.0 },
                    green_count,
                });
            }
        }
    }
    candidates.sort_by(|a, b| a.score.partial_cmp(&b.score).unwrap_or(std::cmp::Ordering::Equal));

    println!("  Top 6 candidates (score=within-colour spread, lower=better):");
    for (rank, c) in candidates.iter().take(6).enumerate() {
        println!("    {:>2}: transpose={} rs={} cs={}  score={:.5} ratio={:.3} green_count={}",
            rank + 1, c.transpose, c.row_shift, c.col_shift, c.score, c.ratio, c.green_count);
    }
    let curr_rs = (crop_top as usize) % 6;
    let curr_cs = (crop_left as usize) % 6;
    if let Some(rank) = candidates.iter().position(|c| !c.transpose && c.row_shift == curr_rs && c.col_shift == curr_cs) {
        let c = &candidates[rank];
        println!("  CURRENT (crop%6): rs={curr_rs} cs={curr_cs}  rank={} score={:.5} ratio={:.3}", rank + 1, c.score, c.ratio);
    }
    if let Some(best) = candidates.first() {
        println!("  BEST: rs={} cs={}  score={:.5} ratio={:.3}", best.row_shift, best.col_shift, best.score, best.ratio);
        println!("  >>> offset from crop%6: drs={} dcs={}",
            (best.row_shift as i32 - curr_rs as i32 + 6) % 6,
            (best.col_shift as i32 - curr_cs as i32 + 6) % 6);
    }
}
