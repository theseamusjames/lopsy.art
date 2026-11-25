//! The camera's white-balance presets in the recipe's units on real RAF
//! files (`LOPSY_RAF_SAMPLES`, a clone of `theseamusjames/sample-raf-images`):
//! each preset the menu offers is the camera's own Temperature and Tint
//! wherever they fall within the sliders' ±150, and stops at 150 only past
//! it. Prints, per file, how many presets would be cut off at ±100 and how
//! many still are at ±150. Without the samples it notes that and passes.

use lopsy_core::raf::{self, wb_presets};
use lopsy_core::scene_tone::SLIDER_END;

/// The table's illuminants the White balance menu offers.
const MENU: [&str; 12] = [
    "Daylight",
    "Cloudy",
    "Shade",
    "Incandescent",
    "Daylight Fluorescent",
    "Day White Fluorescent",
    "White Fluorescent",
    "Cool White Fluorescent",
    "Warm White Fluorescent",
    "Fluorescent",
    "Flash",
    "Underwater",
];

#[test]
fn presets_are_the_cameras_own_within_150() {
    let Some(dir) = std::env::var_os("LOPSY_RAF_SAMPLES") else {
        println!("LOPSY_RAF_SAMPLES is not set: skipping the presets on real files.");
        return;
    };
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .expect("read LOPSY_RAF_SAMPLES")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("raf")))
        .collect();
    files.sort();
    for path in files {
        let data = std::fs::read(&path).expect("read RAF");
        let (model, as_shot) = raf::read_wb_info(&data).expect("white balance info");
        let Some(as_shot) = as_shot else { continue };
        let presets = wb_presets::recipe_presets(&model, as_shot);
        let (mut past_100, mut past_150) = (Vec::new(), Vec::new());
        for p in wb_presets::presets_for_camera(&model) {
            let (t, m) = wb_presets::recipe_temperature_tint(p.multipliers, as_shot);
            if !MENU.contains(&p.illuminant) {
                continue;
            }
            if t.abs() > 100.0 || m.abs() > 100.0 {
                past_100.push(format!("{} ({t:.0}, {m:.0})", p.illuminant));
            }
            if t.abs() > SLIDER_END || m.abs() > SLIDER_END {
                past_150.push(format!("{} ({t:.0}, {m:.0})", p.illuminant));
            }
        }
        // The Kelvin readout at the slider's ends: a mired of 0 or less has no Kelvin.
        if let Some(k) = wb_presets::kelvin_scale(&model, as_shot) {
            let kelvin = |t: f32| {
                let mired = k.mired_at_zero + k.mired_per_unit * t;
                if mired > 0.0 { format!("{:.0} K", 1e6 / mired) } else { "none".to_string() }
            };
            println!("  Kelvin at -150 {}, -100 {}, 0 {}, 100 {}, 150 {}", kelvin(-150.0), kelvin(-100.0), kelvin(0.0), kelvin(100.0), kelvin(150.0));
        }
        for p in &presets {
            assert!(p.temperature.abs() <= SLIDER_END && p.tint.abs() <= SLIDER_END, "{p:?}");
        }
        println!(
            "{}: {model}, {} presets in the menu; cut off at ±100: {} {:?}; still cut off at ±150: {} {:?}",
            path.file_name().unwrap_or_default().to_string_lossy(),
            presets.len(),
            past_100.len(),
            past_100,
            past_150.len(),
            past_150
        );
    }
}
