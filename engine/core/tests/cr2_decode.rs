//! Canon CR2 decoding on real files: every `.CR2` in `LOPSY_CR2_SAMPLES`
//! that is a full-size RAW decodes, both ways (`cr2::read_cr2`, baked;
//! `cr2::linear::prepare_cr2`, for the develop chain), and is compared with
//! the camera's own rendering embedded in the file (its full-size preview
//! JPEG). Reduced-size sRAW and mRAW files are refused with their sentence.
//!
//! What is compared, coarsely, because the camera's JPEG is not a neutral
//! decode (it adds a tone curve, the picture style and lens corrections,
//! and the camera's colour, which a CR2 does not carry):
//!
//! - geometry: the decode's size and aspect against the JPEG's, and the
//!   shift (in pixels of 1000-pixel-wide copies) at which the two
//!   pictures' luminance correlates best over their middle, which is 0, 0
//!   when the crop and orientation are right;
//! - tone: the rank correlation of the cells' luminance on a 48 × 32 grid;
//! - colour: over the cells, the mean hue difference and the ratio of
//!   saturations, and the mean cast of the cells the JPEG shows as
//!   near-neutral (the as-shot white balance and the colour filter's
//!   layout);
//! - slices: the median difference between neighbouring pixels of one
//!   colour across each slice edge and in the columns just beside it (a
//!   mis-ordered or shifted slice makes its edge rougher).
//!
//! The numbers are printed; the assertions are loose bounds a wrong decode
//! breaks. Full-size files: run with `--release`. Without
//! `LOPSY_CR2_SAMPLES` the tests note that and pass. With
//! `LOPSY_CR2_REVIEW_DIR`, review images are written there: the picture
//! reduced, the camera's JPEG beside it, and 100 % crops across a slice
//! edge and of the brightest area.

use std::path::PathBuf;

use lopsy_core::cr2::{self, linear as cr2_linear};
use lopsy_core::dng::linear::{render_binned_linear_for, render_linear_band};
use lopsy_core::output::{output_reference, OutputSettings, OutputTarget};
use lopsy_core::raf::develop::{scene_reference, tone_settings};
use lopsy_core::raf::{plan_bands, RafBand};
use lopsy_core::working_space::Gamut;

#[path = "support/raw_compare.rs"]
mod raw_compare;
use raw_compare::{best_shift, brightness, compare, Picture};

fn files() -> Vec<PathBuf> {
    let Some(dir) = std::env::var_os("LOPSY_CR2_SAMPLES") else { return Vec::new() };
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir).map(|r| r.flatten().map(|e| e.path()).collect()).unwrap_or_default();
    v.retain(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("cr2")));
    v.sort();
    v
}

/// The camera's full-size preview: the largest JPEG the file embeds.
fn embedded_jpeg(data: &[u8]) -> Option<Picture> {
    let (o, n) = cr2::preview_ranges(data).into_iter().max_by_key(|r| r.1)?;
    let mut dec = jpeg_decoder::Decoder::new(&data[o..o + n]);
    let px = dec.decode().ok()?;
    let info = dec.info()?;
    (info.pixel_format == jpeg_decoder::PixelFormat::RGB24).then(|| Picture::from_rgb8(info.width as usize, info.height as usize, &px))
}

/// The median |difference| between same-colour neighbours two columns
/// apart next to each slice edge (at plane columns `edges`): for the two
/// pairs that cross it, and for the pairs a few columns either side that
/// do not. A misplaced slice makes every row jump at its edge, which moves
/// the median; a picture's own edge running along a slice edge (the 40D's
/// chart) moves only a mean.
fn slice_edges(plane: &[f32], w: usize, h: usize, edges: &[usize]) -> (f64, f64) {
    let (mut inside, mut across) = (Vec::new(), Vec::new());
    for &e in edges {
        for x in e.saturating_sub(16)..(e + 16).min(w - 2) {
            let crosses = x < e && e <= x + 2;
            for y in 0..h {
                let d = f64::from((plane[y * w + x] - plane[y * w + x + 2]).abs());
                if crosses {
                    across.push(d);
                } else {
                    inside.push(d);
                }
            }
        }
    }
    let median = |v: &mut Vec<f64>| {
        if v.is_empty() {
            return 0.0;
        }
        let m = v.len() / 2;
        *v.select_nth_unstable_by(m, f64::total_cmp).1
    };
    (median(&mut inside), median(&mut across))
}

#[test]
fn real_cr2s_decode_and_match_the_cameras_rendering() {
    let files = files();
    if files.is_empty() {
        println!("No CR2 files: set LOPSY_CR2_SAMPLES to a folder of .CR2 files. Skipping.");
        return;
    }
    let review = std::env::var_os("LOPSY_CR2_REVIEW_DIR").map(PathBuf::from);
    let mut decoded = 0;
    println!("| file | body | bits | sensor | slices | crop (l,t,w,h) | WB gains | baked ms | shift vs JPEG | corr | hue° | sat | cast r,b | rank |");
    for path in files {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let stem = path.file_stem().unwrap().to_string_lossy().to_string();
        let data = std::fs::read(&path).unwrap();
        assert!(cr2::is_canon_cr2(&data), "{name}");
        let info = match cr2::read_info(&data) {
            Ok(i) => i,
            Err(e) if e == cr2::SRAW_REFUSAL => {
                println!("  {name}: refused: {e}");
                continue;
            }
            Err(e) => panic!("{name}: {e}"),
        };
        decoded += 1;

        let t0 = std::time::Instant::now();
        let baked = cr2::read_cr2(&data).unwrap_or_else(|e| panic!("{name}: {e}"));
        let ms = t0.elapsed().as_millis();
        let img = &baked.image;
        assert_eq!((img.width, img.height), info.oriented_size(), "{name}: the baked size is the crop, oriented");
        assert!(img.pixels.iter().all(|v| v.is_finite() && (0.0..=1.0).contains(v)), "{name}: values outside 0..1");

        // The linear path: the plane, the band renders and the binned view.
        let prep = cr2_linear::prepare_cr2(&data).unwrap();
        let p = &prep.params;
        for line in &prep.debug_log {
            println!("  {name}: {line}");
        }
        assert_eq!((p.width, p.height), (info.crop.width, info.crop.height));
        let whole = render_linear_band(&prep.plane, p, RafBand { y0: 0, y1: p.height, src_y0: 0, src_y1: p.height }).unwrap();
        let row_len = p.width as usize;
        let mut banded = vec![f32::NAN; whole.pixels.len()];
        let (ow, _) = p.oriented_size();
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

        // Slice edges, in the crop's columns.
        let (pw, ph) = (p.width as usize, p.height as usize);
        let mut edges = Vec::new();
        let mut x = 0u32;
        for &s in &info.slices[..info.slices.len() - 1] {
            x += s;
            if x > info.crop.left + 2 && x < info.crop.left + info.crop.width - 2 {
                edges.push((x - info.crop.left) as usize);
            }
        }
        if !edges.is_empty() {
            let (inside, across) = slice_edges(&prep.plane, pw, ph, &edges);
            println!("  {name}: median neighbour differences beside slice edges {inside:.5}, across them {across:.5} (edges at {edges:?})");
            assert!(across < inside * 1.15, "{name}: slice edges are rougher than the slices' insides");
        }
        // The default develop of the binned view, output for sRGB, as the
        // RAW interface opens it (its exposure matched to the preview).
        let defaults = lopsy_core::raw::prepare(&data).unwrap().description.develop_defaults;
        assert_eq!(defaults.cam_to_rgb, cr2_linear::develop_defaults(p).cam_to_rgb);
        let (bw, bh, binned) = render_binned_linear_for(&prep.plane, p, 2000).unwrap();
        let scene = scene_reference(&binned, &defaults);
        let rendered = lopsy_core::tone::tone_reference(&scene, &tone_settings(&defaults));
        let developed = Picture::from_rgba_encoded(bw, bh, &output_reference(&rendered, bw, &OutputSettings::sdr(OutputTarget::Srgb, Gamut::Rec2020, false)));

        let ours = Picture::from_rgba_encoded(img.width, img.height, &img.pixels).resample(2000);
        let jpeg = embedded_jpeg(&data).expect("an embedded JPEG");
        let aspect = |w: usize, h: usize| w as f64 / h as f64;
        println!("  {name}: decoded {}×{}, embedded JPEG {}×{}", img.width, img.height, jpeg.w, jpeg.h);
        assert!((aspect(img.width as usize, img.height as usize) - aspect(jpeg.w, jpeg.h)).abs() < 0.01, "{name}: aspect differs from the camera's JPEG");
        // Never enlarged: an enlarged box resample leaves empty pixels.
        let jpeg2000 = jpeg.resample(2000.min(jpeg.w));
        if let Some(dir) = &review {
            std::fs::create_dir_all(dir).unwrap();
            ours.resample(1400).write_png(&dir.join(format!("{stem}-lopsy.png")));
            jpeg.resample(1400).write_png(&dir.join(format!("{stem}-embedded-jpeg.png")));
            developed.resample(1400).write_png(&dir.join(format!("{stem}-develop.png")));
            let full = Picture::from_rgba_encoded(img.width, img.height, &img.pixels);
            let (cw, ch) = (600.min(full.w), 450.min(full.h));
            let at = |x: usize, y: usize| (x.saturating_sub(cw / 2).min(full.w - cw), y.saturating_sub(ch / 2).min(full.h - ch));
            // Across the first slice edge, at the middle row (orientation 1).
            if let Some(&e) = edges.first() {
                let (x0, y0) = at(e, full.h / 2);
                full.crop(x0, y0, cw, ch).write_png(&dir.join(format!("{stem}-slice-edge-100pct.png")));
                if jpeg.w == full.w && jpeg.h == full.h {
                    jpeg.crop(x0, y0, cw, ch).write_png(&dir.join(format!("{stem}-slice-edge-jpeg-100pct.png")));
                }
            }
            // The brightest area: the 64-pixel cell with the most pixels near white.
            let cell = 64;
            let (mut best, mut bx, mut by) = (0usize, 0usize, 0usize);
            for cy in 0..full.h / cell {
                for cx in 0..full.w / cell {
                    let n = (0..cell * cell).filter(|&i| full.lum(cx * cell + i % cell, cy * cell + i / cell) > 0.97).count();
                    if n > best {
                        (best, bx, by) = (n, cx * cell + cell / 2, cy * cell + cell / 2);
                    }
                }
            }
            if best > 0 {
                let (x0, y0) = at(bx, by);
                full.crop(x0, y0, cw, ch).write_png(&dir.join(format!("{stem}-highlights-100pct.png")));
                if jpeg.w == full.w && jpeg.h == full.h {
                    jpeg.crop(x0, y0, cw, ch).write_png(&dir.join(format!("{stem}-highlights-jpeg-100pct.png")));
                }
            }
        }
        let (ours1000, jpeg1000) = (ours.resample(1000), jpeg2000.resample(1000));
        let (shift, zoom, corr) = best_shift(&ours1000, &jpeg1000, 4);
        // Unmagnified too: a soft picture (the 20D's, out of focus) can
        // correlate a little better at a magnification and shift that
        // trade off against each other.
        let (shift1, corr1) = raw_compare::shift_at(&ours1000, &jpeg1000, 4, 1.0);
        println!("  {name}: vs JPEG: best alignment shift {shift:?} at magnification {zoom:.2}, correlation {corr:.3}; unmagnified {shift1:?} at {corr1:.3}");
        let near = |s: (i32, i32)| s.0.abs() <= 1 && s.1.abs() <= 1;
        assert!((near(shift) && corr > 0.6) || (near(shift1) && corr1 > 0.6), "{name}: best alignment {shift:?} ×{zoom} at {corr}, unmagnified {shift1:?} at {corr1}");
        let (gx, gy) = (48, 32);
        let vs_jpeg = compare(&ours.grid(gx, gy), &jpeg2000.grid(gx, gy));
        println!(
            "  {name}: baked vs JPEG over {} cells: hue {:.1}°, saturation ratio {:.2}, neutral cast (r, b chromaticity) {:+.4} {:+.4} over {} cells, luminance rank correlation {:.3}",
            vs_jpeg.cells, vs_jpeg.hue_deg, vs_jpeg.saturation_ratio, vs_jpeg.neutral_cast[0], vs_jpeg.neutral_cast[1], vs_jpeg.neutral_cells, vs_jpeg.rank_corr
        );
        assert!(vs_jpeg.neutral_cast[0].abs() < 0.03 && vs_jpeg.neutral_cast[1].abs() < 0.03, "{name}: a colour cast against the camera's JPEG");
        assert!(vs_jpeg.hue_deg < 30.0 && vs_jpeg.rank_corr > 0.9, "{name}: colour or tone far from the camera's JPEG");
        let g_dev = developed.resample(2000).grid(gx, gy);
        let st = compare(&g_dev, &jpeg2000.grid(gx, gy));
        let fmt = |b: [f32; 4]| format!("{:.3} ({:.3} {:.3} {:.3})", b[0], b[1], b[2], b[3]);
        println!(
            "  {name}: default develop vs JPEG: hue {:.1}°, saturation ratio {:.2}, neutral cast {:+.4} {:+.4}; brightness mean (p10 p50 p90): develop {}, baked {}, JPEG {}; opening exposure {:+.3} EV (baked {:+.3})",
            st.hue_deg, st.saturation_ratio, st.neutral_cast[0], st.neutral_cast[1], fmt(brightness(&developed)), fmt(brightness(&ours)), fmt(brightness(&jpeg2000)), defaults.exposure_ev, baked.exposure_ev
        );
        println!(
            "| {name} | {} | {} | {}×{} | {:?} | {},{},{},{} | {:.3?} | {ms} | {shift:?} | {corr:.3} | {:.1} | {:.2} | {:+.4},{:+.4} | {:.3} |",
            info.camera_model, info.bits, info.width, info.height, info.slices, info.crop.left, info.crop.top, info.crop.width, info.crop.height, info.as_shot_gain,
            vs_jpeg.hue_deg, vs_jpeg.saturation_ratio, vs_jpeg.neutral_cast[0], vs_jpeg.neutral_cast[1], vs_jpeg.rank_corr
        );

    }
    println!("{decoded} CR2 files decoded");
}

/// Canon's reduced-size raws are refused with their sentence, not decoded.
#[test]
fn reduced_size_raws_are_refused() {
    for path in files() {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        if !(name.contains("sRAW") || name.contains("mRAW")) {
            continue;
        }
        let data = std::fs::read(&path).unwrap();
        assert_eq!(cr2::read_cr2(&data).err().as_deref(), Some(cr2::SRAW_REFUSAL), "{name}");
        assert_eq!(lopsy_core::raw::prepare(&data).err().as_deref(), Some(cr2::SRAW_REFUSAL), "{name}");
        println!("{name}: refused");
    }
}

/// The as-shot white balance is found where the known layouts put it, and
/// a search of the colour data (what an unseen layout gets) finds the same
/// place on every sample.
#[test]
fn the_colour_data_search_agrees_with_the_known_layouts() {
    use lopsy_core::dng::tiff::TiffReader;
    for path in files() {
        let data = std::fs::read(&path).unwrap();
        let reader = TiffReader::new(&data).unwrap();
        let ifd0 = reader.read_ifd(0).unwrap();
        let mn = cr2::maker_note(&data, &reader, &ifd0).unwrap();
        let cd = cr2::shorts(&mn, 0x4001).unwrap();
        let (levels, searched) = cr2::colour_data::as_shot_levels(&cd).unwrap();
        let run = cr2::colour_data::find_run(&cd).unwrap();
        assert!(!searched, "{}: an unseen colour data layout ({} numbers, first {})", path.display(), cd.len(), cd[0]);
        assert_eq!(&cd[run..run + 4], &levels, "{}", path.display());
        println!("{}: colour data {} numbers (first {}), as shot at {run}: {levels:?}", path.display(), cd.len(), cd[0]);
    }
}

/// The bytes are untrusted: cut short at many lengths and with bytes
/// changed in the headers and anywhere, every sample is refused or
/// decoded, never a panic.
#[test]
fn damaged_cr2s_are_refused_not_panicked_on() {
    assert!(cr2_linear::prepare_cr2(b"not a raw").is_err());
    assert!(cr2_linear::prepare_cr2(&[]).is_err());
    let files = files();
    if files.is_empty() {
        println!("No CR2 samples: set LOPSY_CR2_SAMPLES. Skipping the damaged-file cases.");
        return;
    }
    for path in files {
        let data = std::fs::read(&path).unwrap();
        // Cut anywhere before the end of the sensor data: refused. (A
        // dual-pixel file's second frame comes after the first, and is
        // not read.)
        let end = cr2::read_info(&data).map_or(data.len(), |i| i.strip.0 + i.strip.1);
        for cut in [16usize, 64, 512, 4096, 65_536, 200_000, end / 3, end * 2 / 3, end - 1] {
            let r = cr2_linear::prepare_cr2(&data[..cut.min(data.len())]);
            assert!(r.is_err(), "{}: a file cut at {cut} bytes decoded", path.display());
        }
        let _ = cr2_linear::prepare_cr2(&data[..data.len() - 1]);
        let mut seed = 0x9e37_79b9_7f4a_7c15u64;
        let mut refused = 0;
        let tries = 16;
        for i in 0..tries {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            let mut damaged = data.clone();
            let at = (seed % if i % 2 == 0 { 100_000.min(data.len() as u64) } else { data.len() as u64 }) as usize;
            damaged[at] ^= (seed >> 32) as u8 | 1;
            if cr2_linear::prepare_cr2(&damaged).is_err() {
                refused += 1;
            }
        }
        println!("{}: {refused} of {tries} single-byte changes refused, the rest decoded", path.display());
    }
}
