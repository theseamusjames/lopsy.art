//! An experiment, not a check: how far the default ARW renders are from
//! the camera's own brightness. For each ARW in `LOPSY_ARW_SAMPLES`, both
//! the baked decode without exposure matching (`arw::bake_prepared`) and
//! the RAW develop defaults (the
//! binned view through the CPU references, working space on, sRGB) are
//! rendered (a) as they ship and (b) with the exposure, in stops, at which
//! their median luminance equals that of the smallest JPEG the camera
//! embedded in the file. It prints the exposure and the share of the
//! picture clipped to white in each, and writes one side-by-side image a
//! file (top row the baked decode, bottom row the develop defaults: (a),
//! (b), the camera's JPEG, macOS's decode when `LOPSY_ARW_SIPS_DIR` holds
//! it) to `LOPSY_ARW_EXPERIMENT_DIR`. Runs only when that is set;
//! `--release`.

use std::path::{Path, PathBuf};

use lopsy_core::arw::{self, linear as arw_linear};
use lopsy_core::dng::linear::render_binned_linear_for;
use lopsy_core::dng::tiff::TiffReader;
use lopsy_core::output::{output_reference, OutputSettings, OutputTarget};
use lopsy_core::raf::develop::{scene_reference, tone_settings, RawDevelopSettings};
use lopsy_core::working_space::Gamut;

#[path = "support/raw_compare.rs"]
mod raw_compare;
use raw_compare::Picture;

/// The smallest JPEG the file embeds (`JPEGInterchangeFormat`) that is good
/// enough: the whole picture (the decode's aspect, within 1 %; the EXIF
/// thumbnail is 4:3 with bands) and at least 1000 pixels wide.
fn smallest_jpeg(data: &[u8], aspect: f64) -> Option<Picture> {
    let reader = TiffReader::new(data).ok()?;
    let mut found: Vec<Picture> = Vec::new();
    for i in 0..6 {
        let Ok(ifd) = reader.read_ifd(i) else { break };
        let get = |tag: u16| ifd.iter().find(|e| e.tag == tag).and_then(|e| e.as_u32());
        let (Some(o), Some(n)) = (get(0x201), get(0x202)) else { continue };
        let Some(bytes) = data.get(o as usize..(o + n) as usize) else { continue };
        let mut dec = jpeg_decoder::Decoder::new(bytes);
        let Ok(px) = dec.decode() else { continue };
        let Some(info) = dec.info() else { continue };
        let (w, h) = (info.width as usize, info.height as usize);
        if info.pixel_format == jpeg_decoder::PixelFormat::RGB24 && w >= 1000 && (w as f64 / h as f64 / aspect - 1.0).abs() < 0.01 {
            found.push(Picture::from_rgb8(w, h, &px));
        }
    }
    found.into_iter().min_by_key(|p| p.w)
}

/// Median and share clipped to white (every channel at least 0.98
/// encoded) of a picture in linear light.
fn stats(p: &Picture) -> (f32, f32) {
    let enc = |v: f32| lopsy_core::working_space::srgb_encode(v.clamp(0.0, 1.0));
    let mut lum: Vec<f32> = p.rgb.chunks_exact(3).map(|c| enc(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2])).collect();
    let clipped = p.rgb.chunks_exact(3).filter(|c| c.iter().all(|&v| enc(v) >= 0.98)).count() as f32 / lum.len() as f32;
    lum.sort_by(f32::total_cmp);
    (lum[lum.len() / 2], clipped)
}

/// The exposure (stops) at which `render`'s median matches `target`, by
/// bisection over −2..+5 stops (the median rises with exposure).
fn match_median(target: f32, render: &dyn Fn(f32) -> Picture) -> (f32, Picture) {
    let (mut lo, mut hi) = (-2.0f32, 5.0f32);
    for _ in 0..14 {
        let mid = (lo + hi) / 2.0;
        if stats(&render(mid)).0 < target {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let ev = (lo + hi) / 2.0;
    (ev, render(ev))
}

fn side_by_side(path: &Path, rows: &[Vec<&Picture>]) {
    let tile = 600usize;
    let scaled: Vec<Vec<Picture>> = rows.iter().map(|r| r.iter().map(|p| p.resample(tile)).collect()).collect();
    let th = scaled.iter().flatten().map(|p| p.h).max().unwrap();
    let (w, h) = (tile * 4 + 3 * 8, th * rows.len() + 8 * (rows.len() - 1));
    let mut img = Picture { w, h, rgb: vec![1.0; w * h * 3] };
    for (ri, row) in scaled.iter().enumerate() {
        for (ci, p) in row.iter().enumerate() {
            let (x0, y0) = (ci * (tile + 8), ri * (th + 8));
            for y in 0..p.h {
                let d = ((y0 + y) * w + x0) * 3;
                img.rgb[d..d + p.w * 3].copy_from_slice(&p.rgb[y * p.w * 3..(y + 1) * p.w * 3]);
            }
        }
    }
    img.write_png(path);
}

#[test]
fn exposure_matched_to_the_cameras_jpeg() {
    let (Some(dir), Some(out)) = (std::env::var_os("LOPSY_ARW_SAMPLES"), std::env::var_os("LOPSY_ARW_EXPERIMENT_DIR")) else {
        println!("Set LOPSY_ARW_SAMPLES and LOPSY_ARW_EXPERIMENT_DIR to run the exposure experiment.");
        return;
    };
    let out = PathBuf::from(out);
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir).unwrap().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("arw"))).collect();
    files.sort();
    println!("| file | JPEG median / white | baked (a) median / white | baked (b) stops / median / white | develop (a) median / white | develop (b) stops / median / white |");
    for path in files {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let stem = name.trim_end_matches(".ARW").to_string();
        let data = std::fs::read(&path).unwrap();
        let prep = arw_linear::prepare_arw(&data).unwrap();
        let (ow, oh) = prep.params.oriented_size();
        let jpeg = smallest_jpeg(&data, f64::from(ow) / f64::from(oh)).expect("an embedded JPEG of the whole picture");
        let (j_med, j_clip) = stats(&jpeg);
        let bake = |ev: f32| {
            let copy = arw_linear::ArwPrepared { params: prep.params.clone(), plane: prep.plane.clone(), unhandled: Vec::new(), debug_log: Vec::new() };
            let img = arw::bake_prepared(copy, ev).unwrap().image;
            Picture::from_rgba_encoded(img.width, img.height, &img.pixels).resample(2000)
        };
        let (bw, bh, binned) = render_binned_linear_for(&prep.plane, &prep.params, 2000).unwrap();
        let defaults = arw_linear::develop_defaults(&prep.params);
        let develop = |ev: f32| {
            let settings = RawDevelopSettings { exposure_ev: defaults.exposure_ev + ev, ..defaults.clone() };
            let scene = scene_reference(&binned, &settings);
            let rendered = lopsy_core::tone::tone_reference(&scene, &tone_settings(&settings));
            Picture::from_rgba_encoded(bw, bh, &output_reference(&rendered, bw, &OutputSettings::sdr(OutputTarget::Srgb, Gamut::Rec2020, false)))
        };
        let baked_a = bake(0.0);
        let (b_ev, baked_b) = match_median(j_med, &bake);
        let dev_a = develop(0.0);
        let (d_ev, dev_b) = match_median(j_med, &develop);
        let ((ba_med, ba_clip), (bb_med, bb_clip)) = (stats(&baked_a), stats(&baked_b));
        let ((da_med, da_clip), (db_med, db_clip)) = (stats(&dev_a), stats(&dev_b));
        let pct = |f: f32| format!("{:.2} %", f * 100.0);
        println!(
            "| {name} ({}×{} JPEG) | {j_med:.3} / {} | {ba_med:.3} / {} | {b_ev:+.2} / {bb_med:.3} / {} | {da_med:.3} / {} | {d_ev:+.2} / {db_med:.3} / {} |",
            jpeg.w, jpeg.h, pct(j_clip), pct(ba_clip), pct(bb_clip), pct(da_clip), pct(db_clip)
        );
        let sips = raw_compare::sips_reference("LOPSY_ARW_SIPS_DIR", &stem);
        let mut top: Vec<&Picture> = vec![&baked_a, &baked_b, &jpeg];
        let mut bottom: Vec<&Picture> = vec![&dev_a, &dev_b, &jpeg];
        if let Some(s) = &sips {
            top.push(s);
            bottom.push(s);
        }
        side_by_side(&out.join(format!("{stem}-exposure.png")), &[top, bottom]);
    }
}
