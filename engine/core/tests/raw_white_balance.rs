//! White balance in recipe units (`lopsy_core::raw::white_balance`) on real
//! calibrated files: the DNGs (`LOPSY_DNG_SAMPLES`,
//! `LOPSY_DNG_ADOBE_SAMPLES`) and the Sony ARWs (`LOPSY_ARW_SAMPLES`).
//!
//! - As shot, (0, 0), reads the description's as-shot Kelvin exactly.
//! - A typed 3000, 5500 and 8000 K (at the recipe's Tint 0 and 25) reads
//!   back within 50 K, unless the slider's end cannot reach it.
//! - The Daylight preset (D55) reads within 50 K of D55's own colour
//!   temperature, Tungsten within 50 K of illuminant A's.
//! - A patch picked as neutral (`develop_stats::neutral_temperature_tint`,
//!   the picker's maths) comes out neutral through the recipe's white: the
//!   white rose petal of `sample_dng_00.dng`, and each file's grey-world
//!   mean.
//! - An ARW without measured colour: gains only, no matrix, no Kelvin.
//!
//! Full-size files: `--release`.

use std::path::PathBuf;

use lopsy_core::raw::{self, KelvinModel, MatrixModel, RawFormatId};

fn files() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for (var, ext) in [("LOPSY_DNG_SAMPLES", "dng"), ("LOPSY_DNG_ADOBE_SAMPLES", "dng"), ("LOPSY_ARW_SAMPLES", "arw")] {
        let Some(dir) = std::env::var_os(var) else { continue };
        let mut v: Vec<PathBuf> = std::fs::read_dir(dir).map(|r| r.flatten().map(|e| e.path()).collect()).unwrap_or_default();
        v.retain(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case(ext)) && !p.to_string_lossy().contains("lossy"));
        v.sort();
        out.extend(v);
    }
    out
}

/// Mean camera RGB of a region (fractions of the oriented picture) of an
/// RGBA picture.
fn region_mean(rgba: &[f32], w: u32, h: u32, r: (f32, f32, f32, f32)) -> [f32; 3] {
    let (x0, y0, x1, y1) = ((r.0 * w as f32) as u32, (r.1 * h as f32) as u32, (r.2 * w as f32) as u32, (r.3 * h as f32) as u32);
    let mut s = [0f64; 3];
    let mut n = 0f64;
    for y in y0..y1.max(y0 + 1) {
        for x in x0..x1.max(x0 + 1) {
            let i = ((y * w + x) * 4) as usize;
            for c in 0..3 {
                s[c] += f64::from(rgba[i + c]);
            }
            n += 1.0;
        }
    }
    s.map(|v| (v / n) as f32)
}

/// The picker on a patch of camera RGB at the as-shot balance: the recipe
/// values that make its mean neutral.
fn pick(mean: [f32; 3]) -> [f32; 2] {
    let px: Vec<u16> = [mean[0], mean[1], mean[2], 1.0].iter().map(|v| (v.clamp(0.0, 1.0) * 65535.0).round() as u16).collect();
    lopsy_core::develop_stats::neutral_temperature_tint(&px, true)
}

/// A camera RGB colour through a white's gains and matrix.
fn developed(c: [f32; 3], white: &raw::RawWhite, fixed: &[f32; 9]) -> [f32; 3] {
    let m = white.cam_to_rgb.unwrap_or(*fixed);
    let b: [f32; 3] = std::array::from_fn(|i| c[i] * white.wb_ratio[i]);
    std::array::from_fn(|r| m[r * 3] * b[0] + m[r * 3 + 1] * b[1] + m[r * 3 + 2] * b[2])
}

fn spread(c: [f32; 3]) -> f32 {
    c.iter().cloned().fold(f32::MIN, f32::max) / c.iter().cloned().fold(f32::MAX, f32::min)
}

#[test]
fn recipe_white_balance_on_real_files() {
    let files = files();
    if files.is_empty() {
        println!("No DNG or ARW samples set. Skipping.");
        return;
    }
    let cct = |code: u16| {
        let (x, y) = lopsy_core::dng::camera_color::standard_illuminant_xy(code).unwrap();
        lopsy_core::cct::temperature_from_xy(x, y).0 as f32
    };
    let (d55, a) = (cct(20), cct(17));
    for path in files {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let data = std::fs::read(&path).unwrap();
        let prep = raw::prepare(&data).unwrap_or_else(|e| panic!("{name}: {e}"));
        let (format, json, d) = (prep.format, prep.params_json.clone(), prep.description.clone());
        let fixed = d.develop_defaults.cam_to_rgb;
        let (bw, bh, binned) = prep.binned_linear(1024).unwrap();
        let white = |t: f32, m: f32| raw::white_for_recipe(format, &json, t, m).unwrap();

        // A patch picked neutral comes out neutral: the grey-world mean, and
        // the white petal of sample_dng_00.
        let mut patches = vec![("grey-world mean", region_mean(&binned, bw, bh, (0.0, 0.0, 1.0, 1.0)))];
        if name == "sample_dng_00.dng" {
            patches.push(("white petal", region_mean(&binned, bw, bh, (0.44, 0.25, 0.55, 0.28))));
        }
        for (what, mean) in patches {
            let [t, m] = pick(mean);
            let out = developed(mean, &white(t, m), &fixed);
            println!("  {name}: {what} picked as Temperature {t}, Tint {m}: developed {out:.4?} (max/min {:.4})", spread(out));
            // A patch the sliders cannot reach (clamped at ±200) is left.
            let end = lopsy_core::scene_tone::WB_SLIDER_END;
            if t.abs() < end && m.abs() < end {
                assert!(spread(out) < 1.03, "{name}: the {what} picked as neutral is not neutral: {out:?}");
            }
        }

        match d.white_balance.kelvin {
            KelvinModel::Measured { as_shot_kelvin, .. } => {
                assert_eq!(d.white_balance.matrix, MatrixModel::PerWhite);
                let w0 = white(0.0, 0.0);
                assert_eq!(w0.wb_ratio, [1.0, 1.0, 1.0], "{name}: as shot is no change");
                assert!((w0.kelvin.unwrap() - as_shot_kelvin).abs() < 0.5, "{name}");
                for tint in [0.0f32, 25.0] {
                    let mut line = Vec::new();
                    for k in [3000.0f32, 5500.0, 8000.0] {
                        let t = raw::temperature_for_kelvin(format, &json, k, tint).unwrap();
                        let back = white(t, tint).kelvin.unwrap();
                        line.push(format!("{k} K → {t:+.1} → {back:.0} K"));
                        if t.abs() < lopsy_core::scene_tone::WB_SLIDER_END {
                            assert!((back - k).abs() < 50.0, "{name}: typed {k} K at tint {tint} reads back {back} K");
                        }
                    }
                    println!("  {name}: tint {tint}: {}", line.join(", "));
                }
                // Kelvin rises with Temperature.
                let ks: Vec<f32> = [-150.0, -50.0, 0.0, 50.0, 150.0].iter().map(|&t| white(t, 0.0).kelvin.unwrap()).collect();
                assert!(ks.windows(2).all(|p| p[0] < p[1]), "{name}: {ks:?}");
                for p in &d.white_balance.presets {
                    let k = white(p.temperature, p.tint).kelvin.unwrap();
                    let expected = match p.name.as_str() {
                        "Daylight" => Some(d55),
                        "Tungsten" => Some(a),
                        _ => None,
                    };
                    println!("  {name}: preset {} = {}/{} reads {k:.0} K", p.name, p.temperature, p.tint);
                    if let Some(e) = expected.filter(|_| p.temperature.abs() < lopsy_core::scene_tone::WB_SLIDER_END) {
                        assert!((k - e).abs() < 50.0, "{name}: {} reads {k} K, not {e} K", p.name);
                    }
                }
            }
            KelvinModel::None => {
                assert_eq!(format, RawFormatId::Arw, "{name}");
                let w = white(30.0, -10.0);
                assert!(w.cam_to_rgb.is_none() && w.kelvin.is_none(), "{name}");
                assert_eq!(w.wb_ratio, lopsy_core::raw::white_balance::wb_ratio_for(30.0, -10.0));
                assert!(raw::temperature_for_kelvin(format, &json, 5500.0, 0.0).is_err());
                assert!(d.white_balance.presets.is_empty());
                println!("  {name}: fixed matrix, no Kelvin, no presets");
            }
            KelvinModel::Fitted { .. } => panic!("{name}: a fitted scale outside RAF"),
        }
    }
}
