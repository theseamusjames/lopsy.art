//! DNGs made by Adobe DNG Converter (the format a photographer gets from
//! Adobe DNG Converter or Lightroom): both decodes on real files, each
//! compared with the DNG's own embedded preview and, when
//! `LOPSY_DNG_ADOBE_SIPS_DIR` holds `<stem>.png` (macOS's decode, `sips -s
//! format png`, converted to sRGB), with that.
//!
//! The files are read from `LOPSY_DNG_ADOBE_SAMPLES` (a folder of `.dng`
//! files; the six of raw.pixls.us' Canon EOS 5D Mark III set: a Bayer
//! mosaic uncompressed and lossless, the demosaiced "rgb" variants, and the
//! two lossy ones). It is a variable of its own because `dng_develop.rs`
//! expects every file in `LOPSY_DNG_SAMPLES` to take both paths, and the
//! baked decode refuses the lossy ones. Without it the tests note that and pass.
//! Full-size files: run with `--release`. With `LOPSY_DNG_ADOBE_REVIEW_DIR`,
//! review images are written there.
//!
//! What is compared, coarsely (the references add Adobe's tone curve and
//! look table, which neither decode applies): the size, crop and
//! orientation (best alignment of luminance, as `arw_decode.rs`), the cast
//! of near-neutral cells, hue and saturation, and the rank order of the
//! cells' luminance; for the linear decode, the same of its default
//! develop (binned to 2000 pixels, through the CPU references of the
//! develop chain, working space on, output for sRGB). Variants of one
//! frame must agree: the uncompressed and lossless decodes of one layout
//! bit for bit, the mosaic and the demosaiced layouts at a coarse scale.

use std::path::PathBuf;

use lopsy_core::dng::linear::{develop_defaults, prepare_dng, render_binned_linear_for, render_linear_band, DngKind};
use lopsy_core::output::{output_reference, OutputSettings, OutputTarget};
use lopsy_core::raf::develop::{scene_reference, tone_settings};
use lopsy_core::raf::{plan_bands, RafBand};
use lopsy_core::working_space::Gamut;

#[path = "support/raw_compare.rs"]
mod raw_compare;
use raw_compare::{best_shift, brightness, compare, embedded_jpeg, sips_reference, Picture};

const LOSSY_REFUSAL: &str = "This DNG uses lossy JPEG compression, which is not supported yet";

fn files() -> Vec<PathBuf> {
    let Some(dir) = std::env::var_os("LOPSY_DNG_ADOBE_SAMPLES") else { return Vec::new() };
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir).map(|r| r.flatten().map(|e| e.path()).collect()).unwrap_or_default();
    v.retain(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("dng")));
    v.sort();
    v
}

fn hash(v: &[f32]) -> u64 {
    v.iter().fold(0xcbf2_9ce4_8422_2325u64, |h, x| x.to_bits().to_le_bytes().iter().fold(h, |h, &b| (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3)))
}

/// Report `ours` against a reference picture, assert the loose bounds, and
/// return (shift, correlation, hue, saturation ratio, cast) for the table.
fn check(name: &str, what: &str, ours: &Picture, reference: &Picture, strict_geometry: bool) -> String {
    let (shift, zoom, corr) = best_shift(&ours.resample(1000), &reference.resample(1000), 4);
    let st = compare(&ours.resample(2000).grid(48, 32), &reference.resample(2000).grid(48, 32));
    println!(
        "  {name}: {what}: shift {shift:?} ×{zoom:.2} corr {corr:.3}; hue {:.1}°, saturation ratio {:.2}, neutral cast {:+.4} {:+.4} over {} near-neutral cells, luminance rank correlation {:.3} ({} cells)",
        st.hue_deg, st.saturation_ratio, st.neutral_cast[0], st.neutral_cast[1], st.neutral_cells, st.rank_corr, st.cells
    );
    if strict_geometry {
        assert!(shift == (0, 0) && (zoom - 1.0).abs() < 0.005 && corr > 0.9, "{name}: {what}: misaligned {shift:?} ×{zoom} at {corr}");
    }
    assert!(st.neutral_cast[0].abs() < 0.03 && st.neutral_cast[1].abs() < 0.03, "{name}: {what}: a colour cast");
    assert!(st.hue_deg < 15.0 && st.rank_corr > 0.9, "{name}: {what}: colour or tone far off");
    format!("{shift:?} {corr:.3} / {:.1}° / {:.2} / {:+.3},{:+.3}", st.hue_deg, st.saturation_ratio, st.neutral_cast[0], st.neutral_cast[1])
}

#[test]
fn adobe_dngs_load_and_match_their_references() {
    let files = files();
    if files.is_empty() {
        println!("No Adobe DNGs: set LOPSY_DNG_ADOBE_SAMPLES. Skipping.");
        return;
    }
    let review = std::env::var_os("LOPSY_DNG_ADOBE_REVIEW_DIR").map(PathBuf::from);
    // Baked results by layout, for the cross-variant checks.
    let mut baked_by_layout: Vec<(String, bool, u64, Picture, Picture)> = Vec::new();
    let mut rows = Vec::new();
    for path in files {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let stem = name.trim_end_matches(".dng").to_string();
        let data = std::fs::read(&path).unwrap();
        let t0 = std::time::Instant::now();
        let baked = lopsy_core::dng::read_dng(&data);
        let baked_ms = t0.elapsed().as_millis();
        // The lossy files open on the linear path (compared with their
        // lossless siblings in `dng_lossy.rs`); the baked decode refuses
        // them.
        if name.contains("lossy") {
            let why = baked.err().unwrap_or_default();
            assert!(why.starts_with(LOSSY_REFUSAL), "{name}: {why}");
            let prep = prepare_dng(&data).unwrap_or_else(|e| panic!("{name}: {e}"));
            rows.push(format!("| {name} | linear {}×{}; baked refused: {why} |", prep.params.width, prep.params.height));
            continue;
        }
        let img = baked.unwrap_or_else(|e| panic!("{name}: {e}"));
        assert!(img.pixels.iter().all(|v| v.is_finite() && (0.0..=1.0).contains(v)), "{name}");
        let ours = Picture::from_rgba_encoded(img.width, img.height, &img.pixels);

        let t1 = std::time::Instant::now();
        let prep = prepare_dng(&data).unwrap_or_else(|e| panic!("{name}: {e}"));
        let linear_ms = t1.elapsed().as_millis();
        let p = &prep.params;
        assert_eq!(p.oriented_size(), (img.width, img.height), "{name}: the two decodes keep the same area");
        // Bands are bit-identical to the whole frame.
        let whole = render_linear_band(&prep.plane, p, RafBand { y0: 0, y1: p.height, src_y0: 0, src_y1: p.height }).unwrap();
        let row_len = (p.width * p.samples_per_pixel) as usize;
        let (ow, _) = p.oriented_size();
        let mut banded = vec![f32::NAN; whole.pixels.len()];
        for band in plan_bands(p.height, 4) {
            let px = render_linear_band(&prep.plane[band.src_y0 as usize * row_len..band.src_y1 as usize * row_len], p, band).unwrap();
            for row in 0..px.height {
                let dst = (((px.y + row) * ow + px.x) * 4) as usize;
                let s = (row * px.width * 4) as usize;
                banded[dst..dst + (px.width * 4) as usize].copy_from_slice(&px.pixels[s..s + (px.width * 4) as usize]);
            }
        }
        assert!(whole.pixels.iter().zip(&banded).all(|(a, b)| a.to_bits() == b.to_bits()), "{name}: bands differ from the whole frame");
        drop(whole);
        drop(banded);
        // The default develop of the binned view, as the app's first view.
        let (bw, bh, binned) = render_binned_linear_for(&prep.plane, p, 2000).unwrap();
        let settings = develop_defaults(p).unwrap();
        let scene = scene_reference(&binned, &settings);
        let rendered = lopsy_core::tone::tone_reference(&scene, &tone_settings(&settings));
        let developed_px = output_reference(&rendered, bw, &OutputSettings::sdr(OutputTarget::Srgb, Gamut::Rec2020, false));
        let developed = Picture::from_rgba_encoded(bw, bh, &developed_px);
        println!(
            "\n=== {name}: {:?} {}×{} plane, baked {}×{} in {baked_ms} ms, linear prepare in {linear_ms} ms; white {}, as-shot gain {:?}; not applied {:?}",
            p.kind, p.width, p.height, img.width, img.height, p.white_level, p.as_shot_gain, prep.unhandled
        );

        let preview = embedded_jpeg(&data).expect("an embedded preview");
        println!("  {name}: embedded preview {}×{}", preview.w, preview.h);
        let mut row = format!("| {name} | {:?} | {}×{} | {baked_ms} | {linear_ms} |", p.kind, img.width, img.height);
        row += &format!(" {} |", check(&name, "baked vs preview", &ours, &preview, preview.w == ours.w));
        row += &format!(" {} |", check(&name, "linear develop vs preview", &developed, &preview, false));
        let sips = sips_reference("LOPSY_DNG_ADOBE_SIPS_DIR", &stem);
        // Brightness with no exposure matching: mean, p10, p50, p90 of
        // encoded luminance.
        let fmt = |b: [f32; 4]| format!("{:.3} ({:.3} {:.3} {:.3})", b[0], b[1], b[2], b[3]);
        println!(
            "  {name}: brightness mean (p10 p50 p90): baked {}, preview {}, sips {}, linear develop {}",
            fmt(brightness(&ours)),
            fmt(brightness(&preview)),
            sips.as_ref().map_or("-".into(), |s| fmt(brightness(s))),
            fmt(brightness(&developed)),
        );
        if let Some(s) = &sips {
            assert_eq!((s.w, s.h), (ours.w, ours.h), "{name}: sips renders another size");
            row += &format!(" {} |", check(&name, "baked vs sips", &ours, s, true));
            row += &format!(" {} |", check(&name, "linear develop vs sips", &developed, s, false));
        }
        rows.push(row);

        if let Some(dir) = &review {
            ours.resample(2000).write_png(&dir.join(format!("{stem}-lopsy.png")));
            developed.resample(2000).write_png(&dir.join(format!("{stem}-lopsy-linear-develop.png")));
            preview.resample(2000).write_png(&dir.join(format!("{stem}-embedded-preview.png")));
            let (cw, ch) = (800.min(ours.w), 600.min(ours.h));
            let (x0, y0) = ((ours.w - cw) / 2, (ours.h - ch) / 2);
            ours.crop(x0, y0, cw, ch).write_png(&dir.join(format!("{stem}-lopsy-100pct.png")));
            if (preview.w, preview.h) == (ours.w, ours.h) {
                preview.crop(x0, y0, cw, ch).write_png(&dir.join(format!("{stem}-embedded-preview-100pct.png")));
            }
            if let Some(s) = &sips {
                s.resample(2000).write_png(&dir.join(format!("{stem}-sips.png")));
                s.crop(x0, y0, cw, ch).write_png(&dir.join(format!("{stem}-sips-100pct.png")));
            }
        }
        baked_by_layout.push((name, p.kind == DngKind::Bayer, hash(&img.pixels), ours, preview));
    }

    // One frame, several encodings.
    for kind in [true, false] {
        let same: Vec<&(String, bool, u64, Picture, Picture)> = baked_by_layout.iter().filter(|b| b.1 == kind).collect();
        for pair in same.windows(2) {
            assert_eq!(pair[0].2, pair[1].2, "{} and {} decode differently", pair[0].0, pair[1].0);
            println!("{} and {}: baked decodes bit-identical", pair[0].0, pair[1].0);
        }
    }
    if let (Some(m), Some(r)) = (baked_by_layout.iter().find(|b| b.1), baked_by_layout.iter().find(|b| !b.1)) {
        // The demosaiced files hold a smaller picture of a slightly
        // different framing (each lines up with its own preview), so the
        // two layouts are compared as wholes: mean colour and brightness.
        let mean = |p: &Picture| -> [f64; 3] { std::array::from_fn(|c| p.rgb.iter().skip(c).step_by(3).map(|&v| f64::from(v)).sum::<f64>() / (p.w * p.h) as f64) };
        let (a, b) = (mean(&m.3), mean(&r.3));
        let chroma = |v: [f64; 3]| [v[0] / (v[0] + v[1] + v[2]), v[2] / (v[0] + v[1] + v[2])];
        let lum = |v: [f64; 3]| 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
        let (ca, cb) = (chroma(a), chroma(b));
        let stops = (lum(a) / lum(b)).log2();
        // The two files' own previews differ by their framing alone.
        let (pa, pb) = (mean(&m.4), mean(&r.4));
        let (pca, pcb) = (chroma(pa), chroma(pb));
        let pstops = (lum(pa) / lum(pb)).log2();
        println!("{} against {}: mean chromaticity {ca:.4?} against {cb:.4?}, brightness {stops:+.2} stops; their previews {pca:.4?} against {pcb:.4?}, {pstops:+.2} stops", m.0, r.0);
        let gap = |x: f64, y: f64, px: f64, py: f64| ((x - y) - (px - py)).abs();
        assert!(gap(ca[0], cb[0], pca[0], pcb[0]) < 0.006 && gap(ca[1], cb[1], pca[1], pcb[1]) < 0.006 && (stops - pstops).abs() < 0.3, "the mosaic and demosaiced layouts disagree more than their previews do");
    }
    println!("\n| file | layout | size | baked ms | linear ms | baked vs preview: shift corr / hue / sat / cast | linear develop vs preview | baked vs sips | linear develop vs sips |");
    for r in rows {
        println!("{r}");
    }
}

/// Cut short and corrupted, every file is refused or decoded, never a panic.
#[test]
fn damaged_adobe_dngs_are_refused_not_panicked_on() {
    let files = files();
    if files.is_empty() {
        println!("No Adobe DNGs: set LOPSY_DNG_ADOBE_SAMPLES. Skipping.");
        return;
    }
    for path in files {
        let data = std::fs::read(&path).unwrap();
        for cut in [8usize, 64, 512, 4096, 65_536, 200_000, data.len() / 3, data.len() * 2 / 3] {
            assert!(lopsy_core::dng::read_dng(&data[..cut.min(data.len())]).is_err(), "{}: cut at {cut} decoded", path.display());
            assert!(prepare_dng(&data[..cut.min(data.len())]).is_err(), "{}: cut at {cut} decoded", path.display());
        }
        let mut seed = 0x2545_f491_4f6c_dd1du64;
        let mut refused = 0;
        let tries = 16;
        for i in 0..tries {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            let mut damaged = data.clone();
            let at = (seed % if i % 2 == 0 { 250_000.min(data.len() as u64) } else { data.len() as u64 }) as usize;
            damaged[at] ^= (seed >> 32) as u8 | 1;
            let baked = lopsy_core::dng::read_dng(&damaged);
            let linear = prepare_dng(&damaged);
            refused += usize::from(baked.is_err()) + usize::from(linear.is_err());
        }
        println!("{}: {refused} of {} decodes of single-byte changes refused, the rest decoded", path.display(), 2 * tries);
    }
}
