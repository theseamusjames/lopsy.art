//! An experiment, not a check: why our renders are less colourful than the
//! camera's own previews. Runs only with `LOPSY_SATURATION_REPORT` set (and
//! the sample variables); `--release`; prints its tables.
//!
//! Every comparison is on the same reduced grid: the render (binned view,
//! develop chain's CPU references) and the camera's preview are each
//! box-averaged in linear light to [`GRID`] cells across, then converted to
//! Oklab (from linear sRGB, or from linear Rec. 2020 before the output
//! step). The preview's 8-bit values are read as sRGB unless the JPEG
//! carries an ICC profile that says otherwise (Display P3 is then decoded
//! as P3). Cells are classed by the preview's own lightness and hue.
//!
//! Numbers per sample:
//! - chroma ratio ours / preview, Σ C over the chromatic cells (preview
//!   C ≥ 0.03), overall, by lightness band (preview L < 0.45, 0.45–0.70,
//!   ≥ 0.70) and by hue sector (60° each of the preview's Oklab hue);
//! - saturation ratio (C / L) over the same cells;
//! - the neutral axis: our mean C where the preview's C < 0.02;
//! - hue shift: chroma-weighted mean of our hue minus the preview's, where
//!   both have C ≥ 0.04;
//! and, to separate the causes: the same ratio with a saturation factor
//! (the tone step's own mix toward luminance, as RAF's film looks use),
//! with the curve applied per channel instead of on luminance, the chroma
//! the tone step and the output step each change, and the share of the
//! output the gamut mapping moves.

use std::path::PathBuf;

use lopsy_core::look::{oklab_matrices, to_oklab, OkLabMatrices};
use lopsy_core::output::{output_reference, OutputSettings, OutputTarget};
use lopsy_core::raf::develop::{scene_reference, tone_settings, RawDevelopSettings};
use lopsy_core::raw::{self, PreparedRaw, RawFormatId};
use lopsy_core::working_space::{apply, conversion, srgb_decode, Gamut};

#[path = "support/raw_compare.rs"]
mod raw_compare;
#[path = "support/previews.rs"]
mod previews;

const GRID: usize = 48;
const RENDER_LONG_EDGE: u32 = 1200;
const CHROMATIC: f32 = 0.03;
const NEUTRAL: f32 = 0.02;

/// A grid of Oklab cells.
struct Grid {
    w: usize,
    h: usize,
    lab: Vec<[f32; 3]>,
}

/// Box-average interleaved RGB (stride `stride`, first three channels) in
/// linear light to `GRID` wide, then to Oklab through `to_2020`.
fn grid(rgb: &[f32], stride: usize, w: usize, h: usize, to_2020: &[f32; 9], m: &OkLabMatrices) -> Grid {
    let gw = GRID;
    let gh = ((h as f64 * gw as f64 / w as f64).round() as usize).max(1);
    let mut sum = vec![[0f64; 3]; gw * gh];
    let mut n = vec![0f64; gw * gh];
    for y in 0..h {
        let gy = (y * gh / h).min(gh - 1);
        for x in 0..w {
            let g = gy * gw + (x * gw / w).min(gw - 1);
            let p = &rgb[(y * w + x) * stride..];
            for c in 0..3 {
                sum[g][c] += f64::from(p[c]);
            }
            n[g] += 1.0;
        }
    }
    let lab = sum
        .iter()
        .zip(&n)
        .map(|(s, n)| {
            let c = s.map(|v| (v / n.max(1.0)) as f32);
            to_oklab(m, apply(to_2020, c))
        })
        .collect();
    Grid { w: gw, h: gh, lab }
}

fn chroma(l: &[f32; 3]) -> f32 {
    l[1].hypot(l[2])
}

fn hue(l: &[f32; 3]) -> f32 {
    l[2].atan2(l[1]).to_degrees().rem_euclid(360.0)
}

/// Ours against the preview, cell by cell.
#[derive(Default)]
struct Compare {
    chroma: f32,
    saturation: f32,
    bands: [Option<f32>; 3],
    sectors: [Option<f32>; 6],
    neutral_ours: f32,
    neutral_preview: f32,
    hue_shift: f32,
    lightness: f32,
}

fn compare(ours: &Grid, preview: &Grid) -> Compare {
    assert_eq!((ours.w, ours.h), (preview.w, preview.h));
    let ratio = |pred: &dyn Fn(&[f32; 3]) -> bool| -> Option<f32> {
        let (mut a, mut b, mut k) = (0f64, 0f64, 0);
        for (o, p) in ours.lab.iter().zip(&preview.lab) {
            if chroma(p) >= CHROMATIC && pred(p) {
                a += f64::from(chroma(o));
                b += f64::from(chroma(p));
                k += 1;
            }
        }
        (k >= 8).then(|| (a / b) as f32)
    };
    let (mut sa, mut sb) = (0f64, 0f64);
    let (mut no, mut np, mut nk) = (0f64, 0f64, 0);
    let (mut hs, mut hw) = (0f64, 0f64);
    let mut dl = 0f64;
    for (o, p) in ours.lab.iter().zip(&preview.lab) {
        dl += f64::from(o[0] - p[0]);
        if chroma(p) >= CHROMATIC {
            sa += f64::from(chroma(o) / o[0].max(1e-3));
            sb += f64::from(chroma(p) / p[0].max(1e-3));
        }
        if chroma(p) < NEUTRAL {
            no += f64::from(chroma(o));
            np += f64::from(chroma(p));
            nk += 1;
        }
        if chroma(p) >= 0.04 && chroma(o) >= 0.04 {
            let d = (hue(o) - hue(p) + 540.0).rem_euclid(360.0) - 180.0;
            hs += f64::from(d * chroma(p));
            hw += f64::from(chroma(p));
        }
    }
    let bands = [(0.0, 0.45), (0.45, 0.70), (0.70, 2.0)].map(|(lo, hi)| ratio(&|p| p[0] >= lo && p[0] < hi));
    let sectors: [Option<f32>; 6] = std::array::from_fn(|s| {
        let (lo, hi) = (s as f32 * 60.0, (s + 1) as f32 * 60.0);
        ratio(&|p| (lo..hi).contains(&hue(p)))
    });
    Compare {
        chroma: ratio(&|_| true).unwrap_or(f32::NAN),
        saturation: (sa / sb) as f32,
        bands,
        sectors,
        neutral_ours: (no / f64::from(nk.max(1))) as f32,
        neutral_preview: (np / f64::from(nk.max(1))) as f32,
        hue_shift: (hs / hw.max(1e-9)) as f32,
        lightness: (dl / ours.lab.len() as f64) as f32,
    }
}

/// The develop chain on `binned`: (rendered linear Rec. 2020 RGBA, output
/// encoded sRGB RGBA). `per_channel` applies the base curve to each
/// channel in sRGB primaries instead of to luminance (an experiment).
fn render(binned: &[f32], w: u32, h: u32, s: &RawDevelopSettings, per_channel: bool) -> (Vec<f32>, Vec<f32>) {
    let scene = scene_reference(binned, s);
    let toned = lopsy_core::scene_tone::scene_tone_reference(&scene, w as usize, h as usize, &Default::default(), &[], &[]);
    let rendered = if per_channel {
        let curve = s.base_curve.clone().unwrap();
        let sat_only = RawDevelopSettings { base_curve: None, ..s.clone() };
        let mixed = lopsy_core::tone::tone_reference(&toned, &tone_settings(&sat_only));
        let (to_srgb, from_srgb) = (conversion(Gamut::Rec2020, Gamut::Srgb), conversion(Gamut::Srgb, Gamut::Rec2020));
        mixed
            .chunks_exact(4)
            .flat_map(|p| {
                let srgb = apply(&to_srgb, [p[0], p[1], p[2]]).map(|v| if v > 0.0 { lopsy_core::tone::curve_at(&curve, v) } else { v });
                let c = apply(&from_srgb, srgb);
                [c[0], c[1], c[2], p[3]]
            })
            .collect()
    } else {
        lopsy_core::tone::tone_reference(&toned, &tone_settings(s))
    };
    let out = output_reference(&rendered, w, &OutputSettings::sdr(OutputTarget::Srgb, Gamut::Rec2020, false));
    (rendered, out)
}

fn out_grid(out: &[f32], w: u32, h: u32, m: &OkLabMatrices) -> Grid {
    out_grid_in(out, w, h, Gamut::Srgb, m)
}

/// An output encoded with the sRGB curve in `gamut`'s primaries.
fn out_grid_in(out: &[f32], w: u32, h: u32, gamut: Gamut, m: &OkLabMatrices) -> Grid {
    let lin: Vec<f32> = out.chunks_exact(4).flat_map(|p| [srgb_decode(p[0].clamp(0.0, 1.0)), srgb_decode(p[1].clamp(0.0, 1.0)), srgb_decode(p[2].clamp(0.0, 1.0))]).collect();
    grid(&lin, 3, w as usize, h as usize, &conversion(gamut, Gamut::Rec2020), m)
}

fn ratio_sum(a: &Grid, b: &Grid) -> f32 {
    let (mut x, mut y) = (0f64, 0f64);
    for (p, q) in a.lab.iter().zip(&b.lab) {
        x += f64::from(chroma(p));
        y += f64::from(chroma(q));
    }
    (x / y) as f32
}

fn fmt(o: Option<f32>) -> String {
    o.map_or("–".into(), |v| format!("{v:.2}"))
}

struct Sample {
    name: String,
    data: Vec<u8>,
    prep: PreparedRaw,
}

fn samples() -> Vec<Sample> {
    let pick = |var: &str, names: &[&str]| -> Vec<PathBuf> {
        let Some(dir) = std::env::var_os(var).map(PathBuf::from) else { return Vec::new() };
        names.iter().map(|n| dir.join(n)).filter(|p| p.is_file()).collect()
    };
    let mut paths = pick("LOPSY_ARW_SAMPLES", &["ILCE-7M3_DSC0009.ARW", "ILCE-7M4_DSC06677_FullFrame-Raw-Compressed.ARW", "ILCE-6000_DSC01542.ARW", "DSC-RX100M3_DSC00734.ARW"]);
    paths.extend(pick("LOPSY_DNG_SAMPLES", &["sample_dng_00.dng", "sample_dng_01.dng"]));
    paths.extend(pick("LOPSY_RAF_SAMPLES", &["DSCF8005.RAF", "DSCF7912.RAF"]));
    paths
        .into_iter()
        .map(|p| {
            let data = std::fs::read(&p).unwrap();
            let prep = raw::prepare(&data).unwrap();
            Sample { name: p.file_name().unwrap().to_string_lossy().to_string(), data, prep }
        })
        .collect()
}

#[test]
fn where_the_colour_goes() {
    if std::env::var_os("LOPSY_SATURATION_REPORT").is_none() {
        println!("Set LOPSY_SATURATION_REPORT (and the sample variables) to measure the saturation gap.");
        return;
    }
    let m = oklab_matrices();
    let srgb_2020 = conversion(Gamut::Srgb, Gamut::Rec2020);
    let p3_2020 = conversion(Gamut::DisplayP3, Gamut::Rec2020);
    let ident: [f32; 9] = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
    println!("| sample | preview space | chroma | sat C/L | shadows | mids | highlights | red | orange-yellow | green | cyan | blue | purple | neutral C ours/prev | hue shift ° | ΔL |");
    let mut causes = Vec::new();
    for s in samples() {
        let jpeg = previews::preview_jpeg(&s.data, &s.prep).expect("a preview");
        let icc = previews::icc_description(&jpeg);
        let is_p3 = icc.as_deref().is_some_and(|d| d.contains("P3"));
        let pv = previews::preview_picture(&s.data, &s.prep).unwrap();
        let pv_grid = grid(&pv.rgb, 3, pv.w, pv.h, if is_p3 { &p3_2020 } else { &srgb_2020 }, &m);
        let pv_as_srgb = grid(&pv.rgb, 3, pv.w, pv.h, &srgb_2020, &m);
        let (w, h, binned) = s.prep.binned_linear(RENDER_LONG_EDGE).unwrap();
        let d = &s.prep.description.develop_defaults;
        let (rendered, out) = render(&binned, w, h, d, false);
        let ours = out_grid(&out, w, h, &m);
        let c = compare(&ours, &pv_grid);
        let sectors: Vec<String> = c.sectors.iter().map(|v| fmt(*v)).collect();
        println!(
            "| {} | {} | {:.2} | {:.2} | {} | {} | {} | {} | {:.3} / {:.3} | {:+.1} | {:+.3} |",
            s.name,
            icc.clone().unwrap_or_else(|| "none (sRGB)".into()),
            c.chroma,
            c.saturation,
            fmt(c.bands[0]),
            fmt(c.bands[1]),
            fmt(c.bands[2]),
            sectors.join(" | "),
            c.neutral_ours,
            c.neutral_preview,
            c.hue_shift,
            c.lightness
        );
        // Causes. (1) saturation: the ratio with the tone step's mix.
        let sweep: Vec<(f32, f32)> = [1.0f32, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6]
            .iter()
            .map(|&k| {
                let sk = RawDevelopSettings { saturation: d.saturation * k, ..d.clone() };
                let (_, o) = render(&binned, w, h, &sk, false);
                (k, compare(&out_grid(&o, w, h, &m), &pv_grid).chroma)
            })
            .collect();
        let needed = sweep.windows(2).find(|p| p[0].1 < 1.0 && p[1].1 >= 1.0).map(|p| p[0].0 + (1.0 - p[0].1) / (p[1].1 - p[0].1) * (p[1].0 - p[0].0));
        // (2) the curve: per channel instead of on luminance; and the tone
        // step's own chroma and saturation change, scene to rendered.
        let (_, o_pc) = render(&binned, w, h, d, true);
        let per_channel = compare(&out_grid(&o_pc, w, h, &m), &pv_grid).chroma;
        let scene = scene_reference(&binned, d);
        let scene_grid = grid(&scene, 4, w as usize, h as usize, &ident, &m);
        let rendered_grid = grid(&rendered, 4, w as usize, h as usize, &ident, &m);
        let tone_chroma = ratio_sum(&rendered_grid, &scene_grid);
        let sat = |g: &Grid| g.lab.iter().map(|l| f64::from(chroma(l) / l[0].max(1e-3))).sum::<f64>();
        let tone_sat = (sat(&rendered_grid) / sat(&scene_grid)) as f32;
        // (4) the output step: chroma of the output against the rendered
        // data it came from, and the share of pixels it moved by more than
        // a 1/255 step after encoding.
        let output_chroma = ratio_sum(&ours, &rendered_grid);
        let to_srgb = conversion(Gamut::Rec2020, Gamut::Srgb);
        let moved = rendered
            .chunks_exact(4)
            .zip(out.chunks_exact(4))
            .filter(|(r, o)| {
                let lin = apply(&to_srgb, [r[0], r[1], r[2]]);
                let lum = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
                if lum >= 1.0 {
                    return false; // white by the SDR roll-off, not the gamut map
                }
                (0..3).any(|k| (lopsy_core::working_space::srgb_encode(lin[k].clamp(0.0, 1.0)) - o[k]).abs() > 1.0 / 255.0)
            })
            .count() as f32
            / (w * h) as f32;
        // (5) the preview's colour space as read, and ours rendered for it.
        let as_srgb = compare(&ours, &pv_as_srgb).chroma;
        let in_its_space = if is_p3 {
            let o = output_reference(&rendered, w, &OutputSettings::sdr(OutputTarget::DisplayP3, Gamut::Rec2020, false));
            format!("{:.2}", compare(&out_grid_in(&o, w, h, Gamut::DisplayP3, &m), &pv_grid).chroma)
        } else {
            "(sRGB: as left)".into()
        };
        causes.push(format!(
            "| {} | {:.2} | {:.2} | {} | {} | {:.2} | {:.3} / {:.3} | {:.3} | {:.1} % | {:.2} | {:.2} | {} |",
            s.name,
            d.saturation,
            c.chroma,
            sweep.iter().map(|(k, r)| format!("{k:.1}:{r:.2}")).collect::<Vec<_>>().join(" "),
            needed.map_or("> 1.6".into(), |v| format!("{v:.2}")),
            per_channel,
            tone_chroma,
            tone_sat,
            output_chroma,
            moved * 100.0,
            as_srgb,
            c.chroma,
            in_its_space
        ));
        let _ = s.prep.format == RawFormatId::Raf;
    }
    println!();
    println!("| sample | saturation in the look | chroma ratio | ratio with saturation ×k | k for ratio 1 | ratio, curve per channel | tone step chroma / C÷L change | output step chroma | pixels the gamut map moves | ratio, preview read as sRGB | ratio, preview in its ICC space | ratio, ours output for the preview's space |");
    for c in causes {
        println!("{c}");
    }
}
