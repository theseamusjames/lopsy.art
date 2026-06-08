//! DNG decode + compare harness. Decodes sample_dng_00.dng through the engine,
//! dumps the decoder's per-stage debug log and level statistics, and writes
//! sample_dng_00_export.jpg next to the provided sample_dng_00.jpg reference.
//!
//! Run: cargo test -p lopsy-core --test dng_compare -- --nocapture

use std::path::PathBuf;

fn samples_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap().parent().unwrap().parent().unwrap()
        .join("samples")
}

#[test]
fn decode_and_report_dng() {
    let samples = samples_dir();
    let dng_path = samples.join("sample_dng_00.dng");
    if !dng_path.exists() {
        println!("sample_dng_00.dng not found — skipping");
        return;
    }
    let data = std::fs::read(&dng_path).expect("read dng");
    let img = match lopsy_core::dng::read_dng(&data) {
        Ok(i) => i,
        Err(e) => { println!("DNG decode error: {e}"); return; }
    };

    println!("\n=== DNG decode: sample_dng_00.dng ===");
    println!("  dims: {}x{}", img.width, img.height);

    // sample_dng_00 is an iPhone portrait shot (TIFF Orientation 6). The sensor
    // scans landscape, so a correct decode must rotate it upright — height > width.
    assert!(
        img.height > img.width,
        "expected portrait output after orientation (got {}x{}) — Orientation tag not applied?",
        img.width, img.height
    );
    println!("  baseline_exposure: {}", img.baseline_exposure);
    println!("  tone_curve points: {}", img.tone_curve.len());
    if !img.tone_curve.is_empty() {
        let pts: Vec<String> = img.tone_curve.iter().take(8)
            .map(|(x, y)| format!("({x:.3},{y:.3})")).collect();
        println!("  tone_curve[..8]: {}", pts.join(" "));
    }
    println!("  --- decoder debug log ---");
    for l in &img.debug_log { println!("  {l}"); }

    // Pixel stride: RGBA (4) per the struct doc; guard for RGB (3) just in case.
    let n = (img.width * img.height) as usize;
    let stride = if img.pixels.len() == n * 4 { 4 } else { 3 };

    // Level statistics across the whole image.
    let mut sum = [0f64; 3];
    let mut mx = [0f32; 3];
    let mut mn = [1f32; 3];
    // crude per-channel histogram (10 bins) to see where tones sit.
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

    // Write export JPG.
    let mut rgb = vec![0u8; n * 3];
    for i in 0..n {
        for c in 0..3 {
            rgb[i * 3 + c] = (img.pixels[i * stride + c] * 255.0).round().clamp(0.0, 255.0) as u8;
        }
    }
    let out = samples.join("sample_dng_00_export.jpg");
    let enc = jpeg_encoder::Encoder::new_file(&out, 92).expect("create jpg");
    enc.encode(&rgb, img.width as u16, img.height as u16, jpeg_encoder::ColorType::Rgb).expect("encode jpg");
    println!("\n  wrote {} ({} bytes)", out.display(), std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0));
}
