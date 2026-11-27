//! Nikon NEF decoding on real files: every `.NEF` and `.NRW` in
//! `LOPSY_NEF_SAMPLES` either decodes, both ways (`nef::read_nef`, baked;
//! the RAW interface's `raw::prepare`, for the develop chain), or is
//! refused with one of the decoder's sentences. A decoded file is compared
//! with the camera's own full-size JPEG embedded in it:
//!
//! - geometry: the decode's size against the JPEG's (equal: the crop is
//!   the camera's), the shift at which the two pictures' luminance
//!   correlates best over the middle of 1000-pixel-wide copies, and the
//!   same at full size over a 1200-pixel square in the middle (0, 0 when
//!   the crop and orientation are right to the pixel);
//! - tone: the rank correlation of the cells' luminance on a 48 × 32 grid;
//! - colour: the mean cast of the cells the JPEG shows as near-neutral (the
//!   white balance), and the mean hue difference and ratio of saturations
//!   (in linear rg chromaticity), which only show the colour is the right
//!   way round: with no matrix for the body it is washed out;
//! - defects: the mean difference between same-colour neighbours two rows
//!   apart, at each row against the rows around it (a row read wrong, or
//!   unpacked with the wrong bit order, stands out).
//!
//! The numbers are printed; the assertions are loose bounds a wrong decode
//! breaks. Full-size files: run with `--release`. Without
//! `LOPSY_NEF_SAMPLES` the tests note that and pass. With
//! `LOPSY_NEF_REVIEW_DIR`, review images are written there: the baked
//! decode and the default develop reduced, the camera's JPEG, 100 % crops
//! of the middle and of the brightest area, ours and the camera's.

use std::path::PathBuf;

use lopsy_core::nef::{self, linear as nef_linear};
use lopsy_core::raw::{self, RawFormatId};

#[path = "support/raw_compare.rs"]
mod raw_compare;
use lopsy_core::output::{output_reference, OutputSettings, OutputTarget};
use lopsy_core::raf::develop::{scene_reference, tone_settings};
use lopsy_core::working_space::Gamut;
use raw_compare::{best_shift, brightness, compare, shift_at, Picture};

fn files() -> Vec<PathBuf> {
    let Some(dir) = std::env::var_os("LOPSY_NEF_SAMPLES").map(PathBuf::from) else { return Vec::new() };
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir).map(|r| r.flatten().map(|e| e.path()).collect()).unwrap_or_default();
    v.retain(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("nef") || e.eq_ignore_ascii_case("nrw")));
    v.sort();
    v
}

/// The sentences the decoder refuses a sample with (each starts so).
const REFUSALS: [&str; 6] = [
    "This Nikon RAW is lossless compressed, which is not supported yet",
    "This Nikon RAW is lossy compressed, which is not supported yet",
    "This Nikon RAW is a High Efficiency RAW, which uses a licensed third-party codec",
    "This Nikon RAW is a Medium or Small RAW, which is not supported",
    "This RAW file is from a Nikon COOLPIX compact (NRW), which is not supported",
    "This Nikon RAW stores its",
];

/// The largest JPEG in the file as 8-bit RGB (width, height, pixels).
fn largest_jpeg(data: &[u8]) -> Option<(usize, usize, Vec<u8>)> {
    let (o, n) = nef::exposure::jpeg_ranges(data).into_iter().max_by_key(|r| r.1)?;
    let mut dec = jpeg_decoder::Decoder::new(&data[o..o + n]);
    let px = dec.decode().ok()?;
    let info = dec.info()?;
    (info.pixel_format == jpeg_decoder::PixelFormat::RGB24).then_some((info.width as usize, info.height as usize, px))
}

fn crop_rgba(rgba: &[f32], w: usize, x0: usize, y0: usize, cw: usize, ch: usize) -> Picture {
    let mut out = Vec::with_capacity(cw * ch * 4);
    for y in y0..y0 + ch {
        out.extend_from_slice(&rgba[(y * w + x0) * 4..(y * w + x0 + cw) * 4]);
    }
    Picture::from_rgba_encoded(cw as u32, ch as u32, &out)
}

fn crop_rgb8(px: &[u8], w: usize, x0: usize, y0: usize, cw: usize, ch: usize) -> Picture {
    let mut out = Vec::with_capacity(cw * ch * 3);
    for y in y0..y0 + ch {
        out.extend_from_slice(&px[(y * w + x0) * 3..(y * w + x0 + cw) * 3]);
    }
    Picture::from_rgb8(cw, ch, &out)
}

/// The worst row of the plane. A row read wrong differs from both
/// same-colour rows beside it (two above, two below) while those two agree
/// with each other; an edge in the picture crosses the three, so the outer
/// two differ as much. The ratio is the smaller of the row's differences
/// over the outer rows' difference (floored at half the median difference
/// of rows four apart, for flat areas).
fn worst_row_ratio(plane: &[f32], w: usize, h: usize) -> (usize, f64) {
    let diff = |a: usize, b: usize| (0..w).step_by(3).map(|x| f64::from((plane[a * w + x] - plane[b * w + x]).abs())).sum::<f64>();
    let outer: Vec<f64> = (2..h - 2).map(|y| diff(y - 2, y + 2)).collect();
    let mut sorted = outer.clone();
    sorted.sort_by(f64::total_cmp);
    let floor = (sorted[sorted.len() / 2] / 2.0).max(1e-9);
    let mut worst = (0, 0.0);
    for y in 2..h - 2 {
        let r = diff(y, y - 2).min(diff(y, y + 2)) / outer[y - 2].max(floor);
        if r > worst.1 {
            worst = (y, r);
        }
    }
    worst
}

#[test]
fn real_nefs_decode_and_match_the_cameras_rendering() {
    let files = files();
    if files.is_empty() {
        println!("No NEF files: set LOPSY_NEF_SAMPLES to a folder of .NEF files. Skipping.");
        return;
    }
    let review = std::env::var_os("LOPSY_NEF_REVIEW_DIR").map(PathBuf::from);
    let mut decoded = 0;
    for path in files {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let stem = name.rsplit_once('.').map_or(name.clone(), |(s, _)| s.to_string());
        let data = std::fs::read(&path).unwrap();
        assert_eq!(raw::sniff(&data), Some(RawFormatId::Nef), "{name}");
        let info = match nef::read_info(&data) {
            Ok(i) => i,
            Err(e) => {
                assert!(REFUSALS.iter().any(|r| e.starts_with(r)), "{name}: refused with {e:?}");
                let via = raw::prepare(&data).err().expect("refused through the interface too");
                assert_eq!(via, e, "{name}");
                assert!(nef::read_nef(&data).is_err());
                println!("{name}: refused: {e}");
                continue;
            }
        };
        decoded += 1;

        let t0 = std::time::Instant::now();
        let baked = nef::read_nef(&data).unwrap_or_else(|e| panic!("{name}: {e}"));
        let baked_ms = t0.elapsed().as_millis();
        let img = &baked.image;
        assert_eq!((img.width, img.height), info.oriented_size(), "{name}: the baked size is the crop, oriented");
        assert!(img.pixels.iter().all(|v| v.is_finite() && (0.0..=1.0).contains(v)), "{name}: values outside 0..1");

        // The develop chain's plane: no row read wrong.
        let t0 = std::time::Instant::now();
        let prep = raw::prepare(&data).unwrap_or_else(|e| panic!("{name}: {e}"));
        let prepare_ms = t0.elapsed().as_millis();
        let d = &prep.description.clone();
        assert_eq!(d.format, RawFormatId::Nef);
        assert_eq!((d.width, d.height), (img.width, img.height), "{name}: linear and baked sizes differ");
        let (pw, ph) = (d.plane_width as usize, d.plane_height as usize);
        let (worst_row, worst_ratio) = worst_row_ratio(prep.plane(), pw, ph);
        assert!(worst_ratio < 4.0, "{name}: row {worst_row} is {worst_ratio:.1} times rougher than the median row");
        let raw::Prepared::Nef(p) = &prep.prepared else { panic!("{name}: not prepared as a NEF") };
        let defaults = nef_linear::develop_defaults_with(&p.params, &raw::OpeningLook::default());
        assert_eq!(d.develop_defaults, defaults);
        assert_eq!(d.color_note.is_some(), p.params.colour == nef::NefColour::WhiteBalanceOnly);

        // The default develop of the binned view (working space on, output
        // for sRGB): what the RAW develop path shows first.
        let (bw, bh, binned) = prep.binned_linear(2000).unwrap();
        let scene = scene_reference(&binned, &defaults);
        let rendered = lopsy_core::tone::tone_reference(&scene, &tone_settings(&defaults));
        let developed = Picture::from_rgba_encoded(bw, bh, &output_reference(&rendered, bw, &OutputSettings::sdr(OutputTarget::Srgb, Gamut::Rec2020, false)));
        drop(prep);

        let (jw, jh, jpx) = largest_jpeg(&data).expect("an embedded JPEG");
        println!("  {name}: decoded {}×{}, embedded JPEG {jw}×{jh}", img.width, img.height);
        assert_eq!((img.width as usize, img.height as usize), (jw, jh), "{name}: the crop is not the camera's");
        let ours = Picture::from_rgba_encoded(img.width, img.height, &img.pixels).resample(2000);
        let jpeg2000 = Picture::from_rgb8(jw, jh, &jpx).resample(2000);
        let (shift, zoom, corr) = best_shift(&ours.resample(1000), &jpeg2000.resample(1000), 4);
        println!("  {name}: vs JPEG at 1000 wide: best shift {shift:?} at magnification {zoom:.2}, correlation {corr:.3}");
        assert!(shift == (0, 0) && corr > 0.9, "{name}: best alignment {shift:?} ×{zoom} at {corr}");
        // At full size, the middle 800 × 800, at the magnification found
        // above refined in steps of 0.2 % (the Z bodies' JPEGs correct the
        // lens's distortion, which enlarges the middle): the shift is the
        // crop's error in pixels.
        let (s, cx, cy) = (800.min(jw).min(jh), jw / 2, jh / 2);
        let (x0, y0) = (cx - s / 2, cy - s / 2);
        let a = crop_rgba(&img.pixels, img.width as usize, x0, y0, s, s);
        let b = crop_rgb8(&jpx, jw, x0, y0, s, s);
        let ((fine, fine_corr), fine_zoom) = (-5..=5)
            .map(|k| {
                let z = zoom + 0.002 * f64::from(k);
                (shift_at(&a, &b, 4, z), z)
            })
            .max_by(|x, y| x.0 .1.total_cmp(&y.0 .1))
            .unwrap();
        println!("  {name}: vs JPEG at full size, middle {s}²: best shift {fine:?} at magnification {fine_zoom:.3}, correlation {fine_corr:.3}");
        assert!(fine.0.abs() <= 1 && fine.1.abs() <= 1 && fine_corr > 0.9, "{name}: full-size alignment {fine:?} at {fine_corr}");

        let (gx, gy) = (48, 32);
        let vs_jpeg = compare(&ours.grid(gx, gy), &jpeg2000.grid(gx, gy));
        let vs_dev = compare(&developed.resample(2000).grid(gx, gy), &jpeg2000.grid(gx, gy));
        println!(
            "  {name}: baked vs JPEG over {} cells: hue {:.1}°, saturation ratio {:.2}, neutral cast (r, b chromaticity) {:+.4} {:+.4} over {} cells, luminance rank correlation {:.3}",
            vs_jpeg.cells, vs_jpeg.hue_deg, vs_jpeg.saturation_ratio, vs_jpeg.neutral_cast[0], vs_jpeg.neutral_cast[1], vs_jpeg.neutral_cells, vs_jpeg.rank_corr
        );
        println!(
            "  {name}: default develop vs JPEG: hue {:.1}°, saturation ratio {:.2}, neutral cast {:+.4} {:+.4} over {} cells, luminance rank correlation {:.3}",
            vs_dev.hue_deg, vs_dev.saturation_ratio, vs_dev.neutral_cast[0], vs_dev.neutral_cast[1], vs_dev.neutral_cells, vs_dev.rank_corr
        );
        for (what, st) in [("baked", &vs_jpeg), ("develop", &vs_dev)] {
            // A cast is measured only over enough neutral cells: one or two
            // may be a glint or a clipped patch the JPEG renders otherwise.
            if st.neutral_cells >= 4 {
                assert!(st.neutral_cast[0].abs() < 0.03 && st.neutral_cast[1].abs() < 0.03, "{name}: {what}: a colour cast against the camera's JPEG");
            }
            assert!(st.hue_deg < 30.0 && st.rank_corr > 0.9, "{name}: {what}: colour or tone far from the camera's JPEG");
        }
        let fmt = |b: [f32; 4]| format!("{:.3} ({:.3} {:.3} {:.3})", b[0], b[1], b[2], b[3]);
        println!(
            "  {name}: brightness mean (p10 p50 p90): baked {} at {:+.2} EV, default develop {} at {:+.2} EV, JPEG {}",
            fmt(brightness(&ours)),
            baked.exposure_ev,
            fmt(brightness(&developed)),
            d.develop_defaults.exposure_ev,
            fmt(brightness(&jpeg2000))
        );
        println!(
            "| {name} | {} | {:?} | {} | {}×{} | {:?} ({}) | {:?} ({}) | {} | {:.3?} | {baked_ms} ms | {prepare_ms} ms | {:.1}° | {:.2} | row {worst_ratio:.2} |",
            info.camera_model, info.layout, info.bits, info.width, info.height, info.crop, info.sources.crop, info.black, info.sources.black, info.white, info.as_shot_gain, vs_dev.hue_deg, vs_dev.saturation_ratio
        );

        if let Some(dir) = &review {
            std::fs::create_dir_all(dir).unwrap();
            ours.write_png(&dir.join(format!("{stem}-baked.png")));
            developed.resample(2000).write_png(&dir.join(format!("{stem}-develop.png")));
            jpeg2000.write_png(&dir.join(format!("{stem}-jpeg.png")));
            let (cw, ch) = (900.min(jw), 600.min(jh));
            let (x0, y0) = ((jw - cw) / 2, (jh - ch) / 2);
            crop_rgba(&img.pixels, img.width as usize, x0, y0, cw, ch).write_png(&dir.join(format!("{stem}-100pct.png")));
            crop_rgb8(&jpx, jw, x0, y0, cw, ch).write_png(&dir.join(format!("{stem}-jpeg-100pct.png")));
            // The brightest 900 × 600 area of the JPEG (most pixels near white).
            let mut best = (0usize, 0usize, 0usize);
            for by in (0..jh - ch).step_by(150) {
                for bx in (0..jw - cw).step_by(150) {
                    let n = (by..by + ch).step_by(4).map(|y| (bx..bx + cw).step_by(4).filter(|&x| jpx[(y * jw + x) * 3 + 1] > 245).count()).sum::<usize>();
                    if n > best.2 {
                        best = (bx, by, n);
                    }
                }
            }
            crop_rgba(&img.pixels, img.width as usize, best.0, best.1, cw, ch).write_png(&dir.join(format!("{stem}-highlights.png")));
            crop_rgb8(&jpx, jw, best.0, best.1, cw, ch).write_png(&dir.join(format!("{stem}-jpeg-highlights.png")));
        }
    }
    println!("{decoded} files decoded");
}

/// Through the RAW interface: bands through the dispatch are bit-identical
/// to the whole frame, the binned view works, and the description is a
/// fixed-matrix one with no Kelvin.
#[test]
fn nefs_through_the_interface() {
    for path in files() {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let data = std::fs::read(&path).unwrap();
        let Ok(prep) = raw::prepare(&data) else { continue };
        let d = &prep.description;
        let row = (d.plane_width * d.samples_per_pixel) as usize;
        let plane = prep.plane();
        let whole_band = lopsy_core::raf::RafBand { y0: 0, y1: d.plane_height, src_y0: 0, src_y1: d.plane_height };
        let whole = raw::render_linear_band(prep.format, plane, &prep.params_json, whole_band).unwrap();
        assert_eq!((whole.width, whole.height), (d.width, d.height), "{name}");
        let mut out = vec![f32::NAN; whole.pixels.len()];
        for band in raw::plan_bands(prep.format, &prep.params_json, 5).unwrap() {
            let src = &plane[band.src_y0 as usize * row..band.src_y1 as usize * row];
            let px = raw::render_linear_band(prep.format, src, &prep.params_json, band).unwrap();
            for r in 0..px.height {
                let dst = (((px.y + r) * d.width + px.x) * 4) as usize;
                let s = (r * px.width * 4) as usize;
                out[dst..dst + (px.width * 4) as usize].copy_from_slice(&px.pixels[s..s + (px.width * 4) as usize]);
            }
        }
        assert!(out.iter().zip(&whole.pixels).all(|(a, b)| a.to_bits() == b.to_bits()), "{name}: bands differ from the whole frame");
        let (bw, bh, _) = prep.binned_linear(1024).unwrap();
        assert!(bw.max(bh) >= 1024);
        assert_eq!(raw::render_binned_linear(prep.format, plane, &prep.params_json, 1024).unwrap().0, bw);
        assert!(!raw::renders_finished_bands(RawFormatId::Nef) && !d.finished_bands);
        assert_eq!(d.white_balance.matrix, raw::MatrixModel::Fixed);
        assert_eq!(d.white_balance.kelvin, raw::KelvinModel::None);
        let white = raw::white_for_recipe(prep.format, &prep.params_json, 0.0, 0.0).unwrap();
        assert!(white.cam_to_rgb.is_none() && white.wb_ratio.iter().all(|&g| (g - 1.0).abs() < 1e-6), "{name}: {white:?}");
        assert!(raw::temperature_for_kelvin(prep.format, &prep.params_json, 5000.0, 0.0).is_err());
        println!(
            "{name}: {} {}×{} ({}×{} plane), opening exposure {:+.2} EV, clip {:?}, reconstruction {}, note {:?}",
            d.camera_model,
            d.width,
            d.height,
            d.plane_width,
            d.plane_height,
            d.develop_defaults.exposure_ev,
            d.clip_levels,
            matches!(&prep.prepared, raw::Prepared::Nef(p) if p.params.highlight_chroma.is_some()),
            d.color_note
        );
    }
}

/// The bytes are untrusted: cut short at many lengths and with bytes
/// changed in the headers and anywhere, every sample is refused or
/// decoded, never a panic.
#[test]
fn damaged_nikon_raws_are_refused_not_panicked_on() {
    assert!(nef::read_nef(b"not a raw").is_err());
    let files = files();
    if files.is_empty() {
        println!("No Nikon samples: set LOPSY_NEF_SAMPLES. Skipping the damaged-file cases.");
        return;
    }
    for path in files {
        let data = std::fs::read(&path).unwrap();
        for cut in [8usize, 64, 512, 4096, 65_536, 200_000, data.len() / 3, data.len() * 2 / 3] {
            let r = nef::linear::prepare_nef(&data[..cut.min(data.len())]);
            assert!(r.is_err(), "{}: a file cut at {cut} bytes decoded", path.display());
        }
        let _ = nef::linear::prepare_nef(&data[..data.len() - 1]);
        let mut seed = 0x9e37_79b9_7f4a_7c15u64;
        let mut refused = 0;
        let tries = 16;
        for i in 0..tries {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            let mut damaged = data.clone();
            // Half in the headers and the maker note, half anywhere.
            let at = (seed % if i % 2 == 0 { 300_000.min(data.len() as u64) } else { data.len() as u64 }) as usize;
            damaged[at] ^= (seed >> 32) as u8 | 1;
            if nef::linear::prepare_nef(&damaged).is_err() {
                refused += 1;
            }
        }
        println!("{}: {refused} of {tries} single-byte changes refused, the rest decoded", path.display());
    }
}
