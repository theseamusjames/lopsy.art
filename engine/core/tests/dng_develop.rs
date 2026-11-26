//! The linear DNG path on real files: it decodes, bands exactly, a white
//! surface comes out near neutral through the default develop settings,
//! and the picture's brightness and colour are compared with today's baked
//! decode (`dng::read_dng`).
//!
//! The DNG files are not in this repository. Set `LOPSY_DNG_SAMPLES` to a
//! folder of `.dng` files (else `LOPSY_RAF_SAMPLES` is searched); without
//! either the test notes that and passes. Full-size files are slow in a
//! debug build: run with `--release`. With `LOPSY_DNG_REVIEW_DIR` set, a
//! side-by-side PNG of each file (baked decode left, the new path right) is
//! written there.

use std::path::{Path, PathBuf};

use lopsy_core::dng::linear::{develop_defaults, prepare_dng, prepare_dng_with, render_linear_band, white_balance_for_ratio, DngKind, PrepareOptions};
use lopsy_core::output::{output_reference, OutputSettings, OutputTarget};
use lopsy_core::raf::develop::{scene_reference, tone_settings};
use lopsy_core::raf::{plan_bands, RafBand};
use lopsy_core::working_space::Gamut;

fn sample_files() -> Vec<PathBuf> {
    let dirs = ["LOPSY_DNG_SAMPLES", "LOPSY_RAF_SAMPLES"].iter().filter_map(|k| std::env::var(k).ok());
    let mut files: Vec<PathBuf> = dirs
        .flat_map(|d| std::fs::read_dir(d).map(|r| r.filter_map(|e| e.ok().map(|e| e.path())).collect::<Vec<_>>()).unwrap_or_default())
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("dng")))
        .collect();
    files.sort();
    files.dedup();
    files
}

/// A region known to be a white surface, as fractions of the oriented
/// picture (x0, y0, x1, y1), for the samples that have one.
fn white_region(name: &str) -> Option<(f32, f32, f32, f32)> {
    match name {
        // The white rose's top outer petal, in sunlight. (The petals in
        // shade are lit by the sky and are rightly bluer.)
        "sample_dng_00.dng" => Some((0.44, 0.25, 0.55, 0.28)),
        _ => None,
    }
}

/// Means of `rgba` (`w`×`h`) over a `cols`×`rows` grid, by fraction of the
/// picture so two renders of different sizes compare cell for cell.
fn grid(rgba: &[f32], w: u32, h: u32, cols: u32, rows: u32) -> Vec<[f32; 3]> {
    let mut out = Vec::new();
    for gy in 0..rows {
        for gx in 0..cols {
            out.push(region_mean(rgba, w, h, (gx as f32 / cols as f32, gy as f32 / rows as f32, (gx + 1) as f32 / cols as f32, (gy + 1) as f32 / rows as f32)));
        }
    }
    out
}

fn region_mean(rgba: &[f32], w: u32, h: u32, r: (f32, f32, f32, f32)) -> [f32; 3] {
    let (x0, y0) = ((r.0 * w as f32) as u32, (r.1 * h as f32) as u32);
    let (x1, y1) = (((r.2 * w as f32) as u32).max(x0 + 1), ((r.3 * h as f32) as u32).max(y0 + 1));
    let mut sum = [0.0f64; 3];
    let mut n = 0.0;
    for y in y0..y1.min(h) {
        for x in x0..x1.min(w) {
            let i = ((y * w + x) * 4) as usize;
            for c in 0..3 {
                sum[c] += f64::from(rgba[i + c]);
            }
            n += 1.0;
        }
    }
    sum.map(|s| (s / n) as f32)
}

fn decode_srgb(e: f32) -> f32 {
    lopsy_core::working_space::srgb_decode(e.clamp(0.0, 1.0))
}

fn luminance_encoded(c: [f32; 3]) -> f32 {
    let lin = c.map(decode_srgb);
    lopsy_core::working_space::srgb_encode(0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2])
}

/// Box-downscale to at most `long` pixels on the long edge, 8-bit RGB.
fn thumbnail(rgba: &[f32], w: u32, h: u32, long: u32) -> (u32, u32, Vec<u8>) {
    let f = w.max(h).div_ceil(long).max(1);
    let (tw, th) = (w / f, h / f);
    let mut out = Vec::with_capacity((tw * th * 3) as usize);
    for ty in 0..th {
        for tx in 0..tw {
            let m = region_mean(rgba, w, h, ((tx * f) as f32 / w as f32, (ty * f) as f32 / h as f32, ((tx + 1) * f) as f32 / w as f32, ((ty + 1) * f) as f32 / h as f32));
            out.extend(m.map(|v| (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8));
        }
    }
    (tw, th, out)
}

fn write_side_by_side(path: &Path, left: (u32, u32, Vec<u8>), right: (u32, u32, Vec<u8>)) {
    let (w, h) = (left.0 + right.0 + 16, left.1.max(right.1));
    let mut img = vec![255u8; (w * h * 3) as usize];
    for (part, x0) in [(&left, 0), (&right, left.0 + 16)] {
        for y in 0..part.1 {
            let src = (y * part.0 * 3) as usize;
            let dst = ((y * w + x0) * 3) as usize;
            img[dst..dst + (part.0 * 3) as usize].copy_from_slice(&part.2[src..src + (part.0 * 3) as usize]);
        }
    }
    let file = std::fs::File::create(path).unwrap();
    let mut enc = png::Encoder::new(std::io::BufWriter::new(file), w, h);
    enc.set_color(png::ColorType::Rgb);
    enc.set_depth(png::BitDepth::Eight);
    enc.write_header().unwrap().write_image_data(&img).unwrap();
}

#[test]
fn real_dngs_take_the_linear_path() {
    let files = sample_files();
    if files.is_empty() {
        println!("No DNG files: set LOPSY_DNG_SAMPLES (or LOPSY_RAF_SAMPLES) to a folder of .dng files. Skipping.");
        return;
    }
    for path in files {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let data = std::fs::read(&path).unwrap();
        let prep = match prepare_dng(&data) {
            Ok(p) => p,
            Err(e) => panic!("{name}: the linear path refused the file: {e}"),
        };
        let p = &prep.params;
        let cal = &p.calibration;
        println!("\n=== {name}: {} ({:?}), {}×{} ({} bytes)", p.camera_model, p.kind, p.width, p.height, data.len());
        println!(
            "  illuminants {} / {:?}, forward matrices {} / {}, camera calibration {}, analog balance {:?}",
            cal.first.illuminant,
            cal.second.as_ref().map(|s| s.illuminant),
            cal.first.forward_matrix.is_some(),
            cal.second.as_ref().is_some_and(|s| s.forward_matrix.is_some()),
            cal.first.camera_calibration.is_some(),
            cal.analog_balance
        );
        println!(
            "  as-shot neutral {:?}, white xy {:?}, baseline exposure {:.3} EV, white level {}, orientation {}",
            cal.as_shot_neutral, cal.as_shot_white_xy, cal.baseline_exposure, p.white_level, p.orientation
        );
        println!("  not applied: {:?}", prep.unhandled);
        let wb = white_balance_for_ratio(p, [1.0, 1.0, 1.0]).unwrap();
        println!("  as shot: {:.0} K, tint {:+.1}, xy {:?}", wb.kelvin, wb.tint, wb.white_xy);
        assert!((1667.0..=25000.0).contains(&wb.kelvin));

        // Band-wise equals whole-frame.
        let whole_band = RafBand { y0: 0, y1: p.height, src_y0: 0, src_y1: p.height };
        let whole = render_linear_band(&prep.plane, p, whole_band).unwrap();
        let (ow, oh) = p.oriented_size();
        assert_eq!((whole.width, whole.height), (ow, oh));
        let row_len = p.width as usize * p.samples_per_pixel as usize;
        let mut banded = vec![f32::NAN; whole.pixels.len()];
        for band in plan_bands(p.height, 5) {
            let src = &prep.plane[band.src_y0 as usize * row_len..band.src_y1 as usize * row_len];
            let px = render_linear_band(src, p, band).unwrap();
            for row in 0..px.height {
                let dst = (((px.y + row) * ow + px.x) * 4) as usize;
                let s = (row * px.width * 4) as usize;
                banded[dst..dst + (px.width * 4) as usize].copy_from_slice(&px.pixels[s..s + (px.width * 4) as usize]);
            }
        }
        let differing = whole.pixels.iter().zip(&banded).filter(|(a, b)| a.to_bits() != b.to_bits()).count();
        assert_eq!(differing, 0, "{name}: banded render differs from the whole frame");

        // The default develop, working space on, output for sRGB, without
        // the Standard look's saturation: the colour compared with the
        // baked decode below is the colorimetric one, which the look then
        // deliberately makes more colourful. The baked decode does not
        // apply a ProfileGainTableMap and the linear path does: the
        // comparison is of the plane without it (`dng_gain_map.rs` checks
        // the map against the camera's preview).
        let unmapped = prepare_dng_with(&data, PrepareOptions { apply_gain_table_map: false }).unwrap();
        let whole = render_linear_band(&unmapped.plane, &unmapped.params, whole_band).unwrap();
        let settings = lopsy_core::raf::develop::RawDevelopSettings { saturation: 1.0, ..develop_defaults(p).unwrap() };
        let scene = scene_reference(&whole.pixels, &settings);
        let rendered = lopsy_core::tone::tone_reference(&scene, &tone_settings(&settings));
        let new = output_reference(&rendered, ow, &OutputSettings::sdr(OutputTarget::Srgb, Gamut::Rec2020, false));
        drop(scene);
        drop(rendered);

        let baked = lopsy_core::dng::read_dng(&data).unwrap();
        println!("  baked decode {}×{}, new {}×{}", baked.width, baked.height, ow, oh);
        if let Ok(dir) = std::env::var("LOPSY_DNG_REVIEW_DIR") {
            let out = Path::new(&dir).join(format!("{}-baked-vs-linear.png", name.trim_end_matches(".dng")));
            write_side_by_side(&out, thumbnail(&baked.pixels, baked.width, baked.height, 1200), thumbnail(&new, ow, oh, 1200));
            println!("  wrote {}", out.display());
        }
        let (cols, rows) = (16, 12);
        let g_new = grid(&new, ow, oh, cols, rows);
        let g_old = grid(&baked.pixels, baked.width, baked.height, cols, rows);
        let mean = |g: &[[f32; 3]]| -> [f32; 3] { std::array::from_fn(|c| g.iter().map(|v| v[c]).sum::<f32>() / g.len() as f32) };
        let (m_new, m_old) = (mean(&g_new), mean(&g_old));
        let lum = |g: &[[f32; 3]]| g.iter().map(|&c| luminance_encoded(c)).sum::<f32>() / g.len() as f32;
        let (l_new, l_old) = (lum(&g_new), lum(&g_old));
        let mad: [f32; 3] = std::array::from_fn(|c| g_new.iter().zip(&g_old).map(|(a, b)| (a[c] - b[c]).abs()).sum::<f32>() / g_new.len() as f32 * 255.0);
        // Colour of the whole picture: each cell's chromaticity in linear
        // sRGB (r / sum, b / sum), averaged.
        let chroma = |g: &[[f32; 3]]| -> [f32; 2] {
            let v: Vec<[f32; 2]> = g
                .iter()
                .map(|c| c.map(decode_srgb))
                .filter(|c| c.iter().sum::<f32>() > 0.01)
                .map(|c| {
                    let s: f32 = c.iter().sum();
                    [c[0] / s, c[2] / s]
                })
                .collect();
            [v.iter().map(|x| x[0]).sum::<f32>() / v.len() as f32, v.iter().map(|x| x[1]).sum::<f32>() / v.len() as f32]
        };
        let (c_new, c_old) = (chroma(&g_new), chroma(&g_old));
        println!("  mean encoded RGB (16×12 cells): new {m_new:.3?}, baked {m_old:.3?}");
        println!("  mean encoded luminance: new {l_new:.3}, baked {l_old:.3} ({:+.2} stops of linear light)", (decode_srgb(l_new) / decode_srgb(l_old)).log2());
        println!("  mean |cell difference| (of 255): R {:.1}, G {:.1}, B {:.1}", mad[0], mad[1], mad[2]);
        println!("  mean cell chromaticity r, b (linear): new {c_new:.4?}, baked {c_old:.4?}");
        // A large baseline exposure is Apple's lift for a dark scene, which
        // its local tone map (ProfileGainTableMap, left out of both sides
        // here) holds back in the highlights; the baked decode's
        // auto-levels pulls it back down and the new path does not, so
        // such a file is not expected to match.
        if cal.baseline_exposure.abs() <= 1.0 {
            assert!((l_new - l_old).abs() < 0.05, "{name}: brightness {l_new} against the baked {l_old}");
            assert!((c_new[0] - c_old[0]).abs() < 0.01 && (c_new[1] - c_old[1]).abs() < 0.01, "{name}: colour {c_new:?} against {c_old:?}");
        } else {
            println!("  baseline exposure {:.2} EV: brightness and colour not compared (see the test's notes)", cal.baseline_exposure);
        }

        if let Some(region) = white_region(&name) {
            let lin_srgb: Vec<f32> = new.iter().map(|&v| decode_srgb(v)).collect();
            let c = region_mean(&lin_srgb, ow, oh, region);
            let old = region_mean(&baked.pixels.iter().map(|&v| decode_srgb(v)).collect::<Vec<_>>(), baked.width, baked.height, region);
            let spread = |c: [f32; 3]| c.iter().cloned().fold(f32::MIN, f32::max) / c.iter().cloned().fold(f32::MAX, f32::min);
            println!("  white region linear sRGB: new {c:.3?} (max/min {:.3}), baked {old:.3?} (max/min {:.3})", spread(c), spread(old));
            assert!(spread(c) < 1.06, "{name}: the white petal is not near neutral: {c:?}");
        }

        if p.kind == DngKind::Bayer {
            println!("  (a mosaic DNG: demosaiced with the bilinear Bayer interpolation)");
        }
    }
}

/// The bytes are untrusted: a damaged file is refused with a reason (the
/// host then falls back to the baked decode), never a panic. Damage is
/// made from the real files: cut short at many lengths, and single bytes
/// changed in the headers and in the compressed data.
#[test]
fn damaged_dngs_are_refused_not_panicked_on() {
    assert!(prepare_dng(b"not a dng at all").is_err());
    assert!(prepare_dng(&[]).is_err());
    let files = sample_files();
    if files.is_empty() {
        println!("No DNG files: set LOPSY_DNG_SAMPLES (or LOPSY_RAF_SAMPLES). Skipping the damaged-file cases.");
        return;
    }
    for path in files {
        let data = std::fs::read(&path).unwrap();
        for cut in [8usize, 64, 512, 4096, 65_536, data.len() / 3, data.len() - 1] {
            let r = prepare_dng(&data[..cut.min(data.len())]);
            assert!(r.is_err(), "{}: a file cut at {cut} bytes decoded", path.display());
        }
        let mut seed = 0x2545_f491_4f6c_dd1du64;
        let mut refused = 0;
        for i in 0..24 {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            let mut damaged = data.clone();
            // Half in the headers, half anywhere (the compressed tiles).
            let at = (seed % if i % 2 == 0 { 4096 } else { data.len() as u64 }) as usize;
            damaged[at] ^= (seed >> 32) as u8 | 1;
            if prepare_dng(&damaged).is_err() {
                refused += 1;
            }
        }
        println!("{}: {refused} of 24 single-byte changes refused, the rest decoded", path.display());
    }
}
