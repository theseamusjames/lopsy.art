//! The RAW interface (`lopsy_core::raw`) on real files of every format:
//!
//! - RAF (`LOPSY_RAF_SAMPLES`): the parameters string through the interface
//!   is byte for byte the one `rafPrepare` writes, every linear band through
//!   the dispatch is bit-identical to `raf::develop::render_linear_band`'s,
//!   the finished band to `raf::render_band`'s, and the description's
//!   defaults and profiles are `raf::develop`'s.
//! - DNG (`LOPSY_DNG_SAMPLES`, `LOPSY_DNG_ADOBE_SAMPLES`) and ARW
//!   (`LOPSY_ARW_SAMPLES`): bands through the dispatch are bit-identical to
//!   the whole frame, the binned view works, and the lossy DNGs are refused
//!   with "DNG cannot open as RAW:".
//! - Every format: the oriented size of the linear path equals the baked
//!   decode's, and `sniff` names the format.
//!
//! Folders not set are noted and skipped. Full-size files: `--release`.

use std::path::PathBuf;

use lopsy_core::raw::{self, RawFormatId};

fn files(var: &str, ext: &str) -> Vec<PathBuf> {
    let Some(dir) = std::env::var_os(var) else {
        println!("{var} is not set: skipped");
        return Vec::new();
    };
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir).map(|r| r.flatten().map(|e| e.path()).collect()).unwrap_or_default();
    v.retain(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case(ext)));
    v.sort();
    v
}

fn bits(v: &[f32]) -> Vec<u32> {
    v.iter().map(|x| x.to_bits()).collect()
}

/// Render every band of a prepared file through the dispatch and assemble
/// them; assert they equal the whole-frame band.
fn bands_equal_whole(name: &str, prep: &raw::PreparedRaw) {
    let d = &prep.description;
    let row = (d.plane_width * d.samples_per_pixel) as usize;
    let plane = prep.plane();
    let whole_band = lopsy_core::raf::RafBand { y0: 0, y1: d.plane_height, src_y0: 0, src_y1: d.plane_height };
    let whole = raw::render_linear_band(prep.format, plane, &prep.params_json, whole_band).unwrap();
    assert_eq!((whole.width, whole.height), (d.width, d.height), "{name}: the whole band is the described size");
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
    assert!(bits(&out) == bits(&whole.pixels), "{name}: bands through the dispatch differ from the whole frame");
    let (bw, bh, _) = prep.binned_linear(1024).unwrap();
    assert!(bw.max(bh) >= 1024.min(d.width.max(d.height)), "{name}: binned {bw}×{bh}");
    let (bw2, bh2, _) = raw::render_binned_linear(prep.format, plane, &prep.params_json, 1024).unwrap();
    assert_eq!((bw, bh), (bw2, bh2));
}

#[test]
fn raf_through_the_interface_is_raf() {
    for path in files("LOPSY_RAF_SAMPLES", "raf") {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let data = std::fs::read(&path).unwrap();
        assert_eq!(raw::sniff(&data), Some(RawFormatId::Raf), "{name}");
        let direct = lopsy_core::raf::prepare_raf(&data, lopsy_core::raf::RafDecodeOpts::default()).unwrap();
        let direct_json = serde_json::to_string(&direct.params).unwrap();
        let prep = raw::prepare(&data).unwrap();
        assert_eq!(prep.params_json, direct_json, "{name}: params differ from rafPrepare's");
        assert!(bits(prep.plane()) == bits(&direct.mosaic), "{name}: the mosaic differs");
        let d = &prep.description;
        assert_eq!(d.develop_defaults, lopsy_core::raf::develop::develop_defaults(&direct.params), "{name}");
        assert_eq!(d.profiles, lopsy_core::raf::develop::develop_profiles(&direct.params), "{name}");
        assert_eq!((d.width, d.height), direct.params.oriented_size());
        // Every linear band, and one finished band, against the functions
        // the raf… exports call.
        let w = direct.params.width as usize;
        let bands = lopsy_core::raf::plan_bands(direct.params.height, 4);
        assert_eq!(raw::plan_bands(RawFormatId::Raf, &prep.params_json, 4).unwrap(), bands, "{name}");
        for (i, &band) in bands.iter().enumerate() {
            let src = &direct.mosaic[band.src_y0 as usize * w..band.src_y1 as usize * w];
            let a = raw::render_linear_band(RawFormatId::Raf, src, &prep.params_json, band).unwrap();
            let b = lopsy_core::raf::develop::render_linear_band(src, &direct.params, band).unwrap();
            assert!((a.x, a.y, a.width, a.height) == (b.x, b.y, b.width, b.height) && bits(&a.pixels) == bits(&b.pixels), "{name}: linear band {i} differs");
            if i == 0 {
                let a = raw::render_finished_band(RawFormatId::Raf, src, &prep.params_json, band).unwrap();
                let b = lopsy_core::raf::render_band(src, &direct.params, band).unwrap();
                assert!(bits(&a.pixels) == bits(&b.pixels), "{name}: finished band differs");
            }
        }
        let (a, b) = (prep.binned_linear(2048).unwrap(), lopsy_core::raf::develop::render_binned_linear_for(&direct.mosaic, &direct.params, 2048).unwrap());
        assert!(a.0 == b.0 && a.1 == b.1 && bits(&a.2) == bits(&b.2), "{name}: binned view differs");
        // The baked decode's size.
        let baked = lopsy_core::raf::read_raf(&data).unwrap();
        assert_eq!((baked.width, baked.height), (d.width, d.height), "{name}: linear and baked sizes differ");
        println!("{name}: {} {}×{}, params {} bytes identical, {} bands identical, kelvin {:?}, {} presets", d.camera_model, d.width, d.height, prep.params_json.len(), bands.len(), d.white_balance.kelvin, d.white_balance.presets.len());
    }
}

#[test]
fn dng_and_arw_through_the_interface() {
    let mut all: Vec<(PathBuf, RawFormatId)> = Vec::new();
    for var in ["LOPSY_DNG_SAMPLES", "LOPSY_DNG_ADOBE_SAMPLES"] {
        all.extend(files(var, "dng").into_iter().map(|p| (p, RawFormatId::Dng)));
    }
    all.extend(files("LOPSY_ARW_SAMPLES", "arw").into_iter().map(|p| (p, RawFormatId::Arw)));
    for (path, format) in all {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let data = std::fs::read(&path).unwrap();
        assert_eq!(raw::sniff(&data), Some(format), "{name}");
        let t0 = std::time::Instant::now();
        let prep = match raw::prepare(&data) {
            Ok(p) => p,
            Err(e) if name.contains("lossy") => {
                assert_eq!(e, "DNG cannot open as RAW: This DNG uses lossy JPEG compression, which is not supported yet", "{name}");
                println!("{name}: refused: {e}");
                continue;
            }
            Err(e) => panic!("{name}: {e}"),
        };
        let prepare_ms = t0.elapsed().as_millis();
        let d = &prep.description;
        assert_eq!(d.format, format);
        bands_equal_whole(&name, &prep);
        let baked = match format {
            RawFormatId::Dng => {
                let b = lopsy_core::dng::read_dng(&data).unwrap();
                (b.width, b.height)
            }
            _ => {
                let b = lopsy_core::arw::read_arw(&data).unwrap();
                (b.image.width, b.image.height)
            }
        };
        assert_eq!(baked, (d.width, d.height), "{name}: linear and baked sizes differ");
        println!(
            "{name}: {} {}×{} ({}×{}×{} plane) prepared in {prepare_ms} ms; matrix {:?}, kelvin {:?}, presets {:?}, note {:?}",
            d.camera_model, d.width, d.height, d.plane_width, d.plane_height, d.samples_per_pixel, d.white_balance.matrix, d.white_balance.kelvin,
            d.white_balance.presets.iter().map(|p| format!("{} {}/{}", p.name, p.temperature, p.tint)).collect::<Vec<_>>(), d.color_note
        );
    }
}

#[test]
fn not_a_raw_is_named_as_such() {
    assert_eq!(raw::sniff(b"not a raw at all"), None);
    assert!(raw::prepare(b"not a raw at all").is_err());
    assert!(raw::plan_bands(RawFormatId::Raf, "{}", 4).is_err());
    assert_eq!(RawFormatId::parse("dng"), Ok(RawFormatId::Dng));
    assert!(RawFormatId::parse("cr3").is_err());
}
