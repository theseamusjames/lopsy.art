//! Sony ARW decoding on real files: every `.ARW` in `LOPSY_ARW_SAMPLES`
//! decodes, both ways (`arw::read_arw`, baked; `arw::linear::prepare_arw`,
//! for the develop chain), and is compared with the camera's own rendering
//! embedded in the file (its largest preview JPEG) and, when
//! `LOPSY_ARW_SIPS_DIR` holds `<stem>.png` (macOS's own decode, `sips -s
//! format png`, converted to sRGB), with that.
//!
//! What is compared, coarsely, because neither reference is a neutral
//! decode (both add a tone curve, the camera's creative style and lens
//! corrections):
//!
//! - geometry: the decode's size and aspect against the JPEG's, and the
//!   shift (in pixels of 1000-pixel-wide copies, allowing for the references' lens correction as a magnification about the centre) at which the two pictures'
//!   luminance correlates best over their middle, which is 0, 0 when the
//!   crop and orientation are right;
//! - tone: the rank correlation of the cells' luminance on a 48 × 32 grid;
//! - colour: over the cells, the mean hue difference and the ratio of
//!   saturations (in linear rg chromaticity, `r / sum`, `b / sum`), and the
//!   mean cast of the cells the JPEG shows as near-neutral;
//! - defects: for the lossy files the mean difference between neighbouring
//!   pixels of one colour inside Sony's 32-pixel groups and across their
//!   edges (a mis-read block makes the inside rougher), and for the
//!   lossless file the same at tile edges.
//!
//! The numbers are printed; the assertions are loose bounds a wrong decode
//! breaks (a crop off by more than a few pixels, a rotated or mirrored
//! picture, a strong cast, scrambled blocks). Full-size files: run with
//! `--release`. Without `LOPSY_ARW_SAMPLES` the tests note that and pass.
//! With `LOPSY_ARW_REVIEW_DIR`, review images are written there.

use std::path::PathBuf;

use lopsy_core::arw::{self, linear as arw_linear};
use lopsy_core::dng::linear::{render_binned_linear_for, render_linear_band};
use lopsy_core::dng::tiff::TiffReader;

#[path = "support/raw_compare.rs"]
mod raw_compare;
use raw_compare::{best_shift, block_edges, brightness, compare, embedded_jpeg, Picture};
use lopsy_core::output::{output_reference, OutputSettings, OutputTarget};
use lopsy_core::raf::develop::{scene_reference, tone_settings};
use lopsy_core::working_space::Gamut;
use lopsy_core::raf::{plan_bands, RafBand};

fn sample_dir() -> Option<PathBuf> {
    std::env::var_os("LOPSY_ARW_SAMPLES").map(PathBuf::from)
}

fn files_with(ext: &[&str]) -> Vec<PathBuf> {
    let Some(dir) = sample_dir() else { return Vec::new() };
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|r| r.flatten().map(|e| e.path()).collect())
        .unwrap_or_default();
    v.retain(|p| p.extension().is_some_and(|e| ext.iter().any(|x| e.eq_ignore_ascii_case(x))));
    v.sort();
    v
}

#[test]
fn real_arws_decode_and_match_the_cameras_rendering() {
    let files = files_with(&["arw"]);
    if files.is_empty() {
        println!("No ARW files: set LOPSY_ARW_SAMPLES to a folder of .ARW files. Skipping.");
        return;
    }
    let review = std::env::var_os("LOPSY_ARW_REVIEW_DIR").map(PathBuf::from);
    println!("| file | body | encoding | bits | stored | crop (l,t,w,h) | black (from) | white (from) | WB gains (from) | crop from | matrix | baked ms | shift vs JPEG | corr | hue° JPEG | sat JPEG | hue° sips | sat sips |");
    for path in files {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let stem = name.trim_end_matches(".ARW").trim_end_matches(".arw").to_string();
        let data = std::fs::read(&path).unwrap();
        assert!(arw::is_sony_raw(&data), "{name}");
        let info = arw::read_info(&data).unwrap_or_else(|e| panic!("{name}: {e}"));

        let t0 = std::time::Instant::now();
        let baked = arw::read_arw(&data).unwrap_or_else(|e| panic!("{name}: {e}"));
        let ms = t0.elapsed().as_millis();
        let img = &baked.image;
        assert_eq!((img.width, img.height), info.oriented_size(), "{name}: the baked size is the crop, oriented");
        assert_eq!(img.pixels.len(), (img.width * img.height * 4) as usize);
        assert!(img.pixels.iter().all(|v| v.is_finite() && (0.0..=1.0).contains(v)), "{name}: values outside 0..1");

        // The linear path: the plane, the band renders and the binned view.
        let prep = arw_linear::prepare_arw(&data).unwrap();
        let p = &prep.params;
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
        let (bw, bh, _) = render_binned_linear_for(&prep.plane, p, 1024).unwrap();
        assert!(bw.max(bh) >= 1024);
        let defaults = arw_linear::develop_defaults(p);
        assert_eq!(defaults.wb_ratio, [1.0; 3]);
        for r in 0..3 {
            let s: f32 = defaults.cam_to_rgb[r * 3..r * 3 + 3].iter().sum();
            assert!((s - 1.0).abs() < 0.02, "{name}: matrix row {r} sums to {s}");
        }

        // Block and tile edges on the plane (crop-relative; the groups and
        // tiles start at the stored mosaic's column 0).
        let (pw, ph) = (p.width as usize, p.height as usize);
        let edges = match info.encoding {
            arw::ArwEncoding::Lossy => Some(block_edges(&prep.plane, pw, ph, 32, info.crop.left as usize)),
            arw::ArwEncoding::Lossless => Some(block_edges(&prep.plane, pw, ph, 512, info.crop.left as usize)),
            arw::ArwEncoding::Uncompressed => None,
        };
        if let Some((inside, across)) = edges {
            println!("  {name}: neighbour differences inside blocks {:.5}, across block edges {:.5}", inside, across);
            assert!(inside < across * 1.15, "{name}: blocks are rougher inside than across their edges");
        }
        // The default develop of the binned view, working space on, output
        // for sRGB: what the RAW develop path shows first.
        let (bw, bh, binned) = render_binned_linear_for(&prep.plane, p, 2000).unwrap();
        let scene = scene_reference(&binned, &defaults);
        let rendered = lopsy_core::tone::tone_reference(&scene, &tone_settings(&defaults));
        let developed = Picture::from_rgba_encoded(bw, bh, &output_reference(&rendered, bw, &OutputSettings::sdr(OutputTarget::Srgb, Gamut::Rec2020, false)));
        drop(prep);
        drop(whole);
        drop(banded);

        let ours = Picture::from_rgba_encoded(img.width, img.height, &img.pixels).resample(2000);
        let jpeg = embedded_jpeg(&data).expect("an embedded JPEG");
        let aspect = |w: usize, h: usize| w as f64 / h as f64;
        println!("  {name}: decoded {}×{}, embedded JPEG {}×{}", img.width, img.height, jpeg.w, jpeg.h);
        assert!((aspect(img.width as usize, img.height as usize) - aspect(jpeg.w, jpeg.h)).abs() < 0.01, "{name}: aspect differs from the camera's JPEG");
        let jpeg2000 = jpeg.resample(2000);
        let (shift, zoom, corr) = best_shift(&ours.resample(1000), &jpeg2000.resample(1000), 4);
        println!("  {name}: vs JPEG: best alignment shift {shift:?} at magnification {zoom:.2}, correlation {corr:.3}");
        // The preview JPEGs of the older bodies are small (1616 × 1080, a
        // slightly different aspect) and processed, so they only show that
        // the picture is the right way round and not far off; sips, at full
        // size, pins the crop.
        assert!(shift.0.abs() <= 1 && shift.1.abs() <= 1 && corr > 0.6, "{name}: best alignment {shift:?} ×{zoom} at {corr}");
        let (gx, gy) = (48, 32);
        let g_ours = ours.grid(gx, gy);
        let vs_jpeg = compare(&g_ours, &jpeg2000.grid(gx, gy));
        println!(
            "  {name}: vs JPEG over {} cells: hue {:.1}°, saturation ratio {:.2}, neutral cast (r, b chromaticity) {:+.4} {:+.4}, luminance rank correlation {:.3}",
            vs_jpeg.cells, vs_jpeg.hue_deg, vs_jpeg.saturation_ratio, vs_jpeg.neutral_cast[0], vs_jpeg.neutral_cast[1], vs_jpeg.rank_corr
        );
        assert!(vs_jpeg.neutral_cast[0].abs() < 0.03 && vs_jpeg.neutral_cast[1].abs() < 0.03, "{name}: a colour cast against the camera's JPEG");
        assert!(vs_jpeg.hue_deg < 25.0 && vs_jpeg.rank_corr > 0.9, "{name}: colour or tone far from the camera's JPEG");
        let sips = raw_compare::sips_reference("LOPSY_ARW_SIPS_DIR", &stem).map(|s| s.resample(2000));
        // Brightness with no exposure matching: mean, p10, p50, p90 of
        // encoded luminance.
        let fmt = |b: [f32; 4]| format!("{:.3} ({:.3} {:.3} {:.3})", b[0], b[1], b[2], b[3]);
        let (b_ours, b_jpeg) = (brightness(&ours), brightness(&jpeg2000));
        println!(
            "  {name}: brightness mean (p10 p50 p90): baked {}, JPEG {}, sips {}, linear develop {}",
            fmt(b_ours),
            fmt(b_jpeg),
            sips.as_ref().map_or("-".into(), |s| fmt(brightness(s))),
            fmt(brightness(&developed)),
        );
        let vs_sips = sips.as_ref().map(|s| {
            let (sh, z, c) = best_shift(&ours.resample(1000), &s.resample(1000), 4);
            assert!(sh == (0, 0) && c > 0.9, "{name}: best alignment with sips {sh:?} ×{z} at {c}");
            let st = compare(&g_ours, &s.grid(gx, gy));
            assert!(st.neutral_cast[0].abs() < 0.03 && st.neutral_cast[1].abs() < 0.03 && st.hue_deg < 25.0, "{name}: colour far from sips");
            println!(
                "  {name}: vs sips: best shift {sh:?} at magnification {z:.2} (corr {c:.3}); hue {:.1}°, saturation ratio {:.2}, neutral cast {:+.4} {:+.4}, luminance rank correlation {:.3}",
                st.hue_deg, st.saturation_ratio, st.neutral_cast[0], st.neutral_cast[1], st.rank_corr
            );
            st
        });

        let s = &info.sources;
        println!(
            "| {name} | {} | {:?} | {} | {}×{} | {},{},{},{} | {:?} ({}) | {} ({}) | {:.3?} ({}) | {} | {} | {ms} | {shift:?} | {corr:.3} | {:.1} | {:.2} | {} | {} |",
            info.camera_model, info.encoding, info.bits, info.width, info.height, info.crop.left, info.crop.top, info.crop.width, info.crop.height,
            info.black, s.black, info.white, s.white, info.as_shot_gain, s.white_balance, s.crop, s.matrix,
            vs_jpeg.hue_deg, vs_jpeg.saturation_ratio,
            vs_sips.as_ref().map_or("-".into(), |v| format!("{:.1}", v.hue_deg)),
            vs_sips.as_ref().map_or("-".into(), |v| format!("{:.2}", v.saturation_ratio)),
        );

        if let Some(dir) = &review {
            ours.write_png(&dir.join(format!("{stem}-lopsy.png")));
            jpeg2000.write_png(&dir.join(format!("{stem}-embedded-jpeg.png")));
            if let Some(s) = &sips {
                s.write_png(&dir.join(format!("{stem}-sips.png")));
            }
            // A 100 % crop of the middle, from the full-size decode, and the
            // same region of the JPEG when it is full size.
            let full = Picture::from_rgba_encoded(img.width, img.height, &img.pixels);
            let (cw, ch) = (800.min(full.w), 600.min(full.h));
            let (x0, y0) = ((full.w - cw) / 2, (full.h - ch) / 2);
            full.crop(x0, y0, cw, ch).write_png(&dir.join(format!("{stem}-lopsy-100pct.png")));
            if jpeg.w == full.w && jpeg.h == full.h {
                jpeg.crop(x0, y0, cw, ch).write_png(&dir.join(format!("{stem}-embedded-jpeg-100pct.png")));
            }
            if let Some(s) = raw_compare::sips_reference("LOPSY_ARW_SIPS_DIR", &stem).filter(|s| s.w == full.w && s.h == full.h) {
                s.crop(x0, y0, cw, ch).write_png(&dir.join(format!("{stem}-sips-100pct.png")));
            }
        }
    }
}

/// The colour data's provenance on the first sample: the SR2 block's black
/// level and white balance are exactly those the raw IFD stores in the
/// clear (evidence that the block was deciphered right).
#[test]
fn the_sr2_block_agrees_with_the_raw_ifd() {
    for path in files_with(&["arw"]) {
        let data = std::fs::read(&path).unwrap();
        let info = arw::read_info(&data).unwrap();
        let reader = TiffReader::new(&data).unwrap();
        let ifd0 = reader.read_ifd(0).unwrap();
        let sr2 = arw::sr2::read_sr2(&data, &ifd0).unwrap().expect("an SR2 block");
        assert!(sr2.len() > 100, "{}: {} SR2 entries", path.display(), sr2.len());
        let in_raw = |tag| arw::sr2::values_i32(&info.raw_ifd, tag);
        for tag in [0x7310u16, 0x7313] {
            if let Some(raw) = in_raw(tag) {
                assert_eq!(arw::sr2::values_i32(&sr2, tag), Some(raw), "{}: tag {tag:#x}", path.display());
            }
        }
    }
}

/// Sony's two older formats are refused with a sentence, not decoded.
#[test]
fn older_sony_formats_are_refused() {
    for path in files_with(&["sr2", "srf"]) {
        let data = std::fs::read(&path).unwrap();
        let e = arw::read_arw(&data).err().unwrap_or_else(|| panic!("{} decoded", path.display()));
        let ext = path.extension().unwrap().to_string_lossy().to_uppercase();
        assert_eq!(e, format!("This older Sony RAW format ({ext}) is not supported"), "{}", path.display());
    }
}

/// The bytes are untrusted: cut short at many lengths and with bytes
/// changed in the headers and anywhere, every sample (the older formats
/// too) is refused or decoded, never a panic.
#[test]
fn damaged_sony_raws_are_refused_not_panicked_on() {
    assert!(arw::read_arw(b"not a raw").is_err());
    assert!(arw::read_arw(&[]).is_err());
    let files = files_with(&["arw", "sr2", "srf"]);
    if files.is_empty() {
        println!("No Sony samples: set LOPSY_ARW_SAMPLES. Skipping the damaged-file cases.");
        return;
    }
    for path in files {
        let data = std::fs::read(&path).unwrap();
        for cut in [8usize, 64, 512, 4096, 65_536, 200_000, data.len() / 3, data.len() * 2 / 3] {
            let r = arw::linear::prepare_arw(&data[..cut.min(data.len())]);
            assert!(r.is_err(), "{}: a file cut at {cut} bytes decoded", path.display());
        }
        // The last bytes of a file may be padding after the sensor data:
        // cutting them may leave a whole picture, but must not panic.
        let _ = arw::linear::prepare_arw(&data[..data.len() - 1]);
        let mut seed = 0x9e37_79b9_7f4a_7c15u64;
        let mut refused = 0;
        let tries = 16;
        for i in 0..tries {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            let mut damaged = data.clone();
            // Half in the headers and Sony's private block, half anywhere.
            let at = (seed % if i % 2 == 0 { 300_000.min(data.len() as u64) } else { data.len() as u64 }) as usize;
            damaged[at] ^= (seed >> 32) as u8 | 1;
            if arw::linear::prepare_arw(&damaged).is_err() {
                refused += 1;
            }
        }
        println!("{}: {refused} of {tries} single-byte changes refused, the rest decoded", path.display());
    }
}
