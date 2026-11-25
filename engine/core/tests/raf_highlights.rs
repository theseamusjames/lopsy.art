//! Highlight reconstruction on real RAF files: which samples clip, and
//! what the linear path makes of them.
//!
//! Needs `LOPSY_RAF_SAMPLES` (a clone of `theseamusjames/sample-raf-images`);
//! without it every test notes that and passes. The full-resolution checks
//! demosaic whole 40 MP frames: run with `--release`. With
//! `LOPSY_HIGHLIGHT_CROPS` set to a directory, the last test also writes
//! before/after crops of the most clipped highlight there as PNG files.

use std::path::PathBuf;

use lopsy_core::raf::develop::{binned_factor_for, render_binned_linear, render_linear_band, scene_reference, tone_settings};
use lopsy_core::raf::highlights::{RAMP_END, RAMP_START};
use lopsy_core::raf::{plan_bands, prepare_raf, RafBand, RafDecodeOpts, RafMosaic, RafRenderParams};

fn sample_files() -> Option<Vec<PathBuf>> {
    let Some(dir) = std::env::var_os("LOPSY_RAF_SAMPLES").map(PathBuf::from) else {
        eprintln!("LOPSY_RAF_SAMPLES is not set: skipping the highlight tests on real files");
        return None;
    };
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("raf")))
        .collect();
    files.sort();
    Some(files)
}

fn name(path: &std::path::Path) -> String {
    path.file_name().unwrap_or_default().to_string_lossy().into_owned()
}

/// The prepared frame, unrotated, so full and binned renders share a grid.
fn prepare(path: &std::path::Path) -> RafMosaic {
    let mut prep = prepare_raf(&std::fs::read(path).unwrap(), RafDecodeOpts::default()).unwrap();
    prep.params.orientation = 1;
    prep
}

fn colour_of(params: &RafRenderParams, row: usize, col: usize) -> usize {
    let p = if params.is_xtrans { 6 } else { 2 };
    params.cfa[(row % p) * p + col % p] as usize % 3
}

/// Samples per channel at or above `frac` of the channel's clip level.
fn count_at(prep: &RafMosaic, frac: f32) -> [u64; 3] {
    let clip = prep.params.clip_levels.unwrap();
    let w = prep.params.width as usize;
    let mut n = [0u64; 3];
    for (row, line) in prep.mosaic.chunks_exact(w).enumerate() {
        for (col, &v) in line.iter().enumerate() {
            let c = colour_of(&prep.params, row, col);
            if v >= frac * clip[c] {
                n[c] += 1;
            }
        }
    }
    n
}

/// Files with at least this many fully clipped samples get the image checks.
const CLIPPED_ENOUGH: u64 = 20_000;

#[test]
fn clipped_samples_per_file() {
    let Some(files) = sample_files() else { return };
    println!("| file | clip levels R, G, B | samples ≥ 98 % of clip: R, G, B (‰ of channel) | brightest sample / clip: R, G, B | reconstruction |");
    for path in &files {
        let prep = prepare(path);
        let clip = prep.params.clip_levels.expect("prepare_raf records clip levels");
        let full = count_at(&prep, RAMP_END);
        let near = count_at(&prep, RAMP_START);
        let total = (prep.params.width as u64 * prep.params.height as u64).max(1);
        // X-Trans: 2/9 R, 5/9 G, 2/9 B.
        let share = if prep.params.is_xtrans { [2.0, 5.0, 2.0].map(|s| s / 9.0) } else { [0.25, 0.5, 0.25] };
        let permille: Vec<String> =
            (0..3).map(|c| format!("{} ({:.2})", full[c], full[c] as f64 / (total as f64 * share[c]) * 1000.0)).collect();
        let w = prep.params.width as usize;
        let mut top = [0.0f32; 3];
        for (row, line) in prep.mosaic.chunks_exact(w).enumerate() {
            for (col, &v) in line.iter().enumerate() {
                let c = colour_of(&prep.params, row, col);
                top[c] = top[c].max(v / clip[c]);
            }
        }
        println!(
            "| {} | {:.3}, {:.3}, {:.3} | {} | {:.4}, {:.4}, {:.4} | {} |",
            name(path),
            clip[0],
            clip[1],
            clip[2],
            permille.join(", "),
            top[0],
            top[1],
            top[2],
            if prep.params.highlight_chroma.is_some() { "on" } else { "off" }
        );
        // Reconstruction is on exactly when a sample comes near its clip
        // level (up to the few columns past the last whole block).
        if near.iter().sum::<u64>() == 0 {
            assert!(prep.params.highlight_chroma.is_none(), "{}", name(path));
        }
        if full.iter().sum::<u64>() > 1000 {
            assert!(prep.params.highlight_chroma.is_some(), "{}", name(path));
        }
        // Nothing is above the white level, so nothing above its clip level.
        for (row, line) in prep.mosaic.chunks_exact(w).enumerate().step_by(7) {
            for (col, &v) in line.iter().enumerate() {
                assert!(v <= clip[colour_of(&prep.params, row, col)], "{}: {v} above its clip level", name(path));
            }
        }
    }
}

fn to_srgb(params: &RafRenderParams, c: [f32; 3]) -> [f32; 3] {
    let m = &params.cam_to_srgb;
    std::array::from_fn(|r| m[r * 3] * c[0] + m[r * 3 + 1] * c[1] + m[r * 3 + 2] * c[2])
}

/// Hue angle (degrees) and chroma of linear sRGB in a plain opponent plane.
fn hue(c: [f32; 3]) -> (f32, f32) {
    let a = c[0] - c[1];
    let b = 0.5 * (c[0] + c[1]) - c[2];
    (b.atan2(a).to_degrees(), (a * a + b * b).sqrt())
}

fn luminance(c: [f32; 3]) -> f32 {
    0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

/// Chroma-weighted mean hue of `pixels`, in degrees, and how many.
fn mean_hue(pixels: impl Iterator<Item = [f32; 3]>) -> (f32, usize) {
    let (mut x, mut y, mut n) = (0.0f64, 0.0f64, 0usize);
    for c in pixels {
        let (h, ch) = hue(c);
        let w = f64::from(ch / luminance(c).max(1e-6));
        x += w * f64::from(h.to_radians().cos());
        y += w * f64::from(h.to_radians().sin());
        n += 1;
    }
    ((y.atan2(x).to_degrees()) as f32, n)
}

fn hue_gap(a: f32, b: f32) -> f32 {
    let d = (a - b).rem_euclid(360.0);
    d.min(360.0 - d)
}

struct Binned {
    w: usize,
    h: usize,
    /// Without reconstruction (the file's values).
    before: Vec<f32>,
    after: Vec<f32>,
    factor: u32,
}

fn binned(prep: &RafMosaic) -> Binned {
    let factor = binned_factor_for(&prep.params, 2048);
    let (w, h, after) = render_binned_linear(&prep.mosaic, &prep.params, factor).unwrap();
    let plain = RafRenderParams { highlight_chroma: None, ..prep.params.clone() };
    let (_, _, before) = render_binned_linear(&prep.mosaic, &plain, factor).unwrap();
    Binned { w: w as usize, h: h as usize, before, after, factor }
}

fn rgb(px: &[f32], i: usize) -> [f32; 3] {
    [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]]
}

#[test]
fn reconstructed_highlights_keep_the_hue_of_their_surround_and_meet_it_smoothly() {
    let Some(files) = sample_files() else { return };
    for path in &files {
        let prep = prepare(path);
        let full = count_at(&prep, RAMP_END);
        if full.iter().sum::<u64>() < CLIPPED_ENOUGH {
            continue;
        }
        let clip = prep.params.clip_levels.unwrap();
        let b = binned(&prep);
        let n = b.w * b.h;
        // Classified by the file's own values.
        let touched: Vec<bool> = (0..n).map(|i| (0..3).any(|k| rgb(&b.before, i)[k] >= RAMP_START * clip[k])).collect();
        let partial: Vec<bool> = (0..n)
            .map(|i| {
                let c = rgb(&b.before, i);
                let clipped = (0..3).filter(|&k| c[k] >= RAMP_END * clip[k]).count();
                (1..3).contains(&clipped)
            })
            .collect();
        // The surround: unclipped, bright, within 4 binned pixels of a touched one.
        let mut near = vec![false; n];
        for y in 0..b.h {
            for x in 0..b.w {
                if touched[y * b.w + x] {
                    for ny in y.saturating_sub(4)..(y + 5).min(b.h) {
                        for nx in x.saturating_sub(4)..(x + 5).min(b.w) {
                            near[ny * b.w + nx] = true;
                        }
                    }
                }
            }
        }
        // Sorted, for the tiles' lookups.
        let surround: Vec<usize> = (0..n)
            .filter(|&i| {
                let c = rgb(&b.before, i);
                near[i] && !touched[i] && (0..3).map(|k| c[k] / clip[k]).fold(0.0, f32::max) >= 0.5
            })
            .collect();
        // Hue, locally: in each 24-pixel tile with enough of both, the mean
        // hue of its partly clipped pixels against its surround's.
        let tile = 24usize;
        let mut gaps_after = Vec::new();
        let mut gaps_before = Vec::new();
        for ty in 0..b.h / tile {
            for tx in 0..b.w / tile {
                let idx: Vec<usize> =
                    (ty * tile..(ty + 1) * tile).flat_map(|y| (tx * tile..(tx + 1) * tile).map(move |x| y * b.w + x)).collect();
                let part: Vec<usize> = idx.iter().copied().filter(|&i| partial[i]).collect();
                let sur: Vec<usize> = idx.iter().copied().filter(|i| surround.binary_search(i).is_ok()).collect();
                if part.len() < 30 || sur.len() < 30 {
                    continue;
                }
                let (h_sur, _) = mean_hue(sur.iter().map(|&i| to_srgb(&prep.params, rgb(&b.before, i))));
                let (h_after, _) = mean_hue(part.iter().map(|&i| to_srgb(&prep.params, rgb(&b.after, i))));
                let (h_before, _) = mean_hue(part.iter().map(|&i| to_srgb(&prep.params, rgb(&b.before, i))));
                gaps_after.push(hue_gap(h_after, h_sur));
                gaps_before.push(hue_gap(h_before, h_sur));
            }
        }
        let median = |v: &mut Vec<f32>| {
            v.sort_by(f32::total_cmp);
            v.get(v.len() / 2).copied().unwrap_or(0.0)
        };
        let tiles = gaps_after.len();
        let (gap_after, gap_before) = (median(&mut gaps_after), median(&mut gaps_before));

        // Never below the value replaced.
        let lowered = (0..n * 4).filter(|&i| b.after[i] < b.before[i]).count();
        assert_eq!(lowered, 0, "{}: reconstruction lowered {lowered} values", name(path));

        // Continuity where reconstruction starts: horizontally adjacent pairs
        // in smooth bright areas (both at 85–98 % of clip in the file), one
        // below the start and one above, against the same pairs in the
        // file's own values.
        let ratio = |i: usize| {
            let c = rgb(&b.before, i);
            (0..3).map(|k| c[k] / clip[k]).fold(0.0f32, f32::max)
        };
        let step = |px: &[f32]| {
            let (mut s, mut m) = (0.0f64, 0usize);
            for y in 0..b.h {
                for x in 0..b.w - 1 {
                    let (i, j) = (y * b.w + x, y * b.w + x + 1);
                    let (ri, rj) = (ratio(i), ratio(j));
                    let smooth = (0.85..RAMP_END).contains(&ri) && (0.85..RAMP_END).contains(&rj);
                    if smooth && ((ri < RAMP_START) != (rj < RAMP_START)) {
                        let (li, lj) = (luminance(rgb(px, i)).max(1e-6), luminance(rgb(px, j)).max(1e-6));
                        s += f64::from((li / lj).ln().abs());
                        m += 1;
                    }
                }
            }
            (s / m.max(1) as f64, m)
        };
        let ((edge_before, pairs), (edge_after, _)) = (step(&b.before), step(&b.after));
        println!(
            "{}: binned by {}, {} partly clipped pixels; hue gap to the surround, median over {tiles} tiles: reconstructed {gap_after:.1}°, file's own {gap_before:.1}°; mean |Δ ln Y| across the start ({pairs} pairs): file {edge_before:.4}, reconstructed {edge_after:.4}",
            name(path),
            b.factor,
            partial.iter().filter(|&&p| p).count(),
        );
        if tiles >= 5 {
            assert!(
                gap_after <= gap_before + 2.0 && gap_after < 20.0,
                "{}: reconstructed highlights moved away from their surround's hue",
                name(path)
            );
        }
        assert!(edge_after <= edge_before * 1.5 + 0.005, "{}: a step where reconstruction starts", name(path));
    }
}

/// The most clipped sample file, if any is clipped enough.
fn most_clipped(files: &[PathBuf]) -> Option<(PathBuf, RafMosaic)> {
    let mut best: Option<(u64, PathBuf)> = None;
    for path in files {
        let prep = prepare(path);
        let n: u64 = count_at(&prep, RAMP_END).iter().sum();
        if n >= CLIPPED_ENOUGH && best.as_ref().is_none_or(|(m, _)| n > *m) {
            best = Some((n, path.clone()));
        }
    }
    best.map(|(_, p)| {
        let prep = prepare(&p);
        (p, prep)
    })
}

fn render_bands(prep: &RafMosaic, bands: &[RafBand]) -> Vec<f32> {
    let (w, h) = (prep.params.width as usize, prep.params.height as usize);
    let mut out = vec![f32::NAN; w * h * 4];
    for &band in bands {
        let src = &prep.mosaic[band.src_y0 as usize * w..band.src_y1 as usize * w];
        let px = render_linear_band(src, &prep.params, band).unwrap();
        let dst = (px.y as usize * w) * 4;
        out[dst..dst + px.pixels.len()].copy_from_slice(&px.pixels);
    }
    out
}

#[test]
fn full_resolution_reconstruction_bands_exactly_and_agrees_with_the_binned_view() {
    let Some(files) = sample_files() else { return };
    let Some((path, prep)) = most_clipped(&files) else {
        eprintln!("no sample file is clipped enough: skipped");
        return;
    };
    let (w, h) = (prep.params.width as usize, prep.params.height as usize);
    let whole = render_bands(&prep, &[RafBand { y0: 0, y1: h as u32, src_y0: 0, src_y1: h as u32 }]);
    let banded = render_bands(&prep, &plan_bands(h as u32, 7));
    let differ = whole.iter().zip(&banded).filter(|(a, b)| a.to_bits() != b.to_bits()).count();
    assert_eq!(differ, 0, "{}: {differ} values differ between one band and seven", name(&path));

    // The full render box-downscaled by the binned view's factor, against
    // the binned view: in the reconstructed areas, and in bright areas
    // nothing touched (how far binning and demosaicing differ anyway).
    let b = binned(&prep);
    let f = b.factor as usize;
    let clip = prep.params.clip_levels.unwrap();
    let mut diffs_touched = Vec::new();
    let mut diffs_plain = Vec::new();
    for by in 0..b.h {
        for bx in 0..b.w {
            let mut s = [0.0f32; 3];
            for dy in 0..f {
                for dx in 0..f {
                    let c = rgb(&whole, (by * f + dy) * w + bx * f + dx);
                    (0..3).for_each(|k| s[k] += c[k]);
                }
            }
            let down = s.map(|v| v / (f * f) as f32);
            let i = by * b.w + bx;
            let before = rgb(&b.before, i);
            let ratio = (0..3).map(|k| before[k] / clip[k]).fold(0.0f32, f32::max);
            let after = rgb(&b.after, i);
            let d = f64::from((luminance(down).max(1e-6) / luminance(after).max(1e-6)).ln().abs());
            if ratio >= RAMP_END {
                diffs_touched.push(d);
            } else if ratio >= 0.5 {
                diffs_plain.push(d);
            }
        }
    }
    let mean = |v: &[f64]| v.iter().sum::<f64>() / v.len().max(1) as f64;
    let (t, p) = (mean(&diffs_touched), mean(&diffs_plain));
    println!(
        "{}: one band = seven bands bit for bit; full vs binned (by {f}), mean |ln(Y_full / Y_binned)|: reconstructed {t:.4} over {} pixels, bright untouched {p:.4} over {}",
        name(&path),
        diffs_touched.len(),
        diffs_plain.len()
    );
    assert!(t <= (2.0 * p).max(0.03), "{}: the binned view and the full render disagree in reconstructed areas", name(&path));
}

#[test]
fn before_after_crops() {
    let Some(dir) = std::env::var_os("LOPSY_HIGHLIGHT_CROPS").map(PathBuf::from) else { return };
    let Some(files) = sample_files() else { return };
    for path in &files {
        let prep = prepare(path);
        if count_at(&prep, RAMP_END).iter().sum::<u64>() < CLIPPED_ENOUGH {
            continue;
        }
        let h = prep.params.height;
        let whole = render_bands(&prep, &[RafBand { y0: 0, y1: h, src_y0: 0, src_y1: h }]);
        write_crops(&dir, path, &prep, &whole);
    }
}

/// Before (the file's values, the tone step's highlight desaturation on)
/// and after (reconstructed, desaturation off) crops around the two
/// largest clipped areas of `whole`, through the tone and output steps for
/// sRGB, as 16-bit PNG.
fn write_crops(dir: &std::path::Path, path: &std::path::Path, prep: &RafMosaic, whole: &[f32]) {
    use lopsy_core::output::{output_reference, OutputSettings, OutputTarget};
    use lopsy_core::working_space::Gamut;
    std::fs::create_dir_all(dir).unwrap();
    let (w, h) = (prep.params.width as usize, prep.params.height as usize);
    let plain = RafRenderParams { highlight_chroma: None, ..prep.params.clone() };
    let plain_prep = RafMosaic { params: plain, mosaic: prep.mosaic.clone(), exif_info: prep.exif_info.clone(), debug_log: Vec::new() };
    let before_whole = render_bands(&plain_prep, &[RafBand { y0: 0, y1: h as u32, src_y0: 0, src_y1: h as u32 }]);
    let clip = prep.params.clip_levels.unwrap();
    // Partly clipped pixels per 256-pixel tile; crops centred on the two fullest.
    let tile = 256usize;
    let (tw, th) = (w / tile, h / tile);
    let mut counts: Vec<(usize, usize)> = (0..tw * th)
        .map(|t| {
            let (tx, ty) = (t % tw, t / tw);
            let mut n = 0;
            for y in (ty * tile..(ty + 1) * tile).step_by(4) {
                for x in (tx * tile..(tx + 1) * tile).step_by(4) {
                    let c = rgb(&before_whole, y * w + x);
                    if (0..3).any(|k| c[k] >= RAMP_END * clip[k]) && (0..3).any(|k| c[k] < RAMP_START * clip[k]) {
                        n += 1;
                    }
                }
            }
            (n, t)
        })
        .collect();
    counts.sort_by(|a, b| b.0.cmp(&a.0));
    let defaults = lopsy_core::raf::develop::develop_defaults(&prep.params);
    let out = OutputSettings::sdr(OutputTarget::Srgb, Gamut::Rec2020, false);
    let side = 640usize;
    let mut picked: Vec<(usize, usize)> = Vec::new();
    for &(n, t) in &counts {
        if n == 0 || picked.len() == 2 {
            break;
        }
        let (cx, cy) = ((t % tw) * tile + tile / 2, (t / tw) * tile + tile / 2);
        if picked.iter().any(|&(px, py)| px.abs_diff(cx) < side && py.abs_diff(cy) < side) {
            continue;
        }
        picked.push((cx, cy));
    }
    for (k, &(cx, cy)) in picked.iter().enumerate() {
        let x0 = cx.saturating_sub(side / 2).min(w - side);
        let y0 = cy.saturating_sub(side / 2).min(h - side);
        let mut row_pair: Vec<u16> = vec![0; side * 2 * side * 4];
        for (half, (src, desat)) in [(&before_whole, true), (&whole.to_vec(), false)].into_iter().enumerate() {
            let mut crop = Vec::with_capacity(side * side * 4);
            for y in y0..y0 + side {
                crop.extend_from_slice(&src[(y * w + x0) * 4..(y * w + x0 + side) * 4]);
            }
            let scene = scene_reference(&crop, &defaults);
            let mut tone = tone_settings(&defaults);
            tone.highlight_desaturation = desat;
            let rendered = lopsy_core::tone::tone_reference(&scene, &tone);
            let encoded = output_reference(&rendered, side as u32, &out);
            for y in 0..side {
                for x in 0..side {
                    for c in 0..4 {
                        let v = encoded[(y * side + x) * 4 + c].clamp(0.0, 1.0);
                        row_pair[(y * side * 2 + half * side + x) * 4 + c] = (v * 65535.0).round() as u16;
                    }
                }
            }
        }
        let png = lopsy_core::export::encode_png_16(&row_pair, (side * 2) as u32, side as u32, lopsy_core::color::ColorSpace::Srgb).unwrap();
        let file = dir.join(format!("{}-{}-before-left-after-right.png", name(path).trim_end_matches(".RAF"), k + 1));
        std::fs::write(&file, png).unwrap();
        println!("wrote {} (crop at {x0}, {y0}, {side} px)", file.display());
    }
}
