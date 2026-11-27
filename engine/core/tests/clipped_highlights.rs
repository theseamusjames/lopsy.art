//! Sensor-clipped highlights on the DNG and ARW linear path: a pixel whose
//! every channel is clipped at the sensor must render neutral, and nothing
//! else may move. Reads `LOPSY_DNG_ADOBE_SAMPLES` (the six Canon EOS 5D
//! Mark III files) and `LOPSY_ARW_SAMPLES`; a missing variable skips its
//! files. `--release`. RAF files (`LOPSY_RAF_SAMPLES`) are measured for
//! comparison only: RAF renders through its own code, which this leaves
//! alone.
//!
//! Each file is opened with `raw::prepare` and its binned view (long edge
//! at least 2000) rendered through the develop chain's CPU references at
//! its develop defaults, and again at a cooler and a warmer white balance.
//! "Clipped" pixels are those whose every channel in the binned view is at
//! least 95 % of its clip level; "far from neutral" is an Oklab chroma
//! above 0.04 in the rendered output; "the rest" is every pixel whose
//! largest channel is under 80 % of its clip level.
//!
//! Before the fix, every clipped glint on the four LinearRaw 5D3 files and
//! a third of the Bayer ones' rendered far from neutral at the as-shot
//! white (magenta, pink: the as-shot gains' colour); the check is that at
//! most 3 % do now, at the as-shot white. A white balance a quarter cooler
//! or warmer is measured and printed, not checked: the clipped pixel is a
//! neutral at the highest clip level, and a moved white balance tints it
//! as it tints any neutral (`dng::linear::neutral_clipped`).
//!
//! With `LOPSY_HIGHLIGHTS_DIR` set, a crop of the 5D3 tap (the glints at
//! the right edge) is written there for each file, as
//! `<stem>-tap-<tag>.png`, `<tag>` from `LOPSY_HIGHLIGHTS_TAG` (default
//! `now`); when a `<stem>-tap-before.png` is there too, a sheet
//! `<stem>-tap.jpg` of the two side by side.

use std::path::PathBuf;

use lopsy_core::look::{oklab_matrices, to_oklab};
use lopsy_core::output::{output_reference, OutputSettings, OutputTarget};
use lopsy_core::raf::develop::{scene_reference, tone_settings, RawDevelopSettings};
use lopsy_core::raw::{self, PreparedRaw};
use lopsy_core::working_space::{apply, conversion, srgb_decode, Gamut};

#[path = "support/raw_compare.rs"]
mod raw_compare;
#[path = "support/sheet.rs"]
mod sheet;
use raw_compare::Picture;

const LONG_EDGE: u32 = 2000;

fn files() -> Vec<PathBuf> {
    let mut v = Vec::new();
    for (var, ext) in [("LOPSY_DNG_ADOBE_SAMPLES", "dng"), ("LOPSY_ARW_SAMPLES", "arw"), ("LOPSY_RAF_SAMPLES", "raf")] {
        let Some(dir) = std::env::var_os(var) else { continue };
        let mut f: Vec<PathBuf> = std::fs::read_dir(dir).map(|r| r.flatten().map(|e| e.path()).collect()).unwrap_or_default();
        f.retain(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case(ext)));
        f.sort();
        v.extend(f);
    }
    v
}

/// The develop chain on `binned`, encoded sRGB RGBA.
fn render(binned: &[f32], w: u32, h: u32, s: &RawDevelopSettings) -> Vec<f32> {
    let scene = scene_reference(binned, s);
    let toned = lopsy_core::scene_tone::scene_tone_reference(&scene, w as usize, h as usize, &Default::default(), &[], &[]);
    let rendered = lopsy_core::tone::tone_reference(&toned, &tone_settings(s));
    output_reference(&rendered, w, &OutputSettings::sdr(OutputTarget::Srgb, Gamut::Rec2020, false))
}

pub struct Measure {
    pub clipped: usize,
    pub far: usize,
    pub worst: f32,
    pub rest_median: f32,
    pub rest_chroma: f32,
}

fn measure(binned: &[f32], out: &[f32], clip: [f32; 3]) -> Measure {
    let m = oklab_matrices();
    let to2020 = conversion(Gamut::Srgb, Gamut::Rec2020);
    let lab = |p: &[f32]| to_oklab(&m, apply(&to2020, [srgb_decode(p[0].clamp(0.0, 1.0)), srgb_decode(p[1].clamp(0.0, 1.0)), srgb_decode(p[2].clamp(0.0, 1.0))]));
    let (mut clipped, mut far, mut worst) = (0, 0, 0f32);
    let mut rest_l = Vec::new();
    let mut rest_c = 0f64;
    for (lin, o) in binned.chunks_exact(4).zip(out.chunks_exact(4)) {
        let f: [f32; 3] = std::array::from_fn(|c| lin[c] / clip[c]);
        let l = lab(o);
        let c = l[1].hypot(l[2]);
        if f.iter().all(|&x| x >= 0.95) {
            clipped += 1;
            worst = worst.max(c);
            far += usize::from(c > 0.04);
        } else if f.iter().all(|&x| x < 0.8) {
            rest_l.push(l[0]);
            rest_c += f64::from(c);
        }
    }
    let n = rest_l.len();
    let mid = n / 2;
    let median = if n > 0 { *rest_l.select_nth_unstable_by(mid, f32::total_cmp).1 } else { 0.0 };
    Measure { clipped, far, worst, rest_median: median, rest_chroma: (rest_c / n.max(1) as f64) as f32 }
}

/// The plane's clip levels as the decode recorded them.
fn clip_of(prep: &PreparedRaw) -> [f32; 3] {
    prep.description.clip_levels.expect("clip levels")
}

fn at_white(defaults: &RawDevelopSettings, ratio: [f32; 3]) -> RawDevelopSettings {
    RawDevelopSettings { wb_ratio: std::array::from_fn(|c| defaults.wb_ratio[c] * ratio[c]), ..defaults.clone() }
}

#[test]
fn clipped_highlights_render_neutral() {
    let files = files();
    if files.is_empty() {
        println!("No DNG or ARW samples: set LOPSY_DNG_ADOBE_SAMPLES or LOPSY_ARW_SAMPLES. Skipping.");
        return;
    }
    let out_dir = std::env::var_os("LOPSY_HIGHLIGHTS_DIR").map(PathBuf::from).filter(|p| p.is_dir());
    let tag = std::env::var("LOPSY_HIGHLIGHTS_TAG").unwrap_or_else(|_| "now".into());
    println!("| File | WB | clipped px | far from neutral | worst C | rest median L | rest mean C |");
    println!("|---|---|---|---|---|---|---|");
    for path in files {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let data = std::fs::read(&path).unwrap();
        let Ok(prep) = raw::prepare(&data) else { continue };
        let clip = clip_of(&prep);
        let (w, h, binned) = prep.binned_linear(LONG_EDGE).unwrap();
        let d = &prep.description.develop_defaults;
        for (label, ratio) in [("as shot", [1.0, 1.0, 1.0]), ("cooler", [0.8, 1.0, 1.25]), ("warmer", [1.25, 1.0, 0.8])] {
            let out = render(&binned, w, h, &at_white(d, ratio));
            let m = measure(&binned, &out, clip);
            println!("| {name} | {label} | {} | {} | {:.3} | {:.4} | {:.4} |", m.clipped, m.far, m.worst, m.rest_median, m.rest_chroma);
            // RAF is measured, not checked: its render is its own and is
            // not changed by this (`raf::develop`).
            if m.clipped >= 50 && label == "as shot" && !name.to_ascii_lowercase().ends_with(".raf") {
                assert!(m.far * 100 <= 3 * m.clipped, "{name} {label}: {} of {} clipped pixels far from neutral", m.far, m.clipped);
            }
            if label == "as shot" {
                if let (Some(dir), true) = (&out_dir, name.starts_with("5D3")) {
                    let pic = Picture::from_rgba_encoded(w, h, &out);
                    let (x0, y0) = ((w as f32 * 0.86) as usize, (h as f32 * 0.30) as usize);
                    let crop = pic.crop(x0, y0, w as usize - x0, (h as f32 * 0.32) as usize);
                    let stem = name.trim_end_matches(".dng");
                    crop.write_png(&dir.join(format!("{stem}-tap-{tag}.png")));
                    if let (Some(before), true) = (read_png(&dir.join(format!("{stem}-tap-before.png"))), tag != "before") {
                        before_after(&dir.join(format!("{stem}-tap.jpg")), &format!("{name}: before | after (as-shot white, Standard)"), &before, &crop);
                    }
                }
            }
        }
    }
}

fn read_png(path: &std::path::Path) -> Option<Picture> {
    let decoder = png::Decoder::new(std::fs::File::open(path).ok()?);
    let mut reader = decoder.read_info().ok()?;
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).ok()?;
    (info.color_type == png::ColorType::Rgb && info.bit_depth == png::BitDepth::Eight).then(|| Picture::from_rgb8(info.width as usize, info.height as usize, &buf[..info.buffer_size()]))
}

fn before_after(path: &std::path::Path, title: &str, before: &Picture, after: &Picture) {
    const GAP: usize = 12;
    let top = GAP + 18 + GAP;
    let (w, h) = (before.w + after.w + 3 * GAP, top + before.h.max(after.h) + GAP);
    let mut sheet = sheet::Sheet::new(w.max(900), h, 24);
    sheet.text(GAP, GAP, title, 2, [235, 235, 235]);
    sheet.picture(GAP, top, before);
    sheet.picture(2 * GAP + before.w, top, after);
    sheet.write_jpeg(path);
}
