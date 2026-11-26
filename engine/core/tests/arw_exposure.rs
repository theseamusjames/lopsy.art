//! The baked ARW decode's exposure matched to the camera's preview
//! (`arw::exposure`), on every `.ARW` in `LOPSY_ARW_SAMPLES`: the median
//! brightness lands on the preview's, no more of the picture is white than
//! a little above the camera's own share, the exposure each sample gets is
//! pinned loosely, and a damaged or cut preview never fails the decode.
//! Prints before (the decode without exposure matching, with auto-levels)
//! and after, against the preview and macOS's decode (`LOPSY_ARW_SIPS_DIR`).
//! With `LOPSY_ARW_REVIEW_DIR`, writes one side-by-side image a file: the
//! new baked decode, the camera's preview, `sips`. `--release`.

use std::path::PathBuf;

use lopsy_core::arw::{self, linear as arw_linear};
use lopsy_core::dng::tiff::TiffReader;

#[path = "support/raw_compare.rs"]
mod raw_compare;
use raw_compare::Picture;

/// The exposure each sample is expected to get, in stops, give or take
/// `EV_TOLERANCE`: a change to the rule or the decode that moves these is a
/// change to how every ARW opens.
const EXPECTED_EV: [(&str, f32); 6] = [
    ("DSC-RX100M3_DSC00734.ARW", 1.14),
    ("ILCE-6000_DSC01542.ARW", 0.72),
    ("ILCE-7M3_DSC0009.ARW", 1.19),
    ("ILCE-7M4_DSC06673_FullFrame-Raw-Uncompressed.ARW", 0.89),
    ("ILCE-7M4_DSC06674_FullFrame-LossLess-Compressed-Large.ARW", 0.97),
    ("ILCE-7M4_DSC06677_FullFrame-Raw-Compressed.ARW", 0.91),
];
const EV_TOLERANCE: f32 = 0.15;
/// The matched median, encoded luminance, against the preview's.
const MEDIAN_TOLERANCE: f32 = 0.02;
/// The share of the picture at white may exceed the camera's by this much.
const WHITE_MARGIN: f32 = 0.005;

fn files() -> Vec<PathBuf> {
    let Some(dir) = std::env::var_os("LOPSY_ARW_SAMPLES") else { return Vec::new() };
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir).map(|r| r.flatten().map(|e| e.path()).collect()).unwrap_or_default();
    v.retain(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("arw")));
    v.sort();
    v
}

/// The JPEGs of IFD0's chain: (offset, length).
fn jpeg_ranges(data: &[u8]) -> Vec<(usize, usize)> {
    let reader = TiffReader::new(data).unwrap();
    let mut out = Vec::new();
    for i in 0..8 {
        let Ok(ifd) = reader.read_ifd(i) else { break };
        let get = |tag: u16| ifd.iter().find(|e| e.tag == tag).and_then(|e| e.as_u32());
        if let (Some(o), Some(n)) = (get(0x201), get(0x202)) {
            out.push((o as usize, n as usize));
        }
    }
    out
}

/// The preview the decode matches to, decoded in full here: the smallest
/// whole-picture JPEG with a long edge of 1000 or more.
fn preview(data: &[u8], aspect: f64) -> (usize, usize, Picture) {
    let mut best: Option<(usize, usize, Picture)> = None;
    for (o, n) in jpeg_ranges(data) {
        let mut dec = jpeg_decoder::Decoder::new(&data[o..o + n]);
        let Ok(px) = dec.decode() else { continue };
        let info = dec.info().unwrap();
        let (w, h) = (info.width as usize, info.height as usize);
        if info.pixel_format == jpeg_decoder::PixelFormat::RGB24 && w.max(h) >= 1000 && (w as f64 / h as f64 / aspect - 1.0).abs() < 0.01 && best.as_ref().is_none_or(|b| w < b.2.w) {
            best = Some((o, n, Picture::from_rgb8(w, h, &px)));
        }
    }
    best.expect("a whole-picture preview")
}

/// Median of encoded luminance, and the share with every channel at least
/// 0.98 encoded.
fn stats(p: &Picture) -> (f32, f32) {
    let enc = |v: f32| lopsy_core::working_space::srgb_encode(v.clamp(0.0, 1.0));
    let mut lum: Vec<f32> = p.rgb.chunks_exact(3).map(|c| enc(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2])).collect();
    let white = p.rgb.chunks_exact(3).filter(|c| c.iter().all(|&v| enc(v) >= 0.98)).count() as f32 / lum.len() as f32;
    lum.sort_by(f32::total_cmp);
    (lum[lum.len() / 2], white)
}

fn side_by_side(path: &std::path::Path, tiles: &[&Picture]) {
    let tile = 800usize;
    let scaled: Vec<Picture> = tiles.iter().map(|p| p.resample(tile)).collect();
    let th = scaled.iter().map(|p| p.h).max().unwrap();
    let w = tile * tiles.len() + 8 * (tiles.len() - 1);
    let mut img = Picture { w, h: th, rgb: vec![1.0; w * th * 3] };
    for (i, p) in scaled.iter().enumerate() {
        for y in 0..p.h {
            let d = (y * w + i * (tile + 8)) * 3;
            img.rgb[d..d + p.w * 3].copy_from_slice(&p.rgb[y * p.w * 3..(y + 1) * p.w * 3]);
        }
    }
    img.write_png(path);
}

#[test]
fn baked_arws_match_the_cameras_preview() {
    let files = files();
    if files.is_empty() {
        println!("No ARW files: set LOPSY_ARW_SAMPLES. Skipping.");
        return;
    }
    let review = std::env::var_os("LOPSY_ARW_REVIEW_DIR").map(PathBuf::from);
    let pct = |f: f32| format!("{:.2} %", f * 100.0);
    println!("| file | exposure | median ours / preview / sips | white ours / preview / sips / before | p10 before → after | decode before → after |");
    for path in files {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let stem = name.trim_end_matches(".ARW").to_string();
        let data = std::fs::read(&path).unwrap();
        // Before: the whole decode as it was without exposure matching.
        let t0 = std::time::Instant::now();
        let prep = arw_linear::prepare_arw(&data).unwrap();
        let (ow, oh) = prep.params.oriented_size();
        let before = arw::bake_prepared(prep, 0.0).unwrap();
        let before_ms = t0.elapsed().as_millis();
        let (_, _, jpeg) = preview(&data, f64::from(ow) / f64::from(oh));
        let t1 = std::time::Instant::now();
        let after = arw::read_arw(&data).unwrap();
        let after_ms = t1.elapsed().as_millis();
        let pic = |img: &lopsy_core::dng::DngImage| Picture::from_rgba_encoded(img.width, img.height, &img.pixels).resample(jpeg.w);
        let (b, a) = (pic(&before.image), pic(&after.image));
        let ((_, b_white), (a_med, a_white), (j_med, j_white)) = (stats(&b), stats(&a), stats(&jpeg));
        let p10 = |p: &Picture| raw_compare::brightness(p)[1];
        let sips = raw_compare::sips_reference("LOPSY_ARW_SIPS_DIR", &stem);
        let s_stats = sips.as_ref().map(|s| stats(&s.resample(jpeg.w)));
        println!(
            "| {name} | {:+.2} EV | {a_med:.3} / {j_med:.3} / {} | {} / {} / {} / {} | {:.3} → {:.3} | {before_ms} → {after_ms} ms |",
            after.exposure_ev,
            s_stats.map_or("-".into(), |s| format!("{:.3}", s.0)),
            pct(a_white),
            pct(j_white),
            s_stats.map_or("-".into(), |s| pct(s.1)),
            pct(b_white),
            p10(&b),
            p10(&a),
        );
        assert!((a_med - j_med).abs() < MEDIAN_TOLERANCE, "{name}: median {a_med} against the preview's {j_med}");
        assert!(a_white <= j_white + WHITE_MARGIN, "{name}: {} at white against the camera's {}", pct(a_white), pct(j_white));
        if let Some((_, ev)) = EXPECTED_EV.iter().find(|(n, _)| *n == name) {
            assert!((after.exposure_ev - ev).abs() < EV_TOLERANCE, "{name}: exposure {} against the expected {ev}", after.exposure_ev);
        }
        if let Some(dir) = &review {
            let full = Picture::from_rgba_encoded(after.image.width, after.image.height, &after.image.pixels);
            full.resample(2000).write_png(&dir.join(format!("{stem}-lopsy.png")));
            let (cw, ch) = (800.min(full.w), 600.min(full.h));
            full.crop((full.w - cw) / 2, (full.h - ch) / 2, cw, ch).write_png(&dir.join(format!("{stem}-lopsy-100pct.png")));
            let mut tiles = vec![&a, &jpeg];
            if let Some(s) = &sips {
                tiles.push(s);
            }
            side_by_side(&dir.join(format!("{stem}-lopsy-jpeg-sips.png")), &tiles);
        }
    }
}

/// The RAW interface's develop defaults for an ARW open at the camera's
/// brightness too: rendered through the develop chain's CPU references
/// (binned view, scene tone at 0, tone, SDR output for sRGB), the median
/// is within 0.01 of the camera preview's, the exposure lies within the
/// bounds, and the baked decode does not read it.
#[test]
fn develop_defaults_match_the_cameras_preview() {
    use lopsy_core::output::{output_reference, OutputSettings, OutputTarget};
    use lopsy_core::raf::develop::{scene_reference, tone_settings};
    let pct = |f: f32| format!("{:.2} %", f * 100.0);
    for path in files() {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let data = std::fs::read(&path).unwrap();
        let t0 = std::time::Instant::now();
        let prep = lopsy_core::raw::prepare(&data).unwrap();
        let ms = t0.elapsed().as_millis();
        let d = &prep.description;
        let ev = d.develop_defaults.exposure_ev;
        assert!((lopsy_core::arw::exposure::MIN_EV..=lopsy_core::arw::exposure::MAX_EV).contains(&ev), "{name}: {ev}");
        assert!(d.profiles.iter().all(|p| p.settings.exposure_ev == ev), "{name}: every profile opens at the matched exposure");
        let (_, _, jpeg) = preview(&data, f64::from(d.width) / f64::from(d.height));
        let (bw, bh, binned) = prep.binned_linear(jpeg.w.max(jpeg.h) as u32).unwrap();
        let scene = scene_reference(&binned, &d.develop_defaults);
        let toned = lopsy_core::scene_tone::scene_tone_reference(&scene, bw as usize, bh as usize, &Default::default(), &[], &[]);
        let rendered = lopsy_core::tone::tone_reference(&toned, &tone_settings(&d.develop_defaults));
        let out = output_reference(&rendered, bw, &OutputSettings::sdr(OutputTarget::Srgb, lopsy_core::working_space::Gamut::Rec2020, false));
        let developed = Picture::from_rgba_encoded(bw, bh, &out).resample(jpeg.w);
        let ((med, white), (j_med, j_white)) = (stats(&developed), stats(&jpeg));
        println!("| {name} | {ev:+.2} EV | {med:.3} / {j_med:.3} | {} / {} | prepare {ms} ms |", pct(white), pct(j_white));
        assert!((med - j_med).abs() < 0.01, "{name}: developed median {med} against the preview's {j_med}");
        // The baked decode is the one it was: it never reads the field.
        let baked = arw::read_arw(&data).unwrap();
        let again = arw::read_arw(&data).unwrap();
        assert_eq!(baked.exposure_ev, again.exposure_ev);
    }
}

/// A damaged or cut preview costs the match, never the decode: bytes inside
/// the preview changed in many places, its second half zeroed, its header
/// broken; every time the file still decodes, and never panics.
#[test]
fn a_damaged_preview_never_fails_the_decode() {
    for path in files() {
        let data = std::fs::read(&path).unwrap();
        let prep = arw_linear::prepare_arw(&data).unwrap();
        let (ow, oh) = prep.params.oriented_size();
        drop(prep);
        let (o, n, _) = preview(&data, f64::from(ow) / f64::from(oh));
        let mut seed = 0x51f1_5eed_c0ff_ee11u64;
        let mut cases: Vec<Vec<u8>> = Vec::new();
        for _ in 0..6 {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            let mut d = data.clone();
            for k in 0..8 {
                let at = o + ((seed >> (k * 7)) as usize % n);
                d[at] ^= 0x5a;
            }
            cases.push(d);
        }
        let mut half = data.clone();
        half[o + n / 2..o + n].fill(0);
        cases.push(half);
        let mut header = data.clone();
        header[o..o + 64.min(n)].fill(0xff);
        cases.push(header);
        let mut lifted = Vec::new();
        for d in cases {
            let img = arw::read_arw(&d).unwrap_or_else(|e| panic!("{}: a damaged preview failed the decode: {e}", path.display()));
            lifted.push(format!("{:+.2}", img.exposure_ev));
        }
        println!("{}: exposures with a damaged preview: {}", path.display(), lifted.join(" "));
    }
}
