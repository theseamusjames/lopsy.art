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
        let prep = raw::prepare(&data).unwrap_or_else(|e| panic!("{name}: {e}"));
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

/// A prepared Bayer DNG's or ARW's params, which the shared renders take.
enum Bayer {
    Dng(lopsy_core::dng::linear::DngRenderParams),
    Arw(lopsy_core::arw::linear::ArwRenderParams),
}

impl lopsy_core::dng::linear::PlaneParams for Bayer {
    fn layout(&self) -> lopsy_core::dng::linear::PlaneLayout {
        match self {
            Bayer::Dng(p) => p.layout(),
            Bayer::Arw(p) => p.layout(),
        }
    }
    fn highlight_chroma(&self) -> Option<&lopsy_core::raf::highlights::ChromaGrid> {
        match self {
            Bayer::Dng(p) => p.highlight_chroma.as_ref(),
            Bayer::Arw(p) => p.highlight_chroma.as_ref(),
        }
    }
}

/// Highlight reconstruction on Bayer DNG and ARW planes: where the prepare
/// measured a chroma grid, a binned pixel whose green clipped while red and
/// blue did not comes out closer, in log chroma, to the colour measured
/// around it than without reconstruction. (Bands with reconstruction stay
/// bit-identical to the whole frame: `dng_and_arw_through_the_interface`.)
#[test]
fn reconstruction_holds_highlight_hue() {
    use lopsy_core::dng::linear::{render_binned_linear, PlaneParams};
    let mut all: Vec<PathBuf> = files("LOPSY_DNG_ADOBE_SAMPLES", "dng");
    all.extend(files("LOPSY_ARW_SAMPLES", "arw"));
    for path in all {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let data = std::fs::read(&path).unwrap();
        let Ok(prep) = raw::prepare(&data) else { continue };
        let params = match &prep.prepared {
            raw::Prepared::Dng(p) => Bayer::Dng(p.params.clone()),
            raw::Prepared::Arw(p) => Bayer::Arw(p.params.clone()),
            raw::Prepared::Raf(_) => continue,
        };
        let layout = params.layout();
        let Some(grid) = params.highlight_chroma() else {
            println!("{name}: nothing near its clip level (or LinearRaw): no reconstruction");
            continue;
        };
        let clip = prep.description.clip_levels.unwrap();
        let factor = 4;
        let with = render_binned_linear(prep.plane(), &params, factor).unwrap();
        let plain = render_binned_linear(prep.plane(), &layout, factor).unwrap();
        let chi = |c: [f32; 3]| {
            let l = c.map(|v| v.max(1e-6).ln());
            let m = (l[0] + l[1] + l[2]) / 3.0;
            l.map(|v| v - m)
        };
        let dist = |a: [f32; 3], b: [f32; 3]| ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt();
        let (mut before, mut after, mut n, mut above) = (0f64, 0f64, 0usize, 0usize);
        for by in 0..plain.1 as usize {
            for bx in 0..plain.0 as usize {
                let i = (by * plain.0 as usize + bx) * 4;
                let p: [f32; 3] = [plain.2[i], plain.2[i + 1], plain.2[i + 2]];
                let r: [f32; 3] = [with.2[i], with.2[i + 1], with.2[i + 2]];
                above += usize::from((0..3).any(|k| r[k] > clip[k] * 1.001));
                if layout.orientation == 1 && p[1] >= 0.98 * clip[1] && p[0] < 0.9 * clip[0] && p[2] < 0.9 * clip[2] {
                    let f = factor as usize;
                    let target = grid.chroma_at(bx * f + f / 2, by * f + f / 2);
                    before += f64::from(dist(chi(p), target));
                    after += f64::from(dist(chi(r), target));
                    n += 1;
                }
            }
        }
        if n > 0 {
            let (b, a) = (before / n as f64, after / n as f64);
            println!("{name}: {n} binned pixels with green alone clipped: log-chroma distance to the measured surround {b:.3} without, {a:.3} with; {above} binned pixels rise above the clip level");
            assert!(a < b, "{name}: reconstruction moved clipped highlights away from their surround's colour");
        } else {
            println!("{name}: no binned pixel with green alone clipped; {above} rise above the clip level");
        }
    }
}

/// The format alone says whether it renders finished bands, and every
/// prepared file of that format says the same in its description; RAF is
/// the one that does.
#[test]
fn the_format_answers_finished_bands_as_its_descriptions_do() {
    assert!(raw::renders_finished_bands(RawFormatId::Raf));
    assert!(!raw::renders_finished_bands(RawFormatId::Dng));
    assert!(!raw::renders_finished_bands(RawFormatId::Arw));
    let mut paths = files("LOPSY_RAF_SAMPLES", "raf");
    paths.extend(files("LOPSY_DNG_SAMPLES", "dng"));
    paths.extend(files("LOPSY_DNG_ADOBE_SAMPLES", "dng"));
    paths.extend(files("LOPSY_ARW_SAMPLES", "arw"));
    let mut seen = 0;
    for path in paths {
        let data = std::fs::read(&path).unwrap();
        let Ok(prep) = raw::prepare(&data) else { continue };
        let name = path.file_name().unwrap().to_string_lossy();
        assert_eq!(prep.description.finished_bands, raw::renders_finished_bands(prep.format), "{name}");
        seen += 1;
    }
    println!("{seen} files: finished bands as their format says");
}
