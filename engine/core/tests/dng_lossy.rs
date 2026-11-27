//! Lossy JPEG DNGs (compression 34892) against their lossless siblings of
//! the same photograph, on the RAW interface as Photonamous opens them:
//! `5D3-adobe-lossy.dng` against `5D3-adobe-lossless.dng` (the lossy one is
//! the converter's demosaic of the mosaic the lossless one keeps) and
//! `5D3-adobe-lossy-rgb.dng` against `5D3-adobe-lossless-rgb.dng` (both
//! demosaiced). Needs `LOPSY_DNG_ADOBE_SAMPLES`; without it each test notes
//! that and passes. `--release`. With `LOPSY_LOSSY_DNG_DIR`, a sheet of each
//! pair (lossless | lossy | difference × 8, then the same at 1:1 from the
//! middle of the picture) is written there with `numbers.md`.
//!
//! Each file is opened with `raw::prepare` (its develop defaults: as-shot
//! white balance, the file's own matrix, the Standard look) and rendered
//! through the develop chain's CPU references (the binned view, long edge
//! at least 2000: 2880 × 1920 for the mosaic pair, the whole 3960 × 2640
//! for the RGB pair), as `standard_look.rs` renders. Display values are
//! 8-bit sRGB.

use std::path::{Path, PathBuf};

use lopsy_core::output::{output_reference, OutputSettings, OutputTarget};
use lopsy_core::raf::develop::{scene_reference, tone_settings, RawDevelopSettings};
use lopsy_core::raw::{self, Prepared, PreparedRaw};
use lopsy_core::working_space::{srgb_encode, Gamut};

#[path = "support/raw_compare.rs"]
mod raw_compare;
#[path = "support/sheet.rs"]
mod sheet;
use raw_compare::Picture;
use sheet::Sheet;

const LONG_EDGE: u32 = 2000;
const PAIRS: [(&str, &str); 2] = [("5D3-adobe-lossless.dng", "5D3-adobe-lossy.dng"), ("5D3-adobe-lossless-rgb.dng", "5D3-adobe-lossy-rgb.dng")];

fn sample(name: &str) -> Option<Vec<u8>> {
    let dir = std::env::var_os("LOPSY_DNG_ADOBE_SAMPLES").map(PathBuf::from)?;
    std::fs::read(dir.join(name)).ok()
}

fn develop(prep: &PreparedRaw, settings: &RawDevelopSettings) -> Picture {
    let (w, h, binned) = prep.binned_linear(LONG_EDGE).unwrap();
    let scene = scene_reference(&binned, settings);
    let toned = lopsy_core::scene_tone::scene_tone_reference(&scene, w as usize, h as usize, &Default::default(), &[], &[]);
    let rendered = lopsy_core::tone::tone_reference(&toned, &tone_settings(settings));
    let out = output_reference(&rendered, w, &OutputSettings::sdr(OutputTarget::Srgb, Gamut::Rec2020, false));
    Picture::from_rgba_encoded(w, h, &out)
}

/// 8-bit display values of a picture (linear sRGB).
fn display(p: &Picture) -> Vec<u8> {
    p.rgb.iter().map(|&v| (srgb_encode(v.clamp(0.0, 1.0)) * 255.0 + 0.5) as u8).collect()
}

/// Median display luminance (0..1) and share of pixels with a channel at 255.
fn stats(d: &[u8]) -> (f32, f32) {
    let mut lum: Vec<f32> = d.chunks_exact(3).map(|c| (0.2126 * f32::from(c[0]) + 0.7152 * f32::from(c[1]) + 0.0722 * f32::from(c[2])) / 255.0).collect();
    let white = d.chunks_exact(3).filter(|c| c.contains(&255)).count() as f32 / lum.len() as f32;
    let mid = lum.len() / 2;
    let (_, m, _) = lum.select_nth_unstable_by(mid, f32::total_cmp);
    (*m, white)
}

struct Pair {
    lossless: Picture,
    lossy: Picture,
    numbers: Numbers,
}

#[derive(Debug)]
struct Numbers {
    size: (usize, usize),
    median: (f32, f32),
    white: (f32, f32),
    /// Per channel value, |lossless − lossy| in 8-bit display values.
    mean_diff: f32,
    p99_diff: u8,
    max_diff: u8,
}

fn compare_pair(lossless: &str, lossy: &str) -> Option<Pair> {
    let (a, b) = (sample(lossless)?, sample(lossy)?);
    let (pa, pb) = (raw::prepare(&a).unwrap(), raw::prepare(&b).unwrap_or_else(|e| panic!("{lossy}: {e}")));
    let (la, lb) = (develop(&pa, &pa.description.develop_defaults), develop(&pb, &pb.description.develop_defaults));
    assert_eq!((la.w, la.h), (lb.w, lb.h), "{lossy}: rendered at another size");
    let (da, db) = (display(&la), display(&lb));
    let mut diffs: Vec<u8> = da.iter().zip(&db).map(|(x, y)| x.abs_diff(*y)).collect();
    let mean = diffs.iter().map(|&d| f64::from(d)).sum::<f64>() / diffs.len() as f64;
    let at = (diffs.len() as f64 * 0.99) as usize;
    let (_, p99, _) = diffs.select_nth_unstable(at);
    let p99 = *p99;
    let max = diffs.iter().copied().max().unwrap_or(0);
    let (sa, sb) = (stats(&da), stats(&db));
    let numbers = Numbers { size: (la.w, la.h), median: (sa.0, sb.0), white: (sa.1, sb.1), mean_diff: mean as f32, p99_diff: p99, max_diff: max };
    Some(Pair { lossless: la, lossy: lb, numbers })
}

/// Each lossy file opens at the size of its lossless sibling, as bright,
/// clipped the same, and within what JPEG compression explains: a mean
/// difference of a few display levels and a 99th percentile of tens, where
/// a wrong curve, a missing opcode or a misplaced tile would move the
/// median and put whole tiles off.
#[test]
fn lossy_dngs_open_like_their_lossless_siblings() {
    let out = std::env::var_os("LOPSY_LOSSY_DNG_DIR").map(PathBuf::from).filter(|p| p.is_dir());
    let mut table = vec![
        "| Pair | Size | Median lossless / lossy | At white lossless / lossy | Mean diff (of 255) | 99th pct | Max |".to_string(),
        "|---|---|---|---|---|---|---|".to_string(),
    ];
    let mut seen = 0;
    for (lossless, lossy) in PAIRS {
        let Some(pair) = compare_pair(lossless, lossy) else { continue };
        let n = &pair.numbers;
        table.push(format!(
            "| {lossy} vs {lossless} | {}×{} | {:.3} / {:.3} | {:.2} % / {:.2} % | {:.2} | {} | {} |",
            n.size.0, n.size.1, n.median.0, n.median.1, n.white.0 * 100.0, n.white.1 * 100.0, n.mean_diff, n.p99_diff, n.max_diff
        ));
        println!("{}", table.last().unwrap());
        assert!((n.median.0 - n.median.1).abs() < 0.02, "{lossy}: median {:?}", n.median);
        assert!((n.white.0 - n.white.1).abs() < 0.005, "{lossy}: at white {:?}", n.white);
        assert!(n.mean_diff < 4.0 && n.p99_diff < 32, "{lossy}: {n:?}");
        if let Some(dir) = &out {
            write_sheet(&dir.join(format!("{}.jpg", lossy.trim_end_matches(".dng"))), &format!("{lossless} | {lossy} | difference x8"), &pair);
        }
        seen += 1;
    }
    if seen == 0 {
        println!("LOPSY_DNG_ADOBE_SAMPLES is not set or lacks the lossy pairs: skipping.");
        return;
    }
    if let Some(dir) = &out {
        std::fs::write(dir.join("numbers.md"), table.join("\n") + "\n").unwrap();
    }
}

/// The difference ×8, as a picture (display values, shown as encoded).
fn difference(a: &Picture, b: &Picture) -> Picture {
    let rgb = display(a)
        .iter()
        .zip(display(b))
        .map(|(x, y)| lopsy_core::working_space::srgb_decode((f32::from(x.abs_diff(y)) * 8.0 / 255.0).min(1.0)))
        .collect();
    Picture { w: a.w, h: a.h, rgb }
}

fn write_sheet(path: &Path, title: &str, pair: &Pair) {
    const W: usize = 2400;
    const GAP: usize = 12;
    const SCALE: usize = 2;
    const LINE: usize = 9 * SCALE;
    let diff = difference(&pair.lossless, &pair.lossy);
    let pw = (W - 4 * GAP) / 3;
    let whole: Vec<Picture> = [&pair.lossless, &pair.lossy, &diff].iter().map(|p| p.resample(pw)).collect();
    // 1:1 from the middle.
    let (cx, cy) = (pair.lossless.w / 2 - pw / 2, pair.lossless.h / 2 - pw / 3);
    let crops: Vec<Picture> = [&pair.lossless, &pair.lossy, &diff].iter().map(|p| p.crop(cx, cy, pw, 2 * pw / 3)).collect();
    let (h1, h2) = (whole[0].h, crops[0].h);
    let top = GAP + LINE + GAP;
    let h = top + h1 + GAP + h2 + GAP + 2 * LINE + GAP;
    let mut sheet = Sheet::new(W, h, 24);
    sheet.text(GAP, GAP, title, SCALE, [235, 235, 235]);
    for i in 0..3 {
        let x = GAP + i * (pw + GAP);
        sheet.picture(x, top, &whole[i]);
        sheet.picture(x, top + h1 + GAP, &crops[i]);
    }
    let n = &pair.numbers;
    let y = top + h1 + GAP + h2 + GAP;
    sheet.text(GAP, y, &format!("median {:.3} / {:.3}, at white {:.2} % / {:.2} %", n.median.0, n.median.1, n.white.0 * 100.0, n.white.1 * 100.0), SCALE, [235, 235, 120]);
    sheet.text(GAP, y + LINE, &format!("difference of 255: mean {:.2}, 99th percentile {}, max {} (second row: 1:1 from the middle)", n.mean_diff, n.p99_diff, n.max_diff), SCALE, [140, 220, 255]);
    sheet.write_jpeg(path);
}

/// A lossy file takes everything its lossless sibling gets: bands equal to
/// the whole frame bit for bit, the binned view, the Standard look's
/// profiles with their roles, white balance, and nothing about the
/// compression in `notApplied` (its OpcodeList2 is applied).
#[test]
fn a_lossy_dng_is_a_linear_dng_like_any_other() {
    let mut seen = 0;
    for (_, lossy) in PAIRS {
        let Some(data) = sample(lossy) else { continue };
        let prep = raw::prepare(&data).unwrap();
        let Prepared::Dng(p) = &prep.prepared else { panic!("{lossy}: not a DNG") };
        let d = &prep.description;
        assert!(!d.not_applied.iter().any(|u| u.starts_with("OpcodeList2")), "{lossy}: {:?}", d.not_applied);
        let ids: Vec<&str> = d.profiles.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, ["camera", "neutral", "monochrome"], "{lossy}");
        assert!(d.profiles[0].maker_standard && d.profiles[0].role == lopsy_core::raf::develop::ProfileRole::Camera);
        assert!(lopsy_core::dng::linear::white_balance_for_temperature(&p.params, 5000.0, 0.0).is_ok());
        let row = p.params.width as usize * 3;
        let h = p.params.height;
        let whole = lopsy_core::dng::linear::render_linear_band(&p.plane, &p.params, lopsy_core::raf::RafBand { y0: 0, y1: h, src_y0: 0, src_y1: h }).unwrap();
        for band in lopsy_core::raf::plan_bands(h, 5) {
            let src = &p.plane[band.src_y0 as usize * row..band.src_y1 as usize * row];
            let px = lopsy_core::dng::linear::render_linear_band(src, &p.params, band).unwrap();
            for y in 0..px.height {
                let dst = (((px.y + y) * whole.width + px.x) * 4) as usize;
                let s = (y * px.width * 4) as usize;
                let n = (px.width * 4) as usize;
                assert!(whole.pixels[dst..dst + n].iter().zip(&px.pixels[s..s + n]).all(|(a, b)| a.to_bits() == b.to_bits()), "{lossy}: band {band:?}");
            }
        }
        // Linear reference values: 0..1 times the as-shot gain, except a
        // clipped pixel moved toward a neutral at the highest clip level
        // (`dng::linear::neutral_clipped`), which stays within 0 and that.
        let gain = p.params.as_shot_gain;
        let top = gain.iter().copied().fold(0.0f32, f32::max);
        let within = |c: &[f32]| (0..3).all(|k| c[k] >= 0.0 && c[k] <= gain[k] * 1.000_001);
        let moved = |c: &[f32]| c.iter().all(|&v| v >= 0.0 && v <= top * 1.000_001);
        assert!(p.plane.chunks_exact(3).all(|c| within(c) || moved(c)), "{lossy}");
        seen += 1;
    }
    if seen == 0 {
        println!("LOPSY_DNG_ADOBE_SAMPLES is not set: skipping.");
    }
}

/// The baked decode (Lopsy's import, and the app's fallback) opens each
/// lossy file at its sibling's size with the same brightness, full size,
/// within the same JPEG-sized differences.
#[test]
fn the_baked_decode_opens_lossy_dngs_like_their_siblings() {
    let mut seen = 0;
    for (lossless, lossy) in PAIRS {
        let (Some(a), Some(b)) = (sample(lossless), sample(lossy)) else { continue };
        let (ia, ib) = (lopsy_core::dng::read_dng(&a).unwrap(), lopsy_core::dng::read_dng(&b).unwrap_or_else(|e| panic!("{lossy}: {e}")));
        assert_eq!((ia.width, ia.height), (ib.width, ib.height), "{lossy}");
        let to8 = |px: &[f32]| -> Vec<u8> { px.chunks_exact(4).flat_map(|p| [p[0], p[1], p[2]]).map(|v| (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8).collect() };
        let (da, db) = (to8(&ia.pixels), to8(&ib.pixels));
        let mut diffs: Vec<u8> = da.iter().zip(&db).map(|(x, y)| x.abs_diff(*y)).collect();
        let mean = diffs.iter().map(|&d| f64::from(d)).sum::<f64>() / diffs.len() as f64;
        let at = (diffs.len() as f64 * 0.99) as usize;
        let p99 = *diffs.select_nth_unstable(at).1;
        let (sa, sb) = (stats(&da), stats(&db));
        println!(
            "| baked {lossy} vs {lossless} | {}×{} | {:.3} / {:.3} | {:.2} % / {:.2} % | {mean:.2} | {p99} |",
            ia.width, ia.height, sa.0, sb.0, sa.1 * 100.0, sb.1 * 100.0
        );
        assert!((sa.0 - sb.0).abs() < 0.02 && (sa.1 - sb.1).abs() < 0.005, "{lossy}: {sa:?} against {sb:?}");
        assert!(mean < 4.0 && p99 < 32, "{lossy}: mean {mean}, 99th percentile {p99}");
        seen += 1;
    }
    if seen == 0 {
        println!("LOPSY_DNG_ADOBE_SAMPLES is not set: skipping.");
    }
}
