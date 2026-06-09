//! DNG decode + compare harness. Decodes sample DNG files through the engine,
//! dumps the decoder's per-stage debug log and level statistics, and writes
//! export JPGs next to the provided reference images.
//!
//! Run: cargo test -p lopsy-core --test dng_compare -- --nocapture

use std::path::PathBuf;

fn samples_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap().parent().unwrap().parent().unwrap()
        .join("samples")
}

fn decode_and_report(filename: &str, expect_portrait: bool) {
    let samples = samples_dir();
    let dng_path = samples.join(filename);
    if !dng_path.exists() {
        println!("{filename} not found — skipping");
        return;
    }
    let data = std::fs::read(&dng_path).expect("read dng");
    let img = match lopsy_core::dng::read_dng(&data) {
        Ok(i) => i,
        Err(e) => { println!("DNG decode error: {e}"); return; }
    };

    let stem = filename.trim_end_matches(".dng");
    println!("\n=== DNG decode: {filename} ===");
    println!("  dims: {}x{}", img.width, img.height);

    if expect_portrait {
        assert!(
            img.height > img.width,
            "expected portrait output after orientation (got {}x{}) — Orientation tag not applied?",
            img.width, img.height
        );
    }
    println!("  baseline_exposure: {}", img.baseline_exposure);
    println!("  tone_curve points: {}", img.tone_curve.len());
    if !img.tone_curve.is_empty() {
        let pts: Vec<String> = img.tone_curve.iter().take(8)
            .map(|(x, y)| format!("({x:.3},{y:.3})")).collect();
        println!("  tone_curve[..8]: {}", pts.join(" "));
    }
    println!("  --- decoder debug log ---");
    for l in &img.debug_log { println!("  {l}"); }

    let n = (img.width * img.height) as usize;
    let stride = if img.pixels.len() == n * 4 { 4 } else { 3 };

    let mut sum = [0f64; 3];
    let mut mx = [0f32; 3];
    let mut mn = [1f32; 3];
    let mut hist = [[0u64; 10]; 3];
    for i in 0..n {
        for c in 0..3 {
            let v = img.pixels[i * stride + c];
            sum[c] += v as f64;
            mx[c] = mx[c].max(v);
            mn[c] = mn[c].min(v);
            let b = ((v.clamp(0.0, 1.0) * 10.0) as usize).min(9);
            hist[c][b] += 1;
        }
    }
    println!("\n  --- export level stats (whole image) ---");
    println!("  mean RGB: [{:.3}, {:.3}, {:.3}]", sum[0]/n as f64, sum[1]/n as f64, sum[2]/n as f64);
    println!("  min  RGB: [{:.3}, {:.3}, {:.3}]", mn[0], mn[1], mn[2]);
    println!("  max  RGB: [{:.3}, {:.3}, {:.3}]", mx[0], mx[1], mx[2]);
    for (c, name) in ["R", "G", "B"].iter().enumerate() {
        let row: Vec<String> = hist[c].iter().map(|&v| format!("{:.0}%", 100.0 * v as f64 / n as f64)).collect();
        println!("  {name} hist(0..1 in 10 bins): [{}]", row.join(" "));
    }

    let mut rgb = vec![0u8; n * 3];
    for i in 0..n {
        for c in 0..3 {
            rgb[i * 3 + c] = (img.pixels[i * stride + c] * 255.0).round().clamp(0.0, 255.0) as u8;
        }
    }
    let out = samples.join(format!("{stem}_export.jpg"));
    let enc = jpeg_encoder::Encoder::new_file(&out, 92).expect("create jpg");
    enc.encode(&rgb, img.width as u16, img.height as u16, jpeg_encoder::ColorType::Rgb).expect("encode jpg");
    println!("\n  wrote {} ({} bytes)", out.display(), std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0));
}

#[test]
fn decode_and_report_dng_00() {
    decode_and_report("sample_dng_00.dng", true);
}

#[test]
fn decode_and_report_dng_01() {
    decode_and_report("sample_dng_01.dng", false);
}
