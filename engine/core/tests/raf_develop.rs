//! The linear RAF render plus the develop maths must reproduce today's
//! decode, and the linear render must band exactly like `render_band`.
//!
//! Set `LOPSY_RAF_SAMPLES` to a directory of real `.RAF` files to also run
//! the equivalence check on a crop of the first one (slow in a debug build:
//! run with `--release`).

mod support;

use lopsy_core::raf::develop::{develop_defaults, develop_reference, render_linear_band, render_linear_rgb};
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
