//! `ProfileGainTableMap` on the two real ProRAW samples (`dng::gain_map`):
//! the parsed table's shape, the map's place under bands and binning, and
//! what it does to the opening picture against the camera's own preview.
//! Needs `LOPSY_DNG_SAMPLES` (a folder holding `sample_dng_00.dng`, a rose
//! in daylight, and `sample_dng_01.dng`, a dark concert); without it each
//! test notes that and passes. `--release`.
//!
//! With `LOPSY_GAIN_MAP_DIR` set, a contact sheet of each sample is written
//! there (`<stem>-gain-map.jpg`: preview | before | after, the numbers
//! burned in) with the table (`numbers.md`); with `LOPSY_GAIN_MAP_EXPOSURES`
//! also set, the exposure candidates are measured and printed.
//!
//! Every render is the develop chain's CPU references on the binned view
//! (the RAW step at the develop defaults, scene tone at 0, the tone step,
//! the SDR output step for sRGB), as `standard_look.rs` renders. "Before"
//! is what a ProRAW opened with before the map: the plane without it, the
//! Standard look, the exposure matched to the preview within ±3 stops of
//! the baseline. "After" is the RAW interface's prepare as it stands.
//!
//! The numbers, each against the preview (Display P3 on these files, read
//! in its own colour): the median of encoded Rec. 709 luminance and the
//! share of pixels with any channel at 255, both at the narrower picture's
//! width; and Oklab chroma, Σ C ours / Σ C preview over a 48-cell-wide grid
//! where the preview's C ≥ 0.03, overall and by the preview's lightness
//! (L < 0.45, 0.45–0.70, ≥ 0.70).

use std::path::{Path, PathBuf};

use lopsy_core::dng::linear::{self, DngPrepared, PrepareOptions};
use lopsy_core::output::{output_reference, OutputSettings, OutputTarget};
use lopsy_core::raf::develop::{scene_reference, tone_settings, RawDevelopSettings};
use lopsy_core::raf::RafBand;
use lopsy_core::raw::{self, OpeningLook, Prepared, PreparedRaw};
use lopsy_core::working_space::{srgb_encode, Gamut};

#[path = "support/raw_compare.rs"]
mod raw_compare;
#[path = "support/previews.rs"]
mod previews;
#[path = "support/sheet.rs"]
mod sheet;
use raw_compare::Picture;
use sheet::Sheet;

const LONG_EDGE: u32 = 2000;
const ROSE: &str = "sample_dng_00.dng";
const CONCERT: &str = "sample_dng_01.dng";

fn sample(name: &str) -> Option<(PathBuf, Vec<u8>)> {
    let dir = std::env::var_os("LOPSY_DNG_SAMPLES").map(PathBuf::from)?;
    let path = dir.join(name);
    let data = std::fs::read(&path).ok()?;
    Some((path, data))
}

fn skip(what: &str) {
    eprintln!("LOPSY_DNG_SAMPLES is not set or lacks the ProRAW samples: skipping {what}");
}

/// The `ProfileGainTableMap` value of a file, from IFD0 or a SubIFD, and
/// whether the file is big-endian.
fn map_bytes(data: &[u8]) -> Option<(Vec<u8>, bool)> {
    use lopsy_core::dng::tiff::TiffReader;
    let reader = TiffReader::new(data).ok()?;
    let ifd0 = reader.read_ifd(0).ok()?;
    let subs: Vec<u32> = ifd0.iter().find(|e| e.tag == 0x14a).and_then(|e| e.as_u32_vec()).unwrap_or_default();
    let mut ifds = vec![ifd0];
    ifds.extend(subs.iter().filter_map(|&o| reader.read_ifd_at(o).ok()));
    let entry = ifds.iter().flatten().find(|e| e.tag == 52525)?;
    Some((entry.raw_bytes.clone(), !reader.is_little_endian()))
}

/// Both samples carry the first form of the map, as the specification
/// lays it out, and these are its numbers.
#[test]
fn the_prorav_maps_parse_to_the_tables_the_files_hold() {
    let mut seen = 0;
    for (name, origin, spacing) in [(ROSE, (0.228_492, 0.211_748), (0.011_839, 0.009_304)), (CONCERT, (0.010_251, -0.015_625), (0.020_833, 0.016_369))] {
        let Some((_, data)) = sample(name) else { continue };
        let (raw, big) = map_bytes(&data).expect("a ProfileGainTableMap");
        assert!(big, "{name}: both samples are big-endian files");
        assert_eq!(raw.len(), 64 + 4 * 48 * 64 * 257, "{name}");
        let m = lopsy_core::dng::gain_map::parse(&raw, big).unwrap();
        assert_eq!((m.points_v, m.points_h, m.points_n), (48, 64, 257), "{name}");
        let close = |a: f64, b: f64| (a - b).abs() < 1e-5;
        assert!(close(m.origin_v, origin.0) && close(m.origin_h, origin.1), "{name}: origin {} {}", m.origin_v, m.origin_h);
        assert!(close(m.spacing_v, spacing.0) && close(m.spacing_h, spacing.1), "{name}: spacing {} {}", m.spacing_v, m.spacing_h);
        // The weights: small positive R, G, B and max, none on min; they
        // sum to the tables' last gain (0.067), so an input of 1 is a RIMM
        // value near 15 and the map brings it to about 1.
        let w = m.weights;
        assert_eq!(w[3], 0.0, "{name}");
        assert!(w.iter().all(|&x| x >= 0.0) && (w.iter().sum::<f32>() - 0.067).abs() < 0.002, "{name}: {w:?}");
        let (lo, hi) = m.gains.iter().fold((f32::INFINITY, 0.0f32), |(a, b), &g| (a.min(g), b.max(g)));
        assert!(lo > 0.06 && lo < 0.07 && hi > 2.9 && hi < 3.3, "{name}: gains {lo}..{hi}");
        // Every table lifts its darkest input (a gain above 1) and holds
        // its brightest back (about 1/15).
        for t in m.gains.chunks_exact(257) {
            assert!(t[0] > 1.0 && t[256] < 0.07, "{name}");
        }
        seen += 1;
    }
    if seen == 0 {
        skip("the gain map shapes");
    }
}

/// The map is applied to the prepared plane, so a band is the same rows
/// of the whole frame bit for bit, the binned view is the block mean of
/// the full render (to float rounding), and the description no longer
/// lists the map as not applied.
#[test]
fn the_map_is_the_same_under_bands_binning_and_orientation() {
    let mut seen = 0;
    for name in [ROSE, CONCERT] {
        let Some((_, data)) = sample(name) else { continue };
        let t = std::time::Instant::now();
        let prep = linear::prepare_dng(&data).unwrap();
        let with = t.elapsed();
        let t = std::time::Instant::now();
        let _ = linear::prepare_dng_with(&data, PrepareOptions { apply_gain_table_map: false }).unwrap();
        eprintln!("{name}: prepare {with:.2?} with the map, {:.2?} without", t.elapsed());
        assert!(!prep.unhandled.iter().any(|u| u.starts_with("ProfileGainTableMap")), "{name}: {:?}", prep.unhandled);
        let without = linear::prepare_dng_with(&data, PrepareOptions { apply_gain_table_map: false }).unwrap();
        assert!(without.unhandled.iter().any(|u| u == "ProfileGainTableMap (local tone map)"));
        assert_ne!(prep.plane, without.plane, "{name}: the map changed nothing");
        let p = &prep.params;
        let row = p.width as usize * 3;
        let h = p.height;
        let whole = linear::render_linear_band(&prep.plane, p, RafBand { y0: 0, y1: h, src_y0: 0, src_y1: h }).unwrap();
        for band in lopsy_core::raf::plan_bands(h, 7) {
            let src = &prep.plane[band.src_y0 as usize * row..band.src_y1 as usize * row];
            let px = linear::render_linear_band(src, p, band).unwrap();
            for y in 0..px.height {
                let dst = (((px.y + y) * whole.width + px.x) * 4) as usize;
                let s = (y * px.width * 4) as usize;
                let n = (px.width * 4) as usize;
                assert!(whole.pixels[dst..dst + n].iter().zip(&px.pixels[s..s + n]).all(|(a, b)| a.to_bits() == b.to_bits()), "{name}: band {band:?}");
            }
        }
        // The binned view at factor 4 against 4 × 4 means of the full,
        // oriented render.
        let f = 4u32;
        let (bw, bh, binned) = linear::render_binned_linear(&prep.plane, p, f).unwrap();
        assert_eq!((bw, bh), (whole.width / f, whole.height / f));
        let mut worst = 0f32;
        for by in 0..bh {
            for bx in 0..bw {
                for c in 0..3 {
                    let mut sum = 0f64;
                    for dy in 0..f {
                        for dx in 0..f {
                            sum += f64::from(whole.pixels[(((by * f + dy) * whole.width + bx * f + dx) * 4) as usize + c]);
                        }
                    }
                    let mean = (sum / f64::from(f * f)) as f32;
                    let b = binned[((by * bw + bx) * 4) as usize + c];
                    worst = worst.max((b - mean).abs() / mean.abs().max(1e-3));
                }
            }
        }
        assert!(worst < 1e-4, "{name}: binned and full disagree by {worst} relative");
        seen += 1;
    }
    if seen == 0 {
        skip("the band and binning checks");
    }
}

// ── Measuring against the preview ───────────────────────────────────

/// Median encoded luminance and the share of pixels with any channel at
/// 255, of a picture in linear `gamut` (encoded with the sRGB curve, which
/// Display P3 shares): a preview is measured in its own colour, so a P3
/// blue the sRGB conversion would clip does not count as white.
fn stats(p: &Picture, gamut: Gamut) -> (f32, f32) {
    let enc = |v: f32| srgb_encode(v.clamp(0.0, 1.0));
    let y = lopsy_core::working_space::luma(gamut);
    let mut lum: Vec<f32> = p.rgb.chunks_exact(3).map(|c| enc(y[0] * c[0] + y[1] * c[1] + y[2] * c[2])).collect();
    let white = p.rgb.chunks_exact(3).filter(|c| c.iter().any(|&v| enc(v) * 255.0 + 0.5 >= 255.0)).count() as f32 / lum.len() as f32;
    let mid = lum.len() / 2;
    let (_, m, _) = lum.select_nth_unstable_by(mid, f32::total_cmp);
    (*m, white)
}

fn develop_rgba(binned: &[f32], w: u32, h: u32, settings: &RawDevelopSettings) -> Picture {
    let scene = scene_reference(binned, settings);
    let toned = lopsy_core::scene_tone::scene_tone_reference(&scene, w as usize, h as usize, &Default::default(), &[], &[]);
    let rendered = lopsy_core::tone::tone_reference(&toned, &tone_settings(settings));
    let out = output_reference(&rendered, w, &OutputSettings::sdr(OutputTarget::Srgb, Gamut::Rec2020, false));
    Picture::from_rgba_encoded(w, h, &out)
}

struct Panel {
    label: String,
    /// The opening exposure; `None` for the preview.
    ev: Option<f32>,
    /// As shown: linear sRGB.
    pic: Picture,
    /// As measured: linear, in `gamut` (the preview's own colour).
    own: Picture,
    gamut: Gamut,
    lab: Vec<[f32; 3]>,
    median: f32,
    white: f32,
    /// Overall, then by the preview's lightness band.
    chroma: Option<[Option<f32>; 4]>,
}

fn render_panel(label: &str, plane: &[f32], params: &linear::DngRenderParams, settings: &RawDevelopSettings) -> Panel {
    let (w, h, binned) = linear::render_binned_linear_for(plane, params, LONG_EDGE).unwrap();
    let pic = develop_rgba(&binned, w, h, settings);
    let lab = previews::oklab_grid(&pic, Gamut::Srgb);
    let own = Picture { w: pic.w, h: pic.h, rgb: pic.rgb.clone() };
    Panel { label: label.into(), ev: Some(settings.exposure_ev), pic, own, gamut: Gamut::Srgb, lab, median: 0.0, white: 0.0, chroma: None }
}

/// The preview in its own colour (measured) and as sRGB (shown).
fn preview_panel(data: &[u8], prep: &PreparedRaw) -> Panel {
    let (own, gamut) = previews::preview_with_gamut(data, prep).expect("an embedded preview");
    let own = if own.w > 2016 { own.resample(2016) } else { own };
    let lab = previews::oklab_grid(&own, gamut);
    let pic = previews::to_srgb(&own, gamut);
    let label = if gamut == Gamut::DisplayP3 { "preview: Apple (P3)" } else { "preview: Apple" };
    Panel { label: label.into(), ev: None, pic, own, gamut, lab, median: 0.0, white: 0.0, chroma: None }
}

/// Σ C ours / Σ C preview over the chromatic cells, overall and by the
/// preview's lightness; a band with fewer than 8 such cells is `None`.
fn chroma_bands(ours: &[[f32; 3]], preview: &[[f32; 3]]) -> [Option<f32>; 4] {
    let c = |l: &[f32; 3]| l[1].hypot(l[2]);
    let ratio = |lo: f32, hi: f32| {
        let (mut a, mut b, mut k) = (0f64, 0f64, 0);
        for (o, p) in ours.iter().zip(preview) {
            if c(p) >= 0.03 && p[0] >= lo && p[0] < hi {
                a += f64::from(c(o));
                b += f64::from(c(p));
                k += 1;
            }
        }
        (k >= 8).then(|| (a / b) as f32)
    };
    [ratio(0.0, 9.0), ratio(0.0, 0.45), ratio(0.45, 0.70), ratio(0.70, 9.0)]
}

/// Each panel's numbers at the narrowest panel's width, and each render's
/// chroma against the preview (the first panel).
fn measure(panels: &mut [Panel]) {
    let w = panels.iter().map(|p| p.own.w).min().unwrap();
    for p in panels.iter_mut() {
        (p.median, p.white) = if p.own.w > w { stats(&p.own.resample(w), p.gamut) } else { stats(&p.own, p.gamut) };
    }
    let preview = panels[0].lab.clone();
    for p in panels.iter_mut().skip(1) {
        p.chroma = Some(chroma_bands(&p.lab, &preview));
    }
}

fn fmt(o: Option<f32>) -> String {
    o.map_or("–".into(), |v| format!("{v:.2}"))
}

fn row(file: &str, p: &Panel) -> String {
    let ev = p.ev.map_or("–".into(), |e| format!("{e:+.2}"));
    let c = p.chroma.unwrap_or([None; 4]);
    format!("| {file} | {} | {ev} | {:.3} | {:.2} % | {} | {} | {} | {} |", p.label, p.median, p.white * 100.0, fmt(c[0]), fmt(c[1]), fmt(c[2]), fmt(c[3]))
}

const TABLE_HEAD: [&str; 2] = [
    "| File | Picture | EV | Median | At white | Chroma | L < 0.45 | 0.45–0.70 | ≥ 0.70 |",
    "|---|---|---|---|---|---|---|---|---|",
];

/// The plane without the map, as before it was applied.
fn without_map(data: &[u8]) -> DngPrepared {
    linear::prepare_dng_with(data, PrepareOptions { apply_gain_table_map: false }).unwrap()
}

/// What a ProRAW opened with before the map: no map, the Standard look,
/// the exposure matched to the preview within ±3 stops.
fn before_panel(data: &[u8]) -> Panel {
    let mut prep = without_map(data);
    let look = OpeningLook::default();
    let settings = linear::develop_defaults_with(&prep.params, &look).unwrap();
    let ev = lopsy_core::dng::preview::matched_exposure(data, &prep.params, &prep.plane, &settings, (3.0, 3.0)).expect("a camera preview");
    prep.params.default_exposure_ev = Some(ev);
    let settings = linear::develop_defaults_with(&prep.params, &look).unwrap();
    render_panel("before: no map, preview match", &prep.plane, &prep.params, &settings)
}

/// The RAW interface's prepare as Photonamous opens the file.
fn after_panel(prep: &PreparedRaw, label: &str) -> Panel {
    let Prepared::Dng(p) = &prep.prepared else { panic!("not a DNG") };
    render_panel(label, &p.plane, &p.params, &prep.description.develop_defaults)
}

/// The Standard entry of a camera-curve file's profiles, as develop
/// settings: the map with the Standard curve, matched to the preview.
fn standard_profile_settings(prep: &PreparedRaw) -> RawDevelopSettings {
    let d = &prep.description.develop_defaults;
    let s = &prep.description.profiles.iter().find(|p| p.id == "standard").expect("a Standard entry").settings;
    RawDevelopSettings { cam_to_rgb: s.cam_to_rgb, exposure_ev: s.exposure_ev, saturation: s.saturation, highlight_desaturation: s.highlight_desaturation, base_curve: s.base_curve.clone(), ..d.clone() }
}

fn panels_for(data: &[u8]) -> (PreparedRaw, Vec<Panel>) {
    let prep = raw::prepare(data).unwrap();
    let Prepared::Dng(p) = &prep.prepared else { panic!("not a DNG") };
    let standard = render_panel("map, Standard, preview match", &p.plane, &p.params, &standard_profile_settings(&prep));
    let mut panels = vec![preview_panel(data, &prep), before_panel(data), standard, after_panel(&prep, "map, file curve (default)")];
    measure(&mut panels);
    (prep, panels)
}

fn write_sheet(path: &Path, title: &str, panels: &[Panel]) {
    const W: usize = 2400;
    const GAP: usize = 12;
    const SCALE: usize = 2;
    const LINE: usize = 9 * SCALE;
    let n = panels.len();
    let pw = (W - GAP * (n + 1)) / n;
    let small: Vec<Picture> = panels.iter().map(|p| p.pic.resample(pw)).collect();
    let ph = small.iter().map(|p| p.h).max().unwrap();
    let top = GAP + 2 * LINE + GAP;
    let h = top + ph + GAP + 6 * LINE + GAP;
    let mut sheet = Sheet::new(W, h, 24);
    sheet.text(GAP, GAP, title, SCALE, [235, 235, 235]);
    for (i, (p, s)) in panels.iter().zip(&small).enumerate() {
        let x = GAP + i * (pw + GAP);
        sheet.picture(x, top, s);
        let y = top + ph + GAP;
        sheet.text(x, y, &p.label, SCALE, [255, 255, 255]);
        sheet.text(x, y + LINE, &p.ev.map_or("(reference)".into(), |e| format!("EV {e:+.2}")), SCALE, [190, 190, 190]);
        sheet.text(x, y + 2 * LINE, &format!("median {:.3}", p.median), SCALE, [235, 235, 120]);
        sheet.text(x, y + 3 * LINE, &format!("white {:.2} %", p.white * 100.0), SCALE, [235, 235, 120]);
        if let Some(c) = p.chroma {
            sheet.text(x, y + 4 * LINE, &format!("chroma x{} of preview", fmt(c[0])), SCALE, [140, 220, 255]);
            sheet.text(x, y + 5 * LINE, &format!("by L: {} / {} / {}", fmt(c[1]), fmt(c[2]), fmt(c[3])), SCALE, [140, 220, 255]);
        }
    }
    sheet.write_jpeg(path);
}

/// The default for these files is the pair the format describes: the map
/// and the file's own `ProfileToneCurve`, at the BaselineExposure and the
/// Standard saturation, with no preview match. Measured against the
/// camera's previews (median, share at white, chroma):
/// - rose: 0.427 against 0.440, 0.43 % against 0.09 %, chroma 0.92 (before
///   the map 0.440, 0.13 %, 0.98);
/// - concert: 0.229 against 0.167 (half a stop brighter), 1.74 % against
///   0.27 %, chroma 0.89 (before the map 0.161, 13.8 %, 0.75).
///
/// The map with the Standard curve matched to the preview (the Standard
/// entry) has the exact median but chroma 0.94 and 0.71: flat, and the
/// concert hazy. (The rose's overall chroma is the one figure where the
/// Standard entry is nearer, 0.94 against 0.92; by lightness the file's
/// curve is nearer in its bright petals, 0.99 against 0.91.)
/// The bounds below are those numbers with a little room. With
/// `LOPSY_GAIN_MAP_DIR`, the sheets.
#[test]
fn the_map_and_the_files_curve_open_near_the_preview() {
    let out = std::env::var_os("LOPSY_GAIN_MAP_DIR").map(PathBuf::from).filter(|p| p.is_dir());
    let mut table: Vec<String> = TABLE_HEAD.iter().map(|s| s.to_string()).collect();
    let mut seen = 0;
    for name in [ROSE, CONCERT] {
        let Some((_, data)) = sample(name) else { continue };
        let (prep, panels) = panels_for(&data);
        for p in &panels {
            table.push(row(name, p));
            println!("{}", table.last().unwrap());
        }
        let (preview, before, standard, after) = (&panels[0], &panels[1], &panels[2], &panels[3]);
        let Prepared::Dng(p) = &prep.prepared else { unreachable!() };
        assert_eq!(after.ev, Some(p.params.calibration.baseline_exposure as f32), "{name}: opens at the BaselineExposure");
        assert!((standard.median - preview.median).abs() < 0.015, "{name}: the Standard entry's median {} against {}", standard.median, preview.median);
        let chroma = |p: &Panel| p.chroma.unwrap()[0].unwrap();
        assert!(chroma(after) > 0.85 && chroma(after) < 1.0, "{name}: chroma {}", chroma(after));
        // The concert's blues come back; the rose's overall chroma is a
        // little under the Standard entry's (0.92 against 0.94) while its
        // bright petals are nearer the preview (0.99 against 0.91).
        let near = if name == CONCERT { chroma(after) > chroma(standard) + 0.1 } else { chroma(after) > chroma(standard) - 0.03 };
        assert!(near, "{name}: chroma {} against the Standard entry's {}", chroma(after), chroma(standard));
        if name == CONCERT {
            assert!((after.median - preview.median).abs() < 0.08, "{name}: median {} against {}", after.median, preview.median);
            assert!(before.white > 0.10 && after.white < 0.025, "{name}: {} at white (before {})", after.white, before.white);
        } else {
            assert!((after.median - preview.median).abs() < 0.03, "{name}: median {} against {}", after.median, preview.median);
            assert!(after.white < 0.006, "{name}: {} at white", after.white);
        }
        if let Some(dir) = &out {
            let stem = name.trim_end_matches(".dng");
            let title = format!("{name}: preview | before (no map) | map, Standard, preview match | map, file curve (the default)");
            write_sheet(&dir.join(format!("{stem}-gain-map.jpg")), &title, &panels);
        }
        seen += 1;
    }
    if seen == 0 {
        skip("the comparison with the previews");
        return;
    }
    if let Some(dir) = &out {
        std::fs::write(dir.join("numbers.md"), table.join("\n") + "\n").unwrap();
    }
}

/// The file's `ProfileToneCurve` (IFD0) as a 1024-entry table over 0..1,
/// linearly interpolated between its points (the specification asks for a
/// cubic spline; the points are dense enough for a measurement).
fn profile_tone_curve(data: &[u8]) -> Vec<f32> {
    use lopsy_core::dng::tiff::TiffReader;
    let reader = TiffReader::new(data).unwrap();
    let ifd0 = reader.read_ifd(0).unwrap();
    let v = ifd0.iter().find(|e| e.tag == 50940).map(|e| e.as_rational_vec()).unwrap_or_default();
    let pts: Vec<(f64, f64)> = v.chunks_exact(2).map(|p| (p[0], p[1])).collect();
    assert!(pts.len() >= 2, "no ProfileToneCurve");
    (0..1024)
        .map(|i| {
            let x = i as f64 / 1023.0;
            let k = pts.windows(2).position(|w| x <= w[1].0).unwrap_or(pts.len() - 2);
            let ((x0, y0), (x1, y1)) = (pts[k], pts[k + 1]);
            (y0 + (y1 - y0) * if x1 > x0 { (x - x0) / (x1 - x0) } else { 0.0 }) as f32
        })
        .collect()
}

/// An experiment, printed only with `LOPSY_GAIN_MAP_EXPOSURES` set: with the
/// map applied, the opening exposure at the baseline, matched to the
/// preview within ±3 stops, and matched within smaller bounds.
#[test]
fn exposure_candidates_with_the_map() {
    if std::env::var_os("LOPSY_GAIN_MAP_EXPOSURES").is_none() {
        return;
    }
    let mut table: Vec<String> = TABLE_HEAD.iter().map(|s| s.to_string()).collect();
    for name in [ROSE, CONCERT] {
        let Some((_, data)) = sample(name) else { continue };
        let opened = raw::prepare(&data).unwrap();
        let mut panels = vec![preview_panel(&data, &opened), before_panel(&data)];
        let prep = linear::prepare_dng(&data).unwrap();
        let look = OpeningLook::default();
        // The Standard look on the mapped plane (the defaults would be the
        // file's own curve).
        let base = RawDevelopSettings { base_curve: Some(look.curve.lut()), saturation: look.saturation, ..linear::develop_defaults_with(&prep.params, &look).unwrap() };
        let mut at = |label: &str, ev: f32| {
            let s = RawDevelopSettings { exposure_ev: ev, ..base.clone() };
            panels.push(render_panel(label, &prep.plane, &prep.params, &s));
        };
        at("map, baseline", base.exposure_ev);
        for bound in [3.0f32, 1.0, 0.5] {
            let ev = lopsy_core::dng::preview::matched_exposure(&data, &prep.params, &prep.plane, &base, (bound, bound)).unwrap();
            at(&format!("map, match +-{bound}"), ev);
        }
        // Not the Standard look: the file's own ProfileToneCurve (the
        // curve the specification pairs the map with), and the neutral
        // curve, at the baseline.
        let curve = profile_tone_curve(&data);
        for (label, lut, sat) in [("map, file curve", curve.clone(), 1.0), ("map, file curve, sat", curve.clone(), look.saturation), ("map, neutral curve", OpeningLook::parse("neutral").unwrap().curve.lut(), 1.0)] {
            let s = RawDevelopSettings { base_curve: Some(lut), saturation: sat, ..base.clone() };
            panels.push(render_panel(label, &prep.plane, &prep.params, &s));
        }
        let s = RawDevelopSettings { base_curve: Some(curve), saturation: look.saturation, ..base.clone() };
        let ev = lopsy_core::dng::preview::matched_exposure(&data, &prep.params, &prep.plane, &s, (3.0, 3.0)).unwrap();
        panels.push(render_panel("map, file curve, sat, match", &prep.plane, &prep.params, &RawDevelopSettings { exposure_ev: ev, ..s }));
        measure(&mut panels);
        for p in &panels {
            table.push(row(name, p));
        }
        if let Some(dir) = std::env::var_os("LOPSY_GAIN_MAP_DIR").map(PathBuf::from).filter(|p| p.is_dir()) {
            let stem = name.trim_end_matches(".dng");
            for (i, chunk) in panels[1..].chunks(4).enumerate() {
                let mut sheet: Vec<Panel> = vec![preview_panel(&data, &opened)];
                sheet[0].median = panels[0].median;
                sheet[0].white = panels[0].white;
                for p in chunk {
                    let pic = Picture { w: p.pic.w, h: p.pic.h, rgb: p.pic.rgb.clone() };
                    sheet.push(Panel { label: p.label.clone(), ev: p.ev, own: Picture { w: 0, h: 0, rgb: Vec::new() }, gamut: p.gamut, pic, lab: Vec::new(), median: p.median, white: p.white, chroma: p.chroma });
                }
                write_sheet(&dir.join(format!("{stem}-exposure-candidates-{}.jpg", i + 1)), &format!("{name}: exposure and curve candidates with the map ({})", i + 1), &sheet);
            }
        }
    }
    println!("{}", table.join("\n"));
}

/// Both samples' `ProfileToneCurve` is used: 257 points, an S-curve
/// (scene 0.18 to about 0.128). Its table ends at 1.0 with a slope of
/// about 0.76, and the tone step's shoulder continues from there with the
/// same value and slope, so the map's output above 1 (the concert's clipped
/// white lands near 1.13) rises smoothly toward the shoulder's ceiling and
/// the output step rolls it to white: no step at 1, nothing falls. The map
/// itself, gain × input, never falls on the concert's tables and falls by
/// at most 0.1 % (relative) on a few of the rose's, which cannot be seen.
#[test]
fn the_files_curve_meets_the_shoulder_without_a_step_or_a_fall() {
    use lopsy_core::tone::{curve_at, curve_top};
    let mut seen = 0;
    for name in [ROSE, CONCERT] {
        let Some((_, data)) = sample(name) else { continue };
        let prep = linear::prepare_dng(&data).unwrap();
        assert!(!prep.unhandled.iter().any(|u| u.starts_with("ProfileToneCurve")), "{name}: {:?}", prep.unhandled);
        let pts = prep.params.camera_curve.clone().expect("the file's curve in use");
        assert_eq!(pts.len(), 257, "{name}");
        let lut = linear::camera_curve_lut(&pts);
        assert!(lut.windows(2).all(|w| w[1] >= w[0]), "{name}: the table falls");
        assert!((curve_at(&lut, 0.18) - 0.128).abs() < 0.003, "{name}: {}", curve_at(&lut, 0.18));
        let (top, slope) = curve_top(&lut);
        assert!(top == 1.0 && (slope - 0.76).abs() < 0.02, "{name}: top {top}, slope {slope}");
        let mut last = curve_at(&lut, 0.0);
        let mut x = 0.0005f32;
        while x < 4.0 {
            let y = curve_at(&lut, x);
            assert!(y >= last, "{name}: falls at {x}");
            assert!(y - last < 0.01, "{name}: steps at {x}: {last} to {y}");
            last = y;
            x += 0.0005;
        }
        let (raw, big) = map_bytes(&data).unwrap();
        let m = lopsy_core::dng::gain_map::parse(&raw, big).unwrap();
        let mut worst = 0f32;
        for t in m.gains.chunks_exact(257) {
            for k in 0..256 {
                let (a, b) = (t[k] * k as f32, t[k + 1] * (k + 1) as f32);
                worst = worst.max((a - b) / a.max(1e-6));
            }
        }
        assert!(worst < 0.001, "{name}: the map's output falls by {worst} relative");
        seen += 1;
    }
    if seen == 0 {
        skip("the file curve checks");
    }
}

/// The profiles a ProRAW shows: the camera look (the file's curve), the
/// Standard look matched to the preview, Neutral, and Monochrome as the
/// camera look without colour; ProfileToneCurve is not in `notApplied`.
#[test]
fn a_prorav_lists_its_camera_look_first() {
    let mut seen = 0;
    for name in [ROSE, CONCERT] {
        let Some((_, data)) = sample(name) else { continue };
        let prep = raw::prepare(&data).unwrap();
        let d = &prep.description;
        assert!(!d.not_applied.iter().any(|u| u.starts_with("ProfileToneCurve") || u.starts_with("ProfileGainTableMap ")), "{name}: {:?}", d.not_applied);
        let ids: Vec<&str> = d.profiles.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, ["camera", "standard", "neutral", "monochrome"], "{name}");
        let camera = &d.profiles[0];
        assert_eq!((camera.name.as_str(), camera.menu_name.as_str(), camera.maker_standard, camera.listed), ("Camera", "Camera", true, true));
        assert_eq!(camera.role, lopsy_core::raf::develop::ProfileRole::Camera);
        assert_eq!(camera.settings.base_curve, d.develop_defaults.base_curve);
        assert_eq!(camera.settings.saturation, lopsy_core::raw::STANDARD_SATURATION);
        let standard = &d.profiles[1];
        assert_eq!((standard.role, standard.maker_standard), (lopsy_core::raf::develop::ProfileRole::Look, false));
        assert_eq!(standard.settings.base_curve, Some(OpeningLook::default().curve.lut()));
        assert_ne!(standard.settings.exposure_ev, camera.settings.exposure_ev);
        let mono = &d.profiles[3];
        assert_eq!((mono.settings.saturation, &mono.settings.base_curve), (0.0, &d.develop_defaults.base_curve));
        seen += 1;
    }
    if seen == 0 {
        skip("the profile list");
    }
}
