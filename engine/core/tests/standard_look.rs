//! The Standard tone curve candidates (`raf::standard_curve`) on real
//! files: checks that each opens where the opening look says, and, when
//! `LOPSY_STANDARD_LOOK_DIR` is set, the contact sheets the owner chooses a
//! default from. `--release`; the sample variables as the other real-file
//! tests take them (`LOPSY_ARW_SAMPLES`, `LOPSY_DNG_SAMPLES`,
//! `LOPSY_DNG_ADOBE_SAMPLES`, `LOPSY_RAF_SAMPLES`); a missing one skips its
//! files.
//!
//! Every developed panel is the RAW interface's develop defaults
//! (`raw::prepare_with` and the opening look) through the develop chain's
//! CPU references, as the app applies them with the working space on: the
//! binned view (highlights reconstructed where the format does), the RAW
//! step (`scene_reference`: as-shot white balance, matrix, the default
//! exposure), scene tone with every slider at 0, the tone step (the curve
//! and its shoulder) and the SDR output step for sRGB. Not the baked
//! decode. A RAF's candidates are its film-look defaults with the base
//! curve replaced and saturation 1, at its usual exposure: a picture of
//! what Standard would be as a profile on a Fujifilm file, not a default.
//!
//! Each panel's numbers, over the render (binned to a long edge of at
//! least 2000 pixels) and the preview, both box-reduced to the narrower of
//! the two widths: the median of
//! encoded Rec. 709 luminance of linear sRGB (the measure the exposure
//! match uses), and the share of pixels with any channel at 255.

use std::path::{Path, PathBuf};

use lopsy_core::output::{output_reference, OutputSettings, OutputTarget};
use lopsy_core::raf::develop::{scene_reference, tone_settings, RawDevelopSettings};
use lopsy_core::raf::standard_curve::CANDIDATES;
use lopsy_core::raw::{self, OpeningCurve, OpeningLook, Prepared, PreparedRaw};
use lopsy_core::working_space::{srgb_encode, Gamut};

#[path = "support/raw_compare.rs"]
mod raw_compare;
#[path = "support/previews.rs"]
mod previews;
use raw_compare::Picture;

const STATS_LONG_EDGE: u32 = 2000;

fn env_dir(var: &str) -> Option<PathBuf> {
    std::env::var_os(var).map(PathBuf::from).filter(|p| p.is_dir())
}

fn sample(var: &str, name: &str) -> Option<PathBuf> {
    env_dir(var).map(|d| d.join(name)).filter(|p| p.is_file())
}

/// Median encoded luminance and the share of pixels with any channel at 255.
fn stats(p: &Picture) -> (f32, f32) {
    let enc = |v: f32| srgb_encode(v.clamp(0.0, 1.0));
    let mut lum: Vec<f32> = p.rgb.chunks_exact(3).map(|c| enc(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2])).collect();
    let white = p.rgb.chunks_exact(3).filter(|c| c.iter().any(|&v| enc(v) * 255.0 + 0.5 >= 255.0)).count() as f32 / lum.len() as f32;
    let mid = lum.len() / 2;
    let (_, m, _) = lum.select_nth_unstable_by(mid, f32::total_cmp);
    (*m, white)
}

/// The develop chain's CPU references on `binned` (linear camera RGBA).
fn develop_rgba(binned: &[f32], w: u32, h: u32, settings: &RawDevelopSettings) -> Picture {
    let scene = scene_reference(binned, settings);
    let toned = lopsy_core::scene_tone::scene_tone_reference(&scene, w as usize, h as usize, &Default::default(), &[], &[]);
    let rendered = lopsy_core::tone::tone_reference(&toned, &tone_settings(settings));
    let out = output_reference(&rendered, w, &OutputSettings::sdr(OutputTarget::Srgb, Gamut::Rec2020, false));
    Picture::from_rgba_encoded(w, h, &out)
}

fn develop(prep: &PreparedRaw, settings: &RawDevelopSettings, long: u32) -> Picture {
    let (w, h, binned) = prep.binned_linear(long).unwrap();
    develop_rgba(&binned, w, h, settings)
}

// ── Contact sheets ───────────────────────────────────────────────────

/// A 5 × 7 bitmap font, drawn for these sheets: each row's five bits, the
/// leftmost the highest.
fn glyph(c: char) -> [u8; 7] {
    match c {
        'A' => [14, 17, 17, 31, 17, 17, 17],
        'B' => [30, 17, 17, 30, 17, 17, 30],
        'C' => [14, 17, 16, 16, 16, 17, 14],
        'D' => [30, 17, 17, 17, 17, 17, 30],
        'E' => [31, 16, 16, 30, 16, 16, 31],
        'F' => [31, 16, 16, 30, 16, 16, 16],
        'G' => [14, 17, 16, 23, 17, 17, 15],
        'H' => [17, 17, 17, 31, 17, 17, 17],
        'I' => [14, 4, 4, 4, 4, 4, 14],
        'J' => [7, 2, 2, 2, 2, 18, 12],
        'K' => [17, 18, 20, 24, 20, 18, 17],
        'L' => [16, 16, 16, 16, 16, 16, 31],
        'M' => [17, 27, 21, 21, 17, 17, 17],
        'N' => [17, 17, 25, 21, 19, 17, 17],
        'O' => [14, 17, 17, 17, 17, 17, 14],
        'P' => [30, 17, 17, 30, 16, 16, 16],
        'Q' => [14, 17, 17, 17, 21, 18, 13],
        'R' => [30, 17, 17, 30, 20, 18, 17],
        'S' => [15, 16, 16, 14, 1, 1, 30],
        'T' => [31, 4, 4, 4, 4, 4, 4],
        'U' => [17, 17, 17, 17, 17, 17, 14],
        'V' => [17, 17, 17, 17, 17, 10, 4],
        'W' => [17, 17, 17, 21, 21, 21, 10],
        'X' => [17, 17, 10, 4, 10, 17, 17],
        'Y' => [17, 17, 10, 4, 4, 4, 4],
        'Z' => [31, 1, 2, 4, 8, 16, 31],
        '0' => [14, 17, 19, 21, 25, 17, 14],
        '1' => [4, 12, 4, 4, 4, 4, 14],
        '2' => [14, 17, 1, 2, 4, 8, 31],
        '3' => [31, 2, 4, 2, 1, 17, 14],
        '4' => [2, 6, 10, 18, 31, 2, 2],
        '5' => [31, 16, 30, 1, 1, 17, 14],
        '6' => [6, 8, 16, 30, 17, 17, 14],
        '7' => [31, 1, 2, 4, 8, 8, 8],
        '8' => [14, 17, 17, 14, 17, 17, 14],
        '9' => [14, 17, 17, 15, 1, 2, 12],
        '.' => [0, 0, 0, 0, 0, 12, 12],
        ',' => [0, 0, 0, 0, 12, 4, 8],
        '%' => [24, 25, 2, 4, 8, 19, 3],
        '+' => [0, 4, 4, 31, 4, 4, 0],
        '-' => [0, 0, 0, 31, 0, 0, 0],
        '(' => [2, 4, 8, 8, 8, 4, 2],
        ')' => [8, 4, 2, 2, 2, 4, 8],
        '/' => [0, 1, 2, 4, 8, 16, 0],
        ':' => [0, 12, 12, 0, 12, 12, 0],
        '=' => [0, 0, 31, 0, 31, 0, 0],
        '_' => [0, 0, 0, 0, 0, 0, 31],
        _ => [0; 7],
    }
}

/// An 8-bit RGB sheet.
struct Sheet {
    w: usize,
    h: usize,
    px: Vec<u8>,
}

impl Sheet {
    fn new(w: usize, h: usize, bg: u8) -> Self {
        Sheet { w, h, px: vec![bg; w * h * 3] }
    }

    fn text(&mut self, x: usize, y: usize, s: &str, scale: usize, colour: [u8; 3]) {
        for (i, c) in s.to_uppercase().chars().enumerate() {
            let g = glyph(c);
            let gx = x + i * 6 * scale;
            for (row, bits) in g.iter().enumerate() {
                for col in 0..5 {
                    if bits & (16 >> col) == 0 {
                        continue;
                    }
                    for dy in 0..scale {
                        for dx in 0..scale {
                            let (px, py) = (gx + col * scale + dx, y + row * scale + dy);
                            if px < self.w && py < self.h {
                                self.px[(py * self.w + px) * 3..][..3].copy_from_slice(&colour);
                            }
                        }
                    }
                }
            }
        }
    }

    fn picture(&mut self, x: usize, y: usize, p: &Picture) {
        for py in 0..p.h.min(self.h - y) {
            for px in 0..p.w.min(self.w - x) {
                for c in 0..3 {
                    let v = p.rgb[(py * p.w + px) * 3 + c];
                    self.px[((y + py) * self.w + x + px) * 3 + c] = (srgb_encode(v.clamp(0.0, 1.0)) * 255.0 + 0.5) as u8;
                }
            }
        }
    }

    fn write_jpeg(&self, path: &Path) {
        let enc = jpeg_encoder::Encoder::new_file(path, 90).expect("create jpg");
        enc.encode(&self.px, self.w as u16, self.h as u16, jpeg_encoder::ColorType::Rgb).expect("encode jpg");
    }
}

struct Panel {
    label: String,
    /// The opening exposure, when it is a render.
    ev: Option<f32>,
    /// As shown: linear sRGB.
    pic: Picture,
    median: f32,
    white: f32,
    /// Oklab on the chroma grid, in the picture's own space (a P3
    /// preview's colours beyond sRGB included).
    lab: Vec<[f32; 3]>,
    /// Chroma against the sheet's preview (`previews::chroma_ratio`).
    chroma: Option<f32>,
}

const SHEET_WIDTH: usize = 2400;
const GAP: usize = 12;
const TEXT_SCALE: usize = 2;
const LINE: usize = 9 * TEXT_SCALE;

/// Every panel's numbers at one width, the smallest of them (a camera's
/// preview can be smaller than the render), and, when the first panel is
/// a preview, each render's chroma against it.
fn common_stats(panels: &mut [Panel]) {
    let w = panels.iter().map(|p| p.pic.w).min().unwrap();
    for p in panels.iter_mut() {
        (p.median, p.white) = if p.pic.w > w { stats(&p.pic.resample(w)) } else { stats(&p.pic) };
    }
    if panels[0].ev.is_none() {
        let preview = panels[0].lab.clone();
        for p in panels.iter_mut().skip(1) {
            p.chroma = Some(previews::chroma_ratio(&p.lab, &preview));
        }
    }
}

fn write_sheet(path: &Path, title: &str, panels: &[Panel]) {
    let n = panels.len();
    let pw = (SHEET_WIDTH - GAP * (n + 1)) / n;
    let small: Vec<Picture> = panels.iter().map(|p| p.pic.resample(pw)).collect();
    let ph = small.iter().map(|p| p.h).max().unwrap();
    let top = GAP + 2 * LINE + GAP;
    let lines = if panels.iter().any(|p| p.chroma.is_some()) { 5 } else { 4 };
    let h = top + ph + GAP + lines * LINE + GAP;
    let mut sheet = Sheet::new(SHEET_WIDTH, h, 24);
    sheet.text(GAP, GAP, title, TEXT_SCALE, [235, 235, 235]);
    for (i, (p, s)) in panels.iter().zip(&small).enumerate() {
        let x = GAP + i * (pw + GAP);
        sheet.picture(x, top, s);
        let y = top + ph + GAP;
        sheet.text(x, y, &p.label, TEXT_SCALE, [255, 255, 255]);
        let ev = p.ev.map(|e| format!("EV {e:+.2}")).unwrap_or_else(|| "(reference)".into());
        sheet.text(x, y + LINE, &ev, TEXT_SCALE, [190, 190, 190]);
        sheet.text(x, y + 2 * LINE, &format!("median {:.3}", p.median), TEXT_SCALE, [235, 235, 120]);
        sheet.text(x, y + 3 * LINE, &format!("white {:.2} %", p.white * 100.0), TEXT_SCALE, [235, 235, 120]);
        if let Some(c) = p.chroma {
            sheet.text(x, y + 4 * LINE, &format!("chroma x{c:.2} of preview"), TEXT_SCALE, [140, 220, 255]);
        }
    }
    sheet.write_jpeg(path);
}

fn render_panel(label: &str, prep: &PreparedRaw, settings: &RawDevelopSettings) -> Panel {
    let pic = develop(prep, settings, STATS_LONG_EDGE);
    let (median, white) = stats(&pic);
    let lab = previews::oklab_grid(&pic, Gamut::Srgb);
    Panel { label: label.into(), ev: Some(settings.exposure_ev), pic, median, white, lab, chroma: None }
}

fn preview_panel(label: &str, data: &[u8], prep: &PreparedRaw, width: usize) -> Option<Panel> {
    let (own, gamut) = previews::preview_with_gamut(data, prep)?;
    // Box-resampling only ever reduces (it leaves pixels empty going up).
    let own = if own.w > width { own.resample(width) } else { own };
    let lab = previews::oklab_grid(&own, gamut);
    // Shown and measured as sRGB, like the renders; a P3 preview converted.
    let pic = previews::to_srgb(&own, gamut);
    let (median, white) = stats(&pic);
    let label = if gamut == Gamut::DisplayP3 { format!("{label} (P3)") } else { label.to_string() };
    Some(Panel { label, ev: None, pic, median, white, lab, chroma: None })
}

/// The three curves as first compared: before the look had a saturation.
fn looks(preview_match: bool) -> Vec<(String, OpeningLook)> {
    let names = ["A gentle", "B medium", "C punchy"];
    CANDIDATES
        .iter()
        .zip(names)
        .map(|(c, n)| (format!("{n}{}", if preview_match { " +match" } else { "" }), OpeningLook { curve: OpeningCurve::Standard(*c), saturation: 1.0, dng_preview_exposure: preview_match }))
        .collect()
}

/// One row of the numbers table.
fn row(file: &str, case: &str, panels: &[Panel]) -> String {
    let cells: Vec<String> = panels.iter().map(|p| match p.ev {
        Some(ev) => format!("{ev:+.2} / {:.3} / {:.2} %{}", p.median, p.white * 100.0, p.chroma.map_or(String::new(), |c| format!(" / ×{c:.2}"))),
        None => format!("{:.3} / {:.2} %", p.median, p.white * 100.0),
    }).collect();
    format!("| {file} | {case} | {} |", cells.join(" | "))
}

/// The look DNG and ARW opened with before Standard: the neutral curve,
/// every DNG at its BaselineExposure.
fn before(data: &[u8]) -> PreparedRaw {
    raw::prepare_with(data, &OpeningLook::parse("neutral").unwrap()).unwrap()
}

/// A DNG or ARW: preview, before, A, B, C.
fn sheet_for(path: &Path, preview_label: &str, preview_match: bool, out: &Path, table: &mut Vec<String>) {
    let name = path.file_name().unwrap().to_string_lossy().to_string();
    let stem = name.rsplit_once('.').map_or(name.clone(), |(s, _)| s.to_string());
    let data = std::fs::read(path).unwrap();
    let today = before(&data);
    let mut panels = vec![render_panel("before (neutral)", &today, &today.description.develop_defaults)];
    let width = panels[0].pic.w;
    let preview = preview_panel(&format!("preview: {preview_label}"), &data, &today, width).expect("an embedded preview");
    panels.insert(0, preview);
    for (label, look) in looks(preview_match) {
        let prep = raw::prepare_with(&data, &look).unwrap();
        panels.push(render_panel(&label, &prep, &prep.description.develop_defaults));
    }
    let case = if preview_match { "preview match on" } else { "as opened" };
    let suffix = if preview_match { "-preview-match" } else { "" };
    common_stats(&mut panels);
    let title = format!("{name}: {case}. EV is the opening exposure, through each curve");
    write_sheet(&out.join(format!("{stem}{suffix}.jpg")), &title, &panels);
    table.push(row(&name, case, &panels));
    println!("{}", table.last().unwrap());
}

/// A RAF: preview, its film look, and A, B, C in place of the film curve.
fn raf_sheet(path: &Path, out: &Path, table: &mut Vec<String>) {
    let name = path.file_name().unwrap().to_string_lossy().to_string();
    let stem = name.trim_end_matches(".RAF").to_string();
    let data = std::fs::read(path).unwrap();
    let prep = raw::prepare(&data).unwrap();
    let film = &prep.description.develop_defaults;
    let film_name = prep.description.profiles.first().map_or("film look".to_string(), |p| p.name.clone());
    let mut panels = vec![render_panel(&format!("today: {film_name}"), &prep, film)];
    let width = panels[0].pic.w;
    panels.insert(0, preview_panel("preview: camera (Fujifilm)", &data, &prep, width).expect("an embedded JPEG"));
    for (label, look) in looks(false) {
        let settings = RawDevelopSettings { base_curve: Some(look.curve.lut()), saturation: 1.0, ..film.clone() };
        panels.push(render_panel(&format!("{label} (curve only)"), &prep, &settings));
    }
    common_stats(&mut panels);
    let title = format!("{name}: Standard in place of the film curve, saturation 1, its usual exposure. Not a default");
    write_sheet(&out.join(format!("{stem}-standard-as-profile.jpg")), &title, &panels);
    table.push(row(&name, "film look vs Standard as a profile", &panels));
    println!("{}", table.last().unwrap());
}

#[test]
fn contact_sheets_of_the_standard_candidates() {
    let Some(out) = env_dir("LOPSY_STANDARD_LOOK_DIR") else {
        println!("Set LOPSY_STANDARD_LOOK_DIR (and the sample variables) to write the Standard look contact sheets.");
        return;
    };
    let mut table = vec![
        "| File | Case | Preview median / white | Today EV / median / white | A | B | C |".to_string(),
        "|---|---|---|---|---|---|---|".to_string(),
    ];
    for f in ["ILCE-7M3_DSC0009.ARW", "ILCE-7M4_DSC06677_FullFrame-Raw-Compressed.ARW", "ILCE-6000_DSC01542.ARW", "DSC-RX100M3_DSC00734.ARW"] {
        if let Some(p) = sample("LOPSY_ARW_SAMPLES", f) {
            sheet_for(&p, "camera (Sony)", false, &out, &mut table);
        }
    }
    for f in ["sample_dng_00.dng", "sample_dng_01.dng"] {
        if let Some(p) = sample("LOPSY_DNG_SAMPLES", f) {
            sheet_for(&p, "Apple", false, &out, &mut table);
            sheet_for(&p, "Apple", true, &out, &mut table);
        }
    }
    for f in ["5D3-adobe-lossless.dng", "5D3-adobe-lossless-rgb.dng"] {
        if let Some(p) = sample("LOPSY_DNG_ADOBE_SAMPLES", f) {
            sheet_for(&p, "Adobe converter", false, &out, &mut table);
        }
    }
    for f in ["DSCF8005.RAF", "DSCF7912.RAF"] {
        if let Some(p) = sample("LOPSY_RAF_SAMPLES", f) {
            raf_sheet(&p, &out, &mut table);
        }
    }
    std::fs::write(out.join("numbers.md"), table.join("\n") + "\n").unwrap();
}

/// The Standard look at saturation `s`, as a DNG or ARW opens with it.
fn standard_at(s: f32) -> OpeningLook {
    OpeningLook { saturation: s, ..OpeningLook::default() }
}

/// The saturation levels the sheets show beside the delivered A (1.00).
const LEVELS: [f32; 3] = [1.10, lopsy_core::raw::STANDARD_SATURATION, 1.25];

fn level_label(s: f32) -> String {
    let chosen = if s == lopsy_core::raw::STANDARD_SATURATION { " (chosen)" } else { "" };
    format!("Standard sat {s:.2}{chosen}")
}

/// A DNG or ARW: preview | A as delivered (saturation 1) | the Standard
/// look at each of [`LEVELS`].
fn saturation_sheet(path: &Path, preview_label: &str, out: &Path, table: &mut Vec<String>) {
    let name = path.file_name().unwrap().to_string_lossy().to_string();
    let stem = name.rsplit_once('.').map_or(name.clone(), |(s, _)| s.to_string());
    let data = std::fs::read(path).unwrap();
    let delivered = raw::prepare_with(&data, &standard_at(1.0)).unwrap();
    let mut panels = vec![render_panel("A as delivered (sat 1.00)", &delivered, &delivered.description.develop_defaults)];
    let width = panels[0].pic.w;
    panels.insert(0, preview_panel(&format!("preview: {preview_label}"), &data, &delivered, width).expect("an embedded preview"));
    for s in LEVELS {
        let prep = raw::prepare_with(&data, &standard_at(s)).unwrap();
        panels.push(render_panel(&level_label(s), &prep, &prep.description.develop_defaults));
    }
    common_stats(&mut panels);
    let title = format!("{name}: Standard look by saturation. EV is the opening exposure. Chroma is Oklab, 48-cell grid, against the preview");
    write_sheet(&out.join(format!("{stem}-saturation.jpg")), &title, &panels);
    table.push(row(&name, "Standard by saturation", &panels));
    println!("{}", table.last().unwrap());
}

/// A RAF: preview | its film look | Standard as a profile (curve and
/// saturation in place of the film's, its usual exposure) at 1.00 and two
/// of [`LEVELS`].
fn raf_saturation_sheet(path: &Path, out: &Path, table: &mut Vec<String>) {
    let name = path.file_name().unwrap().to_string_lossy().to_string();
    let stem = name.trim_end_matches(".RAF").to_string();
    let data = std::fs::read(path).unwrap();
    let prep = raw::prepare(&data).unwrap();
    let film = &prep.description.develop_defaults;
    let film_name = prep.description.profiles.first().map_or("film look".to_string(), |p| p.name.clone());
    let mut panels = vec![render_panel(&format!("today: {film_name}"), &prep, film)];
    let width = panels[0].pic.w;
    panels.insert(0, preview_panel("preview: camera (Fujifilm)", &data, &prep, width).expect("an embedded JPEG"));
    let curve = OpeningLook::default().curve.lut();
    for s in [1.0, LEVELS[1], LEVELS[2]] {
        let settings = RawDevelopSettings { base_curve: Some(curve.clone()), saturation: s, ..film.clone() };
        panels.push(render_panel(&format!("Standard sat {s:.2} (profile)"), &prep, &settings));
    }
    common_stats(&mut panels);
    let title = format!("{name}: Standard as a profile by saturation, its usual exposure. A picture only: RAF defaults are the film look");
    write_sheet(&out.join(format!("{stem}-saturation.jpg")), &title, &panels);
    table.push(row(&name, "film look vs Standard as a profile", &panels));
    println!("{}", table.last().unwrap());
}

/// The saturation sheets (`<stem>-saturation.jpg`) and their table
/// (`numbers-saturation.md`), when `LOPSY_STANDARD_LOOK_DIR` is set.
#[test]
fn contact_sheets_of_the_standard_saturation() {
    let Some(out) = env_dir("LOPSY_STANDARD_LOOK_DIR") else {
        println!("Set LOPSY_STANDARD_LOOK_DIR (and the sample variables) to write the saturation contact sheets.");
        return;
    };
    let mut table = vec![
        "| File | Case | Preview median / white | A as delivered: EV / median / white / chroma | 2nd | 3rd | 4th |".to_string(),
        "|---|---|---|---|---|---|---|".to_string(),
    ];
    for f in ["ILCE-7M3_DSC0009.ARW", "ILCE-7M4_DSC06677_FullFrame-Raw-Compressed.ARW", "ILCE-6000_DSC01542.ARW", "DSC-RX100M3_DSC00734.ARW"] {
        if let Some(p) = sample("LOPSY_ARW_SAMPLES", f) {
            saturation_sheet(&p, "camera (Sony)", &out, &mut table);
        }
    }
    for f in ["sample_dng_00.dng", "sample_dng_01.dng"] {
        if let Some(p) = sample("LOPSY_DNG_SAMPLES", f) {
            saturation_sheet(&p, "Apple", &out, &mut table);
        }
    }
    for f in ["5D3-adobe-lossless.dng", "5D3-adobe-lossless-rgb.dng"] {
        if let Some(p) = sample("LOPSY_DNG_ADOBE_SAMPLES", f) {
            saturation_sheet(&p, "Adobe converter", &out, &mut table);
        }
    }
    for f in ["DSCF8005.RAF", "DSCF7912.RAF"] {
        if let Some(p) = sample("LOPSY_RAF_SAMPLES", f) {
            raf_saturation_sheet(&p, &out, &mut table);
        }
    }
    std::fs::write(out.join("numbers-saturation.md"), table.join("\n") + "\n").unwrap();
}

// ── Checks ───────────────────────────────────────────────────────────

fn files(var: &str, ext: &str) -> Vec<PathBuf> {
    let Some(dir) = env_dir(var) else { return Vec::new() };
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir).unwrap().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case(ext))).collect();
    v.sort();
    v
}

/// The median the exposure match measures: the develop chain on the
/// binned view at the preview's size, against the preview's own median.
fn matched_median(data: &[u8], prep: &PreparedRaw, preview: &lopsy_core::arw::exposure::Preview) -> f32 {
    let view = match &prep.prepared {
        Prepared::Arw(p) => lopsy_core::arw::exposure::preview_sized_view(&p.plane, &p.params, preview),
        Prepared::Dng(p) => lopsy_core::arw::exposure::preview_sized_view(&p.plane, &p.params, preview),
        Prepared::Raf(_) => None,
    };
    let (w, h, rgba) = view.unwrap_or_else(|| panic!("a view of {} bytes", data.len()));
    let (m, _) = stats(&develop_rgba(&rgba, w as u32, h as u32, &prep.description.develop_defaults));
    m
}

/// Each candidate opens an ARW at the camera preview's brightness after
/// its own curve (not before it, which would count a midtone lift twice),
/// and every profile opens with that exposure and curve.
#[test]
fn every_candidate_opens_an_arw_at_the_cameras_brightness_through_its_curve() {
    for path in files("LOPSY_ARW_SAMPLES", "arw") {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let data = std::fs::read(&path).unwrap();
        let today = before(&data);
        let (w, h) = (today.description.width, today.description.height);
        let Some(preview) = lopsy_core::arw::exposure::whole_picture_preview(&data, f64::from(w) / f64::from(h)) else { continue };
        for (label, look) in looks(false) {
            let prep = raw::prepare_with(&data, &look).unwrap();
            let ev = prep.description.develop_defaults.exposure_ev;
            let m = matched_median(&data, &prep, &preview);
            println!("{name} {label}: {ev:+.3} EV (today {:+.3}), median {m:.3} against {:.3}", today.description.develop_defaults.exposure_ev, preview.median);
            assert!((m - preview.median).abs() < 0.01 || ev == lopsy_core::arw::exposure::MIN_EV || ev == lopsy_core::arw::exposure::MAX_EV, "{name} {label}: {m} against {}", preview.median);
            assert!(prep.description.profiles.iter().all(|p| p.settings.exposure_ev == ev));
            let ids: Vec<&str> = prep.description.profiles.iter().map(|p| p.id.as_str()).collect();
            assert_eq!(ids, ["camera", "neutral", "monochrome"], "{name}");
            let curve = |id: &str| prep.description.profiles.iter().find(|p| p.id == id).unwrap().settings.base_curve.clone();
            assert_eq!(curve("camera"), Some(look.curve.lut()));
            assert_eq!(curve("monochrome"), Some(look.curve.lut()));
            assert_eq!(curve("neutral"), Some(OpeningCurve::Neutral.lut()));
        }
    }
}

/// With the preview match, a ProRAW (a gain map, a camera-made preview)
/// opens at the preview's brightness within the bounds around its
/// baseline; an Adobe-converted DNG keeps its baseline; and without the
/// match every DNG keeps its baseline.
#[test]
fn the_dng_preview_match_takes_only_camera_previews_of_gain_mapped_files() {
    use lopsy_core::dng::preview::{camera_preview_for_exposure, MAX_ABOVE_BASELINE, MIN_BELOW_BASELINE};
    let mut paths = files("LOPSY_DNG_SAMPLES", "dng");
    paths.extend(files("LOPSY_DNG_ADOBE_SAMPLES", "dng"));
    for path in paths {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let data = std::fs::read(&path).unwrap();
        let Ok(today) = raw::prepare_with(&data, &OpeningLook::parse("neutral").unwrap()) else { continue };
        let Prepared::Dng(p) = &today.prepared else { continue };
        let baseline = p.params.calibration.baseline_exposure as f32;
        assert_eq!(today.description.develop_defaults.exposure_ev, baseline, "{name}");
        let (w, h) = (today.description.width, today.description.height);
        let preview = camera_preview_for_exposure(&data, f64::from(w) / f64::from(h));
        let converted = lopsy_core::dng::preview::written_by_a_converter(&data);
        assert!(!(converted && preview.is_some()), "{name}: a converter's preview is not the camera's");
        for (label, look) in looks(true) {
            let prep = raw::prepare_with(&data, &look).unwrap();
            let ev = prep.description.develop_defaults.exposure_ev;
            match &preview {
                Some(pv) => {
                    assert!((baseline - MIN_BELOW_BASELINE..=baseline + MAX_ABOVE_BASELINE).contains(&ev), "{name} {label}: {ev}");
                    let m = matched_median(&data, &prep, pv);
                    println!("{name} {label}: {ev:+.3} EV (baseline {baseline:+.3}), median {m:.3} against {:.3}", pv.median);
                    let at_bound = ev == baseline - MIN_BELOW_BASELINE || ev == baseline + MAX_ABOVE_BASELINE;
                    assert!((m - pv.median).abs() < 0.01 || at_bound, "{name} {label}: {m} against {}", pv.median);
                }
                None => {
                    println!("{name} {label}: no camera preview to match (converter {converted}), baseline {baseline:+.3}");
                    assert_eq!(ev, baseline, "{name} {label}");
                }
            }
        }
    }
}
