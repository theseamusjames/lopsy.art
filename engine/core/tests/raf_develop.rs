//! The linear RAF render plus the develop maths must reproduce today's
//! decode, and the linear render must band exactly like `render_band`.
//!
//! Set `LOPSY_RAF_SAMPLES` to a directory of real `.RAF` files to also run
//! the equivalence check on a crop of the first one (slow in a debug build:
//! run with `--release`).

mod support;

use lopsy_core::raf::develop::{
    binned_factor_for, develop_defaults, develop_reference, is_valid_bin_factor, render_binned_linear, render_linear_band,
    render_linear_rgb,
};
use lopsy_core::raf::{plan_bands, prepare_raf, render_rgb_unsharpened, RafBand, RafDecodeOpts, RafRenderParams, BAND_HALO_ROWS};
use support::synthetic_raf::SyntheticRaf;

fn render_linear_banded(data: &[u8], bands: &[RafBand]) -> (u32, u32, Vec<f32>) {
    let prep = prepare_raf(data, RafDecodeOpts::default()).unwrap();
    let json = serde_json::to_string(&prep.params).unwrap();
    let p: RafRenderParams = serde_json::from_str(&json).unwrap();
    let (ow, oh) = p.oriented_size();
    let mut out = vec![f32::NAN; (ow * oh * 4) as usize];
    let w = p.width as usize;
    for &band in bands {
        let src = &prep.mosaic[band.src_y0 as usize * w..band.src_y1 as usize * w];
        let px = render_linear_band(src, &p, band).unwrap();
        assert!(px.x + px.width <= ow && px.y + px.height <= oh, "{band:?} lands outside the image");
        for row in 0..px.height {
            let dst = (((px.y + row) * ow + px.x) * 4) as usize;
            let src = (row * px.width * 4) as usize;
            let len = (px.width * 4) as usize;
            out[dst..dst + len].copy_from_slice(&px.pixels[src..src + len]);
        }
    }
    (ow, oh, out)
}

/// The whole frame as one band: the reference the banded renders must hit.
fn render_linear_whole(data: &[u8]) -> Vec<f32> {
    let prep = prepare_raf(data, RafDecodeOpts::default()).unwrap();
    let h = prep.params.height;
    let band = RafBand { y0: 0, y1: h, src_y0: 0, src_y1: h };
    render_linear_band(&prep.mosaic, &prep.params, band).unwrap().pixels
}

fn assert_bit_identical(name: &str, expected: &[f32], actual: &[f32]) {
    assert_eq!(expected.len(), actual.len(), "{name}: length");
    let mismatches = expected.iter().zip(actual).filter(|(e, a)| e.to_bits() != a.to_bits()).count();
    assert_eq!(mismatches, 0, "{name}: {mismatches} values differ from the whole-frame linear render");
}

#[test]
fn linear_bands_match_whole_frame_in_every_orientation() {
    for orientation in 1..=8u16 {
        let mut cfg = SyntheticRaf::small(331, 418);
        cfg.orientation = orientation;
        let data = cfg.build();
        let whole = render_linear_whole(&data);
        let (_, _, banded) = render_linear_banded(&data, &plan_bands(418, 4));
        assert_bit_identical(&format!("orientation {orientation}"), &whole, &banded);
    }
}

#[test]
fn thin_linear_bands_match_whole_frame() {
    let mut cfg = SyntheticRaf::small(205, 160);
    cfg.crop_top = 4;
    cfg.crop_left = 9;
    let data = cfg.build();
    let whole = render_linear_whole(&data);
    let height = 160;
    let bands: Vec<RafBand> = (0..height)
        .step_by(6)
        .map(|y0| {
            let y1 = (y0 + 6).min(height);
            RafBand { y0, y1, src_y0: y0.saturating_sub(BAND_HALO_ROWS), src_y1: (y1 + BAND_HALO_ROWS).min(height) }
        })
        .collect();
    let (_, _, banded) = render_linear_banded(&data, &bands);
    assert_bit_identical("thin bands", &whole, &banded);
}

#[test]
fn bayer_linear_bands_match_whole_frame() {
    let mut cfg = SyntheticRaf::small(240, 300);
    cfg.model = "X-A5";
    let data = cfg.build();
    let whole = render_linear_whole(&data);
    let (_, _, banded) = render_linear_banded(&data, &plan_bands(300, 3));
    assert_bit_identical("bayer", &whole, &banded);
}

#[test]
fn linear_render_is_not_clamped() {
    let data = SyntheticRaf::small(120, 96).build();
    let prep = prepare_raf(&data, RafDecodeOpts::default()).unwrap();
    // Push the mosaic over white, as a strong as-shot white balance does to
    // red and blue highlights: the linear render must keep the excess.
    let hot: Vec<f32> = prep.mosaic.iter().map(|v| v * 4.0).collect();
    let band = RafBand { y0: 0, y1: 96, src_y0: 0, src_y1: 96 };
    let px = render_linear_band(&hot, &prep.params, band).unwrap().pixels;
    assert!(px.iter().all(|v| v.is_finite()));
    assert!(px.iter().any(|&v| v > 1.0), "expected values above 1.0");
    assert!(px.chunks_exact(4).all(|p| p[3] == 1.0));
}

struct Diff {
    max: f32,
    mean: f32,
    over_half_step: usize,
    count: usize,
}

/// Linear render → develop with the defaults, against `render_rgb` without
/// capture sharpening, both clamped to 0..1 as the import clamps them.
fn compare_with_today(mosaic: &[f32], params: &RafRenderParams) -> Diff {
    let (w, h) = (params.width as usize, params.height as usize);
    let today = render_rgb_unsharpened(mosaic, w, h, params);
    let linear = render_linear_rgb(mosaic, w, h, params);
    let rgba: Vec<f32> = linear.chunks_exact(3).flat_map(|c| [c[0], c[1], c[2], 1.0]).collect();
    let developed = develop_reference(&rgba, &develop_defaults(params));
    let mut d = Diff { max: 0.0, mean: 0.0, over_half_step: 0, count: 0 };
    let mut sum = 0.0f64;
    for (t, px) in today.chunks_exact(3).zip(developed.chunks_exact(4)) {
        for c in 0..3 {
            let e = (t[c].clamp(0.0, 1.0) - px[c].clamp(0.0, 1.0)).abs();
            d.max = d.max.max(e);
            sum += e as f64;
            if e > 0.5 / 255.0 {
                d.over_half_step += 1;
            }
            d.count += 1;
        }
    }
    d.mean = (sum / d.count as f64) as f32;
    d
}

#[test]
fn default_develop_reproduces_todays_decode() {
    for (name, model) in [("x-trans", "X-T5"), ("bayer", "X-A5")] {
        let mut cfg = SyntheticRaf::small(240, 216);
        cfg.model = model;
        let data = cfg.build();
        let prep = prepare_raf(&data, RafDecodeOpts::default()).unwrap();
        let d = compare_with_today(&prep.mosaic, &prep.params);
        println!(
            "{name}: max |Δ| {:.2e}, mean {:.2e}, {} of {} channels over half an 8-bit step",
            d.max, d.mean, d.over_half_step, d.count
        );
        assert!(d.max < 1e-3, "{name}: max difference {}", d.max);
        assert_eq!(d.over_half_step, 0, "{name}");
    }
}

#[test]
fn default_develop_reproduces_todays_decode_on_a_real_sample() {
    let Ok(dir) = std::env::var("LOPSY_RAF_SAMPLES") else {
        eprintln!("LOPSY_RAF_SAMPLES not set; skipping");
        return;
    };
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("raf")))
        .collect();
    files.sort();
    let Some(path) = files.first() else {
        eprintln!("no .RAF in {dir}; skipping");
        return;
    };
    let data = std::fs::read(path).unwrap();
    let prep = prepare_raf(&data, RafDecodeOpts::default()).unwrap();
    // A 600×600 crop from the middle, on the 6-pixel CFA period so the
    // pattern applies unshifted.
    let (w, h) = (prep.params.width as usize, prep.params.height as usize);
    let side = 600usize.min(w).min(h) / 6 * 6;
    let x0 = (w / 2 - side / 2) / 6 * 6;
    let y0 = (h / 2 - side / 2) / 6 * 6;
    let mut crop = Vec::with_capacity(side * side);
    for row in y0..y0 + side {
        crop.extend_from_slice(&prep.mosaic[row * w + x0..row * w + x0 + side]);
    }
    let mut params = prep.params.clone();
    params.width = side as u32;
    params.height = side as u32;
    let d = compare_with_today(&crop, &params);
    println!(
        "{}: max |Δ| {:.2e}, mean {:.2e}, {} of {} channels over half an 8-bit step",
        path.display(),
        d.max,
        d.mean,
        d.over_half_step,
        d.count
    );
    assert!(d.max < 1e-3, "max difference {}", d.max);
    assert_eq!(d.over_half_step, 0);
}

/// The synthetic RAF writer only makes X-Trans data, so a Bayer frame is
/// made from its full linear render, sampled through an RGGB pattern.
fn bayer_from_xtrans(w: u16, h: u16) -> (Vec<f32>, RafRenderParams) {
    let prep = prepare_raf(&SyntheticRaf::small(w, h).build(), RafDecodeOpts::default()).unwrap();
    let (w, h) = (w as usize, h as usize);
    let rgb = render_linear_rgb(&prep.mosaic, w, h, &prep.params);
    let rggb = [0u8, 1, 1, 2];
    let mosaic = (0..w * h).map(|i| rgb[i * 3 + rggb[(i / w % 2) * 2 + i % w % 2] as usize]).collect();
    let mut params = prep.params.clone();
    params.is_xtrans = false;
    params.cfa = rggb.iter().cycle().take(36).copied().collect();
    (mosaic, params)
}

/// Binned preview against the full linear render box-downscaled over the
/// same blocks, both developed with the defaults and compared in 8-bit
/// sRGB steps: (mean, 99th percentile, max). Tolerances: on the synthetic
/// frames mean < 2 and p99 < 14 steps; on a real crop mean < 6 and p99 < 45
/// at /3, mean < 3 and p99 < 25 at /6. Binning has no demosaic, so edges
/// alias; the max is not bounded.
fn binned_vs_box(mosaic: &[f32], params: &RafRenderParams, factor: u32) -> (f32, f32, f32) {
    let mut p = params.clone();
    p.orientation = 1;
    let (w, h, f) = (p.width as usize, p.height as usize, factor as usize);
    let (bw, bh, binned) = render_binned_linear(mosaic, &p, factor).unwrap();
    assert_eq!((bw as usize, bh as usize), (w / f, h / f));
    let full = render_linear_rgb(mosaic, w, h, &p);
    let mut boxed = vec![0.0f32; binned.len()];
    for by in 0..h / f {
        for bx in 0..w / f {
            let o = (by * (w / f) + bx) * 4;
            for dy in 0..f {
                for dx in 0..f {
                    let i = ((by * f + dy) * w + bx * f + dx) * 3;
                    for c in 0..3 {
                        boxed[o + c] += full[i + c] / (f * f) as f32;
                    }
                }
            }
            boxed[o + 3] = 1.0;
        }
    }
    let settings = develop_defaults(&p);
    let a = develop_reference(&binned, &settings);
    let b = develop_reference(&boxed, &settings);
    let mut steps: Vec<f32> = a
        .iter()
        .zip(&b)
        .enumerate()
        .filter(|(i, _)| i % 4 != 3)
        .map(|(_, (x, y))| (x.clamp(0.0, 1.0) - y.clamp(0.0, 1.0)).abs() * 255.0)
        .collect();
    let mean = steps.iter().sum::<f32>() / steps.len() as f32;
    steps.sort_by(f32::total_cmp);
    (mean, steps[steps.len() * 99 / 100], *steps.last().unwrap())
}

#[test]
fn bin_factors_keep_every_colour_in_every_block() {
    let xt = prepare_raf(&SyntheticRaf::small(240, 216).build(), RafDecodeOpts::default()).unwrap().params;
    assert!(!is_valid_bin_factor(&xt, 2));
    assert!(is_valid_bin_factor(&xt, 3), "the X-Trans 3x3 halves each hold R, G and B");
    assert!(is_valid_bin_factor(&xt, 6) && is_valid_bin_factor(&xt, 12));
    let bayer = bayer_from_xtrans(240, 216).1;
    assert!(is_valid_bin_factor(&bayer, 2) && is_valid_bin_factor(&bayer, 4));
    assert!(!is_valid_bin_factor(&bayer, 3), "only whole 2x2 periods");
    assert!(!is_valid_bin_factor(&xt, 4), "only whole 3x3 halves");
    // A 7752-wide frame: factor 3 keeps 2584 px ≥ 2048; 6 would fall short.
    let mut big = xt.clone();
    big.width = 7752;
    big.height = 5178;
    assert_eq!(binned_factor_for(&big, 2048), 3);
    assert_eq!(binned_factor_for(&big, 1024), 6);
    assert_eq!(binned_factor_for(&xt, 2048), 3, "a small frame takes the finest factor");
}

#[test]
fn binned_preview_matches_a_box_downscaled_linear_render() {
    let prep = prepare_raf(&SyntheticRaf::small(240, 216).build(), RafDecodeOpts::default()).unwrap();
    let bayer = bayer_from_xtrans(240, 216);
    let cases: [(&str, &[f32], &RafRenderParams, u32); 4] = [
        ("x-trans", &prep.mosaic, &prep.params, 3),
        ("x-trans", &prep.mosaic, &prep.params, 6),
        ("bayer", &bayer.0, &bayer.1, 2),
        ("bayer", &bayer.0, &bayer.1, 4),
    ];
    for (name, mosaic, params, f) in cases {
        let (mean, p99, max) = binned_vs_box(mosaic, params, f);
        println!("{name} /{f}: binned vs box-downscaled, 8-bit steps: mean {mean:.2}, p99 {p99:.2}, max {max:.2}");
        // The limits follow the camera matrix: the binned view takes each
        // colour from a different place in its block, and the matrix turns
        // that into colour. With the sensor's matrix in `camera_colour`
        // (red row 1.78, −0.71, −0.07) the worst case measures mean 1.96
        // and p99 21.5; with the matrix it replaced (red row 1.26, 0.03,
        // −0.29) it measured 1.28 and 11.2.
        assert!(mean < 2.4 && p99 < 25.0, "{name} /{f}: mean {mean}, p99 {p99}");
    }
}

#[test]
fn binned_preview_orients_like_the_bands() {
    for orientation in 1..=8u16 {
        let mut cfg = SyntheticRaf::small(240, 216);
        cfg.orientation = orientation;
        let prep = prepare_raf(&cfg.build(), RafDecodeOpts::default()).unwrap();
        let (w, h, px) = render_binned_linear(&prep.mosaic, &prep.params, 3).unwrap();
        assert_eq!((w, h), match orientation { 5..=8 => (72, 80), _ => (80, 72) }, "orientation {orientation}");
        assert_eq!(px.len(), (w * h * 4) as usize);
        assert!(px.iter().all(|v| v.is_finite()));
    }
}

#[test]
fn binned_preview_on_a_real_sample() {
    let Ok(dir) = std::env::var("LOPSY_RAF_SAMPLES") else {
        eprintln!("LOPSY_RAF_SAMPLES not set; skipping");
        return;
    };
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("raf")))
        .collect();
    files.sort();
    let Some(path) = files.first() else { return };
    let data = std::fs::read(path).unwrap();
    let t = std::time::Instant::now();
    let prep = prepare_raf(&data, RafDecodeOpts::default()).unwrap();
    let prepare_ms = t.elapsed().as_secs_f64() * 1000.0;
    let t = std::time::Instant::now();
    let factor = binned_factor_for(&prep.params, 2048);
    let (w, h, px) = render_binned_linear(&prep.mosaic, &prep.params, factor).unwrap();
    let bin_ms = t.elapsed().as_secs_f64() * 1000.0;
    assert_eq!(px.len(), (w * h * 4) as usize);
    println!(
        "{}: {}x{} mosaic, prepare {prepare_ms:.0} ms, binned /{factor} to {w}x{h} in {bin_ms:.0} ms",
        path.display(),
        prep.params.width,
        prep.params.height
    );

    let (fw, fh) = (prep.params.width as usize, prep.params.height as usize);
    let side = 1200usize.min(fw).min(fh) / 6 * 6;
    let (x0, y0) = ((fw / 2 - side / 2) / 6 * 6, (fh / 2 - side / 2) / 6 * 6);
    let mut crop = Vec::with_capacity(side * side);
    for row in y0..y0 + side {
        crop.extend_from_slice(&prep.mosaic[row * fw + x0..row * fw + x0 + side]);
    }
    let mut params = prep.params.clone();
    params.width = side as u32;
    params.height = side as u32;
    for f in [3u32, 6] {
        let (mean, p99, max) = binned_vs_box(&crop, &params, f);
        println!("real /{f}: binned vs box-downscaled, 8-bit steps: mean {mean:.2}, p99 {p99:.2}, max {max:.2}");
        // Real detail aliases more than the synthetic frame (see the module notes).
        // With the sensor's matrix in `camera_colour`: 5.74 and 45.4 at /3,
        // 2.77 and 24.1 at /6 (4.46 and 35.4, 2.13 and 18.7 with the matrix
        // it replaced).
        let (mean_max, p99_max) = if f == 3 { (6.6, 52.0) } else { (3.2, 28.0) };
        assert!(mean < mean_max && p99 < p99_max, "/{f}: mean {mean}, p99 {p99}");
    }
}
