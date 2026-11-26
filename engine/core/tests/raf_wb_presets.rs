//! The camera's white-balance presets, read from real RAF files
//! (`LOPSY_RAF_SAMPLES`, a clone of `theseamusjames/sample-raf-images`):
//! every sample carries the preset table and the calibration whites
//! (`raf::wb_presets`); a body's presets are the same in each of its
//! frames; Tungsten is the camera's illuminant A white; and each preset the
//! menu offers is the camera's own Temperature and Tint within the sliders'
//! ±200. Prints, per file, the presets in recipe units and the Kelvin each
//! reads as. Without the samples it notes that and passes.

use std::collections::HashMap;

use lopsy_core::raf::{self, wb_presets};
use lopsy_core::scene_tone::WB_SLIDER_END;

const NAMES: [&str; 6] = [
    "Daylight",
    "Cloudy",
    "Tungsten",
    "Fluorescent (daylight)",
    "Fluorescent (day white)",
    "Fluorescent (cool white)",
];

#[test]
fn presets_are_the_cameras_own_from_the_file() {
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
    assert!(!files.is_empty(), "no RAF files in LOPSY_RAF_SAMPLES");
    let mut per_body: HashMap<String, wb_presets::CameraWhiteBalance> = HashMap::new();
    for path in files {
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        let data = std::fs::read(&path).expect("read RAF");
        let (model, as_shot) = raf::read_wb_info(&data).expect("white balance info");
        let as_shot = as_shot.expect("an as-shot balance");
        let camera = wb_presets::read_camera_white_balance(&data);

        // Every sample has the table and both calibration whites.
        let names: Vec<&str> = camera.presets.iter().map(|p| p.name).collect();
        assert_eq!(names, NAMES, "{name} ({model})");
        let codes: Vec<u16> = camera.calibration.iter().map(|c| c.0).collect();
        assert_eq!(codes, [17, 21], "{name} ({model})");
        let tungsten = camera.presets.iter().find(|p| p.name == "Tungsten").unwrap();
        assert_eq!(tungsten.multipliers, camera.calibration[0].1, "{name}: Tungsten is illuminant A");
        // A body's presets do not change from frame to frame.
        let first = per_body.entry(model.clone()).or_insert_with(|| camera.clone());
        assert_eq!(*first, camera, "{name} ({model}) differs from an earlier frame of the body");

        let presets = wb_presets::recipe_presets(&camera, as_shot);
        let kelvin = wb_presets::kelvin_scale(&camera, as_shot).expect("a Kelvin scale");
        let reads = |t: f32| {
            let mired = kelvin.mired_at_zero + kelvin.mired_per_unit * t;
            if mired > 0.0 { format!("{:.0} K", 1e6 / mired) } else { "none".to_string() }
        };
        println!("{name}: {model}, as shot {:.0} K", kelvin.as_shot_kelvin);
        for (p, cam) in presets.iter().zip(&camera.presets) {
            let (t, m) = wb_presets::recipe_temperature_tint(cam.multipliers, as_shot);
            assert!(p.temperature.abs() <= WB_SLIDER_END && p.tint.abs() <= WB_SLIDER_END, "{p:?}");
            assert_eq!(p.temperature, t.clamp(-WB_SLIDER_END, WB_SLIDER_END).round() + 0.0, "{p:?}");
            println!(
                "  {:<26} R/G {:.4} B/G {:.4}  Temperature {:+5.0} Tint {:+5.0}  ({:+.1}, {:+.1} unclamped)  reads {}",
                p.name, cam.multipliers[0], cam.multipliers[2], p.temperature, p.tint, t, m, reads(t)
            );
        }
        println!("  Kelvin at -200 {}, -100 {}, 0 {}, 100 {}, 200 {}", reads(-200.0), reads(-100.0), reads(0.0), reads(100.0), reads(200.0));
        if name == "DSCF6952.RAF" {
            let daylight = presets.iter().find(|p| p.name == "Daylight").unwrap();
            assert!(daylight.temperature.abs() <= 20.0, "a sunny frame: {daylight:?}");
            assert!((4500.0..7000.0).contains(&kelvin.as_shot_kelvin), "{kelvin:?}");
        }
    }
}
