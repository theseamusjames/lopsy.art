//! Auto tone and auto white balance on real RAFs: on a well-exposed
//! daylight photo they must move things only a little. Reads the samples
//! from `LOPSY_RAF_SAMPLES` and skips when it is unset; run with
//! `--release --nocapture` to see every sample's answer (set `AUTO_DEBUG`
//! for its histogram percentiles and channel means, without the asserts).
//!
//! The pipeline is the Photos app's: the binned linear preview, developed
//! with the camera defaults, encoded to 8 bits, binned into the histogram
//! the engine reads back.

use lopsy_core::develop_stats::{auto_tone, auto_white_balance, histogram_from_rgba8, ToneSettings, RAW_TEMPERATURE_STOPS, RAW_TINT_STOPS};
use lopsy_core::raf::develop::{binned_factor_for, develop_defaults, develop_reference, render_binned_linear};
use lopsy_core::raf::{prepare_raf, RafDecodeOpts};

/// The app's `temperatureTintFor` (raw-develop.ts), unrounded.
fn temperature_tint(r: [f32; 3]) -> (f32, f32) {
    let t = (r[0] / r[2]).log2() / (2.0 * RAW_TEMPERATURE_STOPS) * 100.0;
    let m = -(r[1] / (r[0] * r[2]).sqrt()).log2() / RAW_TINT_STOPS * 100.0;
    (t, m)
}

struct Answer {
    tone: ToneSettings,
    wb: (f32, f32),
}

fn answer(path: &std::path::Path) -> Option<Answer> {
    let data = std::fs::read(path).ok()?;
    // Some samples use a compression variant the decoder does not read.
    let prep = prepare_raf(&data, RafDecodeOpts::default()).ok()?;
    let factor = binned_factor_for(&prep.params, 1024);
    let (_, _, linear) = render_binned_linear(&prep.mosaic, &prep.params, factor).unwrap();
    let developed = develop_reference(&linear, &develop_defaults(&prep.params));
    let bytes: Vec<u8> = developed.iter().map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8).collect();
    let histogram = histogram_from_rgba8(&bytes);
    if std::env::var("AUTO_DEBUG").is_ok() {
        let lum = &histogram[768..];
        let total: u32 = lum.iter().sum();
        let pct = |q: f32| { let mut acc = 0; for (i, &n) in lum.iter().enumerate() { acc += n; if acc as f32 >= q * total as f32 { return i; } } 255 };
        println!("  p1 {} p10 {} p50 {} p90 {} p99 {} p99.5 {} | top {:?} bottom {:?}", pct(0.01), pct(0.1), pct(0.5), pct(0.9), pct(0.99), pct(0.995),
            (0..3).map(|c| histogram[c * 256 + 255] as f32 / total as f32).collect::<Vec<_>>(),
            (0..3).map(|c| histogram[c * 256] as f32 / total as f32).collect::<Vec<_>>());
        let n = linear.len() / 4;
        let mean: Vec<f32> = (0..3).map(|c| linear.chunks_exact(4).map(|p| p[c]).sum::<f32>() / n as f32).collect();
        println!("  linear camera mean {:?}", mean);
    }
    Some(Answer { tone: auto_tone(&histogram, &ToneSettings::default()), wb: temperature_tint(auto_white_balance(&linear)) })
}

fn samples() -> Option<Vec<std::path::PathBuf>> {
    let dir = std::env::var("LOPSY_RAF_SAMPLES").ok()?;
    let mut files: Vec<_> = std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("raf")))
        .collect();
    files.sort();
    Some(files)
}

#[test]
fn auto_tone_and_white_balance_barely_move_a_well_exposed_daylight_photo() {
    let Some(files) = samples() else {
        eprintln!("LOPSY_RAF_SAMPLES not set; skipping");
        return;
    };
    for path in &files {
        let Some(a) = answer(path) else {
            println!("{}: not decodable here; skipped", path.display());
            continue;
        };
        println!(
            "{}: auto tone {:?}; auto WB temperature {:+.1}, tint {:+.1}",
            path.file_name().unwrap().to_string_lossy(),
            a.tone,
            a.wb.0,
            a.wb.1
        );
        // DSCF6952 is a sunny, well-exposed scene (the UX review's case).
        if path.file_name().is_some_and(|n| n == "DSCF6952.RAF") && std::env::var("AUTO_DEBUG").is_err() {
            assert!(a.tone.exposure.abs() <= 0.3, "exposure {}", a.tone.exposure);
            assert!(a.tone.highlights >= -30.0 && a.tone.shadows <= 30.0, "{:?}", a.tone);
            assert!(a.tone.blacks.abs() <= 20.0 && a.tone.whites.abs() <= 30.0, "{:?}", a.tone);
            assert!(a.wb.0.abs() <= 15.0 && a.wb.1.abs() <= 15.0, "white balance {:?}", a.wb);
        }
    }
}

#[test]
fn white_balance_presets_place_daylight_near_a_sunny_as_shot() {
    let Some(files) = samples() else {
        eprintln!("LOPSY_RAF_SAMPLES not set; skipping");
        return;
    };
    for path in &files {
        let data = std::fs::read(path).unwrap();
        let Ok((model, Some(as_shot))) = lopsy_core::raf::read_wb_info(&data) else { continue };
        let presets = lopsy_core::raf::wb_presets::recipe_presets(&model, as_shot);
        let kelvin = lopsy_core::raf::wb_presets::kelvin_scale(&model, as_shot);
        println!("{} ({model}): {presets:?}; {kelvin:?}", path.file_name().unwrap().to_string_lossy());
        if path.file_name().is_some_and(|n| n == "DSCF6952.RAF") {
            let daylight = presets.iter().find(|p| p.name == "Daylight").expect("a Daylight preset");
            assert!(daylight.temperature.abs() <= 20.0, "{daylight:?}");
            let k = kelvin.expect("a Kelvin scale");
            assert!((4500.0..7000.0).contains(&k.as_shot_kelvin), "{k:?}");
        }
    }
}
